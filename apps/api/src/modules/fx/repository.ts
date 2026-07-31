import { Prisma, PrismaClient } from "../../db/client.js";
import { applyBalanceDelta } from "../../db/balance-writer.js";
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

  deleteRate(id: string) {
    return this.db.fXRate.delete({ where: { id } });
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

  /**
   * Resolve a revaluation rate, falling back the way the ledger revaluation
   * engine does: requested type → the inverse of the reverse pair → SPOT.
   *
   * Revaluation used to query CLOSING only and skip any invoice without one.
   * Nothing in the system writes CLOSING rates — the ECB import writes SPOT —
   * so in practice every invoice was skipped and the whole revaluation posted
   * nothing while reporting success.
   *
   * Returns null only when no usable rate exists in any form; callers must
   * surface that rather than silently continuing.
   */
  async resolveRevaluationRate(
    fromCurrency: string,
    toCurrency: string,
    preferredType: "SPOT" | "AVERAGE" | "BUDGET" | "CLOSING",
    asOfDate: Date
  ): Promise<Prisma.Decimal | null> {
    const direct = await this.getLatestRate(fromCurrency, toCurrency, preferredType, asOfDate);
    if (direct) return new Prisma.Decimal(direct.rate);

    const reverse = await this.getLatestRate(toCurrency, fromCurrency, preferredType, asOfDate);
    if (reverse) {
      const rate = new Prisma.Decimal(reverse.rate);
      if (!rate.isZero()) return new Prisma.Decimal(1).div(rate).toDecimalPlaces(8);
    }

    if (preferredType !== "SPOT") {
      const spot = await this.getLatestRate(fromCurrency, toCurrency, "SPOT", asOfDate);
      if (spot) return new Prisma.Decimal(spot.rate);

      const spotReverse = await this.getLatestRate(toCurrency, fromCurrency, "SPOT", asOfDate);
      if (spotReverse) {
        const rate = new Prisma.Decimal(spotReverse.rate);
        if (!rate.isZero()) return new Prisma.Decimal(1).div(rate).toDecimalPlaces(8);
      }
    }

    return null;
  }

  /**
   * Outstanding gross balance per AP invoice: what the supplier is still owed.
   *
   * APInvoice has no amountPaid column — payments are recorded as
   * ap_payment_allocations — so the outstanding amount has to be derived.
   */
  async getAPOutstandingByInvoice(entityId: string, invoiceIds: string[]) {
    if (invoiceIds.length === 0) return new Map<string, Prisma.Decimal>();

    const rows = await this.db.$queryRaw<Array<{ invoice_id: string; allocated: string }>>`
      SELECT i.id AS invoice_id,
             COALESCE(SUM(a.allocated_amount), 0)::text AS allocated
      FROM ap_invoices i
      LEFT JOIN ap_payment_allocations a ON a.invoice_id = i.id
      WHERE i.entity_id = ${entityId}
        AND i.id = ANY(${invoiceIds})
      GROUP BY i.id
    `;

    const allocated = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      allocated.set(row.invoice_id, new Prisma.Decimal(row.allocated));
    }
    return allocated;
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
        // Gross is what the supplier is owed and what AP control carries.
        // netAmount is the pre-tax figure and would revalue the wrong base.
        grossAmount: true,
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

  /**
   * @param referenceDate The closing-rate date, as YYYY-MM-DD. This MUST be the
   *   same value findExistingRevaluationJournal is called with. It previously
   *   stamped `new Date()` instead, so whenever the closing date differed from
   *   the run date — re-running an April revaluation in May, the normal case —
   *   the idempotency check looked for a reference that had never been written
   *   and posted a second gain/loss journal on top of the first.
   */
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
    }>,
    referenceDate: string
  ) {
    return this.db.journal.create({
      data: {
        entityId,
        periodId,
        reference: `FX-REVAL-${referenceDate}`,
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

  /**
   * Update one account's period balance.
   *
   * This used to hold its own unsigned writer, justified by a comment claiming
   * "FX revaluation always uses debit-normal convention (gain/loss accounts)".
   * That was wrong: fx/service.ts applies this to every line of the
   * revaluation journal, which includes AP control, AR control and bank
   * accounts. Revaluing a foreign payable therefore moved AP control the wrong
   * way and the trial balance stopped tying.
   *
   * It now delegates to the canonical signed writer like every other module.
   */
  async updateAccountBalance(
    entityId: string,
    accountId: string,
    periodId: string,
    debitFunctional: Prisma.Decimal,
    creditFunctional: Prisma.Decimal
  ) {
    await applyBalanceDelta(
      this.db,
      entityId,
      periodId,
      accountId,
      debitFunctional,
      creditFunctional
    );
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
