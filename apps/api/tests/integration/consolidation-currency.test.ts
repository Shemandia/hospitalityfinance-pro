/**
 * Integration Test: consolidation currency translation (P0 blocker).
 *
 * Consolidating a TZS property into a USD group used to go wrong three ways:
 *
 *  - Intercompany eliminations were summed in the child's FUNCTIONAL currency
 *    and then subtracted from REPORTING-currency figures, so an elimination was
 *    out by the exchange rate itself — roughly 2,500x for TZS/USD.
 *  - A missing closing or average rate fell back to 1:1 with only a warning,
 *    silently overstating every foreign balance by the same factor.
 *  - The elimination used natural-sign debit − credit against
 *    normal-balance-positive consolidated figures, so a credit-normal
 *    intercompany payable was increased rather than eliminated.
 *
 * Reads mv_period_account_balances, so it needs the materialized view:
 *   DATABASE_URL=$TEST_DATABASE_URL pnpm tsx src/db/setupPerformance.ts
 *
 * Run: TEST_DATABASE_URL=… pnpm vitest run tests/integration/consolidation-currency.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Prisma } from "../../src/db/client.js";
import { withBypassRLS } from "../../src/db/rls-bypass.js";
import {
  ConsolidationService,
  ConsolidationServiceError
} from "../../src/modules/consolidation/service.js";

const D = (v: string | number) => new Prisma.Decimal(v);

// 1 TZS = 0.0004 USD, i.e. 2,500 TZS to the dollar.
const TZS_USD = "0.0004";

if (!process.env.TEST_DATABASE_URL) {
  describe.skip("consolidation currency translation against real Postgres", () => {
    it("requires TEST_DATABASE_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("consolidation currency translation against real Postgres", () => {
    let prisma: PrismaClient;
    let service: ConsolidationService;
    let parentId: string;
    let childId: string;
    let periodId: string;
    let cashId: string;
    let icReceivableId: string;
    let icPayableId: string;
    let userId: string;

    beforeAll(async () => {
      const base = process.env.TEST_DATABASE_URL!;
      const url = `${base}${base.includes("?") ? "&" : "?"}connection_limit=1`;
      prisma = new PrismaClient({ datasources: { db: { url } } });
      service = new ConsolidationService(prisma);
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      const unique = `${Date.now()}-${Math.round(performance.now() * 1000)}`;

      const seeded = await withBypassRLS(prisma, async (tx: any) => {
        const parent = await tx.entity.create({
          data: {
            name: `Group ${unique}`,
            type: "CORPORATE",
            countryCode: "TZ",
            functionalCurrency: "USD",
            reportingCurrency: "USD"
          }
        });
        // Child must be a strict descendant — the service enforces lineage.
        const child = await tx.entity.create({
          data: {
            name: `TZS Property ${unique}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "TZS",
            reportingCurrency: "USD",
            parentId: parent.id
          }
        });

        const user = await tx.user.create({
          data: { email: `cons-${unique}@example.test`, name: "Consolidator" }
        });

        // One period row, owned by the parent, is shared across the group:
        // runConsolidation resolves it against the parent entity and then
        // queries every child's balances with the same periodId.
        const period = await tx.period.create({
          data: { entityId: parent.id, year: 2026, month: 6, name: "2026-06", status: "OPEN" }
        });

        const mk = async (code: string, name: string, type: string, nb: string) =>
          (
            await tx.account.create({
              data: { entityId: child.id, code, name, type, normalBalance: nb }
            })
          ).id;

        return {
          parentId: parent.id,
          childId: child.id,
          userId: user.id,
          periodId: period.id,
          cashId: await mk("1000", "Cash", "ASSET", "DEBIT"),
          icReceivableId: await mk("1300", "IC Receivable", "ASSET", "DEBIT"),
          icPayableId: await mk("2300", "IC Payable", "LIABILITY", "CREDIT")
        };
      });

      ({ parentId, childId, userId, periodId, cashId, icReceivableId, icPayableId } = seeded);
      // Consolidation runs from the parent's perspective: RLS must expose the
      // parent's period and its child entities. Child balances are read through
      // mv_period_account_balances, which has no RLS — the service relies on
      // the parent/child lineage check as the access boundary instead.
      await prisma.$executeRaw`SELECT set_config('app.current_entity_id', ${parentId}, false)`;
    });

    /** Balance rows are read through the materialized view, so refresh it. */
    async function setBalance(accountId: string, closing: string) {
      await withBypassRLS(prisma, async (tx: any) => {
        await tx.accountPeriodBalance.create({
          data: {
            entityId: childId,
            accountId,
            periodId,
            openingBalance: D(0),
            periodDebits: D(0),
            periodCredits: D(0),
            closingBalance: D(closing)
          }
        });
      });
      // Must bypass RLS: PostgreSQL applies the underlying tables' policies
      // while refreshing, so a refresh without it rebuilds the view empty.
      await withBypassRLS(prisma, async (tx: any) =>
        tx.$executeRawUnsafe("REFRESH MATERIALIZED VIEW mv_period_account_balances")
      );
    }

    async function setRates(closing: string, average: string) {
      for (const [rateType, rate] of [
        ["CLOSING", closing],
        ["AVERAGE", average]
      ] as Array<[string, string]>) {
        await withBypassRLS(prisma, async (tx: any) =>
          tx.fXRate.upsert({
            where: {
              fromCurrency_toCurrency_rateType_effectiveDate: {
                fromCurrency: "TZS",
                toCurrency: "USD",
                rateType,
                effectiveDate: new Date("2026-06-15")
              }
            },
            create: {
              fromCurrency: "TZS",
              toCurrency: "USD",
              rateType,
              rate: D(rate),
              effectiveDate: new Date("2026-06-15"),
              source: "MANUAL"
            },
            update: { rate: D(rate) }
          })
        );
      }
    }

    async function clearRates() {
      await withBypassRLS(prisma, async (tx: any) =>
        tx.fXRate.deleteMany({ where: { fromCurrency: "TZS", toCurrency: "USD" } })
      );
    }

    /** An intercompany journal line on the child, tagged for elimination. */
    async function postIcLine(accountId: string, debit: string, credit: string) {
      await withBypassRLS(prisma, async (tx: any) => {
        await tx.journal.create({
          data: {
            entityId: childId,
            periodId,
            reference: `IC-${Math.random().toString(36).slice(2, 8)}`,
            source: "MANUAL",
            status: "POSTED",
            functionalCurrency: "TZS",
            createdById: userId,
            postedAt: new Date(),
            lines: {
              create: [
                {
                  accountId,
                  debit: D(debit),
                  credit: D(credit),
                  currency: "TZS",
                  fxRate: D(1),
                  debitFunctional: D(debit),
                  creditFunctional: D(credit),
                  dimension1: "INTERCOMPANY",
                  lineNumber: 1
                }
              ]
            }
          }
        });
      });
    }

    function run() {
      return service.runConsolidation({
        parentEntityId: parentId,
        childEntityIds: [childId],
        reportingCurrency: "USD",
        periodId
      });
    }

    it("refuses to consolidate when an FX rate is missing", async () => {
      // Previously this translated at 1:1 with only a warning, overstating the
      // TZS property by 2,500x on a USD consolidated balance sheet.
      await clearRates();
      await setBalance(cashId, "2500000");

      await expect(run()).rejects.toThrow(ConsolidationServiceError);
      await expect(run()).rejects.toThrow(/FX rates are missing/i);
    });

    it("names the entity and the missing rate types", async () => {
      await clearRates();
      await setBalance(cashId, "2500000");

      await expect(run()).rejects.toThrow(/TZS\/USD/);
      await expect(run()).rejects.toThrow(/CLOSING and AVERAGE/);
    });

    it("translates a balance-sheet balance at the closing rate", async () => {
      await setRates(TZS_USD, TZS_USD);
      // 2,500,000 TZS = 1,000 USD.
      await setBalance(cashId, "2500000");

      const result = await run();
      const cash = result.consolidatedLines.find((l) => l.accountCode === "1000");
      expect(cash).toBeDefined();
      expect(D(cash!.consolidatedAmount).toFixed(2)).toBe("1000.00");
    });

    it("eliminates an intercompany balance in reporting currency, not functional", async () => {
      await setRates(TZS_USD, TZS_USD);
      // 2,500,000 TZS receivable = 1,000 USD, and an IC journal for the same.
      await setBalance(icReceivableId, "2500000");
      await postIcLine(icReceivableId, "2500000", "0");

      const result = await run();
      const ic = result.consolidatedLines.find((l) => l.accountCode === "1300");
      expect(ic).toBeDefined();

      // The elimination must be 1,000 USD — not 2,500,000, which is what
      // subtracting an untranslated functional-currency figure produced.
      expect(D(ic!.eliminationsAmount).toFixed(2)).toBe("-1000.00");
      // Translated 1,000 less an elimination of 1,000 nets to zero.
      expect(D(ic!.consolidatedAmount).toFixed(2)).toBe("0.00");
    });

    it("eliminates a credit-normal intercompany payable in the right direction", async () => {
      await setRates(TZS_USD, TZS_USD);
      // Credit-normal: closing_balance is stored normal-balance-positive.
      await setBalance(icPayableId, "2500000");
      await postIcLine(icPayableId, "0", "2500000");

      const result = await run();
      const ic = result.consolidatedLines.find((l) => l.accountCode === "2300");
      expect(ic).toBeDefined();

      // Natural sign here is negative; without normalising, .neg() made the
      // elimination positive and the payable grew instead of clearing.
      expect(D(ic!.eliminationsAmount).toFixed(2)).toBe("-1000.00");
      expect(D(ic!.consolidatedAmount).toFixed(2)).toBe("0.00");
    });

    it("consolidates a same-currency child without needing rates", async () => {
      await clearRates();
      const usdChildId = await withBypassRLS(prisma, async (tx: any) => {
        const child = await tx.entity.create({
          data: {
            name: `USD Property ${Date.now()}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "USD",
            reportingCurrency: "USD",
            parentId
          }
        });
        const acc = await tx.account.create({
          data: {
            entityId: child.id,
            code: "1000",
            name: "Cash",
            type: "ASSET",
            normalBalance: "DEBIT"
          }
        });
        await tx.accountPeriodBalance.create({
          data: {
            entityId: child.id,
            accountId: acc.id,
            periodId,
            openingBalance: D(0),
            periodDebits: D(0),
            periodCredits: D(0),
            closingBalance: D("750")
          }
        });
        return child.id;
      });
      // Must bypass RLS: PostgreSQL applies the underlying tables' policies
      // while refreshing, so a refresh without it rebuilds the view empty.
      await withBypassRLS(prisma, async (tx: any) =>
        tx.$executeRawUnsafe("REFRESH MATERIALIZED VIEW mv_period_account_balances")
      );

      const result = await service.runConsolidation({
        parentEntityId: parentId,
        childEntityIds: [usdChildId],
        reportingCurrency: "USD",
        periodId
      });

      const cash = result.consolidatedLines.find((l) => l.accountCode === "1000");
      expect(D(cash!.consolidatedAmount).toFixed(2)).toBe("750.00");
    });
  });
}
