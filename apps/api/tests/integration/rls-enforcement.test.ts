/**
 * Integration Test: Row-Level Security Enforcement
 *
 * Verifies that RLS policies on the actual database correctly isolate
 * entity data. This test MUST run against a real PostgreSQL instance
 * with RLS policies applied (via db:setup:rls).
 *
 * Every assertion runs as a non-owner application role (OPS-08). The role that
 * owns the tables bypasses RLS wherever it is not FORCEd, and a superuser
 * bypasses it everywhere, so a suite that runs as either proves nothing. The
 * connecting role only creates the fixtures and the application role; it needs
 * CREATEROLE (or superuser) for that.
 *
 * Run: TEST_DATABASE_URL=... pnpm vitest run tests/integration/rls-enforcement.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Prisma } from "../../src/db/client.js";
import { getTestPrisma, disconnectTestPrisma } from "./helpers.js";

const APP_ROLE = "hfp_rls_test_app";

type Tx = Prisma.TransactionClient;

if (!process.env.TEST_DATABASE_URL) {
  describe.skip("RLS enforcement against real Postgres", () => {
    it("requires TEST_DATABASE_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("RLS enforcement against real Postgres", () => {
    const prisma = getTestPrisma();
    const suffix = Date.now().toString(36).slice(-5).toUpperCase();
    let entityA = "";
    let entityB = "";
    let accountA = "";
    let accountB = "";

    /** Runs as the connecting (owner) role with the policy bypass set: fixtures only. */
    function asOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });
    }

    /** Runs as the application role, scoped to one entity (or to none). */
    function asApp<T>(entityId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
        if (entityId) {
          await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, true)`;
        }
        return fn(tx);
      });
    }

    beforeAll(async () => {
      // A data-only role: no ownership, no superuser, no BYPASSRLS.
      const existing = await prisma.$queryRaw<
        Array<{ rolname: string }>
      >`SELECT rolname FROM pg_roles WHERE rolname = ${APP_ROLE}`;
      if (existing.length === 0) {
        await prisma.$executeRawUnsafe(
          `CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
        );
      }
      await prisma.$executeRawUnsafe(`GRANT ${APP_ROLE} TO CURRENT_USER`);
      await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
      await prisma.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`
      );

      await asOwner(async (tx) => {
        const a = await tx.entity.create({
          data: {
            name: "RLS Test Hotel A",
            code: `RA${suffix}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "USD"
          }
        });
        const b = await tx.entity.create({
          data: {
            name: "RLS Test Hotel B",
            code: `RB${suffix}`,
            type: "PROPERTY",
            countryCode: "TZ",
            functionalCurrency: "USD"
          }
        });
        entityA = a.id;
        entityB = b.id;

        for (const [entityId, label] of [
          [entityA, "A"],
          [entityB, "B"]
        ] as const) {
          const account = await tx.account.create({
            data: {
              entityId,
              code: "1000",
              name: `Cash - Entity ${label}`,
              type: "ASSET",
              normalBalance: "DEBIT"
            }
          });
          const period = await tx.period.create({
            data: { entityId, year: 2026, month: 3, name: "2026-03", status: "OPEN" }
          });
          await tx.accountPeriodBalance.create({
            data: {
              entityId,
              accountId: account.id,
              periodId: period.id,
              openingBalance: 0,
              periodDebits: 1000,
              periodCredits: 0,
              closingBalance: 1000
            }
          });
          if (label === "A") accountA = account.id;
          else accountB = account.id;
        }
      });
    });

    afterAll(async () => {
      if (entityA && entityB) {
        const ids = [entityA, entityB];
        await asOwner(async (tx) => {
          await tx.accountPeriodBalance.deleteMany({ where: { entityId: { in: ids } } });
          await tx.account.deleteMany({ where: { entityId: { in: ids } } });
          await tx.period.deleteMany({ where: { entityId: { in: ids } } });
          await tx.entity.deleteMany({ where: { id: { in: ids } } });
        });
      }
      await disconnectTestPrisma();
    });

    it("runs its assertions as a role that cannot bypass RLS", async () => {
      const rows = await asApp(
        entityA,
        (tx) =>
          tx.$queryRaw<
            Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean; owns: bigint }>
          >`SELECT current_user::text AS current_user, r.rolsuper, r.rolbypassrls,
                 (SELECT count(*) FROM pg_tables t
                   WHERE t.schemaname = 'public' AND t.tableowner = current_user) AS owns
            FROM pg_roles r WHERE r.rolname = current_user`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.current_user).toBe(APP_ROLE);
      expect(rows[0]?.rolsuper).toBe(false);
      expect(rows[0]?.rolbypassrls).toBe(false);
      expect(Number(rows[0]?.owns)).toBe(0);
    });

    it("entity A cannot see entity B accounts", async () => {
      const results = await asApp(entityA, (tx) =>
        tx.account.findMany({ where: { id: { in: [accountA, accountB] } } })
      );
      expect(results).toHaveLength(1);
      expect(results[0]?.entityId).toBe(entityA);
      expect(results[0]?.name).toBe("Cash - Entity A");
    });

    it("entity A cannot see entity B itself", async () => {
      const results = await asApp(entityA, (tx) =>
        tx.entity.findMany({ where: { id: { in: [entityA, entityB] } } })
      );
      expect(results.map((e) => e.id)).toEqual([entityA]);
    });

    it("balances are isolated by entity", async () => {
      const balances = await asApp(entityA, (tx) =>
        tx.accountPeriodBalance.findMany({ where: { entityId: { in: [entityA, entityB] } } })
      );
      expect(balances).toHaveLength(1);
      expect(balances[0]?.entityId).toBe(entityA);
    });

    it("sees nothing when no entity is set", async () => {
      const results = await asApp(null, (tx) =>
        tx.account.findMany({ where: { id: { in: [accountA, accountB] } } })
      );
      expect(results).toHaveLength(0);
    });

    it("entity A cannot write a row into entity B", async () => {
      await expect(
        asApp(entityA, (tx) =>
          tx.account.create({
            data: {
              entityId: entityB,
              code: "9999",
              name: "Planted by entity A",
              type: "ASSET",
              normalBalance: "DEBIT"
            }
          })
        )
      ).rejects.toThrow(/row-level security/i);
    });

    it("entity A cannot update or delete entity B rows", async () => {
      const updated = await asApp(entityA, (tx) =>
        tx.account.updateMany({ where: { id: accountB }, data: { name: "Renamed by A" } })
      );
      const deleted = await asApp(entityA, (tx) =>
        tx.account.deleteMany({ where: { id: accountB } })
      );
      expect(updated.count).toBe(0);
      expect(deleted.count).toBe(0);

      const stillThere = await asOwner((tx) => tx.account.findUnique({ where: { id: accountB } }));
      expect(stillThere?.name).toBe("Cash - Entity B");
    });

    it("the explicit bypass setting sees both entities", async () => {
      const results = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return tx.account.findMany({ where: { id: { in: [accountA, accountB] } } });
      });
      expect(results.map((r) => r.entityId).sort()).toEqual([entityA, entityB].sort());
    });
  });
}
