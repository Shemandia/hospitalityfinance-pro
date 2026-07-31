import {
  Prisma,
  PrismaClient,
  type JournalStatus,
  type JournalApprovalStatus,
  type WorkflowModule
} from "../../db/client.js";
import { applyBalanceDelta, applyBalanceDeltas } from "../../db/balance-writer.js";
import type {
  AccountCreateInput,
  AccountUpdateInput,
  JournalCreateInput,
  JournalListQuery,
  JournalTypeCreateInput,
  JournalTypeUpdateInput
} from "./types.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

type TrialBalanceRow = {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_level: number;
  opening_balance: Prisma.Decimal;
  period_debits: Prisma.Decimal;
  period_credits: Prisma.Decimal;
  closing_balance: Prisma.Decimal;
  comparative_closing_balance: Prisma.Decimal | null;
};

export class GLRepository {
  constructor(private readonly db: DbClient) {}

  listAccounts(entityId: string) {
    return this.db.account.findMany({
      where: { entityId, isActive: true },
      orderBy: [{ code: "asc" }]
    });
  }

  findAccountById(entityId: string, id: string) {
    return this.db.account.findFirst({
      where: { entityId, id, isActive: true }
    });
  }

  findAccountByCode(entityId: string, code: string) {
    return this.db.account.findUnique({
      where: { entityId_code: { entityId, code } }
    });
  }

  createAccount(entityId: string, input: AccountCreateInput) {
    const data: Record<string, unknown> = {
      entityId,
      code: input.code,
      name: input.name,
      type: input.type,
      usaliCategory: input.usaliCategory,
      usaliDepartment: input.usaliDepartment,
      normalBalance: input.normalBalance,
      allowPosting: input.allowPosting,
      allowedSources: input.allowedSources ?? [],
      isControlAccount: input.isControlAccount,
      parentId: input.parentId,
      level: input.level
    };
    return this.db.account.create({ data: data as any });
  }

  updateAccount(entityId: string, id: string, input: AccountUpdateInput) {
    return this.db.account.updateMany({
      where: { entityId, id, isActive: true },
      data: input
    });
  }

  softDeleteAccount(entityId: string, id: string) {
    return this.db.account.updateMany({
      where: { entityId, id, isActive: true },
      data: { isActive: false }
    });
  }

  findAccountsByIds(entityId: string, ids: string[]) {
    return this.db.account.findMany({
      where: { entityId, id: { in: ids }, isActive: true }
    });
  }

  countJournalLinesByAccount(entityId: string, accountId: string) {
    return this.db.journalLine.count({
      where: {
        accountId,
        journal: { entityId }
      }
    });
  }

  getAccountLedger(
    entityId: string,
    accountId: string,
    opts: { periodId?: string; status?: string; limit: number; offset: number }
  ) {
    return this.db.journalLine.findMany({
      where: {
        accountId,
        journal: {
          entityId,
          ...(opts.periodId ? { periodId: opts.periodId } : {}),
          ...(opts.status ? { status: opts.status as never } : {})
        }
      },
      include: {
        journal: {
          select: {
            id: true,
            reference: true,
            description: true,
            status: true,
            source: true,
            createdAt: true,
            postedAt: true,
            periodId: true,
            period: { select: { name: true } }
          }
        }
      },
      orderBy: [{ journal: { createdAt: "asc" } }, { lineNumber: "asc" }],
      take: opts.limit,
      skip: opts.offset
    });
  }

  countAccountLedger(
    entityId: string,
    accountId: string,
    opts: { periodId?: string; status?: string }
  ) {
    return this.db.journalLine.count({
      where: {
        accountId,
        journal: {
          entityId,
          ...(opts.periodId ? { periodId: opts.periodId } : {}),
          ...(opts.status ? { status: opts.status as never } : {})
        }
      }
    });
  }

  getPeriod(entityId: string, periodId: string) {
    return this.db.period.findFirst({
      where: { entityId, id: periodId }
    });
  }

  createJournal(entityId: string, createdById: string, input: JournalCreateInput) {
    return (this.db.journal as any).create({
      data: {
        entityId,
        periodId: input.periodId,
        journalTypeId: input.journalTypeId ?? null,
        reference: input.reference,
        description: input.description,
        source: input.source,
        functionalCurrency: input.functionalCurrency,
        createdById,
        lines: {
          create: input.lines.map((line, index) => ({
            accountId: line.accountId,
            debit: new Prisma.Decimal(line.debit),
            credit: new Prisma.Decimal(line.credit),
            currency: line.currency.toUpperCase(),
            fxRate: new Prisma.Decimal(line.fxRate),
            debitFunctional: new Prisma.Decimal(line.debit).mul(new Prisma.Decimal(line.fxRate)),
            creditFunctional: new Prisma.Decimal(line.credit).mul(new Prisma.Decimal(line.fxRate)),
            description: line.description,
            dimension1: line.dimension1,
            dimension2: line.dimension2,
            dimension3: line.dimension3,
            dimension4: line.dimension4,
            dimension5: line.dimension5,
            dimension6: line.dimension6,
            lineNumber: line.lineNumber ?? index + 1
          }))
        }
      },
      include: {
        lines: true
      }
    });
  }

  getJournalWithLines(entityId: string, journalId: string) {
    return (this.db.journal as any).findFirst({
      where: { entityId, id: journalId },
      include: {
        lines: {
          orderBy: [{ lineNumber: "asc" }],
          include: { account: { select: { code: true, name: true, type: true } } }
        },
        period: true,
        journalType: true,
        approvals: {
          orderBy: [{ createdAt: "asc" }],
          include: { approver: true }
        }
      }
    });
  }

  listJournals(entityId: string, query: JournalListQuery) {
    const searchFilters = query.search
      ? {
          OR: [
            { reference: { contains: query.search, mode: "insensitive" as const } },
            { description: { contains: query.search, mode: "insensitive" as const } }
          ]
        }
      : {};

    return (this.db.journal as any).findMany({
      where: {
        entityId,
        status: query.status,
        source: query.source,
        journalTypeId: query.journalTypeId,
        periodId: query.periodId,
        ...searchFilters
      },
      take: query.limit,
      ...(query.cursor
        ? {
            skip: 1,
            cursor: { id: query.cursor }
          }
        : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        _count: { select: { lines: true, approvals: true } }
      }
    });
  }

  setJournalStatus(
    entityId: string,
    journalId: string,
    status: JournalStatus,
    approvedById?: string | null
  ) {
    return this.db.journal.updateMany({
      where: { entityId, id: journalId },
      data: {
        status,
        approvedById: approvedById ?? null,
        postedAt: status === "POSTED" ? new Date() : null
      }
    });
  }

  /**
   * Conditional status update — only succeeds if the journal is currently
   * in one of the expected statuses. Returns the number of rows updated (0 or 1).
   */
  async setJournalStatusConditional(
    entityId: string,
    journalId: string,
    newStatus: JournalStatus,
    approvedById: string | null,
    expectedStatuses: JournalStatus[]
  ): Promise<number> {
    const result = await this.db.journal.updateMany({
      where: { entityId, id: journalId, status: { in: expectedStatuses } },
      data: {
        status: newStatus,
        approvedById: approvedById ?? null,
        postedAt: newStatus === "POSTED" ? new Date() : null
      }
    });
    return result.count;
  }

  getApprovalRuleForAmount(entityId: string, module: WorkflowModule, amount: Prisma.Decimal) {
    return this.db.approvalRule.findFirst({
      where: {
        entityId,
        module,
        isActive: true,
        minAmount: { lte: amount },
        OR: [{ maxAmount: null }, { maxAmount: { gte: amount } }]
      },
      orderBy: [{ minAmount: "desc" }]
    });
  }

  async createJournalApprovals(entityId: string, journalId: string, approverIds: string[]) {
    if (approverIds.length === 0) {
      return;
    }

    await this.db.journalApproval.createMany({
      data: approverIds.map((approverId) => ({
        entityId,
        journalId,
        approverId,
        status: "PENDING"
      })),
      skipDuplicates: true
    });
  }

  getJournalApprovalEntries(entityId: string, journalId: string) {
    return this.db.journalApproval.findMany({
      where: { entityId, journalId },
      include: { approver: true },
      orderBy: [{ createdAt: "asc" }]
    });
  }

  upsertJournalApprovalDecision(
    entityId: string,
    journalId: string,
    approverId: string,
    status: JournalApprovalStatus,
    reason?: string
  ) {
    return this.db.journalApproval.upsert({
      where: {
        journalId_approverId: {
          journalId,
          approverId
        }
      },
      create: {
        entityId,
        journalId,
        approverId,
        status,
        reason,
        approvedAt: status === "APPROVED" ? new Date() : null
      },
      update: {
        status,
        reason,
        approvedAt: status === "APPROVED" ? new Date() : null
      }
    });
  }

  async markPendingApprovalsRejected(entityId: string, journalId: string, reason?: string) {
    await this.db.journalApproval.updateMany({
      where: { entityId, journalId, status: "PENDING" },
      data: {
        status: "REJECTED",
        reason
      }
    });
  }

  // ── Approval Rule CRUD ─────────────────────────────────────────────────

  listApprovalRules(entityId: string) {
    return this.db.approvalRule.findMany({
      where: { entityId },
      orderBy: [{ module: "asc" }, { minAmount: "asc" }]
    });
  }

  getApprovalRule(entityId: string, ruleId: string) {
    return this.db.approvalRule.findFirst({
      where: { id: ruleId, entityId }
    });
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
    return this.db.approvalRule.create({
      data: {
        entityId,
        module: data.module,
        minAmount: new Prisma.Decimal(data.minAmount),
        maxAmount: data.maxAmount != null ? new Prisma.Decimal(data.maxAmount) : null,
        requiredApprovers: data.requiredApprovers,
        requireAll: data.requireAll,
        isActive: data.isActive
      }
    });
  }

  updateApprovalRule(
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
    const updateData: Record<string, unknown> = {};
    if (data.module !== undefined) updateData.module = data.module;
    if (data.minAmount !== undefined) updateData.minAmount = new Prisma.Decimal(data.minAmount);
    if (data.maxAmount !== undefined)
      updateData.maxAmount = data.maxAmount != null ? new Prisma.Decimal(data.maxAmount) : null;
    if (data.requiredApprovers !== undefined) updateData.requiredApprovers = data.requiredApprovers;
    if (data.requireAll !== undefined) updateData.requireAll = data.requireAll;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    return this.db.approvalRule.update({
      where: { id: ruleId },
      data: updateData
    });
  }

  deleteApprovalRule(entityId: string, ruleId: string) {
    return this.db.approvalRule.delete({
      where: { id: ruleId }
    });
  }

  /**
   * Current balance of a single account, summed across all periods.
   * For debit-normal accounts (ASSET, EXPENSE) returns positive when in
   * surplus; for credit-normal (LIABILITY, EQUITY, REVENUE) likewise.
   * Returns 0 if the account has never been posted to.
   */
  async getAccountCurrentBalance(
    entityId: string,
    accountId: string
  ): Promise<{ balance: string; debits: string; credits: string }> {
    const rows = await this.db.$queryRaw<Array<{ debits: string | null; credits: string | null }>>`
      SELECT
        COALESCE(SUM(period_debits),  0)::text AS debits,
        COALESCE(SUM(period_credits), 0)::text AS credits
      FROM account_period_balances
      WHERE entity_id = ${entityId} AND account_id = ${accountId}
    `;
    const debits = new Prisma.Decimal(rows[0]?.debits ?? "0");
    const credits = new Prisma.Decimal(rows[0]?.credits ?? "0");

    // Sign from the account's declared normal balance — the same rule the
    // canonical balance writer applies, so this read agrees with what was
    // written. The old type-code list could not classify custom account types.
    const account = await this.db.account.findFirst({
      where: { entityId, id: accountId },
      select: { normalBalance: true }
    });
    const isDebitNormal = account?.normalBalance === "DEBIT";
    const balance = isDebitNormal ? debits.minus(credits) : credits.minus(debits);

    return {
      balance: balance.toFixed(2),
      debits: debits.toFixed(2),
      credits: credits.toFixed(2)
    };
  }

  /**
   * Update one account's period balance.
   *
   * Delegates to the canonical signed writer in db/balance-writer.ts, which
   * derives the sign from the account's own normal_balance.
   *
   * @param accountType Ignored, and optional. Retained so existing call sites
   *   still compile. The writer no longer trusts a caller-supplied type: it was
   *   possible to pass the wrong one, and the hardcoded type-code list could
   *   not classify custom account types at all.
   */
  async updateAccountBalance(
    entityId: string,
    accountId: string,
    periodId: string,
    debitFunctional: Prisma.Decimal,
    creditFunctional: Prisma.Decimal,
    accountType?: string
  ) {
    void accountType;
    await applyBalanceDelta(
      this.db,
      entityId,
      periodId,
      accountId,
      debitFunctional,
      creditFunctional
    );
  }

  /**
   * Update balances for many journal lines in a single statement.
   *
   * The writer aggregates by account first, so a journal posting two lines to
   * the same GL account — an ordinary dimensional split — no longer fails with
   * Postgres 21000 ("ON CONFLICT DO UPDATE cannot affect row a second time").
   *
   * `accountType` on each line is ignored; see updateAccountBalance above.
   */
  async batchUpdateAccountBalances(
    entityId: string,
    periodId: string,
    lines: Array<{
      accountId: string;
      debitFunctional: Prisma.Decimal;
      creditFunctional: Prisma.Decimal;
      accountType?: string;
    }>
  ) {
    if (lines.length === 0) return;
    await applyBalanceDeltas(this.db, entityId, periodId, lines);
  }

  async runTrialBalanceQuery(
    entityId: string,
    periodId: string,
    comparativePeriodId: string | undefined,
    showZeroBalances: boolean
  ) {
    const rows = await this.db.$queryRaw<TrailBalanceQueryResult>`
      WITH period_balances AS (
        SELECT
          a.id AS account_id,
          a.code AS account_code,
          a.name AS account_name,
          a.type AS account_type,
          a.level AS account_level,
          COALESCE(apb.opening_balance, 0)::numeric(18,4) AS opening_balance,
          COALESCE(apb.period_debits, 0)::numeric(18,4) AS period_debits,
          COALESCE(apb.period_credits, 0)::numeric(18,4) AS period_credits,
          COALESCE(apb.closing_balance, 0)::numeric(18,4) AS closing_balance
        FROM accounts a
        LEFT JOIN account_period_balances apb
          ON apb.account_id = a.id
         AND apb.entity_id = ${entityId}
         AND apb.period_id = ${periodId}
        WHERE a.entity_id = ${entityId}
          AND a.is_active = true
          -- STATISTICAL (memo) accounts are non-financial and excluded from the trial balance
          AND a.type <> 'STATISTICAL'
      ),
      comparative_balances AS (
        SELECT
          apb2.account_id,
          COALESCE(apb2.closing_balance, 0)::numeric(18,4) AS comparative_closing_balance
        FROM account_period_balances apb2
        WHERE apb2.entity_id = ${entityId}
          ${
            comparativePeriodId
              ? Prisma.sql`AND apb2.period_id = ${comparativePeriodId}`
              : Prisma.sql`AND 1 = 0`
          }
      )
      SELECT
        pb.account_id,
        pb.account_code,
        pb.account_name,
        pb.account_type,
        pb.account_level,
        pb.opening_balance,
        pb.period_debits,
        pb.period_credits,
        pb.closing_balance,
        cb.comparative_closing_balance
      FROM period_balances pb
      LEFT JOIN comparative_balances cb
        ON cb.account_id = pb.account_id
      ${
        showZeroBalances
          ? Prisma.sql``
          : Prisma.sql`WHERE (pb.opening_balance <> 0 OR pb.period_debits <> 0 OR pb.period_credits <> 0 OR pb.closing_balance <> 0)`
      }
      ORDER BY pb.account_code ASC;
    `;

    return rows as TrialBalanceRow[];
  }
}

type TrailBalanceQueryResult = TrialBalanceRow[];

// ── Journal Type CRUD ──────────────────────────────────────────────────────

export class JournalTypeRepository {
  constructor(private readonly db: DbClient) {}

  // Accessor for journalType model — cast needed until prisma generate runs
  private get jt() {
    return (this.db as any).journalType;
  }

  listJournalTypes(entityId: string) {
    return this.jt.findMany({
      where: { entityId },
      orderBy: [{ code: "asc" }],
      include: { _count: { select: { journals: true } } }
    });
  }

  getJournalType(entityId: string, id: string) {
    return this.jt.findFirst({
      where: { entityId, id }
    });
  }

  getJournalTypeByCode(entityId: string, code: string) {
    return this.jt.findUnique({
      where: { entityId_code: { entityId, code } }
    });
  }

  createJournalType(entityId: string, input: JournalTypeCreateInput) {
    return this.jt.create({
      data: {
        entityId,
        code: input.code,
        name: input.name,
        description: input.description,
        allowedSources: input.allowedSources as any,
        allowedAccountTypes: input.allowedAccountTypes as any,
        numberPrefix: input.numberPrefix,
        autoReverse: input.autoReverse,
        requireBalance: input.requireBalance,
        isActive: input.isActive
      }
    });
  }

  updateJournalType(entityId: string, id: string, input: JournalTypeUpdateInput) {
    const data: Record<string, unknown> = {};
    if (input.code !== undefined) data.code = input.code;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.allowedSources !== undefined) data.allowedSources = input.allowedSources;
    if (input.allowedAccountTypes !== undefined)
      data.allowedAccountTypes = input.allowedAccountTypes;
    if (input.numberPrefix !== undefined) data.numberPrefix = input.numberPrefix;
    if (input.autoReverse !== undefined) data.autoReverse = input.autoReverse;
    if (input.requireBalance !== undefined) data.requireBalance = input.requireBalance;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return this.jt.updateMany({
      where: { entityId, id },
      data
    });
  }

  async deleteJournalType(entityId: string, id: string) {
    // Verify entity ownership before deletion to prevent cross-entity access
    const existing = await this.jt.findFirst({ where: { id, entityId } });
    if (!existing) throw new Error("Journal type not found for this entity.");
    return this.jt.delete({ where: { id } });
  }

  countJournalsByType(entityId: string, journalTypeId: string) {
    return (this.db.journal as any).count({
      where: { entityId, journalTypeId }
    });
  }

  /** Atomically increment and return the next reference number for this type */
  async getNextReference(entityId: string, journalTypeId: string): Promise<string> {
    const updated = await this.jt.update({
      where: { id: journalTypeId },
      data: { nextNumber: { increment: 1 } },
      select: { numberPrefix: true, nextNumber: true }
    });
    const num = updated.nextNumber - 1; // we incremented, so current = next - 1
    const year = new Date().getFullYear();
    return `${updated.numberPrefix}-${year}-${String(num).padStart(4, "0")}`;
  }
}
