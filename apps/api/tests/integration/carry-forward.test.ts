/**
 * Integration Test: balance carry-forward engine (P0 blocker — opening
 * balances never rolled forward between periods).
 *
 * Runs against a real PostgreSQL database because the engine is SQL. Stubbing
 * Prisma here would only assert that a query string contains certain words,
 * which proves nothing about whether the arithmetic is right.
 *
 * Run: TEST_DATABASE_URL=postgresql://…/hfp_cf_test pnpm vitest run tests/integration/carry-forward.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Prisma } from "../../src/db/client.js";
import { withBypassRLS } from "../../src/db/rls-bypass.js";
import {
  carryForwardOpeningBalances,
  rebuildOpeningBalances,
  findPrecedingPeriodId,
  findFollowingPeriodId
} from "../../src/modules/period/carry-forward.js";

const D = (v: string | number) => new Prisma.Decimal(v);

if (!process.env.TEST_DATABASE_URL) {
  describe.skip("carry-forward against real Postgres", () => {
    it("requires TEST_DATABASE_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("carry-forward against real Postgres", () => {
    let prisma: PrismaClient;
    let entityId: string;
    let jan: string;
    let feb: string;
    let mar: string;
    let cash: string;
    let revenue: string;
    let payables: string;

    beforeAll(async () => {
      prisma = new PrismaClient({
        datasources: { db: { url: process.env.TEST_DATABASE_URL! } }
      });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    /**
     * Run `fn` with the tenant entity context RLS policies expect. This is how
     * carry-forward actually executes in production: inside closePeriod's
     * transaction, after the RLS middleware has set app.current_entity_id.
     */
    async function withEntityContext<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return (prisma as any).$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, true)`;
        return fn(tx);
      });
    }

    beforeEach(async () => {
      // Fresh entity per test keeps cases independent without truncating
      // tables another test might be using. Fixture writes bypass RLS the way
      // provisioning/admin paths do — the entity context cannot be set for an
      // entity that does not exist yet.
      entityId = await withBypassRLS(prisma, async (tx: any) => {
        const entity = await tx.entity.create({
          data: {
            name: `CF Test ${Date.now()}-${Math.round(performance.now() * 1000)}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "USD"
          }
        });
        return entity.id;
      });

      await withBypassRLS(prisma, async (tx: any) => {
        const mkPeriod = async (year: number, month: number) =>
          (
            await tx.period.create({
              data: {
                entityId,
                year,
                month,
                name: `${year}-${String(month).padStart(2, "0")}`,
                status: "OPEN"
              }
            })
          ).id;

        jan = await mkPeriod(2026, 1);
        feb = await mkPeriod(2026, 2);
        mar = await mkPeriod(2026, 3);

        const mkAccount = async (code: string, name: string, type: string, nb: string) =>
          (
            await tx.account.create({
              data: { entityId, code, name, type, normalBalance: nb }
            })
          ).id;

        cash = await mkAccount("1000", "Cash", "ASSET", "DEBIT");
        revenue = await mkAccount("4000", "Room Revenue", "REVENUE", "CREDIT");
        payables = await mkAccount("2000", "Accounts Payable", "LIABILITY", "CREDIT");
      });
    });

    /**
     * Write a balance row exactly the way GLRepository does when a journal is
     * posted: opening_balance hardcoded to 0, closing = sign * (debits - credits).
     * This reproduces the pre-fix on-disk state.
     */
    async function postAsGlRepositoryWould(
      accountId: string,
      periodId: string,
      debits: string,
      credits: string,
      accountType: string
    ) {
      const sign = ["ASSET", "EXPENSE", "CONTRA_REVENUE"].includes(accountType) ? 1 : -1;
      const closing = D(debits).sub(D(credits)).mul(sign);
      await withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.create({
          data: {
            entityId,
            accountId,
            periodId,
            openingBalance: D(0),
            periodDebits: D(debits),
            periodCredits: D(credits),
            closingBalance: closing
          }
        })
      );
    }

    async function balance(accountId: string, periodId: string) {
      return withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.findFirst({
          where: { entityId, accountId, periodId }
        })
      );
    }

    it("finds the adjacent periods by (year, month), not by status", async () => {
      await withEntityContext(async (tx) => {
        expect(await findPrecedingPeriodId(tx, entityId, feb)).toBe(jan);
        expect(await findPrecedingPeriodId(tx, entityId, jan)).toBeNull();
        expect(await findFollowingPeriodId(tx, entityId, feb)).toBe(mar);
        expect(await findFollowingPeriodId(tx, entityId, mar)).toBeNull();
      });
    });

    it("carries a dormant account's balance into the next period", async () => {
      // January: 5000 into Cash. February: no Cash activity at all.
      // This is the reported failure — February showed Cash back at zero.
      await postAsGlRepositoryWould(cash, jan, "5000", "0", "ASSET");

      expect(await balance(cash, feb)).toBeNull();

      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, feb));

      const febCash = await balance(cash, feb);
      expect(febCash).not.toBeNull();
      expect(D(febCash.openingBalance).toFixed(2)).toBe("5000.00");
      expect(D(febCash.closingBalance).toFixed(2)).toBe("5000.00");
      expect(D(febCash.periodDebits).toFixed(2)).toBe("0.00");
    });

    it("adds the next period's own movement on top of the opening", async () => {
      await postAsGlRepositoryWould(cash, jan, "5000", "0", "ASSET");
      await postAsGlRepositoryWould(cash, feb, "0", "1200", "ASSET");

      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, feb));

      const febCash = await balance(cash, feb);
      expect(D(febCash.openingBalance).toFixed(2)).toBe("5000.00");
      // debit-normal: closing = opening + debits - credits = 5000 + 0 - 1200
      expect(D(febCash.closingBalance).toFixed(2)).toBe("3800.00");
    });

    it("gets the sign right for credit-normal accounts", async () => {
      // Credit-normal balances are stored normal-balance-positive:
      // a payable credited 800 has closing +800, not -800.
      await postAsGlRepositoryWould(payables, jan, "0", "800", "LIABILITY");
      await postAsGlRepositoryWould(payables, feb, "300", "0", "LIABILITY");

      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, feb));

      const febAp = await balance(payables, feb);
      expect(D(febAp.openingBalance).toFixed(2)).toBe("800.00");
      // credit-normal: closing = opening - debits + credits = 800 - 300 + 0
      expect(D(febAp.closingBalance).toFixed(2)).toBe("500.00");
    });

    it("keeps the trial balance tied across the carry-forward", async () => {
      // A balanced January: DR Cash 5000 / CR Revenue 5000.
      await postAsGlRepositoryWould(cash, jan, "5000", "0", "ASSET");
      await postAsGlRepositoryWould(revenue, jan, "0", "5000", "REVENUE");

      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, feb));

      const rows = await withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.findMany({
          where: { entityId, periodId: feb },
          include: { account: true }
        })
      );

      let debitNormal = D(0);
      let creditNormal = D(0);
      for (const r of rows) {
        const isDebitNormal = ["ASSET", "EXPENSE", "CONTRA_REVENUE"].includes(r.account.type);
        if (isDebitNormal) debitNormal = debitNormal.add(D(r.closingBalance));
        else creditNormal = creditNormal.add(D(r.closingBalance));
      }
      expect(debitNormal.toFixed(2)).toBe("5000.00");
      expect(creditNormal.toFixed(2)).toBe("5000.00");
      expect(debitNormal.sub(creditNormal).toFixed(2)).toBe("0.00");
    });

    it("is idempotent — re-running does not double the opening", async () => {
      await postAsGlRepositoryWould(cash, jan, "5000", "0", "ASSET");
      await postAsGlRepositoryWould(cash, feb, "0", "1200", "ASSET");

      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, feb));
      const once = await balance(cash, feb);

      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, feb));
      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, feb));
      const thrice = await balance(cash, feb);

      expect(D(thrice.openingBalance).toFixed(2)).toBe(D(once.openingBalance).toFixed(2));
      expect(D(thrice.closingBalance).toFixed(2)).toBe(D(once.closingBalance).toFixed(2));
      expect(D(thrice.closingBalance).toFixed(2)).toBe("3800.00");
    });

    it("zeroes openings for the very first period", async () => {
      await postAsGlRepositoryWould(cash, jan, "5000", "0", "ASSET");
      // Corrupt the opening to prove it gets restated, not just left alone.
      await withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.updateMany({
          where: { entityId, accountId: cash, periodId: jan },
          data: { openingBalance: D("999") }
        })
      );

      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, jan));

      const janCash = await balance(cash, jan);
      expect(D(janCash.openingBalance).toFixed(2)).toBe("0.00");
      expect(D(janCash.closingBalance).toFixed(2)).toBe("5000.00");
    });

    it("rebuilds a multi-period chain in chronological order", async () => {
      // This is the repair path for existing tenant data, where every row was
      // written with opening_balance = 0.
      await postAsGlRepositoryWould(cash, jan, "5000", "0", "ASSET");
      await postAsGlRepositoryWould(cash, feb, "2000", "0", "ASSET");
      await postAsGlRepositoryWould(cash, mar, "0", "500", "ASSET");

      const results = await withEntityContext((tx) => rebuildOpeningBalances(tx, entityId));
      expect(results).toHaveLength(3);

      const janCash = await balance(cash, jan);
      const febCash = await balance(cash, feb);
      const marCash = await balance(cash, mar);

      expect(D(janCash.closingBalance).toFixed(2)).toBe("5000.00");
      expect(D(febCash.openingBalance).toFixed(2)).toBe("5000.00");
      expect(D(febCash.closingBalance).toFixed(2)).toBe("7000.00");
      expect(D(marCash.openingBalance).toFixed(2)).toBe("7000.00");
      expect(D(marCash.closingBalance).toFixed(2)).toBe("6500.00");
    });

    it("skips a gap period with no activity and still carries the balance", async () => {
      // January has a balance, February has nothing at all, March has activity.
      await postAsGlRepositoryWould(cash, jan, "5000", "0", "ASSET");
      await postAsGlRepositoryWould(cash, mar, "0", "500", "ASSET");

      await withEntityContext((tx) => rebuildOpeningBalances(tx, entityId));

      const febCash = await balance(cash, feb);
      const marCash = await balance(cash, mar);
      // February must be materialised, otherwise March has nothing to read.
      expect(D(febCash.closingBalance).toFixed(2)).toBe("5000.00");
      expect(D(marCash.openingBalance).toFixed(2)).toBe("5000.00");
      expect(D(marCash.closingBalance).toFixed(2)).toBe("4500.00");
    });

    it("does not create rows for accounts whose balance is zero", async () => {
      await postAsGlRepositoryWould(cash, jan, "5000", "5000", "ASSET");

      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, feb));

      // Closing was zero, so there is nothing to carry — no noise row.
      expect(await balance(cash, feb)).toBeNull();
    });
  });
}
