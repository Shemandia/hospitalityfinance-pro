import { Prisma, PrismaClient } from "../../db/client.js";
import { setEntityDbContext, clearEntityDbContext } from "../../db/tenantContext.js";
import { sendApprovalEmail } from "../../shared/email.js";
import { AuthorizationService } from "../authorization/service.js";
import { GLRepository, JournalTypeRepository } from "./repository.js";
import type {
  AccountCreateInput,
  AccountUpdateInput,
  JournalCreateInput,
  JournalListQuery,
  JournalTypeCreateInput,
  JournalTypeUpdateInput
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
  allowedSources: string[];
  level: number;
  parentId: string | null;
  children: AccountTreeNode[];
};

type PostingJournal = {
  id: string;
  entityId: string;
  periodId: string;
  functionalCurrency: string;
  source: string;
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
    account: { type: string };
  }>;
};

import { ServiceError } from "../../shared/service-error.js";

export class GLServiceError extends ServiceError {}

export class GLService {
  constructor(private readonly prisma: PrismaClient) {}

  private repository(client: PrismaClient | Prisma.TransactionClient) {
    return new GLRepository(client);
  }

  private journalTypeRepo(client: PrismaClient | Prisma.TransactionClient = this.prisma) {
    return new JournalTypeRepository(client);
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
        allowedSources: (account as any).allowedSources ?? [],
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
        throw new GLServiceError("GL_PARENT_ACCOUNT_NOT_FOUND", "Parent account not found.", 404);
      }
    }

    return repository.createAccount(entityId, input);
  }

  async updateAccount(entityId: string, id: string, input: AccountUpdateInput) {
    const repository = this.repository(this.prisma);
    const existing = await this.getAccount(entityId, id);

    // Account type is immutable once transactions have been posted to the account.
    // This matches SunSystems Memo-account semantics and prevents silently corrupting
    // historical balances when flipping between financial and statistical types.
    if (input.type && input.type !== existing.type) {
      const usageCount = await repository.countJournalLinesByAccount(entityId, id);
      if (usageCount > 0) {
        throw new GLServiceError(
          "GL_ACCOUNT_TYPE_IMMUTABLE",
          `Account ${existing.code} already has ${usageCount} posted journal line(s). ` +
            `Account type cannot be changed once transactions exist.`,
          409
        );
      }
    }

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
        throw new GLServiceError("GL_PARENT_ACCOUNT_NOT_FOUND", "Parent account not found.", 404);
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

    const journalUsageCount = await repository.countJournalLinesByAccount(entityId, id);
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

  /**
   * Validate that the sum of debits equals the sum of credits across `lines`.
   *
   * Statistics-only journals (every line posts to a STATISTICAL-type account)
   * are memo entries with no GL impact, so they skip the balance check entirely —
   * matching SunSystems Memo-account semantics. Mixed journals must balance on
   * their non-statistical lines independently.
   */
  async validateBalance(entityId: string, lines: JournalCreateInput["lines"]): Promise<void> {
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = accountIds.length
      ? await this.repository(this.prisma).findAccountsByIds(entityId, accountIds)
      : [];
    const statAccountIds = new Set(
      accounts.filter((a) => a.type === "STATISTICAL").map((a) => a.id)
    );

    const nonStatLines = lines.filter((l) => !statAccountIds.has(l.accountId));
    if (nonStatLines.length === 0) {
      return;
    }

    // Balance is asserted in FUNCTIONAL currency (amount × fxRate): a
    // multi-currency journal that balances on raw transaction amounts can
    // still be functionally imbalanced, which corrupts account balances and
    // deadlocks hard close (GL-1, audit 2026-07-08).
    const totals = nonStatLines.reduce(
      (acc, line) => {
        const rate = new Prisma.Decimal(line.fxRate ?? "1");
        acc.debit = acc.debit.add(new Prisma.Decimal(line.debit).mul(rate));
        acc.credit = acc.credit.add(new Prisma.Decimal(line.credit).mul(rate));
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
        `Journal is unbalanced in functional currency. Functional debits=${totals.debit.toFixed(4)}, credits=${totals.credit.toFixed(4)}.`,
        422
      );
    }
  }

  private computeJournalAmount(lines: JournalCreateInput["lines"]): Prisma.Decimal {
    const ZERO = new Prisma.Decimal(0);
    const totalDebit = lines.reduce((sum, line) => {
      return sum.add(new Prisma.Decimal(line.debit).mul(new Prisma.Decimal(line.fxRate)).abs());
    }, ZERO);
    const totalCredit = lines.reduce((sum, line) => {
      return sum.add(new Prisma.Decimal(line.credit).mul(new Prisma.Decimal(line.fxRate)).abs());
    }, ZERO);
    return Prisma.Decimal.max(totalDebit, totalCredit);
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
    // Verify journal is still in a postable state (prevents approve-during-reject race)
    if (!["DRAFT", "PENDING_APPROVAL"].includes(journal.status)) {
      throw new GLServiceError(
        "GL_JOURNAL_STATUS_INVALID",
        `Journal status ${journal.status} cannot be posted.`,
        409
      );
    }

    if (journal.period.status !== "OPEN") {
      throw new GLServiceError(
        "GL_PERIOD_CLOSED",
        `Period ${journal.period.name} is not open.`,
        422
      );
    }

    await this.validateBalance(journal.entityId, this.toJournalInputLines(journal));

    // Conditional update: only succeeds if journal is still in expected state
    const result = await repository.setJournalStatusConditional(
      journal.entityId,
      journal.id,
      "POSTED",
      approvedById,
      ["DRAFT", "PENDING_APPROVAL"]
    );
    if (result === 0) {
      throw new GLServiceError(
        "GL_JOURNAL_STATUS_CHANGED",
        "Journal status was changed by another user. Please refresh.",
        409
      );
    }

    await repository.batchUpdateAccountBalances(
      journal.entityId,
      journal.periodId,
      journal.lines.map((line) => ({
        accountId: line.accountId,
        debitFunctional: line.debitFunctional,
        creditFunctional: line.creditFunctional,
        accountType: line.account.type
      }))
    );
  }

  /**
   * Validates that the journal source is allowed for every account in the journal.
   * Revenue accounts default to PMS/POS only when allowedSources is empty (convention).
   * A sourceOverrideReason permits CONTROLLER/ADMIN to bypass the restriction with audit trail.
   */
  private async validateSourceRestrictions(
    entityId: string,
    source: string,
    lines: JournalCreateInput["lines"],
    sourceOverrideReason?: string
  ): Promise<void> {
    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.repository(this.prisma).findAccountsByIds(entityId, accountIds);

    const violations: string[] = [];
    for (const account of accounts) {
      // Determine effective allowed sources:
      // - If explicitly set on the account, use those
      // - If account is REVENUE type and no explicit sources → default to PMS, POS
      const acctSources = ((account as any).allowedSources ?? []) as string[];
      const effectiveSources =
        acctSources.length > 0 ? acctSources : account.type === "REVENUE" ? ["PMS", "POS"] : []; // empty = no restriction

      if (effectiveSources.length === 0) continue;
      if (effectiveSources.includes(source)) continue;

      violations.push(
        `${account.code} (${account.name}) only accepts sources: ${effectiveSources.join(", ")}`
      );
    }

    if (violations.length === 0) return;

    // Allow override with reason (for write-offs, corrections, etc.)
    if (sourceOverrideReason && sourceOverrideReason.trim().length > 0) {
      console.info(
        `[GLService] Source restriction override for entity=${entityId}, source=${source}, reason="${sourceOverrideReason}", accounts: ${violations.join("; ")}`
      );
      return;
    }

    throw new GLServiceError(
      "GL_SOURCE_RESTRICTED",
      `Journal source "${source}" is not allowed for the following accounts: ${violations.join("; ")}. ` +
        `Revenue accounts require PMS or POS source. Provide a sourceOverrideReason to bypass with CONTROLLER approval.`,
      403
    );
  }

  /**
   * If a journalTypeId is provided, validate source + account type restrictions
   * and auto-generate the reference number from the type's prefix + sequence.
   */
  private async applyJournalTypeRules(
    entityId: string,
    input: JournalCreateInput
  ): Promise<{ autoReverse: boolean; generatedRef?: string }> {
    if (!input.journalTypeId) {
      return { autoReverse: false };
    }

    const jtRepo = this.journalTypeRepo();
    const jt = await jtRepo.getJournalType(entityId, input.journalTypeId);
    if (!jt) {
      throw new GLServiceError("GL_JOURNAL_TYPE_NOT_FOUND", "Journal type not found.", 404);
    }
    if (!jt.isActive) {
      throw new GLServiceError(
        "GL_JOURNAL_TYPE_INACTIVE",
        `Journal type "${jt.code}" is inactive.`,
        422
      );
    }

    // Enforce allowed sources
    const allowedSrc = (jt.allowedSources ?? []) as string[];
    if (allowedSrc.length > 0 && !allowedSrc.includes(input.source)) {
      throw new GLServiceError(
        "GL_JOURNAL_TYPE_SOURCE_MISMATCH",
        `Journal type "${jt.code}" only allows sources: ${allowedSrc.join(", ")}. Got "${input.source}".`,
        422
      );
    }

    // Enforce allowed account types on every line
    const allowedAcctTypes = (jt.allowedAccountTypes ?? []) as string[];
    if (allowedAcctTypes.length > 0) {
      const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
      const accounts = await this.repository(this.prisma).findAccountsByIds(entityId, accountIds);
      const violations = accounts.filter((a) => !allowedAcctTypes.includes(a.type));
      if (violations.length > 0) {
        const names = violations.map((a) => `${a.code} (${a.type})`).join(", ");
        throw new GLServiceError(
          "GL_JOURNAL_TYPE_ACCOUNT_MISMATCH",
          `Journal type "${jt.code}" only allows account types: ${allowedAcctTypes.join(", ")}. Violations: ${names}.`,
          422
        );
      }
    }

    // Skip balance validation for statistical journal types.
    // validateBalance itself also short-circuits for statistics-only journals
    // so account-level memo semantics still hold if requireBalance is left on.
    if (jt.requireBalance) {
      await this.validateBalance(entityId, input.lines);
    }

    // Auto-generate reference from type prefix + sequence
    const generatedRef = await jtRepo.getNextReference(entityId, jt.id);

    return { autoReverse: jt.autoReverse, generatedRef };
  }

  async createJournal(entityId: string, createdById: string, input: JournalCreateInput) {
    const period = await this.repository(this.prisma).getPeriod(entityId, input.periodId);
    if (!period) {
      throw new GLServiceError("GL_PERIOD_NOT_FOUND", "Period not found.", 404);
    }

    // Apply journal type rules (source lock, account type restriction, auto-numbering)
    const typeRules = await this.applyJournalTypeRules(entityId, input);
    if (typeRules.generatedRef && !input.reference) {
      input = { ...input, reference: typeRules.generatedRef };
    }

    // Enforce source restrictions (revenue accounts → PMS/POS only)
    await this.validateSourceRestrictions(
      entityId,
      input.source,
      input.lines,
      input.sourceOverrideReason
    );

    const journalAmount = this.computeJournalAmount(input.lines);

    let result;
    try {
      result = await this.prisma.$transaction(async (transaction) => {
        await setEntityDbContext(transaction, entityId);
        const repository = this.repository(transaction);
        const created = await repository.createJournal(entityId, createdById, input);
        const rule = await repository.getApprovalRuleForAmount(entityId, "GL", journalAmount);

        if (!rule || rule.requiredApprovers.length === 0) {
          return {
            journal: created,
            approvalRecipients: [] as Array<{ id: string; email: string; name: string }>
          };
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
    } finally {
      clearEntityDbContext();
    }

    // ── Multi-stage authorization check ──────────────────────────────────
    // If the journal was NOT already routed by the legacy ApprovalRule system,
    // check whether multi-stage authorization is required (LedgerSetup or JournalType).
    if (result.approvalRecipients.length === 0) {
      try {
        const ledgerSetup = await (this.prisma as any).ledgerSetup.findFirst({
          where: { entityId, ledger: "A" }
        });
        const journalType = input.journalTypeId
          ? await (this.prisma as any).journalType.findFirst({
              where: { id: input.journalTypeId, entityId }
            })
          : null;

        const authRequired =
          ledgerSetup?.authorizationRequired || journalType?.authorizationRequired;

        if (authRequired) {
          const authService = new AuthorizationService(this.prisma);
          const authResult = await authService.submitForAuthorization(entityId, result.journal.id);
          if (authResult.required) {
            // Re-fetch journal to get updated status
            const refreshed = await this.repository(this.prisma).getJournalWithLines(
              entityId,
              result.journal.id
            );
            return refreshed ?? result.journal;
          }
        }
      } catch {
        // Authorization check failure should not block journal creation — log and continue
        console.warn(
          "[GLService] Multi-stage authorization check failed for journal",
          result.journal.id
        );
      }
    }

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
        emailFailures.map((f) => f.reason?.message ?? "unknown")
      );
    }

    return result.journal;
  }

  async postJournal(entityId: string, journalId: string, approvedById: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
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

        // Verify multi-stage authorization is complete (if applicable)
        const authService = new AuthorizationService(this.prisma);
        const isAuthorized = await authService.isFullyAuthorized(journalId);
        if (!isAuthorized) {
          throw new GLServiceError(
            "GL_AUTHORIZATION_INCOMPLETE",
            "Cannot post: authorization stages are not complete.",
            409
          );
        }

        await this.postJournalInternal(repository, journal as PostingJournal, approvedById);
        return repository.getJournalWithLines(entityId, journal.id);
      });
    } finally {
      clearEntityDbContext();
    }
  }

  async approveJournal(entityId: string, journalId: string, approverId: string, reason?: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
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

        const amount = this.computeJournalAmount(
          this.toJournalInputLines(journal as PostingJournal)
        );
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
    } finally {
      clearEntityDbContext();
    }
  }

  async rejectJournal(entityId: string, journalId: string, approverId: string, reason?: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
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
          await repository.batchUpdateAccountBalances(
            entityId,
            journal.periodId,
            journal.lines.map((line: any) => ({
              accountId: line.accountId,
              debitFunctional: line.creditFunctional, // swapped: credits become debits
              creditFunctional: line.debitFunctional, // swapped: debits become credits
              accountType: line.account.type
            }))
          );
        }

        await repository.setJournalStatus(entityId, journalId, "DRAFT", null);

        return repository.getJournalWithLines(entityId, journalId);
      });
    } finally {
      clearEntityDbContext();
    }
  }

  async reverseJournal(entityId: string, journalId: string, createdById: string) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
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
          source: existing.source as JournalCreateInput["source"],
          functionalCurrency: existing.functionalCurrency,
          lines: existing.lines.map((line: any) => ({
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
    } finally {
      clearEntityDbContext();
    }
  }

  async getAccountCurrentBalance(entityId: string, accountId: string) {
    const repo = this.repository(this.prisma);
    const account = await repo.findAccountById(entityId, accountId);
    if (!account) {
      throw new GLServiceError("GL_ACCOUNT_NOT_FOUND", "Account not found.", 404);
    }
    const balance = await repo.getAccountCurrentBalance(entityId, accountId);
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      ...balance
    };
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

    const isBalanced = totals.debits.toDecimalPlaces(4).equals(totals.credits.toDecimalPlaces(4));

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

  // ── Approval Rule CRUD ──────────────────────────────────────────────────

  listApprovalRules(entityId: string) {
    return this.repository(this.prisma).listApprovalRules(entityId);
  }

  async getApprovalRule(entityId: string, ruleId: string) {
    const rule = await this.repository(this.prisma).getApprovalRule(entityId, ruleId);
    if (!rule) {
      throw new GLServiceError("GL_APPROVAL_RULE_NOT_FOUND", "Approval rule not found.", 404);
    }
    return rule;
  }

  createApprovalRule(
    entityId: string,
    data: {
      module: "GL" | "AP" | "AR";
      minAmount: number;
      maxAmount?: number;
      requiredApprovers: string[];
      requireAll: boolean;
      isActive: boolean;
    }
  ) {
    return this.repository(this.prisma).createApprovalRule(entityId, data);
  }

  async updateApprovalRule(
    entityId: string,
    ruleId: string,
    data: {
      module?: "GL" | "AP" | "AR";
      minAmount?: number;
      maxAmount?: number | null;
      requiredApprovers?: string[];
      requireAll?: boolean;
      isActive?: boolean;
    }
  ) {
    const existing = await this.repository(this.prisma).getApprovalRule(entityId, ruleId);
    if (!existing) {
      throw new GLServiceError("GL_APPROVAL_RULE_NOT_FOUND", "Approval rule not found.", 404);
    }
    return this.repository(this.prisma).updateApprovalRule(entityId, ruleId, data);
  }

  async deleteApprovalRule(entityId: string, ruleId: string) {
    const existing = await this.repository(this.prisma).getApprovalRule(entityId, ruleId);
    if (!existing) {
      throw new GLServiceError("GL_APPROVAL_RULE_NOT_FOUND", "Approval rule not found.", 404);
    }
    return this.repository(this.prisma).deleteApprovalRule(entityId, ruleId);
  }

  // ── Journal Type CRUD ────────────────────────────────────────────────────

  listJournalTypes(entityId: string) {
    return this.journalTypeRepo().listJournalTypes(entityId);
  }

  async getJournalType(entityId: string, id: string) {
    const jt = await this.journalTypeRepo().getJournalType(entityId, id);
    if (!jt) {
      throw new GLServiceError("GL_JOURNAL_TYPE_NOT_FOUND", "Journal type not found.", 404);
    }
    return jt;
  }

  async createJournalType(entityId: string, input: JournalTypeCreateInput) {
    const repo = this.journalTypeRepo();
    const existing = await repo.getJournalTypeByCode(entityId, input.code);
    if (existing) {
      throw new GLServiceError(
        "GL_JOURNAL_TYPE_CODE_EXISTS",
        `Journal type code "${input.code}" already exists.`,
        409
      );
    }
    return repo.createJournalType(entityId, input);
  }

  async updateJournalType(entityId: string, id: string, input: JournalTypeUpdateInput) {
    const repo = this.journalTypeRepo();
    const existing = await repo.getJournalType(entityId, id);
    if (!existing) {
      throw new GLServiceError("GL_JOURNAL_TYPE_NOT_FOUND", "Journal type not found.", 404);
    }
    if (input.code && input.code !== existing.code) {
      const byCode = await repo.getJournalTypeByCode(entityId, input.code);
      if (byCode && byCode.id !== id) {
        throw new GLServiceError(
          "GL_JOURNAL_TYPE_CODE_EXISTS",
          `Journal type code "${input.code}" already exists.`,
          409
        );
      }
    }
    await repo.updateJournalType(entityId, id, input);
    return this.getJournalType(entityId, id);
  }

  async deleteJournalType(entityId: string, id: string) {
    const repo = this.journalTypeRepo();
    const existing = await repo.getJournalType(entityId, id);
    if (!existing) {
      throw new GLServiceError("GL_JOURNAL_TYPE_NOT_FOUND", "Journal type not found.", 404);
    }
    const usageCount = await repo.countJournalsByType(entityId, id);
    if (usageCount > 0) {
      throw new GLServiceError(
        "GL_JOURNAL_TYPE_IN_USE",
        `Journal type "${existing.code}" has ${usageCount} journals. Deactivate it instead.`,
        409
      );
    }
    await repo.deleteJournalType(entityId, id);
    return { id, deleted: true };
  }
}
