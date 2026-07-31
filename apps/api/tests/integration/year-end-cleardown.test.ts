/**
 * Integration Test: year-end cleardown (P0 blocker — cleardown swept the wrong
 * profit, and skipped account types it should have cleared).
 *
 * The headline case is the audit's: a full year of trading must sweep the
 * *annual* profit to retained earnings, not just the final month's. That only
 * holds once opening balances carry forward, so this test exercises both the
 * carry-forward engine and the cleardown together against real Postgres.
 *
 * Run: TEST_DATABASE_URL=… pnpm vitest run tests/integration/year-end-cleardown.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient, Prisma } from "../../src/db/client.js";
import { withBypassRLS } from "../../src/db/rls-bypass.js";
import { carryForwardOpeningBalances } from "../../src/modules/period/carry-forward.js";
import {
  runYearEndCleardown,
  YearEndCleardownError
} from "../../src/modules/period-close/year-end-cleardown.js";

const D = (v: string | number) => new Prisma.Decimal(v);

if (!process.env.TEST_DATABASE_URL) {
  describe.skip("year-end cleardown against real Postgres", () => {
    it("requires TEST_DATABASE_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("year-end cleardown against real Postgres", () => {
    let prisma: PrismaClient;
    let entityId: string;
    let userId: string;
    let periods: string[]; // index 0 => January … index 11 => December
    let revenue: string;
    let expense: string;
    let retainedEarnings: string;

    beforeAll(async () => {
      // runYearEndCleardown opens its own transactions (process lock, journal
      // post, audit event), so a transaction-local entity context would not
      // survive across them. Pin the pool to a single connection and set the
      // context at session scope instead — every statement then runs under RLS
      // with the right tenant, which is what the request path does per request.
      const base = process.env.TEST_DATABASE_URL!;
      const url = `${base}${base.includes("?") ? "&" : "?"}connection_limit=1`;
      prisma = new PrismaClient({ datasources: { db: { url } } });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function withEntityContext<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return (prisma as any).$transaction(async (tx: any) => {
        await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, true)`;
        return fn(tx);
      });
    }

    /** Create an account, optionally bound to a type definition. */
    async function mkAccount(
      tx: any,
      code: string,
      name: string,
      type: string,
      normalBalance: "DEBIT" | "CREDIT",
      accountTypeDefId?: string
    ): Promise<string> {
      const a = await tx.account.create({
        data: { entityId, code, name, type, normalBalance, accountTypeDefId }
      });
      return a.id;
    }

    beforeEach(async () => {
      const unique = `${Date.now()}-${Math.round(performance.now() * 1000)}`;

      const created = await withBypassRLS(prisma, async (tx: any) => {
        const entity = await tx.entity.create({
          data: {
            name: `YE Test ${unique}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "USD"
          }
        });
        entityId = entity.id;

        const user = await tx.user.create({
          data: { email: `ye-${unique}@example.test`, name: "Year End Runner" }
        });

        const periodIds: string[] = [];
        for (let month = 1; month <= 12; month++) {
          const p = await tx.period.create({
            data: {
              entityId,
              year: 2026,
              month,
              name: `2026-${String(month).padStart(2, "0")}`,
              status: "OPEN"
            }
          });
          periodIds.push(p.id);
        }

        return { userId: user.id, periodIds };
      });

      userId = created.userId;
      periods = created.periodIds;

      await withBypassRLS(prisma, async (tx: any) => {
        revenue = await mkAccount(tx, "4000", "Room Revenue", "REVENUE", "CREDIT");
        expense = await mkAccount(tx, "6000", "Payroll", "EXPENSE", "DEBIT");
        retainedEarnings = await mkAccount(tx, "3200", "Retained Earnings", "EQUITY", "CREDIT");
      });

      // Session-scoped (third arg false) so it survives the transactions
      // runYearEndCleardown opens internally.
      await prisma.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, false)`;
    });

    /**
     * Write a balance row the way posting does: opening = 0, closing signed by
     * the account's normal balance (matching db/balance-writer.ts).
     */
    async function post(
      accountId: string,
      periodIdx: number,
      debits: string,
      credits: string,
      normalBalance: "DEBIT" | "CREDIT"
    ) {
      const sign = normalBalance === "DEBIT" ? 1 : -1;
      await withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.create({
          data: {
            entityId,
            accountId,
            periodId: periods[periodIdx],
            openingBalance: D(0),
            periodDebits: D(debits),
            periodCredits: D(credits),
            closingBalance: D(debits).sub(D(credits)).mul(sign)
          }
        })
      );
    }

    /** Carry balances through every period, as closing each month would. */
    async function carryAllPeriods() {
      await withEntityContext(async (tx) => {
        for (const periodId of periods) {
          await carryForwardOpeningBalances(tx, entityId, periodId);
        }
      });
    }

    async function balance(accountId: string, periodIdx: number) {
      return withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.findFirst({
          where: { entityId, accountId, periodId: periods[periodIdx] }
        })
      );
    }

    it("sweeps the whole year's profit, not just the final month's", async () => {
      // 12 months at 200,000 revenue and 50,000 expense.
      // Annual profit = 12 × 150,000 = 1,800,000.
      // December alone would be 150,000 — the bug the audit reported.
      for (let m = 0; m < 12; m++) {
        await post(revenue, m, "0", "200000", "CREDIT");
        await post(expense, m, "50000", "0", "DEBIT");
      }
      await carryAllPeriods();

      const result = await runYearEndCleardown(prisma, entityId, userId, {
        periodId: periods[11],
        retainedEarningsCode: "3200"
      });

      expect(result.totalRevenue).toBe(2400000);
      expect(result.totalExpense).toBe(600000);
      expect(result.netProfitLoss).toBe(1800000);
      expect(result.journalId).not.toBeNull();
    });

    it("leaves P&L at zero and retained earnings holding the profit", async () => {
      for (let m = 0; m < 12; m++) {
        await post(revenue, m, "0", "200000", "CREDIT");
        await post(expense, m, "50000", "0", "DEBIT");
      }
      await carryAllPeriods();

      await runYearEndCleardown(prisma, entityId, userId, {
        periodId: periods[11],
        retainedEarningsCode: "3200"
      });

      const decRevenue = await balance(revenue, 11);
      const decExpense = await balance(expense, 11);
      const decRE = await balance(retainedEarnings, 11);

      expect(D(decRevenue.closingBalance).toFixed(2)).toBe("0.00");
      expect(D(decExpense.closingBalance).toFixed(2)).toBe("0.00");
      // Equity is credit-normal, stored normal-balance-positive.
      expect(D(decRE.closingBalance).toFixed(2)).toBe("1800000.00");
    });

    it("sweeps CONTRA_REVENUE, which the old type filter skipped", async () => {
      const discounts = await withBypassRLS(prisma, async (tx: any) =>
        mkAccount(tx, "4900", "Discounts & Allowances", "CONTRA_REVENUE", "DEBIT")
      );

      await post(revenue, 11, "0", "100000", "CREDIT");
      await post(discounts, 11, "15000", "0", "DEBIT");
      await carryAllPeriods();

      const result = await runYearEndCleardown(prisma, entityId, userId, {
        periodId: periods[11],
        retainedEarningsCode: "3200"
      });

      // Contra-revenue is debit-normal, so it reduces profit: 100,000 − 15,000.
      expect(result.netProfitLoss).toBe(85000);
      expect(result.lines.some((l) => l.accountCode === "4900")).toBe(true);

      const decDiscounts = await balance(discounts, 11);
      expect(D(decDiscounts.closingBalance).toFixed(2)).toBe("0.00");
    });

    it("does not sweep STATISTICAL accounts into retained earnings", async () => {
      const stats = await withBypassRLS(prisma, async (tx: any) =>
        mkAccount(tx, "9000", "Rooms Occupied", "STATISTICAL", "DEBIT")
      );

      await post(revenue, 11, "0", "100000", "CREDIT");
      await post(stats, 11, "450", "0", "DEBIT");
      await carryAllPeriods();

      const result = await runYearEndCleardown(prisma, entityId, userId, {
        periodId: periods[11],
        retainedEarningsCode: "3200"
      });

      expect(result.netProfitLoss).toBe(100000);
      expect(result.lines.some((l) => l.accountCode === "9000")).toBe(false);
    });

    it("sweeps a custom INCOME type using its declared normal balance", async () => {
      // 'REBATES' is not in the debit-normal type-code list the balance writer
      // used to rely on. Cleardown briefly refused to sweep such accounts,
      // because signing them from the type code would have moved the balance
      // the wrong way. Now that every writer signs from accounts.normal_balance,
      // a custom income type is swept correctly instead of rejected.
      const rebateType = await withBypassRLS(prisma, async (tx: any) =>
        tx.accountTypeDefinition.create({
          data: {
            entityId,
            code: "REBATES",
            name: "Rebates",
            category: "INCOME",
            normalBalance: "DEBIT"
          }
        })
      );

      const rebates = await withBypassRLS(prisma, async (tx: any) =>
        mkAccount(tx, "4950", "Channel Rebates", "REBATES", "DEBIT", rebateType.id)
      );

      await post(revenue, 11, "0", "100000", "CREDIT");
      await post(rebates, 11, "12000", "0", "DEBIT");
      await carryAllPeriods();

      const result = await runYearEndCleardown(prisma, entityId, userId, {
        periodId: periods[11],
        retainedEarningsCode: "3200"
      });

      // Debit-normal income reduces profit: 100,000 − 12,000.
      expect(result.netProfitLoss).toBe(88000);
      expect(result.lines.some((l) => l.accountCode === "4950")).toBe(true);
      expect(D((await balance(rebates, 11)).closingBalance).toFixed(2)).toBe("0.00");
    });

    it("leaves the next fiscal year opening at zero even if December closed first", async () => {
      // Reproduces the ordering hazard: December is carried forward *before*
      // cleardown runs, so January briefly holds the un-swept annual profit.
      for (let m = 0; m < 12; m++) {
        await post(revenue, m, "0", "200000", "CREDIT");
      }
      await carryAllPeriods();

      const jan2027 = await withBypassRLS(prisma, async (tx: any) => {
        const p = await tx.period.create({
          data: { entityId, year: 2027, month: 1, name: "2027-01", status: "OPEN" }
        });
        return p.id;
      });

      // Carry December's un-swept balances into January 2027 first.
      await withEntityContext((tx) => carryForwardOpeningBalances(tx, entityId, jan2027));

      const janBefore = await withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.findFirst({
          where: { entityId, accountId: revenue, periodId: jan2027 }
        })
      );
      expect(D(janBefore.openingBalance).toFixed(2)).toBe("2400000.00");

      // Now run the cleardown — it must repair January rather than leave it stale.
      await runYearEndCleardown(prisma, entityId, userId, {
        periodId: periods[11],
        retainedEarningsCode: "3200"
      });

      const janAfter = await withBypassRLS(prisma, async (tx: any) =>
        tx.accountPeriodBalance.findFirst({
          where: { entityId, accountId: revenue, periodId: jan2027 }
        })
      );
      expect(D(janAfter.openingBalance).toFixed(2)).toBe("0.00");
      expect(D(janAfter.closingBalance).toFixed(2)).toBe("0.00");
    });
  });
}
