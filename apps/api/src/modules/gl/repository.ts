import {
  Prisma,
  PrismaClient,
  type JournalStatus,
  type JournalApprovalStatus,
  type WorkflowModule
} from "@prisma/client";
import type {
  AccountCreateInput,
  AccountUpdateInput,
  JournalCreateInput,
  JournalListQuery
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
    return this.db.account.create({
      data: {
        entityId,
        code: input.code,
        name: input.name,
        type: input.type,
        usaliCategory: input.usaliCategory,
        usaliDepartment: input.usaliDepartment,
        normalBalance: input.normalBalance,
        allowPosting: input.allowPosting,
        isControlAccount: input.isControlAccount,
        parentId: input.parentId,
        level: input.level
      }
    });
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
    return this.db.journal.create({
      data: {
        entityId,
        periodId: input.periodId,
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
            debitFunctional: new Prisma.Decimal(line.debit).mul(
              new Prisma.Decimal(line.fxRate)
            ),
            creditFunctional: new Prisma.Decimal(line.credit).mul(
              new Prisma.Decimal(line.fxRate)
            ),
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
    return this.db.journal.findFirst({
      where: { entityId, id: journalId },
      include: {
        lines: {
          orderBy: [{ lineNumber: "asc" }],
          include: { account: { select: { code: true, name: true } } }
        },
        period: true,
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

    return this.db.journal.findMany({
      where: {
        entityId,
        status: query.status,
        source: query.source,
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
        lines: true,
        approvals: true
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

  getApprovalRuleForAmount(
    entityId: string,
    module: WorkflowModule,
    amount: Prisma.Decimal
  ) {
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

  async createJournalApprovals(
    entityId: string,
    journalId: string,
    approverIds: string[]
  ) {
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

  async markPendingApprovalsRejected(
    entityId: string,
    journalId: string,
    reason?: string
  ) {
    await this.db.journalApproval.updateMany({
      where: { entityId, journalId, status: "PENDING" },
      data: {
        status: "REJECTED",
        reason
      }
    });
  }

  async updateAccountBalance(
    entityId: string,
    accountId: string,
    periodId: string,
    debitFunctional: Prisma.Decimal,
    creditFunctional: Prisma.Decimal
  ) {
    const existing = await this.db.accountPeriodBalance.findUnique({
      where: {
        entityId_accountId_periodId: {
          entityId,
          accountId,
          periodId
        }
      }
    });

    if (!existing) {
      const opening = new Prisma.Decimal(0);
      const periodDebits = debitFunctional;
      const periodCredits = creditFunctional;
      const closing = opening.add(periodDebits).sub(periodCredits);

      await this.db.accountPeriodBalance.create({
        data: {
          entityId,
          accountId,
          periodId,
          openingBalance: opening,
          periodDebits,
          periodCredits,
          closingBalance: closing
        }
      });
      return;
    }

    const periodDebits = new Prisma.Decimal(existing.periodDebits).add(
      debitFunctional
    );
    const periodCredits = new Prisma.Decimal(existing.periodCredits).add(
      creditFunctional
    );
    const closing = new Prisma.Decimal(existing.openingBalance)
      .add(periodDebits)
      .sub(periodCredits);

    await this.db.accountPeriodBalance.update({
      where: { id: existing.id },
      data: {
        periodDebits,
        periodCredits,
        closingBalance: closing
      }
    });
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
      ),
      comparative_balances AS (
        SELECT
          account_id,
          COALESCE(closing_balance, 0)::numeric(18,4) AS comparative_closing_balance
        FROM account_period_balances
        WHERE entity_id = ${entityId}
          AND period_id = ${comparativePeriodId ?? ""}
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
      ${showZeroBalances
        ? Prisma.sql``
        : Prisma.sql`WHERE (pb.opening_balance <> 0 OR pb.period_debits <> 0 OR pb.period_credits <> 0 OR pb.closing_balance <> 0)`}
      ORDER BY pb.account_code ASC;
    `;

    return rows as TrialBalanceRow[];
  }
}

type TrailBalanceQueryResult = TrialBalanceRow[];
