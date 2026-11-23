/**
 * The tenant client pool (ARC-04), against real PostgreSQL, without a pooler:
 *
 *   - each client opens at most TENANT_CONNECTION_LIMIT connections;
 *   - making room never closes a client that is running a query or a
 *     transaction, and evictTenant waits for running work;
 *   - a handle held across an eviction carries on with a fresh client.
 *
 * The pool is limited to one client here (TENANT_POOL_MAX=1). Connections are
 * counted by the server processes that concurrent queries report.
 *
 * Run: pnpm test:integration
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TENANT_POOL_MAX = "1";
  process.env.TENANT_CONNECTION_LIMIT = "2";
  delete process.env.TENANT_DB_POOLER_HOST;
});

import {
  disconnectAllTenants,
  evictTenant,
  getPoolSize,
  getTenantClient,
  inFlight
} from "../../src/db/tenantPool.js";
import { disconnectTestPrisma, getTestDatabaseUrl } from "./helpers.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

if (!process.env.TEST_DATABASE_URL) {
  describe("tenant client pool", () => {
    it("requires TEST_DATABASE_URL", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("tenant client pool", () => {
    const run = Date.now().toString(36);
    const url = getTestDatabaseUrl();
    const slug = (name: string) => `it-pool-${name}-${run}`;
    afterAll(async () => {
      await disconnectAllTenants();
      await disconnectTestPrisma();
    });

    it("opens at most TENANT_CONNECTION_LIMIT connections per client", async () => {
      const db = getTenantClient(slug("limit"), url);
      // Twelve queries at once; each reports the server process that ran it.
      const pids = await Promise.all(
        Array.from(
          { length: 12 },
          () =>
            db.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid FROM pg_sleep(0.2)`
        )
      );
      const distinct = new Set(pids.map(([row]) => row?.pid));
      expect(distinct.size).toBeGreaterThan(0);
      expect(distinct.size).toBeLessThanOrEqual(2);
    }, 30_000);

    it("never closes a client with a transaction running, even when the pool is full", async () => {
      await evictTenant(slug("limit"));
      const a = getTenantClient(slug("a"), url);
      const running = a.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.8)`;
        const [row] = await tx.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
        return row?.ok;
      });
      await sleep(150);
      expect(inFlight(slug("a"))).toBeGreaterThan(0);

      // The pool holds one client and it is busy: B is opened past the limit.
      const b = getTenantClient(slug("b"), url);
      await b.$queryRaw`SELECT 1`;
      expect(getPoolSize()).toBe(2);

      await expect(running).resolves.toBe(1);
      expect(inFlight(slug("a"))).toBe(0);
    }, 30_000);

    it("closes idle clients to make room, least recently used first", async () => {
      // A and B are idle now; C needs room in a pool of one.
      await getTenantClient(slug("c"), url).$queryRaw`SELECT 1`;
      expect(getPoolSize()).toBe(1);
    }, 30_000);

    it("lets a handle held across an eviction carry on with a fresh client", async () => {
      const held = getTenantClient(slug("held"), url);
      await held.$queryRaw`SELECT 1`;
      await evictTenant(slug("held"));
      const [row] = await held.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      expect(row?.ok).toBe(1);
    }, 30_000);

    it("evictTenant waits for running work before closing the client", async () => {
      const d = getTenantClient(slug("d"), url);
      const running = d.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok FROM pg_sleep(0.6)`;
      await sleep(150);
      const evicted = evictTenant(slug("d"));
      const [row] = await running;
      expect(row?.ok).toBe(1);
      await evicted;
      expect(getPoolSize()).toBeLessThanOrEqual(1);
    }, 30_000);
  });
}
