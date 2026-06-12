import type { PrismaClient } from "../../db/client.js";
import { Prisma } from "../../db/client.js";
import { ProcessLockService } from "../process-lock/service.js";
import { AuditService } from "../audit/service.js";
import { GLRepository } from "../gl/repository.js";
import type {
  RunYearEndCleardownInput,
  YearEndCleardownLineResult,
  YearEndCleardownResult
} from "./year-end-types.js";

// ── Decimal Helpers ─────────────────────────────────────────────────────────

const D = (v: unknown): Prisma.Decimal => new Prisma.Decimal(String(v ?? 0));
const ZERO = new Prisma.Decimal(0);

// ── Errors ───────────────────────────────────────────────────────────────────

export class YearEndCleardownError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

// ── Main Engine ──────────────────────────────────────────────────────────────

/**
 * Year-End P&L Cleardown Engine
 *
 * Sweeps all Revenue and Expense account balances to Retained Earnings:
 *   1. Validate this is the final period of the fiscal year
 *   2. Query all P&L accounts (REVENUE + EXPENSE)
 *   3. Sum closing balances from AccountPeriodBalance
 *   4. Post cleardown journal: DR/CR each P&L account, offset to Retained Earnings
 *   5. Set PeriodCloseStatus.yearEndProcessed = true
 *
 * Process-locked: acquires YEAR_END lock, releases on completion.
 */
export async function runYearEndCleardown(
  prisma: PrismaClient,
  entityId: string,
  actorId: string,
  input: RunYearEndCleardownInput
): Promise<YearEndCleardownResult> {
  const lockService = new ProcessLockService(prisma);

  await lockService.acquireLock({
    entityId,
    processType: "YEAR_END",
    userId: actorId,
    timeoutMinutes: 15
  });

  try {
    return await executeCleardown(prisma, entityId, actorId, input);
  } finally {
    await lockService.releaseLock({ entityId, processType: "YEAR_END" }).catch(() => {});
  }
}

async function executeCleardown(
  prisma: PrismaClient,
  entityId: string,
  actorId: string,
  input: RunYearEndCleardownInput
): Promise<YearEndCleardownResult> {
  // Load period
  const period = await (prisma as any).period.findFirst({
    where: { id: input.periodId, entityId }
  });
  if (!period) {
    throw new YearEndCleardownError("YE_PERIOD_NOT_FOUND", "Period not found.", 404);
  }

  // Load year-end config
  const config = await (prisma as any).yearEndConfig.findFirst({
    where: { entityId }
  });

  const retainedEarningsCode = input.retainedEarningsCode ?? config?.retainedEarningsCode;

  if (!retainedEarningsCode) {
    throw new YearEndCleardownError(
      "YE_NO_RE_ACCOUNT",
      "Retained earnings account code not configured. Set it in Year-End Config or pass it explicitly.",
      422
    );
  }

  const fiscalYearStartMonth = config?.fiscalYearStartMonth ?? 1;

  // Validate this is the final period of the fiscal year
  await validateFinalPeriod(prisma, entityId, period, fiscalYearStartMonth);

  // Idempotency check
  const existingJournal = await (prisma as any).journal.findFirst({
    where: {
      entityId,
      periodId: input.periodId,
      source: "YEAREND",
      reference: { startsWith: `YE-${period.year}` }
    }
  });
  if (existingJournal) {
    throw new YearEndCleardownError(
      "YE_ALREADY_RUN",
      `Year-end cleardown has already been run for fiscal year ${period.year}.`,
      409
    );
  }

  // Get entity functional currency
  const entity = await (prisma as any).entity.findFirst({
    where: { id: entityId },
    select: { functionalCurrency: true }
  });
  const funcCurrency = entity?.functionalCurrency ?? "USD";

  // Resolve retained earnings account
  const reAccount = await (prisma as any).account.findFirst({
    where: { entityId, code: retainedEarningsCode, isActive: true }
  });
  if (!reAccount) {
    throw new YearEndCleardownError(
      "YE_RE_ACCOUNT_NOT_FOUND",
      `Retained earnings account ${retainedEarningsCode} not found.`,
      422
    );
  }

  // Query all P&L accounts (REVENUE + EXPENSE)
  const plAccounts = await (prisma as any).account.findMany({
    where: {
      entityId,
      isActive: true,
      type: { in: ["REVENUE", "EXPENSE"] }
    },
    orderBy: { code: "asc" }
  });

  if (plAccounts.length === 0) {
    return makeEmptyResult(period, retainedEarningsCode);
  }

  // Get closing balances for all P&L accounts in this period
  const accountIds = plAccounts.map((a: any) => a.id);
  const balances = await (prisma as any).accountPeriodBalance.findMany({
    where: {
      entityId,
      periodId: input.periodId,
      accountId: { in: accountIds }
    }
  });

  // Build balance map: accountId → closingBalance (Decimal)
  const balanceMap = new Map<string, Prisma.Decimal>();
  for (const bal of balances) {
    balanceMap.set(bal.accountId, D(bal.closingBalance));
  }

  // Build cleardown lines using Decimal accumulators
  const lines: YearEndCleardownLineResult[] = [];
  let totalRevenueD = ZERO;
  let totalExpenseD = ZERO;

  for (const account of plAccounts) {
    const closingBalanceD = balanceMap.get(account.id) ?? ZERO;
    if (closingBalanceD.abs().lt(new Prisma.Decimal("0.01"))) continue;

    const cleardownAmountD = closingBalanceD.neg();

    if (account.type === "REVENUE") {
      totalRevenueD = totalRevenueD.add(closingBalanceD);
    } else {
      totalExpenseD = totalExpenseD.add(closingBalanceD);
    }

    lines.push({
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      closingBalance: closingBalanceD.toDecimalPlaces(4).toNumber(),
      cleardownAmount: cleardownAmountD.toDecimalPlaces(4).toNumber()
    });
  }

  if (lines.length === 0) {
    await updatePeriodCloseStatus(prisma, entityId, input.periodId);
    return makeEmptyResult(period, retainedEarningsCode);
  }

  // Canonical closing balances are normal-balance-positive, so P&L = revenue − expense
  const netProfitLossD = totalRevenueD.sub(totalExpenseD);

  // Build journal lines using Decimal-safe strings
  const journalLines: Array<{
    accountId: string;
    debit: string;
    credit: string;
    description: string;
  }> = [];

  const DEBIT_NORMAL_TYPES = new Set(["ASSET", "EXPENSE", "CONTRA_REVENUE"]);

  for (const line of lines) {
    const account = plAccounts.find((a: any) => a.code === line.accountCode);
    if (!account) continue;

    const balD = D(line.closingBalance);
    // account_period_balances stores normal-balance-positive closing balances
    // (GLRepository.updateAccountBalance). Zero a debit-normal account by
    // crediting its balance; zero a credit-normal account by debiting it.
    const isDebitNormal = DEBIT_NORMAL_TYPES.has(account.type);
    const postAsCredit = isDebitNormal ? balD.gt(ZERO) : balD.lt(ZERO);

    if (postAsCredit) {
      journalLines.push({
        accountId: account.id,
        debit: "0",
        credit: balD.abs().toFixed(4),
        description: `Year-end cleardown ${line.accountCode} ${line.accountName}`
      });
    } else {
      journalLines.push({
        accountId: account.id,
        debit: balD.abs().toFixed(4),
        credit: "0",
        description: `Year-end cleardown ${line.accountCode} ${line.accountName}`
      });
    }
  }

  // Retained earnings offset line — use Decimal to avoid float accumulation error
  const totalDebitsD = journalLines.reduce((s, l) => s.add(D(l.debit)), ZERO);
  const totalCreditsD = journalLines.reduce((s, l) => s.add(D(l.credit)), ZERO);

  if (totalDebitsD.gt(totalCreditsD)) {
    journalLines.push({
      accountId: reAccount.id,
      debit: "0",
      credit: totalDebitsD.sub(totalCreditsD).toDecimalPlaces(4).toFixed(4),
      description: `Year-end P&L transfer to Retained Earnings`
    });
  } else if (totalCreditsD.gt(totalDebitsD)) {
    journalLines.push({
      accountId: reAccount.id,
      debit: totalCreditsD.sub(totalDebitsD).toDecimalPlaces(4).toFixed(4),
      credit: "0",
      description: `Year-end P&L transfer to Retained Earnings`
    });
  }

  // Account types for canonical balance updates
  const accountTypeById = new Map<string, string>(plAccounts.map((a: any) => [a.id, a.type]));
  accountTypeById.set(reAccount.id, reAccount.type);

  // Post the year-end journal + update status in a single transaction
  const reference = `YE-${period.year}-CLEARDOWN`;
  const journal = await prisma.$transaction(async (tx: any) => {
    const created = await tx.journal.create({
      data: {
        entityId,
        periodId: input.periodId,
        reference,
        description: `Year-end P&L cleardown — FY${period.year} to Retained Earnings (${retainedEarningsCode})`,
        source: "YEAREND",
        status: "POSTED",
        postedAt: new Date(),
        functionalCurrency: funcCurrency,
        createdById: actorId,
        lines: {
          create: journalLines.map((jl) => ({
            accountId: jl.accountId,
            debit: jl.debit,
            credit: jl.credit,
            currency: funcCurrency,
            fxRate: 1,
            debitFunctional: jl.debit,
            creditFunctional: jl.credit,
            description: jl.description
          }))
        }
      }
    });

    // Update account balances so the cleardown is reflected in the trial balance
    const glRepo = new GLRepository(tx);
    await glRepo.batchUpdateAccountBalances(
      entityId,
      input.periodId,
      journalLines.map((jl) => ({
        accountId: jl.accountId,
        debitFunctional: D(jl.debit),
        creditFunctional: D(jl.credit),
        accountType: accountTypeById.get(jl.accountId)!
      }))
    );

    // Update PeriodCloseStatus inside the same transaction
    await updatePeriodCloseStatusTx(tx, entityId, input.periodId);

    return created;
  });

  // Synchronous audit trail
  const auditService = new AuditService(prisma);
  await auditService.createEvent({
    entityId,
    userId: actorId,
    eventType: "YEAR_END_CLEARDOWN_EXECUTED",
    resourceType: "YEAR_END_CLEARDOWN",
    resourceId: journal.id,
    afterState: {
      journalId: journal.id,
      periodId: input.periodId,
      fiscalYear: period.year,
      totalRevenue: totalRevenueD.toDecimalPlaces(2).toNumber(),
      totalExpense: totalExpenseD.toDecimalPlaces(2).toNumber(),
      netProfitLoss: netProfitLossD.toDecimalPlaces(2).toNumber(),
      retainedEarningsCode
    }
  });

  return {
    periodName: period.name ?? `${period.year}-${String(period.month).padStart(2, "0")}`,
    fiscalYear: period.year,
    retainedEarningsCode,
    totalRevenue: totalRevenueD.toDecimalPlaces(2).toNumber(),
    totalExpense: totalExpenseD.toDecimalPlaces(2).toNumber(),
    netProfitLoss: netProfitLossD.toDecimalPlaces(2).toNumber(),
    lines,
    journalId: journal.id
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function validateFinalPeriod(
  prisma: PrismaClient,
  entityId: string,
  period: any,
  fiscalYearStartMonth: number
) {
  // Determine fiscal year boundaries
  // If fiscal year starts in January (1), the final month is December (12) of the same year
  // If fiscal year starts in April (4), the final month is March (3) of the next year
  const fiscalYearEndMonth = fiscalYearStartMonth === 1 ? 12 : fiscalYearStartMonth - 1;

  // Determine what fiscal year this period belongs to
  let fiscalYear: number;
  if (fiscalYearStartMonth === 1) {
    fiscalYear = period.year;
  } else {
    // If month >= start month, it's in the fiscal year starting this calendar year
    // If month < start month, it's in the fiscal year that started the previous calendar year
    fiscalYear = period.month >= fiscalYearStartMonth ? period.year : period.year - 1;
  }

  // Check if this period is the final month of the fiscal year
  if (period.month !== fiscalYearEndMonth) {
    throw new YearEndCleardownError(
      "YE_NOT_FINAL_PERIOD",
      `Year-end cleardown can only run on the final period of the fiscal year (month ${fiscalYearEndMonth}). ` +
        `This period is month ${period.month}.`,
      422
    );
  }

  // Also verify no later periods exist in the same fiscal year
  // (handles edge case of out-of-order period creation)
  const laterPeriods = await (prisma as any).period.findMany({
    where: {
      entityId,
      year: period.year,
      month: { gt: period.month }
    }
  });

  // For standard Jan fiscal year, no later months should exist in the same year
  // For non-Jan fiscal year, this is more nuanced but the month check above suffices
  if (fiscalYearStartMonth === 1 && laterPeriods.length > 0) {
    throw new YearEndCleardownError(
      "YE_NOT_FINAL_PERIOD",
      "Later periods exist in this fiscal year. Year-end cleardown must run on the final period.",
      422
    );
  }
}

async function updatePeriodCloseStatus(prisma: PrismaClient, entityId: string, periodId: string) {
  await updatePeriodCloseStatusTx(prisma, entityId, periodId);
}

async function updatePeriodCloseStatusTx(tx: any, entityId: string, periodId: string) {
  const existing = await tx.periodCloseStatus.findFirst({
    where: { entityId, periodId, ledger: "A" }
  });

  if (existing) {
    await tx.periodCloseStatus.update({
      where: { id: existing.id },
      data: { yearEndProcessed: true }
    });
  } else {
    await tx.periodCloseStatus.create({
      data: {
        entityId,
        periodId,
        ledger: "A",
        status: "PC_OPEN",
        yearEndProcessed: true
      }
    });
  }
}

function makeEmptyResult(period: any, retainedEarningsCode: string): YearEndCleardownResult {
  return {
    periodName: period.name ?? `${period.year}-${String(period.month).padStart(2, "0")}`,
    fiscalYear: period.year,
    retainedEarningsCode,
    totalRevenue: 0,
    totalExpense: 0,
    netProfitLoss: 0,
    lines: [],
    journalId: null
  };
}

// round2 removed — all rounding now uses Prisma.Decimal.toDecimalPlaces()
