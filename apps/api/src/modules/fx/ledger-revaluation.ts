import type { PrismaClient } from "../../db/client.js";
import { Prisma } from "../../db/client.js";
import { ProcessLockService } from "../process-lock/service.js";
import { GLRepository } from "../gl/repository.js";
import type {
  RunLedgerRevaluationInput,
  RevaluationLineResult,
  RevaluationResult
} from "./revaluation-types.js";

// ── Decimal Helpers ─────────────────────────────────────────────────────────

const D = (v: unknown): Prisma.Decimal => new Prisma.Decimal(String(v ?? 0));
const ZERO = new Prisma.Decimal(0);
const ONE = new Prisma.Decimal(1);

// ── Errors ───────────────────────────────────────────────────────────────────

export class LedgerRevaluationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Minimum absolute difference to post (avoids rounding noise) */
const MIN_DIFFERENCE_THRESHOLD = 0.01;

// ── Main Engine ──────────────────────────────────────────────────────────────

/**
 * Ledger Revaluation Engine (LER)
 *
 * Revalues account-level foreign currency balances at a closing (or average/custom) rate.
 * For each account matching the profile filters:
 *   1. Get the current period closing balance (AccountPeriodBalance)
 *   2. Identify journal lines in non-functional currencies
 *   3. Recalculate the functional equivalent at the new rate
 *   4. Post unrealized gain/loss journal (DR/CR account ↔ CR/DR gain/loss)
 *   5. If autoReverse: create reversal journal in next period
 *   6. Update PeriodCloseStatus.revaluationRun = true
 *
 * Process-locked: acquires REVALUATION lock, releases on completion.
 */
export async function runLedgerRevaluation(
  prisma: PrismaClient,
  entityId: string,
  actorId: string,
  input: RunLedgerRevaluationInput
): Promise<RevaluationResult> {
  const lockService = new ProcessLockService(prisma);

  // 1. Acquire process lock
  await lockService.acquireLock({
    entityId,
    processType: "REVALUATION",
    userId: actorId,
    timeoutMinutes: 15
  });

  try {
    return await executeRevaluation(prisma, entityId, actorId, input);
  } finally {
    await lockService.releaseLock({ entityId, processType: "REVALUATION" }).catch(() => {});
  }
}

async function executeRevaluation(
  prisma: PrismaClient,
  entityId: string,
  actorId: string,
  input: RunLedgerRevaluationInput
): Promise<RevaluationResult> {
  // Load profile
  const profile = await (prisma as any).revaluationProfile.findFirst({
    where: { id: input.profileId, entityId, isActive: true }
  });
  if (!profile) {
    throw new LedgerRevaluationError(
      "REVAL_PROFILE_NOT_FOUND",
      "Revaluation profile not found.",
      404
    );
  }

  // Load period
  const period = await (prisma as any).period.findFirst({
    where: { id: input.periodId, entityId }
  });
  if (!period) {
    throw new LedgerRevaluationError("REVAL_PERIOD_NOT_FOUND", "Period not found.", 404);
  }

  // Resolve entity functional currency
  const entity = await (prisma as any).entity.findFirst({
    where: { id: entityId },
    select: { functionalCurrency: true }
  });
  const funcCurrency = entity?.functionalCurrency ?? "USD";

  // Idempotency check — has revaluation already been posted for this period/profile?
  const existingJournal = await (prisma as any).journal.findFirst({
    where: {
      entityId,
      periodId: input.periodId,
      source: "REVAL",
      reference: { startsWith: `LER-${profile.name.replace(/\s+/g, "-").slice(0, 20)}` }
    }
  });
  if (existingJournal) {
    throw new LedgerRevaluationError(
      "REVAL_ALREADY_RUN",
      `Ledger revaluation "${profile.name}" has already been run for this period.`,
      409
    );
  }

  // Build account filter
  const accountWhere: any = { entityId, isActive: true };
  const accountTypeFilter = (profile.accountTypeFilter ?? []) as string[];
  if (accountTypeFilter.length > 0) {
    accountWhere.type = { in: accountTypeFilter };
  }
  if (profile.accountCodeFrom || profile.accountCodeTo) {
    accountWhere.code = {};
    if (profile.accountCodeFrom) accountWhere.code.gte = profile.accountCodeFrom;
    if (profile.accountCodeTo) accountWhere.code.lte = profile.accountCodeTo;
  }

  const accounts = await (prisma as any).account.findMany({
    where: accountWhere,
    orderBy: { code: "asc" }
  });

  if (accounts.length === 0) {
    return makeEmptyResult(profile, period, input);
  }

  // For each account, find foreign currency journal lines in this period
  // and calculate the revaluation difference
  const closingDate = new Date(input.closingDate);
  const revalLines: RevaluationLineResult[] = [];

  for (const account of accounts) {
    // Get all journal lines for this account in this period with non-functional currencies
    const foreignLines = await (prisma as any).journalLine.findMany({
      where: {
        accountId: account.id,
        journal: {
          entityId,
          periodId: input.periodId,
          status: "POSTED"
        },
        NOT: { currency: funcCurrency }
      },
      select: {
        currency: true,
        debit: true,
        credit: true,
        fxRate: true,
        debitFunctional: true,
        creditFunctional: true
      }
    });

    if (foreignLines.length === 0) continue;

    // Apply currency filter from profile
    const filteredLines = profile.currencyFilter
      ? foreignLines.filter((l: any) => l.currency === profile.currencyFilter)
      : foreignLines;

    if (filteredLines.length === 0) continue;

    // Group by currency using Decimal arithmetic
    const byCurrency = new Map<
      string,
      { fcBalance: Prisma.Decimal; currentFunctionalBalance: Prisma.Decimal }
    >();

    for (const line of filteredLines) {
      const curr = line.currency;
      const existing = byCurrency.get(curr) ?? {
        fcBalance: ZERO,
        currentFunctionalBalance: ZERO
      };
      existing.fcBalance = existing.fcBalance.add(D(line.debit)).sub(D(line.credit));
      existing.currentFunctionalBalance = existing.currentFunctionalBalance
        .add(D(line.debitFunctional))
        .sub(D(line.creditFunctional));
      byCurrency.set(curr, existing);
    }

    // For each currency, get the closing rate and calculate difference
    for (const [currency, data] of byCurrency) {
      if (data.fcBalance.abs().lt(new Prisma.Decimal("0.0001"))) continue;

      const rate = await getRevaluationRate(
        prisma,
        currency,
        funcCurrency,
        profile.rateType,
        closingDate,
        input.customRate
      );

      if (!rate) continue;

      const rateDecimal = D(rate);
      const revaluedFunctional = data.fcBalance.mul(rateDecimal);
      const difference = revaluedFunctional.sub(data.currentFunctionalBalance);

      if (difference.abs().lt(D(MIN_DIFFERENCE_THRESHOLD))) continue;

      revalLines.push({
        accountCode: account.code,
        accountName: account.name,
        currency,
        originalFunctionalBalance: data.currentFunctionalBalance.toDecimalPlaces(2).toNumber(),
        revaluedFunctionalBalance: revaluedFunctional.toDecimalPlaces(2).toNumber(),
        difference: difference.toDecimalPlaces(2).toNumber(),
        fxRate: rate
      });
    }
  }

  // Calculate totals using Decimal
  const totalGainD = revalLines
    .filter((l) => l.difference > 0)
    .reduce((sum, l) => sum.add(D(l.difference)), ZERO);
  const totalLossD = revalLines
    .filter((l) => l.difference < 0)
    .reduce((sum, l) => sum.add(D(l.difference).abs()), ZERO);
  const totalGain = totalGainD.toDecimalPlaces(2).toNumber();
  const totalLoss = totalLossD.toDecimalPlaces(2).toNumber();

  // If no differences or postDifferences=false, return report only
  if (revalLines.length === 0 || !profile.postDifferences) {
    // Still update PeriodCloseStatus
    await updatePeriodCloseStatus(prisma, entityId, input.periodId);

    return {
      profileName: profile.name,
      periodName: period.name ?? `${period.year}-${String(period.month).padStart(2, "0")}`,
      closingDate: input.closingDate,
      rateType: profile.rateType,
      totalGain,
      totalLoss,
      netGainLoss: totalGainD.sub(totalLossD).toDecimalPlaces(2).toNumber(),
      lines: revalLines,
      journalId: null,
      reversalJournalId: null
    };
  }

  // Resolve gain/loss accounts
  const gainAccount = await (prisma as any).account.findFirst({
    where: { entityId, code: profile.gainAccountCode, isActive: true }
  });
  const lossAccount = await (prisma as any).account.findFirst({
    where: { entityId, code: profile.lossAccountCode, isActive: true }
  });

  if (!gainAccount) {
    throw new LedgerRevaluationError(
      "REVAL_GAIN_ACCOUNT_MISSING",
      `Gain account ${profile.gainAccountCode} not found.`,
      422
    );
  }
  if (!lossAccount) {
    throw new LedgerRevaluationError(
      "REVAL_LOSS_ACCOUNT_MISSING",
      `Loss account ${profile.lossAccountCode} not found.`,
      422
    );
  }

  // Account types for canonical balance updates (covers all journal-line accounts)
  const accountTypeById = new Map<string, string>();
  for (const acct of accounts) accountTypeById.set(acct.id, acct.type);
  accountTypeById.set(gainAccount.id, gainAccount.type);
  accountTypeById.set(lossAccount.id, lossAccount.type);

  // Build journal lines using Decimal-safe strings
  const journalLines: Array<{
    accountId: string;
    debit: string;
    credit: string;
    description: string;
  }> = [];

  for (const line of revalLines) {
    const acct = accounts.find((a: any) => a.code === line.accountCode);
    if (!acct) continue;

    const diffD = D(line.difference);

    if (diffD.gt(ZERO)) {
      const amt = diffD.toFixed(4);
      journalLines.push({
        accountId: acct.id,
        debit: amt,
        credit: "0",
        description: `FX reval ${line.accountCode} ${line.currency} gain`
      });
      journalLines.push({
        accountId: gainAccount.id,
        debit: "0",
        credit: amt,
        description: `Unrealized FX gain — ${line.accountCode} ${line.currency}`
      });
    } else {
      const amt = diffD.abs().toFixed(4);
      journalLines.push({
        accountId: lossAccount.id,
        debit: amt,
        credit: "0",
        description: `Unrealized FX loss — ${line.accountCode} ${line.currency}`
      });
      journalLines.push({
        accountId: acct.id,
        debit: "0",
        credit: amt,
        description: `FX reval ${line.accountCode} ${line.currency} loss`
      });
    }
  }

  // Post revaluation journal + optional reversal in a single transaction
  const refSlug = profile.name.replace(/\s+/g, "-").slice(0, 20);
  const reference = `LER-${refSlug}-${input.closingDate}`;

  const { journalId, reversalJournalId } = await prisma.$transaction(async (tx: any) => {
    const journal = await tx.journal.create({
      data: {
        entityId,
        periodId: input.periodId,
        reference,
        description: `Ledger FX revaluation — ${profile.name} at ${profile.rateType} rate`,
        source: "REVAL",
        status: "POSTED",
        postedAt: new Date(),
        functionalCurrency: funcCurrency,
        createdById: actorId,
        isAutoReversible: profile.autoReverse,
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

    let revId: string | null = null;
    if (profile.autoReverse) {
      const nextPeriod = await tx.period.findFirst({
        where: {
          entityId,
          OR: [{ year: period.year, month: { gt: period.month } }, { year: { gt: period.year } }]
        },
        orderBy: [{ year: "asc" }, { month: "asc" }]
      });

      if (nextPeriod) {
        const reversalJournal = await tx.journal.create({
          data: {
            entityId,
            periodId: nextPeriod.id,
            reference: `REV-${reference}`,
            description: `Auto-reversal of ledger FX revaluation — ${profile.name}`,
            source: "REVAL",
            status: "POSTED",
            postedAt: new Date(),
            functionalCurrency: funcCurrency,
            createdById: actorId,
            reversalOfId: journal.id,
            lines: {
              create: journalLines.map((jl) => ({
                accountId: jl.accountId,
                debit: jl.credit,
                credit: jl.debit,
                currency: funcCurrency,
                fxRate: 1,
                debitFunctional: jl.credit,
                creditFunctional: jl.debit,
                description: `Reversal: ${jl.description}`
              }))
            }
          }
        });
        revId = reversalJournal.id;

        await glRepo.batchUpdateAccountBalances(
          entityId,
          nextPeriod.id,
          journalLines.map((jl) => ({
            accountId: jl.accountId,
            debitFunctional: D(jl.credit), // flipped — reversal
            creditFunctional: D(jl.debit),
            accountType: accountTypeById.get(jl.accountId)!
          }))
        );
      }
    }

    return { journalId: journal.id as string, reversalJournalId: revId };
  });

  // Update PeriodCloseStatus
  await updatePeriodCloseStatus(prisma, entityId, input.periodId);

  return {
    profileName: profile.name,
    periodName: period.name ?? `${period.year}-${String(period.month).padStart(2, "0")}`,
    closingDate: input.closingDate,
    rateType: profile.rateType,
    totalGain,
    totalLoss,
    netGainLoss: totalGainD.sub(totalLossD).toDecimalPlaces(2).toNumber(),
    lines: revalLines,
    journalId,
    reversalJournalId
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getRevaluationRate(
  prisma: PrismaClient,
  fromCurrency: string,
  toCurrency: string,
  rateType: string,
  closingDate: Date,
  customRate?: number
): Promise<number | null> {
  if (rateType === "CUSTOM" && customRate) {
    return customRate;
  }

  const fxRateType =
    rateType === "CLOSING" ? "CLOSING" : rateType === "AVERAGE" ? "AVERAGE" : "SPOT";

  const rate = await (prisma as any).fXRate.findFirst({
    where: {
      fromCurrency: fromCurrency.toUpperCase(),
      toCurrency: toCurrency.toUpperCase(),
      rateType: fxRateType,
      effectiveDate: { lte: closingDate }
    },
    orderBy: { effectiveDate: "desc" }
  });

  if (rate) return Number(rate.rate);

  // Try reverse rate — use Decimal for precision
  const reverseRate = await (prisma as any).fXRate.findFirst({
    where: {
      fromCurrency: toCurrency.toUpperCase(),
      toCurrency: fromCurrency.toUpperCase(),
      rateType: fxRateType,
      effectiveDate: { lte: closingDate }
    },
    orderBy: { effectiveDate: "desc" }
  });

  if (reverseRate) {
    const rateD = D(reverseRate.rate);
    if (!rateD.isZero()) {
      return ONE.div(rateD).toDecimalPlaces(8).toNumber();
    }
  }

  // Fallback to SPOT rate if CLOSING/AVERAGE not found
  if (fxRateType !== "SPOT") {
    return getRevaluationRate(prisma, fromCurrency, toCurrency, "SPOT", closingDate, undefined);
  }

  return null;
}

async function updatePeriodCloseStatus(prisma: PrismaClient, entityId: string, periodId: string) {
  const existing = await (prisma as any).periodCloseStatus.findFirst({
    where: { entityId, periodId, ledger: "A" }
  });

  if (existing) {
    await (prisma as any).periodCloseStatus.update({
      where: { id: existing.id },
      data: { revaluationRun: true }
    });
  } else {
    await (prisma as any).periodCloseStatus.create({
      data: {
        entityId,
        periodId,
        ledger: "A",
        status: "PC_OPEN",
        revaluationRun: true
      }
    });
  }
}

function makeEmptyResult(
  profile: any,
  period: any,
  input: RunLedgerRevaluationInput
): RevaluationResult {
  return {
    profileName: profile.name,
    periodName: period.name ?? `${period.year}-${String(period.month).padStart(2, "0")}`,
    closingDate: input.closingDate,
    rateType: profile.rateType,
    totalGain: 0,
    totalLoss: 0,
    netGainLoss: 0,
    lines: [],
    journalId: null,
    reversalJournalId: null
  };
}

// round2 removed — all rounding now uses Prisma.Decimal.toDecimalPlaces()
