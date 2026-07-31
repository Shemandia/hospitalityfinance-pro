/**
 * Integration Test: the canonical signed balance writer.
 *
 * Covers the P0 where balances were written from many places under two sign
 * conventions, so credit-normal accounts moved the wrong way — FX revaluation
 * pushed AP control backwards and unbalanced the trial balance, and
 * depreciation drove accumulated depreciation negative.
 *
 * Run: TEST_DATABASE_URL=… pnpm vitest run tests/integration/balance-writer.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Prisma } from "../../src/db/client.js";
import { withBypassRLS } from "../../src/db/rls-bypass.js";
import {
  applyBalanceDeltas,
  applyBalanceDelta,
  BalanceWriterError
} from "../../src/db/balance-writer.js";

const D = (v: string | number) => new Prisma.Decimal(v);

if (!process.env.TEST_DATABASE_URL) {
  describe.skip("balance writer against real Postgres", () => {
    it("requires TEST_DATABASE_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("balance writer against real Postgres", () => {
    let prisma: PrismaClient;
    let entityId: string;
    let periodId: string;
    let cash: string; // ASSET, debit-normal
    let payables: string; // LIABILITY, credit-normal
    let accumDep: string; // contra-asset, credit-normal
    let revenue: string; // REVENUE, credit-normal
    let custom: string; // custom type, debit-normal — the type-code list cannot classify this

    beforeAll(async () => {
      const base = process.env.TEST_DATABASE_URL!;
      const url = `${base}${base.includes("?") ? "&" : "?"}connection_limit=1`;
      prisma = new PrismaClient({ datasources: { db: { url } } });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      const unique = `${Date.now()}-${Math.round(performance.now() * 1000)}`;
      const seeded = await withBypassRLS(prisma, async (tx: any) => {
        const entity = await tx.entity.create({
          data: {
            name: `BW Test ${unique}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "TZS"
          }
        });
        const period = await tx.period.create({
          data: { entityId: entity.id, year: 2026, month: 5, name: "2026-05", status: "OPEN" }
        });
        const mk = async (code: string, name: string, type: string, nb: string) =>
          (
            await tx.account.create({
              data: { entityId: entity.id, code, name, type, normalBalance: nb }
            })
          ).id;
        return {
          entityId: entity.id,
          periodId: period.id,
          cash: await mk("1000", "Cash", "ASSET", "DEBIT"),
          payables: await mk("2000", "Accounts Payable", "LIABILITY", "CREDIT"),
          accumDep: await mk("1590", "Accumulated Depreciation", "CONTRA_ASSET", "CREDIT"),
          revenue: await mk("4000", "Revenue", "REVENUE", "CREDIT"),
          custom: await mk("6500", "Channel Rebates", "REBATES", "DEBIT")
        };
      });
      ({ entityId, periodId, cash, payables, accumDep, revenue, custom } = seeded);
      await prisma.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, false)`;
    });

    async function bal(accountId: string) {
      return withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.findFirst({ where: { entityId, accountId, periodId } })
      );
    }

    it("moves a debit-normal account up on a debit", async () => {
      await applyBalanceDelta(prisma, entityId, periodId, cash, "5000", "0");
      expect(D((await bal(cash)).closingBalance).toFixed(2)).toBe("5000.00");
    });

    it("moves a credit-normal account up on a credit", async () => {
      // The core defect: an unsigned writer produced -800 here, so the payable
      // appeared as a negative liability and the trial balance stopped tying.
      await applyBalanceDelta(prisma, entityId, periodId, payables, "0", "800");
      expect(D((await bal(payables)).closingBalance).toFixed(2)).toBe("800.00");
    });

    it("accumulates depreciation positively on a credit-normal contra-asset", async () => {
      await applyBalanceDelta(prisma, entityId, periodId, accumDep, "0", "1200");
      await applyBalanceDelta(prisma, entityId, periodId, accumDep, "0", "1200");
      expect(D((await bal(accumDep)).closingBalance).toFixed(2)).toBe("2400.00");
    });

    it("signs a custom account type from its normal balance", async () => {
      // 'REBATES' is not in the old hardcoded debit-normal list, so the
      // type-code convention would have signed it backwards.
      await applyBalanceDelta(prisma, entityId, periodId, custom, "300", "0");
      expect(D((await bal(custom)).closingBalance).toFixed(2)).toBe("300.00");
    });

    it("keeps a balanced journal's trial balance tied", async () => {
      await applyBalanceDeltas(prisma, entityId, periodId, [
        { accountId: cash, debitFunctional: "5000", creditFunctional: "0" },
        { accountId: revenue, debitFunctional: "0", creditFunctional: "5000" }
      ]);
      const debitNormal = D((await bal(cash)).closingBalance);
      const creditNormal = D((await bal(revenue)).closingBalance);
      expect(debitNormal.sub(creditNormal).toFixed(2)).toBe("0.00");
    });

    it("accumulates across repeated calls instead of overwriting", async () => {
      await applyBalanceDelta(prisma, entityId, periodId, cash, "5000", "0");
      await applyBalanceDelta(prisma, entityId, periodId, cash, "0", "1200");
      const row = await bal(cash);
      expect(D(row.periodDebits).toFixed(2)).toBe("5000.00");
      expect(D(row.periodCredits).toFixed(2)).toBe("1200.00");
      expect(D(row.closingBalance).toFixed(2)).toBe("3800.00");
    });

    it("handles two lines to the same account in one call", async () => {
      // Postgres rejects an ON CONFLICT statement whose proposed rows repeat a
      // conflict key (21000). A dimensional split to one GL account used to
      // crash the post with a 500; the writer aggregates first.
      await applyBalanceDeltas(prisma, entityId, periodId, [
        { accountId: cash, debitFunctional: "3000", creditFunctional: "0" },
        { accountId: cash, debitFunctional: "2000", creditFunctional: "0" }
      ]);
      const row = await bal(cash);
      expect(D(row.periodDebits).toFixed(2)).toBe("5000.00");
      expect(D(row.closingBalance).toFixed(2)).toBe("5000.00");
    });

    it("preserves a carried-forward opening balance", async () => {
      await withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.create({
          data: {
            entityId,
            accountId: cash,
            periodId,
            openingBalance: D("5000"),
            periodDebits: D(0),
            periodCredits: D(0),
            closingBalance: D("5000")
          }
        })
      );

      await applyBalanceDelta(prisma, entityId, periodId, cash, "0", "1200");

      const row = await bal(cash);
      expect(D(row.openingBalance).toFixed(2)).toBe("5000.00");
      expect(D(row.closingBalance).toFixed(2)).toBe("3800.00");
    });

    it("refuses to silently drop a movement for an unknown account", async () => {
      await expect(
        applyBalanceDelta(prisma, entityId, periodId, "no-such-account", "100", "0")
      ).rejects.toThrow(BalanceWriterError);
    });

    it("refuses an account belonging to another entity", async () => {
      const otherAccountId = await withBypassRLS(prisma, async (tx: any) => {
        const other = await tx.entity.create({
          data: {
            name: `BW Other ${Date.now()}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "TZS"
          }
        });
        const acc = await tx.account.create({
          data: {
            entityId: other.id,
            code: "1000",
            name: "Their Cash",
            type: "ASSET",
            normalBalance: "DEBIT"
          }
        });
        return acc.id;
      });

      await expect(
        applyBalanceDelta(prisma, entityId, periodId, otherAccountId, "100", "0")
      ).rejects.toThrow(BalanceWriterError);
    });
  });
}
