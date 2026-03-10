import { Prisma, PrismaClient } from "@prisma/client";
import type { CurrencyCreateInput, FXRateCreateInput, FXRateQuery } from "./types.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class FXRepository {
  constructor(private readonly db: DbClient) {}

  // ── Currencies ───────────────────────────────────────────────────────────────

  listCurrencies(activeOnly = true) {
    return this.db.currency.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ code: "asc" }]
    });
  }

  getCurrency(code: string) {
    return this.db.currency.findUnique({ where: { code: code.toUpperCase() } });
  }

  upsertCurrency(input: CurrencyCreateInput) {
    return this.db.currency.upsert({
      where: { code: input.code },
      create: {
        code: input.code,
        name: input.name,
        symbol: input.symbol,
        decimalPlaces: input.decimalPlaces,
        isActive: input.isActive
      },
      update: {
        name: input.name,
        symbol: input.symbol,
        decimalPlaces: input.decimalPlaces,
        isActive: input.isActive
      }
    });
  }

  // ── FX Rates ─────────────────────────────────────────────────────────────────

  listRates(query: FXRateQuery) {
    return this.db.fXRate.findMany({
      where: {
        ...(query.fromCurrency && { fromCurrency: query.fromCurrency.toUpperCase() }),
        ...(query.toCurrency && { toCurrency: query.toCurrency.toUpperCase() }),
        ...(query.rateType && { rateType: query.rateType }),
        ...(query.effectiveDate && { effectiveDate: query.effectiveDate })
      },
      take: query.limit,
      orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }]
    });
  }

  upsertRate(input: FXRateCreateInput) {
    return this.db.fXRate.upsert({
      where: {
        fromCurrency_toCurrency_rateType_effectiveDate: {
          fromCurrency: input.fromCurrency,
          toCurrency: input.toCurrency,
          rateType: input.rateType,
          effectiveDate: input.effectiveDate
        }
      },
      create: {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rateType: input.rateType,
        rate: new Prisma.Decimal(input.rate),
        effectiveDate: input.effectiveDate,
        source: input.source
      },
      update: {
        rate: new Prisma.Decimal(input.rate),
        source: input.source
      }
    });
  }

  getLatestRate(
    fromCurrency: string,
    toCurrency: string,
    rateType: "SPOT" | "AVERAGE" | "BUDGET" | "CLOSING",
    asOfDate?: Date
  ) {
    return this.db.fXRate.findFirst({
      where: {
        fromCurrency: fromCurrency.toUpperCase(),
        toCurrency: toCurrency.toUpperCase(),
        rateType,
        ...(asOfDate && { effectiveDate: { lte: asOfDate } })
      },
      orderBy: [{ effectiveDate: "desc" }]
    });
  }

  // ── Revaluation helpers ─────────────────────────────────────────────────────

  getOpenAPInvoices(entityId: string) {
    return this.db.aPInvoice.findMany({
      where: {
        entityId,
        status: { in: ["APPROVED", "POSTED"] }
      },
      select: {
        id: true,
        currency: true,
        functionalAmount: true,
        fxRate: true,
        netAmount: true,
        periodId: true
      }
    });
  }

  getOpenARInvoices(entityId: string) {
    return this.db.aRInvoice.findMany({
      where: {
        entityId,
        status: { in: ["POSTED", "PARTIALLY_PAID", "OVERDUE"] }
      },
      select: {
        id: true,
        currency: true,
        functionalAmount: true,
        fxRate: true,
        amount: true,
        amountPaid: true
      }
    });
  }

  getAccount(entityId: string, code: string) {
    return this.db.account.findUnique({
      where: { entityId_code: { entityId, code } }
    });
  }

  getAccountByType(entityId: string, usaliCategory: string) {
    return this.db.account.findFirst({
      where: { entityId, usaliCategory, allowPosting: true, isActive: true }
    });
  }

  getPeriod(entityId: string, periodId: string) {
    return this.db.period.findFirst({
      where: { entityId, id: periodId },
      include: { entity: true }
    });
  }

  findUser(entityId: string) {
    return this.db.entityUser.findFirst({
      where: { entityId },
      include: { user: true }
    });
  }

  createRevaluationJournal(
    entityId: string,
    actorId: string,
    periodId: string,
    currency: string,
    description: string,
    lines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      lineNumber: number;
      description: string;
    }>
  ) {
    return this.db.journal.create({
      data: {
        entityId,
        periodId,
        reference: `FX-REVAL-${new Date().toISOString().slice(0, 10)}`,
        description,
        source: "FX_REVAL",
        status: "POSTED",
        functionalCurrency: currency,
        createdById: actorId,
        postedAt: new Date(),
        lines: {
          create: lines.map((line) => ({
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            currency,
            fxRate: new Prisma.Decimal(1),
            debitFunctional: line.debit,
            creditFunctional: line.credit,
            description: line.description,
            lineNumber: line.lineNumber
          }))
        }
      },
      include: { lines: true }
    });
  }

  updateAccountBalance(
    entityId: string,
    accountId: string,
    periodId: string,
    debitFunctional: Prisma.Decimal,
    creditFunctional: Prisma.Decimal
  ) {
    return this.db.accountPeriodBalance.upsert({
      where: { entityId_accountId_periodId: { entityId, accountId, periodId } },
      create: {
        entityId,
        accountId,
        periodId,
        openingBalance: new Prisma.Decimal(0),
        periodDebits: debitFunctional,
        periodCredits: creditFunctional,
        closingBalance: debitFunctional.sub(creditFunctional)
      },
      update: {
        periodDebits: { increment: debitFunctional },
        periodCredits: { increment: creditFunctional },
        closingBalance: { increment: debitFunctional.sub(creditFunctional) }
      }
    });
  }

  markAPInvoiceRevalued(entityId: string, invoiceId: string, newFunctionalAmount: Prisma.Decimal) {
    return this.db.aPInvoice.updateMany({
      where: { entityId, id: invoiceId },
      data: { functionalAmount: newFunctionalAmount }
    });
  }

  markARInvoiceRevalued(entityId: string, invoiceId: string, newFunctionalAmount: Prisma.Decimal) {
    return this.db.aRInvoice.updateMany({
      where: { entityId, id: invoiceId },
      data: { functionalAmount: newFunctionalAmount }
    });
  }

  // Check if revaluation journal already exists for this period (idempotency)
  findExistingRevaluationJournal(entityId: string, periodId: string, referenceDate: string) {
    return this.db.journal.findFirst({
      where: {
        entityId,
        periodId,
        source: "FX_REVAL",
        reference: `FX-REVAL-${referenceDate}`
      }
    });
  }
}
