/**
 * Integration Test: FX revaluation idempotency and rate resolution (P0).
 *
 * Three defects, all of which only show up against a real database:
 *
 *  - The idempotency key was written as FX-REVAL-{today} but checked as
 *    FX-REVAL-{closingRateDate}. Re-running an April revaluation in May found
 *    nothing and posted a second gain/loss journal on top of the first.
 *  - Rates were looked up as CLOSING only, and a miss silently `continue`d.
 *    Nothing writes CLOSING rates — the ECB import writes SPOT — so in practice
 *    revaluation touched nothing while reporting success.
 *  - AP revalued invoice.netAmount: gross of payments already made, and (since
 *    tax was split out) pre-tax, so it revalued a base AP control never held.
 *
 * Run: TEST_DATABASE_URL=… pnpm vitest run tests/integration/fx-revaluation.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Prisma } from "../../src/db/client.js";
import { withBypassRLS } from "../../src/db/rls-bypass.js";
import { FXService } from "../../src/modules/fx/service.js";

const D = (v: string | number) => new Prisma.Decimal(v);

if (!process.env.TEST_DATABASE_URL) {
  describe.skip("FX revaluation against real Postgres", () => {
    it("requires TEST_DATABASE_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("FX revaluation against real Postgres", () => {
    let prisma: PrismaClient;
    let service: FXService;
    let entityId: string;
    let periodId: string;
    let supplierId: string;
    let apControl: string;
    let fxGainLoss: string;

    // Booked at 2.0, revalued at 2.5 — a clear, checkable movement.
    const BOOKED_RATE = "2.0";
    const CLOSING_DATE = new Date("2026-04-30");

    beforeAll(async () => {
      const base = process.env.TEST_DATABASE_URL!;
      const url = `${base}${base.includes("?") ? "&" : "?"}connection_limit=1`;
      prisma = new PrismaClient({ datasources: { db: { url } } });
      service = new FXService(prisma);
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      const unique = `${Date.now()}-${Math.round(performance.now() * 1000)}`;

      const seeded = await withBypassRLS(prisma, async (tx: any) => {
        const entity = await tx.entity.create({
          data: {
            name: `FX Test ${unique}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "USD"
          }
        });

        const user = await tx.user.create({
          data: { email: `fx-${unique}@example.test`, name: "FX Tester" }
        });
        await tx.entityUser.create({
          data: { entityId: entity.id, userId: user.id }
        });

        const period = await tx.period.create({
          data: { entityId: entity.id, year: 2026, month: 4, name: "2026-04", status: "OPEN" }
        });

        const mk = async (code: string, name: string, type: string, nb: string) =>
          (
            await tx.account.create({
              data: { entityId: entity.id, code, name, type, normalBalance: nb }
            })
          ).id;

        // Codes the service resolves by convention.
        const accounts = {
          fxGainLoss: await mk("7000", "FX Gain/Loss", "EXPENSE", "DEBIT"),
          apControl: await mk("2100", "AP Control", "LIABILITY", "CREDIT"),
          arControl: await mk("1200", "AR Control", "ASSET", "DEBIT")
        };

        const supplier = await tx.supplier.create({
          data: {
            entityId: entity.id,
            name: "EUR Supplier",
            code: `SUP${unique.slice(-6)}`,
            currency: "EUR",
            paymentTermsDays: 30
          }
        });

        return {
          entityId: entity.id,
          periodId: period.id,
          supplierId: supplier.id,
          ...accounts
        };
      });

      ({ entityId, periodId, supplierId, apControl, fxGainLoss } = seeded);
      await prisma.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, false)`;
    });

    /** A EUR payable of `gross`, booked into USD at BOOKED_RATE. */
    async function makeEurPayable(gross: string, tax = "0") {
      const net = D(gross).sub(D(tax));
      return withBypassRLS(prisma, async (tx: any) => {
        const inv = await tx.aPInvoice.create({
          data: {
            entityId,
            supplierId,
            periodId,
            invoiceNumber: `EUR-${Math.random().toString(36).slice(2, 10)}`,
            invoiceDate: new Date("2026-04-01"),
            dueDate: new Date("2026-05-01"),
            currency: "EUR",
            grossAmount: D(gross),
            taxAmount: D(tax),
            netAmount: net,
            functionalAmount: D(gross).mul(D(BOOKED_RATE)),
            fxRate: D(BOOKED_RATE),
            status: "POSTED"
          }
        });
        return inv.id;
      });
    }

    /**
     * fx_rates has no entity_id — it is a tenant-wide table, so rates written
     * by one test are visible to the next. Upsert rather than create, and let
     * tests that must see "no rate at all" use their own currency.
     */
    async function addRate(rateType: "SPOT" | "CLOSING", rate: string, from = "EUR") {
      await withBypassRLS(prisma, async (tx: any) =>
        tx.fXRate.upsert({
          where: {
            fromCurrency_toCurrency_rateType_effectiveDate: {
              fromCurrency: from,
              toCurrency: "USD",
              rateType,
              effectiveDate: CLOSING_DATE
            }
          },
          create: {
            fromCurrency: from,
            toCurrency: "USD",
            rateType,
            rate: D(rate),
            effectiveDate: CLOSING_DATE,
            source: "MANUAL"
          },
          update: { rate: D(rate) }
        })
      );
    }

    /** Remove every rate for a pair so a "no usable rate" case is genuine. */
    async function clearRates(from: string) {
      await withBypassRLS(prisma, async (tx: any) =>
        tx.fXRate.deleteMany({ where: { fromCurrency: from, toCurrency: "USD" } })
      );
    }

    async function revalJournals() {
      return withBypassRLS(prisma, async (tx: any) =>
        tx.journal.findMany({ where: { entityId, periodId, source: "FX_REVAL" } })
      );
    }

    it("does not double-post when re-run with a closing date before the run date", async () => {
      // The reported failure: closingRateDate is April 30 but the run happens
      // in May. The key written must match the key checked.
      await makeEurPayable("1000");
      await addRate("CLOSING", "2.5");

      const first = await service.runRevaluation({
        entityId,
        periodId,
        closingRateDate: CLOSING_DATE
      } as any);
      expect(first.idempotent).toBe(false);
      expect(first.journalId).not.toBeNull();

      const second = await service.runRevaluation({
        entityId,
        periodId,
        closingRateDate: CLOSING_DATE
      } as any);
      expect(second.idempotent).toBe(true);
      expect(second.journalId).toBe(first.journalId);

      expect(await revalJournals()).toHaveLength(1);
    });

    it("stamps the journal with the closing date, not the run date", async () => {
      await makeEurPayable("1000");
      await addRate("CLOSING", "2.5");

      await service.runRevaluation({
        entityId,
        periodId,
        closingRateDate: CLOSING_DATE
      } as any);

      const [journal] = await revalJournals();
      expect(journal.reference).toBe("FX-REVAL-2026-04-30");
    });

    it("falls back to a SPOT rate when no CLOSING rate exists", async () => {
      // The ECB import only ever writes SPOT. Without a fallback the engine
      // skipped every invoice and posted nothing while reporting success.
      await makeEurPayable("1000");
      await addRate("SPOT", "2.5");

      const result = await service.runRevaluation({
        entityId,
        periodId,
        closingRateDate: CLOSING_DATE
      } as any);

      expect(result.apItemsRevalued).toBe(1);
      expect(result.skippedNoRate).toEqual([]);
      expect(result.journalId).not.toBeNull();
    });

    it("reports the currency pair when no usable rate exists at all", async () => {
      // fx_rates is tenant-wide, so use a pair no other test populates and
      // clear it first to make "no rate" genuine rather than leaked state.
      await clearRates("EUR");
      await makeEurPayable("1000");

      const result = await service.runRevaluation({
        entityId,
        periodId,
        closingRateDate: CLOSING_DATE
      } as any);

      expect(result.apItemsRevalued).toBe(0);
      expect(result.skippedNoRate).toContain("EUR->USD");
    });

    it("revalues the gross payable, not the pre-tax amount", async () => {
      // 1180 gross = 1000 net + 180 tax. AP control carries the gross, so the
      // revaluation base must be 1180. Booked at 2.0 => 2360 functional;
      // revalued at 2.5 => 2950; loss on the payable of 590.
      await makeEurPayable("1180", "180");
      await addRate("CLOSING", "2.5");

      const result = await service.runRevaluation({
        entityId,
        periodId,
        closingRateDate: CLOSING_DATE
      } as any);

      expect(result.apItemsRevalued).toBe(1);
      // Payable grew in functional terms => loss => negative gain/loss.
      expect(D(result.totalGainLoss).toFixed(2)).toBe("-590.00");
    });

    it("revalues only the unpaid portion of a partly-paid invoice", async () => {
      const invoiceId = await makeEurPayable("1000");

      await withBypassRLS(prisma, async (tx: any) => {
        const payment = await tx.aPPayment.create({
          data: {
            entityId,
            supplierId,
            paymentDate: new Date("2026-04-15"),
            currency: "EUR",
            amount: D("400"),
            status: "POSTED"
          }
        });
        await tx.aPPaymentAllocation.create({
          data: { paymentId: payment.id, invoiceId, allocatedAmount: D("400") }
        });
      });

      await addRate("CLOSING", "2.5");

      const result = await service.runRevaluation({
        entityId,
        periodId,
        closingRateDate: CLOSING_DATE
      } as any);

      // Outstanding 600 EUR: booked 2000 functional, now 600 × 2.5 = 1500.
      // Gain of 500 on the payable (it shrank in functional terms).
      expect(result.apItemsRevalued).toBe(1);
      expect(D(result.totalGainLoss).toFixed(2)).toBe("500.00");
    });

    it("moves AP control in the correct direction for a credit-normal account", async () => {
      // Guards the sign fix: FX used to write balances unsigned, pushing the
      // payable the wrong way and unbalancing the trial balance.
      await makeEurPayable("1000");
      await addRate("CLOSING", "2.5");

      await service.runRevaluation({
        entityId,
        periodId,
        closingRateDate: CLOSING_DATE
      } as any);

      const balances = await withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.findMany({ where: { entityId, periodId } })
      );
      const ap = balances.find((b: any) => b.accountId === apControl);
      const fx = balances.find((b: any) => b.accountId === fxGainLoss);

      // Payable rose by 500 functional: credit-normal, stored positive.
      expect(D(ap.closingBalance).toFixed(2)).toBe("500.00");
      // Matching loss on the debit-normal P&L account.
      expect(D(fx.closingBalance).toFixed(2)).toBe("500.00");
    });
  });
}
