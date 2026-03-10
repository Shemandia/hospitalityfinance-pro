import { Prisma, PrismaClient } from "@prisma/client";
import { setEntityDbContext } from "../../db/tenantContext.js";
import { sendApprovalEmail } from "../../shared/email.js";
import { GLRepository } from "./repository.js";
import type {
  AccountCreateInput,
  AccountUpdateInput,
  JournalCreateInput,
  JournalListQuery
} from "./types.js";

type AccountTreeNode = {
  id: string;
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  usaliCategory: string | null;
  usaliDepartment: string | null;
  allowPosting: boolean;
  level: number;
  parentId: string | null;
  children: AccountTreeNode[];
};

type PostingJournal = {
  id: string;
  entityId: string;
  periodId: string;
  functionalCurrency: string;
  status: string;
  period: {
    id: string;
    name: string;
    status: string;
  };
  lines: Array<{
    accountId: string;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
    currency: string;
    fxRate: Prisma.Decimal;
    debitFunctional: Prisma.Decimal;
    creditFunctional: Prisma.Decimal;
    lineNumber: number;
    description: string | null;
    dimension1: string | null;
    dimension2: string | null;
    dimension3: string | null;
    dimension4: string | null;
    dimension5: string | null;
    dimension6: string | null;
  }>;
};

export class GLServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export class GLService {
  constructor(private readonly prisma: PrismaClient) {}

  private repository(client: PrismaClient | Prisma.TransactionClient) {
    return new GLRepository(client);
  }

  async listAccounts(entityId: string): Promise<AccountTreeNode[]> {
    const accounts = await this.repository(this.prisma).listAccounts(entityId);
    const byId = new Map<string, AccountTreeNode>();

    for (const account of accounts) {
      byId.set(account.id, {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        usaliCategory: account.usaliCategory,
        usaliDepartment: account.usaliDepartment,
        allowPosting: account.allowPosting,
        level: account.level,
        parentId: account.parentId,
        children: []
      });
    }

    const roots: AccountTreeNode[] = [];

    for (const node of byId.values()) {
      if (!node.parentId) {
        roots.push(node);
        continue;
      }

      const parent = byId.get(node.parentId);
      if (!parent) {
        roots.push(node);
        continue;
      }

      parent.children.push(node);
    }

    return roots;
  }

  async getAccount(entityId: string, id: string) {
    const account = await this.repository(this.prisma).findAccountById(entityId, id);
    if (!account) {
      throw new GLServiceError("GL_ACCOUNT_NOT_FOUND", "Account not found.", 404);
    }
    return account;
  }

  async createAccount(entityId: string, input: AccountCreateInput) {
    const repository = this.repository(this.prisma);

    const existing = await repository.findAccountByCode(entityId, input.code);
    if (existing?.isActive) {
      throw new GLServiceError(
        "GL_ACCOUNT_CODE_EXISTS",
        `Account code ${input.code} already exists.`,
        409
      );
    }

    if (input.parentId) {
      const parent = await repository.findAccountById(entityId, input.parentId);
      if (!parent) {
        throw new GLServiceError(
          "GL_PARENT_ACCOUNT_NOT_FOUND",
          "Parent account not found.",
          404
        );
      }
    }

    return repository.createAccount(entityId, input);
  }

  async updateAccount(entityId: string, id: string, input: AccountUpdateInput) {
    const repository = this.repository(this.prisma);
    await this.getAccount(entityId, id);

    if (input.code) {
      const existing = await repository.findAccountByCode(entityId, input.code);
      if (existing && existing.id !== id && existing.isActive) {
        throw new GLServiceError(
          "GL_ACCOUNT_CODE_EXISTS",
          `Account code ${input.code} already exists.`,
          409
        );
      }
    }

    if (input.parentId) {
      const parent = await repository.findAccountById(entityId, input.parentId);
      if (!parent) {
        throw new GLServiceError(
          "GL_PARENT_ACCOUNT_NOT_FOUND",
          "Parent account not found.",
          404
        );
      }
    }

    const result = await repository.updateAccount(entityId, id, input);
    if (result.count === 0) {
      throw new GLServiceError("GL_ACCOUNT_NOT_FOUND", "Account not found.", 404);
    }

    return this.getAccount(entityId, id);
  }

  async deleteAccount(entityId: string, id: string) {
    const repository = this.repository(this.prisma);
    await this.getAccount(entityId, id);

    const journalUsageCount = await repository.countJournalLinesByAccount(
      entityId,
      id
    );
    if (journalUsageCount > 0) {
      throw new GLServiceError(
        "GL_ACCOUNT_HAS_TRANSACTIONS",
        "Account cannot be deleted because it has journal transactions.",
        409
      );
    }

    await repository.softDeleteAccount(entityId, id);
    return { id, deleted: true };
  }

  validateBalance(lines: JournalCreateInput["lines"]): void {
    const totals = lines.reduce(
      (acc, line) => {
        const debit = new Prisma.Decimal(line.debit);
        const credit = new Prisma.Decimal(line.credit);
        acc.debit = acc.debit.add(debit);
        acc.credit = acc.credit.add(credit);
        return acc;
      },
      {
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0)
      }
    );

    if (totals.debit.toDecimalPlaces(4).equals(totals.credit.toDecimalPlaces(4)) === false) {
      throw new GLServiceError(
        "GL_UNBALANCED_JOURNAL",
        `Journal is unbalanced. Debits=${totals.debit.toFixed(4)}, Credits=${totals.credit.toFixed(4)}.`,
        422
      );
    }
  }

  private computeJournalAmount(lines: JournalCreateInput["lines"]): Prisma.Decimal {
    return lines.reduce((total, line) => {
      const debitFunctional = new Prisma.Decimal(line.debit).mul(
        new Prisma.Decimal(line.fxRate)
      );
      return total.add(debitFunctional.abs());
    }, new Prisma.Decimal(0));
  }

  private toJournalInputLines(journal: PostingJournal): JournalCreateInput["lines"] {
    return journal.lines.map((line) => ({
      accountId: line.accountId,
      debit: line.debit.toString(),
      credit: line.credit.toString(),
      currency: line.currency,
      fxRate: line.fxRate.toString(),
      description: line.description ?? undefined,
      lineNumber: line.lineNumber,
      dimension1: line.dimension1 ?? undefined,
      dimension2: line.dimension2 ?? undefined,
      dimension3: line.dimension3 ?? undefined,
      dimension4: line.dimension4 ?? undefined,
      dimension5: line.dimension5 ?? undefined,
      dimension6: line.dimension6 ?? undefined
    }));
  }

  private async postJournalInternal(
    repository: GLRepository,
    journal: PostingJournal,
    approvedById: string
  ) {
    if (journal.period.status !== "OPEN") {
      throw new GLServiceError(
        "GL_PERIOD_CLOSED",
        `Period ${journal.period.name} is not open.`,
        422
      );
    }

    this.validateBalance(this.toJournalInputLines(journal));

    await repository.setJournalStatus(journal.entityId, journal.id, "POSTED", approvedById);

    for (const line of journal.lines) {
      await repository.updateAccountBalance(
        journal.entityId,
        line.accountId,
        journal.periodId,
        line.debitFunctional,
        line.creditFunctional,
        line.account.type
      );
    }
  }

  async createJournal(
    entityId: string,
    createdById: string,
    input: JournalCreateInput
  ) {
    const period = await this.repository(this.prisma).getPeriod(entityId, input.periodId);
    if (!period) {
      throw new GLServiceError("GL_PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    const journalAmount = this.computeJournalAmount(input.lines);

    const result = await this.prisma.$transaction(async (transaction) => {
      await setEntityDbContext(transaction, entityId);
      const repository = this.repository(transaction);
      const created = await repository.createJournal(entityId, createdById, input);
      const rule = await repository.getApprovalRuleForAmount(entityId, "GL", journalAmount);

      if (!rule || rule.requiredApprovers.length === 0) {
        return { journal: created, approvalRecipients: [] as Array<{ id: string; email: string; name: string }> };
      }

      await repository.setJournalStatus(entityId, created.id, "PENDING_APPROVAL", null);
      await repository.createJournalApprovals(entityId, created.id, rule.requiredApprovers);

      const approvals = await repository.getJournalApprovalEntries(entityId, created.id);
      const recipients = approvals.map((entry) => ({
        id: entry.approver.id,
        email: entry.approver.email,
        name: entry.approver.name
      }));

      const refreshed = await repository.getJournalWithLines(entityId, created.id);
      return {
        journal: refreshed ?? created,
        approvalRecipients: recipients
      };
    });

    const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";

    const emailResults = await Promise.allSettled(
      result.approvalRecipients.map((recipient) =>
        sendApprovalEmail({
          to: recipient.email,
          approverName: recipient.name,
          journalId: result.journal.id,
          entityId,
          approveUrl: `${appBaseUrl}/approval/journals/${result.journal.id}?action=approve&approverId=${recipient.id}`,
          rejectUrl: `${appBaseUrl}/approval/journals/${result.journal.id}?action=reject&approverId=${recipient.id}`
        })
      )
    );
    const emailFailures = emailResults.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    if (emailFailures.length > 0) {
      console.warn(
        "[GLService] Approval email failures:",
        emailFailures.length,
        emailFailures.map(f => f.reason?.message ?? "unknown")
      );
    }

    return result.journal;
  }

  async postJournal(entityId: string, journalId: string, approvedById: string) {
    return this.prisma.$transaction(async (transaction) => {
      await setEntityDbContext(transaction, entityId);
      const repository = this.repository(transaction);
      const journal = await repository.getJournalWithLines(entityId, journalId);

      if (!journal) {
        throw new GLServiceError("GL_JOURNAL_NOT_FOUND", "Journal not found.", 404);
      }

      if (journal.status !== "DRAFT") {
        throw new GLServiceError(
          "GL_JOURNAL_INVALID_STATUS",
          "Only draft journals can be posted directly.",
          409
        );
      }

      await this.postJournalInternal(repository, journal as PostingJournal, approvedById);
      return repository.getJournalWithLines(entityId, journal.id);
    });
  }

  async approveJournal(
    entityId: string,
    journalId: string,
    approverId: string,
    reason?: string
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await setEntityDbContext(transaction, entityId);
      const repository = this.repository(transaction);
      const journal = await repository.getJournalWithLines(entityId, journalId);

      if (!journal) {
        throw new GLServiceError("GL_JOURNAL_NOT_FOUND", "Journal not found.", 404);
      }

      if (journal.status !== "PENDING_APPROVAL") {
        throw new GLServiceError(
          "GL_JOURNAL_NOT_PENDING_APPROVAL",
          "Journal is not awaiting approval.",
          409
        );
      }

      await repository.upsertJournalApprovalDecision(
        entityId,
        journalId,
        approverId,
        "APPROVED",
        reason
      );

      const amount = this.computeJournalAmount(this.toJournalInputLines(journal as PostingJournal));
      const rule = await repository.getApprovalRuleForAmount(entityId, "GL", amount);
      const approvals = await repository.getJournalApprovalEntries(entityId, journalId);

      const approvedCount = approvals.filter((entry) => entry.status === "APPROVED").length;
      const requiredCount = approvals.length;
      const shouldPost = rule?.requireAll
        ? approvedCount === requiredCount && requiredCount > 0
        : approvedCount > 0;

      if (shouldPost) {
        const current = await repository.getJournalWithLines(entityId, journalId);
        if (!current) {
          throw new GLServiceError("GL_JOURNAL_NOT_FOUND", "Journal not found.", 404);
        }
        await this.postJournalInternal(repository, current as PostingJournal, approverId);
      }

      return repository.getJournalWithLines(entityId, journalId);
    });
  }

  async rejectJournal(
    entityId: string,
    journalId: string,
    approverId: string,
    reason?: string
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await setEntityDbContext(transaction, entityId);
      const repository = this.repository(transaction);
      const journal = await repository.getJournalWithLines(entityId, journalId);

      if (!journal) {
        throw new GLServiceError("GL_JOURNAL_NOT_FOUND", "Journal not found.", 404);
      }

      if (journal.status !== "PENDING_APPROVAL") {
        throw new GLServiceError(
          "GL_JOURNAL_NOT_PENDING_APPROVAL",
          "Journal is not awaiting approval.",
          409
        );
      }

      await repository.upsertJournalApprovalDecision(
        entityId,
        journalId,
        approverId,
        "REJECTED",
        reason
      );
      await repository.markPendingApprovalsRejected(entityId, journalId, reason);

      // Reverse account balances if journal was already posted
      if (journal.status === "POSTED") {
        for (const line of journal.lines) {
          await repository.updateAccountBalance(
            entityId,
            line.accountId,
            journal.periodId,
            line.creditFunctional,  // swapped: credits become debits
            line.debitFunctional,   // swapped: debits become credits
            line.account.type
          );
        }
      }

      await repository.setJournalStatus(entityId, journalId, "DRAFT", null);

      return repository.getJournalWithLines(entityId, journalId);
    });
  }

  async reverseJournal(entityId: string, journalId: string, createdById: string) {
    return this.prisma.$transaction(async (transaction) => {
      await setEntityDbContext(transaction, entityId);
      const repository = this.repository(transaction);
      const existing = await repository.getJournalWithLines(entityId, journalId);

      if (!existing) {
        throw new GLServiceError("GL_JOURNAL_NOT_FOUND", "Journal not found.", 404);
      }

      if (existing.status !== "POSTED") {
        throw new GLServiceError(
          "GL_JOURNAL_NOT_POSTED",
          "Only posted journals can be reversed.",
          409
        );
      }

      const reversal = await repository.createJournal(entityId, createdById, {
        periodId: existing.periodId,
        reference: `REV-${existing.reference ?? existing.id}`,
        description: `Reversal of journal ${existing.id}`,
        source: "MANUAL",
        functionalCurrency: existing.functionalCurrency,
        lines: existing.lines.map((line) => ({
          accountId: line.accountId,
          debit: line.credit.toString(),
          credit: line.debit.toString(),
          currency: line.currency,
          fxRate: line.fxRate.toString(),
          description: line.description ?? undefined,
          lineNumber: line.lineNumber,
          dimension1: line.dimension1 ?? undefined,
          dimension2: line.dimension2 ?? undefined,
          dimension3: line.dimension3 ?? undefined,
          dimension4: line.dimension4 ?? undefined,
          dimension5: line.dimension5 ?? undefined,
          dimension6: line.dimension6 ?? undefined
        }))
      });

      await repository.setJournalStatus(entityId, existing.id, "REVERSED", createdById);
      const postedReversal = await repository.getJournalWithLines(entityId, reversal.id);
      if (!postedReversal) {
        throw new GLServiceError("GL_JOURNAL_NOT_FOUND", "Reversal journal not found.", 404);
      }
      await this.postJournalInternal(repository, postedReversal as PostingJournal, createdById);

      return repository.getJournalWithLines(entityId, reversal.id);
    });
  }

  async getAccountLedger(
    entityId: string,
    accountId: string,
    opts: { periodId?: string; status?: string; limit: number; offset: number }
  ) {
    const repo = this.repository(this.prisma);
    const account = await repo.findAccountById(entityId, accountId);
    if (!account) {
      throw new GLServiceError("GL_ACCOUNT_NOT_FOUND", "Account not found.", 404);
    }

    const [lines, total] = await Promise.all([
      repo.getAccountLedger(entityId, accountId, opts),
      repo.countAccountLedger(entityId, accountId, {
        periodId: opts.periodId,
        status: opts.status
      })
    ]);

    return {
      account: {
        id: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
        usaliCategory: account.usaliCategory,
        usaliDepartment: account.usaliDepartment
      },
      lines: lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        debit: line.debit.toString(),
        credit: line.credit.toString(),
        debitFunctional: line.debitFunctional.toString(),
        creditFunctional: line.creditFunctional.toString(),
        currency: line.currency,
        fxRate: line.fxRate.toString(),
        description: line.description,
        dimension1: line.dimension1,
        dimension2: line.dimension2,
        journalId: line.journal.id,
        journalRef: line.journal.reference,
        journalDescription: line.journal.description,
        journalStatus: line.journal.status,
        journalSource: line.journal.source,
        journalDate: line.journal.postedAt ?? line.journal.createdAt,
        periodId: line.journal.periodId,
        periodName: line.journal.period?.name ?? null
      })),
      total,
      limit: opts.limit,
      offset: opts.offset
    };
  }

  listJournals(entityId: string, query: JournalListQuery) {
    return this.repository(this.prisma).listJournals(entityId, query);
  }

  async getJournal(entityId: string, journalId: string) {
    const journal = await this.repository(this.prisma).getJournalWithLines(entityId, journalId);
    if (!journal) {
      throw new GLServiceError("GL_JOURNAL_NOT_FOUND", "Journal not found.", 404);
    }
    return journal;
  }

  async getTrialBalance(
    entityId: string,
    periodId: string,
    comparativePeriodId: string | undefined,
    showZeroBalances: boolean
  ) {
    const rows = await this.repository(this.prisma).runTrialBalanceQuery(
      entityId,
      periodId,
      comparativePeriodId,
      showZeroBalances
    );

    const totals = rows.reduce(
      (acc, row) => {
        acc.debits = acc.debits.add(new Prisma.Decimal(row.period_debits));
        acc.credits = acc.credits.add(new Prisma.Decimal(row.period_credits));
        return acc;
      },
      { debits: new Prisma.Decimal(0), credits: new Prisma.Decimal(0) }
    );

    const isBalanced = totals.debits
      .toDecimalPlaces(4)
      .equals(totals.credits.toDecimalPlaces(4));

    return {
      data: rows.map((row) => ({
        accountId: row.account_id,
        accountCode: row.account_code,
        accountName: row.account_name,
        accountType: row.account_type,
        accountLevel: row.account_level,
        openingBalance: row.opening_balance.toString(),
        periodDebits: row.period_debits.toString(),
        periodCredits: row.period_credits.toString(),
        closingBalance: row.closing_balance.toString(),
        comparativeClosingBalance: row.comparative_closing_balance?.toString() ?? null
      })),
      isBalanced
    };
  }
}
