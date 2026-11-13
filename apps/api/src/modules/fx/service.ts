import { Prisma, PrismaClient } from "../../db/client.js";
import { setEntityDbContext, clearEntityDbContext } from "../../db/tenantContext.js";
import { FXRepository } from "./repository.js";
import { AuditService } from "../audit/service.js";
import type {
  ConvertQuery,
  CurrencyCreateInput,
  FXRateCreateInput,
  FXRateQuery,
  RevaluationRequest
} from "./types.js";

import { ServiceError } from "../../shared/service-error.js";
import { entityActor } from "../access/actor.js";
import { config } from "../../config.js";

export class FXServiceError extends ServiceError {}

type EcbRateEntry = { currency: string; rate: string };

/** Only these currencies are active in the system. USD is the base/reporting currency. */
const ALLOWED_CURRENCIES = new Set(["USD", "EUR", "GBP", "TZS", "AED", "QAR"]);

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

  async deleteRate(id: string) {
    return this.repository(this.prisma).deleteRate(id);
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
    const ecbUrl = config().ECB_RATES_URL;

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
    const allEntries: EcbRateEntry[] = rateMatches.map((m) => ({
      currency: m[1],
      rate: m[2]
    }));

    // Only keep currencies in our allowed set (excluding EUR which is the ECB base)
    const entries = allEntries.filter((e) => ALLOWED_CURRENCIES.has(e.currency));

    // Also seed/ensure the 4 allowed currencies exist
    const currencyMeta: Record<string, { name: string; symbol: string }> = {
      USD: { name: "US Dollar", symbol: "$" },
      EUR: { name: "Euro", symbol: "€" },
      GBP: { name: "British Pound", symbol: "£" },
      TZS: { name: "Tanzanian Shilling", symbol: "TSh" },
      AED: { name: "UAE Dirham", symbol: "د.إ" },
      QAR: { name: "Qatari Riyal", symbol: "ر.ق" }
    };
    for (const [code, meta] of Object.entries(currencyMeta)) {
      try {
        await this.repository(this.prisma).upsertCurrency({
          code,
          name: meta.name,
          symbol: meta.symbol,
          decimalPlaces: ["TZS"].includes(code) ? 0 : 2,
          isActive: true
        });
      } catch {
        /* already exists */
      }
    }

    // Build EUR→X rate map for cross-rate derivation
    const eurRateMap = new Map<string, Prisma.Decimal>();
    let imported = 0;
    const repo = this.repository(this.prisma);

    for (const entry of entries) {
      try {
        const rateDecimal = new Prisma.Decimal(entry.rate);
        eurRateMap.set(entry.currency, rateDecimal);

        // EUR → X
        await repo.upsertRate({
          fromCurrency: "EUR",
          toCurrency: entry.currency,
          rateType: "SPOT",
          rate: entry.rate,
          effectiveDate,
          source: "ECB"
        });
        // X → EUR (inverse)
        const inverse = new Prisma.Decimal(1).div(rateDecimal);
        await repo.upsertRate({
          fromCurrency: entry.currency,
          toCurrency: "EUR",
          rateType: "SPOT",
          rate: inverse.toDecimalPlaces(8).toFixed(8),
          effectiveDate,
          source: "ECB"
        });
        imported++;
      } catch {
        // Skip individual failures
      }
    }

    // Derive USD cross rates from EUR rates (USD is the base/reporting currency)
    const eurUsd = eurRateMap.get("USD");
    if (eurUsd) {
      for (const [ccy, eurRate] of eurRateMap) {
        if (ccy === "USD") continue;
        try {
          // USD → X = (EUR→X) / (EUR→USD)
          const usdToX = eurRate.div(eurUsd);
          await repo.upsertRate({
            fromCurrency: "USD",
            toCurrency: ccy,
            rateType: "SPOT",
            rate: usdToX.toDecimalPlaces(8).toFixed(8),
            effectiveDate,
            source: "ECB"
          });
          // X → USD = (EUR→USD) / (EUR→X)
          const xToUsd = eurUsd.div(eurRate);
          await repo.upsertRate({
            fromCurrency: ccy,
            toCurrency: "USD",
            rateType: "SPOT",
            rate: xToUsd.toDecimalPlaces(8).toFixed(8),
            effectiveDate,
            source: "ECB"
          });
          imported++;
        } catch {
          // Skip
        }
      }
    }

    // ── Fallback: fetch rates for currencies ECB doesn't cover (e.g. TZS, QAR) ──
    const coveredByEcb = new Set(entries.map((e) => e.currency));
    const missing = [...ALLOWED_CURRENCIES].filter((c) => c !== "EUR" && !coveredByEcb.has(c));

    if (missing.length > 0 && eurUsd) {
      try {
        // Use open.er-api.com (free, no key required) as fallback
        const fallbackUrl = `https://open.er-api.com/v6/latest/USD`;
        const fbRes = await fetch(fallbackUrl, {
          signal: AbortSignal.timeout(10_000)
        });
        if (fbRes.ok) {
          const fbData = (await fbRes.json()) as { rates?: Record<string, number> };
          const fbRates = fbData.rates ?? {};

          for (const ccy of missing) {
            const rate = fbRates[ccy];
            if (!rate) continue;
            try {
              // USD → X
              await repo.upsertRate({
                fromCurrency: "USD",
                toCurrency: ccy,
                rateType: "SPOT",
                rate: new Prisma.Decimal(rate).toDecimalPlaces(8).toFixed(8),
                effectiveDate,
                source: "OPEN_ER_API"
              });
              // X → USD (inverse)
              const inv = new Prisma.Decimal(1).div(new Prisma.Decimal(rate));
              await repo.upsertRate({
                fromCurrency: ccy,
                toCurrency: "USD",
                rateType: "SPOT",
                rate: inv.toDecimalPlaces(8).toFixed(8),
                effectiveDate,
                source: "OPEN_ER_API"
              });
              imported++;
            } catch {
              // Skip individual failures
            }
          }
        }
      } catch {
        // Fallback API unavailable — skip silently
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
    /**
     * Currency pairs skipped because no usable rate exists in any form.
     * Non-empty with zero items revalued means the run did nothing — the
     * condition that previously reported success while posting nothing.
     */
    skippedNoRate: string[];
  }> {
    const repository = this.repository(this.prisma);
    const referenceDate = request.closingRateDate.toISOString().slice(0, 10);

    const period = await repository.getPeriod(request.entityId, request.periodId);
    if (!period) {
      throw new FXServiceError("FX_PERIOD_NOT_FOUND", "Period not found.", 404);
    }
    if (period.status !== "OPEN" && period.status !== "SOFT_CLOSE") {
      throw new FXServiceError(
        "FX_PERIOD_NOT_OPEN",
        "Period must be OPEN or SOFT_CLOSE for revaluation.",
        422
      );
    }

    // Quick idempotency check (non-authoritative, saves work if already done)
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
        idempotent: true,
        skippedNoRate: []
      };
    }

    const actor = await entityActor(this.prisma, request.entityId);
    if (!actor) {
      throw new FXServiceError("FX_NO_USER", "No user found for entity to create journal.", 422);
    }
    const actorId = actor.userId;
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

    // AP Control account (code 2100) and AR Control account (code 1200) for counter-entries
    const apControlAccount = await repository.getAccount(request.entityId, "2100");
    const arControlAccount = await repository.getAccount(request.entityId, "1200");
    if (!apControlAccount || !arControlAccount) {
      throw new FXServiceError(
        "FX_CONTROL_ACCOUNTS_NOT_FOUND",
        "AP Control account (2100) or AR Control account (1200) not configured.",
        422
      );
    }

    // ── All reads and writes in a single transaction (IAS 21 compliance) ──────
    try {
      return await this.prisma.$transaction(async (tx) => {
        await setEntityDbContext(tx, request.entityId);
        const txRepo = this.repository(tx);

        // Authoritative idempotency check inside transaction (prevents race)
        const existingInTx = await txRepo.findExistingRevaluationJournal(
          request.entityId,
          request.periodId,
          referenceDate
        );
        if (existingInTx) {
          return {
            journalId: existingInTx.id,
            apItemsRevalued: 0,
            arItemsRevalued: 0,
            totalGainLoss: "0.0000",
            idempotent: true,
            skippedNoRate: []
          };
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
        const apRevaluations: Array<{ invoiceId: string; newFunctional: Prisma.Decimal }> = [];
        const arRevaluations: Array<{ invoiceId: string; newFunctional: Prisma.Decimal }> = [];
        // Currency pairs with no usable rate at all. Reported back rather than
        // swallowed: a revaluation that quietly touched nothing used to look
        // identical to one that had nothing to do.
        const skippedNoRate = new Set<string>();

        // ── Revalue AP invoices ──────────────────────────────────────────────────
        const apInvoices = await txRepo.getOpenAPInvoices(request.entityId);
        const apAllocated = await txRepo.getAPOutstandingByInvoice(
          request.entityId,
          apInvoices.map((i) => i.id)
        );

        for (const invoice of apInvoices) {
          if (invoice.currency === functionalCurrency) continue;

          const closingRate = await txRepo.resolveRevaluationRate(
            invoice.currency,
            functionalCurrency,
            "CLOSING",
            request.closingRateDate
          );
          if (!closingRate) {
            skippedNoRate.add(`${invoice.currency}->${functionalCurrency}`);
            continue;
          }

          // Revalue the outstanding GROSS balance. This previously used
          // invoice.netAmount, which is both gross of any payments already made
          // and — since tax was split out — the pre-tax figure, so it revalued a
          // base that never matched what AP control actually carries.
          const outstanding = new Prisma.Decimal(invoice.grossAmount).sub(
            apAllocated.get(invoice.id) ?? new Prisma.Decimal(0)
          );
          if (outstanding.lessThanOrEqualTo(0)) continue;

          const bookedFunctional = new Prisma.Decimal(invoice.functionalAmount);
          const newFunctional = outstanding.mul(closingRate);
          const gainLoss = bookedFunctional.sub(newFunctional); // positive = gain for payable

          if (gainLoss.abs().lessThan(new Prisma.Decimal("0.0001"))) continue;

          if (gainLoss.greaterThan(0)) {
            // Gain on payable (payable decreased in functional terms)
            // DR AP Control (reduce liability), CR FX Gain/Loss (recognise gain)
            journalLines.push({
              accountId: apControlAccount.id,
              debit: gainLoss.abs(),
              credit: new Prisma.Decimal(0),
              lineNumber: lineNumber++,
              description: `FX reval AP control adjustment ${invoice.id.slice(0, 8)}`
            });
            journalLines.push({
              accountId: fxGainLossAccount.id,
              debit: new Prisma.Decimal(0),
              credit: gainLoss.abs(),
              lineNumber: lineNumber++,
              description: `FX revaluation gain on AP ${invoice.id.slice(0, 8)}`
            });
          } else {
            // Loss on payable (payable increased in functional terms)
            // DR FX Gain/Loss (recognise loss), CR AP Control (increase liability)
            journalLines.push({
              accountId: fxGainLossAccount.id,
              debit: gainLoss.abs(),
              credit: new Prisma.Decimal(0),
              lineNumber: lineNumber++,
              description: `FX revaluation loss on AP ${invoice.id.slice(0, 8)}`
            });
            journalLines.push({
              accountId: apControlAccount.id,
              debit: new Prisma.Decimal(0),
              credit: gainLoss.abs(),
              lineNumber: lineNumber++,
              description: `FX reval AP control adjustment ${invoice.id.slice(0, 8)}`
            });
          }
          totalGainLoss = totalGainLoss.add(gainLoss);
          apItemsRevalued++;
          apRevaluations.push({ invoiceId: invoice.id, newFunctional });
        }

        // ── Revalue AR invoices ──────────────────────────────────────────────────
        const arInvoices = await txRepo.getOpenARInvoices(request.entityId);
        for (const invoice of arInvoices) {
          if (invoice.currency === functionalCurrency) continue;

          const closingRate = await txRepo.resolveRevaluationRate(
            invoice.currency,
            functionalCurrency,
            "CLOSING",
            request.closingRateDate
          );
          if (!closingRate) {
            skippedNoRate.add(`${invoice.currency}->${functionalCurrency}`);
            continue;
          }

          const outstanding = new Prisma.Decimal(invoice.amount).sub(
            new Prisma.Decimal(invoice.amountPaid)
          );
          const bookedFunctional = new Prisma.Decimal(invoice.functionalAmount);
          const newFunctional = outstanding.mul(closingRate);
          const gainLoss = newFunctional.sub(bookedFunctional); // positive = gain for receivable

          if (gainLoss.abs().lessThan(new Prisma.Decimal("0.0001"))) continue;

          if (gainLoss.greaterThan(0)) {
            // Gain on receivable (receivable increased in functional terms)
            // DR AR Control (increase asset), CR FX Gain/Loss (recognise gain)
            journalLines.push({
              accountId: arControlAccount.id,
              debit: gainLoss.abs(),
              credit: new Prisma.Decimal(0),
              lineNumber: lineNumber++,
              description: `FX reval AR control adjustment ${invoice.id.slice(0, 8)}`
            });
            journalLines.push({
              accountId: fxGainLossAccount.id,
              debit: new Prisma.Decimal(0),
              credit: gainLoss.abs(),
              lineNumber: lineNumber++,
              description: `FX revaluation gain on AR ${invoice.id.slice(0, 8)}`
            });
          } else {
            // Loss on receivable (receivable decreased in functional terms)
            // DR FX Gain/Loss (recognise loss), CR AR Control (reduce asset)
            journalLines.push({
              accountId: fxGainLossAccount.id,
              debit: gainLoss.abs(),
              credit: new Prisma.Decimal(0),
              lineNumber: lineNumber++,
              description: `FX revaluation loss on AR ${invoice.id.slice(0, 8)}`
            });
            journalLines.push({
              accountId: arControlAccount.id,
              debit: new Prisma.Decimal(0),
              credit: gainLoss.abs(),
              lineNumber: lineNumber++,
              description: `FX reval AR control adjustment ${invoice.id.slice(0, 8)}`
            });
          }
          totalGainLoss = totalGainLoss.add(gainLoss);
          arItemsRevalued++;
          arRevaluations.push({ invoiceId: invoice.id, newFunctional });
        }

        if (journalLines.length === 0) {
          return {
            journalId: null,
            apItemsRevalued,
            arItemsRevalued,
            totalGainLoss: "0.0000",
            idempotent: false,
            skippedNoRate: [...skippedNoRate]
          };
        }

        // Balance the journal: net gain/loss entry to offset all individual lines
        const totalDebit = journalLines.reduce((s, l) => s.add(l.debit), new Prisma.Decimal(0));
        const totalCredit = journalLines.reduce((s, l) => s.add(l.credit), new Prisma.Decimal(0));
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

        const journal = await txRepo.createRevaluationJournal(
          request.entityId,
          actorId,
          request.periodId,
          functionalCurrency,
          `FX revaluation for period ${period.name} at closing date ${referenceDate}`,
          journalLines,
          // Same key the idempotency check reads, so a re-run is recognised.
          referenceDate
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

        // Update invoice functional amounts to the revalued amounts (IAS 21 compliance)
        for (const reval of apRevaluations) {
          await txRepo.markAPInvoiceRevalued(
            request.entityId,
            reval.invoiceId,
            reval.newFunctional
          );
        }
        for (const reval of arRevaluations) {
          await txRepo.markARInvoiceRevalued(
            request.entityId,
            reval.invoiceId,
            reval.newFunctional
          );
        }

        // Synchronous audit trail (within transaction for atomicity)
        await AuditService.createEventInTx(tx as unknown as PrismaClient, {
          entityId: request.entityId,
          userId: actorId,
          eventType: "FX_REVALUATION_EXECUTED",
          resourceType: "FX_REVALUATION",
          resourceId: journal.id,
          afterState: {
            journalId: journal.id,
            periodId: request.periodId,
            closingRateDate: referenceDate,
            apItemsRevalued,
            arItemsRevalued,
            totalGainLoss: totalGainLoss.toFixed(4)
          }
        });

        return {
          journalId: journal.id,
          apItemsRevalued,
          arItemsRevalued,
          totalGainLoss: totalGainLoss.toFixed(4),
          idempotent: false,
          skippedNoRate: [...skippedNoRate]
        };
      });
    } finally {
      clearEntityDbContext();
    }
  }
}
