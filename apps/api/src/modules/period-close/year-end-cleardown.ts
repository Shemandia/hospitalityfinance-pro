import type { PrismaClient } from "../../db/client.js";
import { ProcessLockService } from "../process-lock/service.js";
import type {
  RunYearEndCleardownInput,
  YearEndCleardownLineResult,
  YearEndCleardownResult
} from "./year-end-types.js";

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

  // Build balance map: accountId → closingBalance
  const balanceMap = new Map<string, number>();
  for (const bal of balances) {
    balanceMap.set(bal.accountId, Number(bal.closingBalance));
  }

  // Build cleardown lines
  const lines: YearEndCleardownLineResult[] = [];
  let totalRevenue = 0;
  let totalExpense = 0;

  for (const account of plAccounts) {
    const closingBalance = balanceMap.get(account.id) ?? 0;
    if (Math.abs(closingBalance) < 0.01) continue;

    // Cleardown amount is the negative of the closing balance
    // (to zero out the account)
    const cleardownAmount = -closingBalance;

    if (account.type === "REVENUE") {
      totalRevenue += closingBalance;
    } else {
      totalExpense += closingBalance;
    }

    lines.push({
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type,
      closingBalance: round2(closingBalance),
      cleardownAmount: round2(cleardownAmount)
    });
  }

  if (lines.length === 0) {
    await updatePeriodCloseStatus(prisma, entityId, input.periodId);
    return makeEmptyResult(period, retainedEarningsCode);
  }

  // Net P&L = Revenue + Expense (expense is typically negative in natural sign)
  // Revenue accounts normally have credit (negative) balances, Expense have debit (positive)
  const netProfitLoss = round2(totalRevenue + totalExpense);

  // Build journal lines
  const journalLines: Array<{
    accountId: string;
    debit: number;
    credit: number;
    description: string;
  }> = [];

  for (const line of lines) {
    const account = plAccounts.find((a: any) => a.code === line.accountCode);
    if (!account) continue;

    // To zero out: if closingBalance > 0, credit the account; if < 0, debit the account
    if (line.closingBalance > 0) {
      journalLines.push({
        accountId: account.id,
        debit: 0,
        credit: line.closingBalance,
        description: `Year-end cleardown ${line.accountCode} ${line.accountName}`
      });
    } else {
      journalLines.push({
        accountId: account.id,
        debit: Math.abs(line.closingBalance),
        credit: 0,
        description: `Year-end cleardown ${line.accountCode} ${line.accountName}`
      });
    }
  }

  // Retained earnings offset line
  // Total DR must equal Total CR. The RE line balances the journal.
  const totalDebits = journalLines.reduce((s, l) => s + l.debit, 0);
  const totalCredits = journalLines.reduce((s, l) => s + l.credit, 0);

  if (totalDebits > totalCredits) {
    // Net profit: more credits from revenue accounts → DR P&L side, CR RE
    journalLines.push({
      accountId: reAccount.id,
      debit: 0,
      credit: round2(totalDebits - totalCredits),
      description: `Year-end P&L transfer to Retained Earnings`
    });
  } else if (totalCredits > totalDebits) {
    // Net loss: more debits from expense accounts → CR P&L side, DR RE
    journalLines.push({
      accountId: reAccount.id,
      debit: round2(totalCredits - totalDebits),
      credit: 0,
      description: `Year-end P&L transfer to Retained Earnings`
    });
  }

  // Post the year-end journal
  const reference = `YE-${period.year}-CLEARDOWN`;
  const journal = await (prisma as any).journal.create({
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

  // Update PeriodCloseStatus
  await updatePeriodCloseStatus(prisma, entityId, input.periodId);

  return {
    periodName: period.name ?? `${period.year}-${String(period.month).padStart(2, "0")}`,
    fiscalYear: period.year,
    retainedEarningsCode,
    totalRevenue: round2(totalRevenue),
    totalExpense: round2(totalExpense),
    netProfitLoss,
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
  const existing = await (prisma as any).periodCloseStatus.findFirst({
    where: { entityId, periodId, ledger: "A" }
  });

  if (existing) {
    await (prisma as any).periodCloseStatus.update({
      where: { id: existing.id },
      data: { yearEndProcessed: true }
    });
  } else {
    await (prisma as any).periodCloseStatus.create({
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
