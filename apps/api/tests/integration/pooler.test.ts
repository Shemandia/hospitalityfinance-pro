/**
 * Tenant clients through a transaction-mode PgBouncer (ARC-04), as requests
 * and jobs use them when TENANT_DB_POOLER_HOST is set:
 *
 *   - clients share the pooler's few server connections;
 *   - the selected entity (set_config(..., true)) never leaks between
 *     transactions that share a server connection;
 *   - the row-security bypass (app_begin_rls_bypass, SEC-11) holds for its
 *     own transaction only;
 *   - Prisma 5.22 works through PgBouncer >= 1.21 with max_prepared_statements
 *     set, without `pgbouncer=true` (docs/CONNECTION-POOLER.md).
 *
 * Needs TEST_POOLER_HOST and TEST_POOLER_PORT: a PgBouncer in transaction mode
 * in front of TEST_DATABASE_URL's server, default_pool_size TEST_POOLER_POOL_SIZE
 * (default 2). CI provides one; locally the test is skipped, because no pooler
 * is installed on the shared development server without the owner.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const host = process.env.TEST_POOLER_HOST;
  if (host) {
    process.env.TENANT_DB_POOLER_HOST = host;
    process.env.TENANT_DB_POOLER_PORT = process.env.TEST_POOLER_PORT ?? "6432";
    process.env.TENANT_CONNECTION_LIMIT = "3";
  }
  return {
    host,
    poolSize: Number(process.env.TEST_POOLER_POOL_SIZE ?? "2"),
    required: Boolean(process.env.CI)
  };
});

import type { Prisma } from "../../src/db/client.js";
import { runWithContext } from "../../src/db/requestContext.js";
import { withBypassRLS } from "../../src/db/rls-bypass.js";
import { disconnectAllTenants, getTenantClient } from "../../src/db/tenantPool.js";
import { disconnectTestPrisma, getTestDatabaseUrl, getTestPrisma } from "./helpers.js";

type Tx = Prisma.TransactionClient;

if (!env.host || !process.env.TEST_DATABASE_URL) {
  describe.skipIf(!env.required)("tenant clients through the connection pooler", () => {
    it("requires TEST_POOLER_HOST and TEST_DATABASE_URL (CI provides them)", () => {
      expect(env.host).toBeDefined();
    });
  });
} else {
  describe("tenant clients through the connection pooler", () => {
    const fixtures = getTestPrisma();
    const run = Date.now().toString(36);
    const ids = { entityA: "", entityB: "", user: "" };
    const client = (n: number) => getTenantClient(`it-pooler-${n}-${run}`, getTestDatabaseUrl());

    const fixture = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> =>
      fixtures.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });

    const accountsSeen = (n: number, entityId: string) =>
      runWithContext({ entityId, userId: ids.user }, async () => {
        const rows = await client(n).account.findMany({
          where: { name: `Pooler IT cash ${run}` },
          select: { entityId: true }
        });
        return [...new Set(rows.map((row) => row.entityId))];
      });

    beforeAll(async () => {
      await fixture(async (tx) => {
        const entity = (label: string) =>
          tx.entity.create({
            data: {
              name: `Pooler IT ${label} ${run}`,
              code: `PL${label}${run}`.slice(0, 20),
              type: "PROPERTY",
              countryCode: "TZ"
            }
          });
        ids.entityA = (await entity("A")).id;
        ids.entityB = (await entity("B")).id;
        ids.user = (
          await tx.user.create({ data: { email: `pooler-${run}@pooler.test`, name: "Pooler IT" } })
        ).id;
        await tx.account.createMany({
          data: [ids.entityA, ids.entityB].map((entityId) => ({
            entityId,
            code: "1000",
            name: `Pooler IT cash ${run}`,
            type: "ASSET" as const,
            normalBalance: "DEBIT" as const
          }))
        });
      });
    });

    afterAll(async () => {
      await fixture(async (tx) => {
        await tx.account.deleteMany({ where: { name: `Pooler IT cash ${run}` } });
        await tx.user.deleteMany({ where: { id: ids.user } });
        await tx.entity.deleteMany({ where: { name: { startsWith: "Pooler IT", endsWith: run } } });
      });
      await disconnectAllTenants();
      await disconnectTestPrisma();
    });

    it("shares the pooler's server connections between clients", async () => {
      // Three clients of three connections each run eighteen queries at once.
      const pids = await Promise.all(
        Array.from(
          { length: 18 },
          (_, i) =>
            client(i % 3).$queryRaw<
              Array<{ pid: number }>
            >`SELECT pg_backend_pid() AS pid FROM pg_sleep(0.2)`
        )
      );
      const distinct = new Set(pids.map(([row]) => row?.pid));
      expect(distinct.size).toBeGreaterThan(0);
      expect(distinct.size).toBeLessThanOrEqual(env.poolSize);
    }, 60_000);

    it("never lets one request's entity leak into another's transaction", async () => {
      const checks = await Promise.all(
        Array.from({ length: 40 }, async (_, i) => {
          const entityId = i % 2 === 0 ? ids.entityA : ids.entityB;
          return { entityId, seen: await accountsSeen(i % 3, entityId) };
        })
      );
      for (const { entityId, seen } of checks) expect(seen).toEqual([entityId]);

      // Outside a transaction no entity is set, whichever server connection answers.
      for (let i = 0; i < 10; i++) {
        const [row] = await client(i % 3).$queryRaw<Array<{ entity: string | null }>>`
          SELECT nullif(current_setting('app.current_entity_id', true), '') AS entity`;
        expect(row?.entity ?? null).toBeNull();
      }
    }, 60_000);

    it("keeps the row-security bypass to its own transaction", async () => {
      const bypassed = await runWithContext({ entityId: ids.entityA, userId: ids.user }, () =>
        withBypassRLS(client(0), async (tx: Tx) => {
          const rows = await tx.account.findMany({
            where: { name: `Pooler IT cash ${run}` },
            select: { entityId: true }
          });
          return [...new Set(rows.map((row) => row.entityId))].sort();
        })
      );
      expect(bypassed).toEqual([ids.entityA, ids.entityB].sort());

      // Every later transaction, on any server connection, is filtered again.
      for (let i = 0; i < 10; i++) {
        expect(await accountsSeen(i % 3, ids.entityB)).toEqual([ids.entityB]);
      }
    }, 60_000);

    it("runs interactive transactions and repeated parameterised queries", async () => {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) =>
          client(i % 3).$transaction(async (tx) => {
            const [row] = await tx.$queryRaw<Array<{ n: number }>>`SELECT ${i}::int AS n`;
            const [again] = await tx.$queryRaw<Array<{ n: number }>>`SELECT ${i}::int + 1 AS n`;
            return (row?.n ?? -1) + (again?.n ?? -1);
          })
        )
      );
      expect(results).toEqual(Array.from({ length: 30 }, (_, i) => 2 * i + 1));
    }, 60_000);
  });
}
