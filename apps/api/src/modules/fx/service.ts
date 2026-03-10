import { Prisma, PrismaClient } from "@prisma/client";
import { setEntityDbContext } from "../../db/tenantContext.js";
import { FXRepository } from "./repository.js";
import type {
  ConvertQuery,
  CurrencyCreateInput,
  FXRateCreateInput,
  FXRateQuery,
  RevaluationRequest
} from "./types.js";

export class FXServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

type EcbRateEntry = { currency: string; rate: string };

export class FXService {
  constructor(private readonly prisma: PrismaClient) {}

  private repository(client: PrismaClient | Prisma.TransactionClient) {
    return new FXRepository(client);
  }

  // ── Currencies ───────────────────────────────────────────────────────────────

  listCurrencies(activeOnly = true) {
    return this.repository(this.prisma).listCurrencies(activeOnly);
  }

  async upsertCurrency(input: CurrencyCreateInput) {
    return this.repository(this.prisma).upsertCurrency(input);
  }

  // ── FX Rates ─────────────────────────────────────────────────────────────────

  listRates(query: FXRateQuery) {
    return this.repository(this.prisma).listRates(query);
  }

  async upsertRate(input: FXRateCreateInput) {
    return this.repository(this.prisma).upsertRate(input);
  }

  async convert(query: ConvertQuery) {
    if (query.fromCurrency.toUpperCase() === query.toCurrency.toUpperCase()) {
      return {
        fromCurrency: query.fromCurrency.toUpperCase(),
        toCurrency: query.toCurrency.toUpperCase(),
        inputAmount: query.amount,
        convertedAmount: query.amount,
        rate: "1.00000000",
        rateType: query.rateType,
        effectiveDate: query.effectiveDate ?? new Date()
      };
    }

    const rate = await this.repository(this.prisma).getLatestRate(
      query.fromCurrency,
      query.toCurrency,
      query.rateType,
      query.effectiveDate
    );

    if (!rate) {
      throw new FXServiceError(
        "FX_RATE_NOT_FOUND",
        `No ${query.rateType} rate found for ${query.fromCurrency}/${query.toCurrency}.`,
        404
      );
    }

    const amount = new Prisma.Decimal(query.amount);
    const converted = amount.mul(rate.rate);

    return {
      fromCurrency: query.fromCurrency.toUpperCase(),
      toCurrency: query.toCurrency.toUpperCase(),
      inputAmount: query.amount,
      convertedAmount: converted.toFixed(8),
      rate: rate.rate.toFixed(8),
      rateType: rate.rateType,
      effectiveDate: rate.effectiveDate
    };
  }

  // ── ECB Import ────────────────────────────────────────────────────────────────

  async importEcbRates(): Promise<{ imported: number; date: string }> {
    const ecbUrl =
      process.env.ECB_RATES_URL ??
      "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

    let xml: string;
    try {
      const response = await fetch(ecbUrl, {
        headers: { Accept: "application/xml, text/xml" },
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        throw new Error(`ECB fetch failed: ${response.status}`);
      }
      xml = await response.text();
    } catch (error) {
      throw new FXServiceError(
        "FX_ECB_FETCH_FAILED",
        `Failed to fetch ECB rates: ${error instanceof Error ? error.message : String(error)}`,
        502
      );
    }

    // Parse minimal XML without external dependency
    const dateMatch = xml.match(/time='(\d{4}-\d{2}-\d{2})'/);
    const rateDate = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
    const effectiveDate = new Date(rateDate);

    const rateMatches = [...xml.matchAll(/currency='([A-Z]{3})' rate='([0-9.]+)'/g)];
    const entries: EcbRateEntry[] = rateMatches.map((m) => ({
      currency: m[1],
      rate: m[2]
    }));

    let imported = 0;
    for (const entry of entries) {
      try {
        // EUR -> foreign currency
        await this.repository(this.prisma).upsertRate({
          fromCurrency: "EUR",
          toCurrency: entry.currency,
          rateType: "SPOT",
          rate: entry.rate,
          effectiveDate,
          source: "ECB"
        });
        // Inverse: foreign -> EUR
        const inverse = new Prisma.Decimal(1).div(new Prisma.Decimal(entry.rate));
        await this.repository(this.prisma).upsertRate({
          fromCurrency: entry.currency,
          toCurrency: "EUR",
          rateType: "SPOT",
          rate: inverse.toDecimalPlaces(8).toFixed(8),
          effectiveDate,
          source: "ECB"
        });
        imported++;
      } catch {
        // Skip individual failures; log if needed
      }
    }

    return { imported, date: rateDate };
  }

  // ── FX Revaluation (IAS 21) ──────────────────────────────────────────────────

  async runRevaluation(request: RevaluationRequest): Promise<{
    journalId: string | null;
    apItemsRevalued: number;
    arItemsRevalued: number;
    totalGainLoss: string;
    idempotent: boolean;
  }> {
    const repository = this.repository(this.prisma);
    const referenceDate = request.closingRateDate.toISOString().slice(0, 10);

    const period = await repository.getPeriod(request.entityId, request.periodId);
    if (!period) {
      throw new FXServiceError("FX_PERIOD_NOT_FOUND", "Period not found.", 404);
    }
    if (period.status !== "OPEN") {
      throw new FXServiceError("FX_PERIOD_NOT_OPEN", "Period must be OPEN for revaluation.", 422);
    }

    // Idempotency: if revaluation already ran for this period+date, return early
    const existing = await repository.findExistingRevaluationJournal(
      request.entityId,
      request.periodId,
      referenceDate
    );
    if (existing) {
      return {
        journalId: existing.id,
        apItemsRevalued: 0,
        arItemsRevalued: 0,
        totalGainLoss: "0.0000",
        idempotent: true
      };
    }

    const entityUser = await repository.findUser(request.entityId);
    if (!entityUser) {
      throw new FXServiceError("FX_NO_USER", "No user found for entity to create journal.", 422);
    }
    const actorId = entityUser.userId;
    const functionalCurrency = period.entity?.functionalCurrency ?? "USD";

    // Get FX P&L account (account code 7000 or first available)
    const fxGainLossAccount =
      (await repository.getAccount(request.entityId, "7000")) ??
      (await repository.getAccountByType(request.entityId, "Other Income/Expense"));
    if (!fxGainLossAccount) {
      throw new FXServiceError(
        "FX_GL_ACCOUNT_NOT_FOUND",
        "FX Gain/Loss account (code 7000) not configured.",
        422
      );
    }

    const journalLines: Array<{
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      lineNumber: number;
      description: string;
    }> = [];
    let lineNumber = 1;
    let totalGainLoss = new Prisma.Decimal(0);
    let apItemsRevalued = 0;
    let arItemsRevalued = 0;

    // ── Revalue AP invoices ────────────────────────────────────────────────────
    const apInvoices = await repository.getOpenAPInvoices(request.entityId);
    for (const invoice of apInvoices) {
      if (invoice.currency === functionalCurrency) continue;

      const rateRecord = await repository.getLatestRate(
        invoice.currency,
        functionalCurrency,
        "CLOSING",
        request.closingRateDate
      );
      if (!rateRecord) continue;

      const closingRate = new Prisma.Decimal(rateRecord.rate);
      const bookedFunctional = new Prisma.Decimal(invoice.functionalAmount);
      const newFunctional = new Prisma.Decimal(invoice.netAmount).mul(closingRate);
      const gainLoss = bookedFunctional.sub(newFunctional); // positive = gain for payable

      if (gainLoss.abs().lessThan(new Prisma.Decimal("0.0001"))) continue;

      if (gainLoss.greaterThan(0)) {
        // Gain on payable (payable decreased in functional terms) — credit FX Gain/Loss
        journalLines.push({
          accountId: fxGainLossAccount.id,
          debit: new Prisma.Decimal(0),
          credit: gainLoss.abs(),
          lineNumber: lineNumber++,
          description: `FX revaluation gain on AP ${invoice.id.slice(0, 8)}`
        });
      } else {
        // Loss on payable
        journalLines.push({
          accountId: fxGainLossAccount.id,
          debit: gainLoss.abs(),
          credit: new Prisma.Decimal(0),
          lineNumber: lineNumber++,
          description: `FX revaluation loss on AP ${invoice.id.slice(0, 8)}`
        });
      }
      totalGainLoss = totalGainLoss.add(gainLoss);
      apItemsRevalued++;
    }

    // ── Revalue AR invoices ────────────────────────────────────────────────────
    const arInvoices = await repository.getOpenARInvoices(request.entityId);
    for (const invoice of arInvoices) {
      if (invoice.currency === functionalCurrency) continue;

      const rateRecord = await repository.getLatestRate(
        invoice.currency,
        functionalCurrency,
        "CLOSING",
        request.closingRateDate
      );
      if (!rateRecord) continue;

      const closingRate = new Prisma.Decimal(rateRecord.rate);
      const outstanding = new Prisma.Decimal(invoice.amount).sub(new Prisma.Decimal(invoice.amountPaid));
      const bookedFunctional = new Prisma.Decimal(invoice.functionalAmount);
      const newFunctional = outstanding.mul(closingRate);
      const gainLoss = newFunctional.sub(bookedFunctional); // positive = gain for receivable

      if (gainLoss.abs().lessThan(new Prisma.Decimal("0.0001"))) continue;

      if (gainLoss.greaterThan(0)) {
        journalLines.push({
          accountId: fxGainLossAccount.id,
          debit: new Prisma.Decimal(0),
          credit: gainLoss.abs(),
          lineNumber: lineNumber++,
          description: `FX revaluation gain on AR ${invoice.id.slice(0, 8)}`
        });
      } else {
        journalLines.push({
          accountId: fxGainLossAccount.id,
          debit: gainLoss.abs(),
          credit: new Prisma.Decimal(0),
          lineNumber: lineNumber++,
          description: `FX revaluation loss on AR ${invoice.id.slice(0, 8)}`
        });
      }
      totalGainLoss = totalGainLoss.add(gainLoss);
      arItemsRevalued++;
    }

    if (journalLines.length === 0) {
      return {
        journalId: null,
        apItemsRevalued,
        arItemsRevalued,
        totalGainLoss: "0.0000",
        idempotent: false
      };
    }

    // Balance the journal: net gain/loss entry to offset all individual lines
    const totalDebit = journalLines.reduce(
      (s, l) => s.add(l.debit),
      new Prisma.Decimal(0)
    );
    const totalCredit = journalLines.reduce(
      (s, l) => s.add(l.credit),
      new Prisma.Decimal(0)
    );
    const diff = totalDebit.sub(totalCredit);
    if (!diff.equals(0)) {
      if (diff.greaterThan(0)) {
        journalLines.push({
          accountId: fxGainLossAccount.id,
          debit: new Prisma.Decimal(0),
          credit: diff,
          lineNumber: lineNumber++,
          description: "FX revaluation balancing entry"
        });
      } else {
        journalLines.push({
          accountId: fxGainLossAccount.id,
          debit: diff.abs(),
          credit: new Prisma.Decimal(0),
          lineNumber: lineNumber++,
          description: "FX revaluation balancing entry"
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      await setEntityDbContext(tx, request.entityId);
      const txRepo = this.repository(tx);

      const journal = await txRepo.createRevaluationJournal(
        request.entityId,
        actorId,
        request.periodId,
        functionalCurrency,
        `FX revaluation for period ${period.name} at closing date ${referenceDate}`,
        journalLines
      );

      for (const line of journal.lines) {
        await txRepo.updateAccountBalance(
          request.entityId,
          line.accountId,
          request.periodId,
          line.debitFunctional,
          line.creditFunctional
        );
      }

      return {
        journalId: journal.id,
        apItemsRevalued,
        arItemsRevalued,
        totalGainLoss: totalGainLoss.toFixed(4),
        idempotent: false
      };
    });
  }
}
