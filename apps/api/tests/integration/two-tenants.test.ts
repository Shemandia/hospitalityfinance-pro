/**
 * WP-A acceptance check 5, against two real tenant databases (AUT-05, SEC-02).
 *
 *   A request for tenant 1 with a session from tenant 2 is refused, and no
 *   query runs without a bound tenant.
 *
 * Tenant 1 lives in TEST_DATABASE_URL, tenant 2 in TEST_SECOND_DATABASE_URL.
 * Both hold a property, an account and a user under the same codes, with
 * names that say which database they came from. Only the tenant registry is
 * stubbed, to point the two tenant ids at the two databases; requests go
 * through the real application, the tenant client pool, row-level security,
 * Redis and PostgreSQL.
 *
 * Run: pnpm test:integration (the environment must be set before the app is imported)
 */

import jwt from "jsonwebtoken";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient, type Prisma } from "../../src/db/client.js";
import { getAccessService, setAccessService } from "../../src/modules/access/runtime.js";
import { ensurePermissions } from "./helpers.js";

type Tx = Prisma.TransactionClient;

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;

const environmentReady = vi.hoisted(() => {
  const ready = Boolean(
    process.env.TEST_DATABASE_URL &&
    process.env.TEST_SECOND_DATABASE_URL &&
    (process.env.TEST_REDIS_URL ?? process.env.REDIS_URL)
  );
  if (ready) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    process.env.JWT_SECRET ??= "two-tenants-test-secret-two-tenants-test-secret";
    process.env.PLATFORM_API_KEY ??= "two-tenants-test-platform-key";
  }
  return ready;
});

const tenants = vi.hoisted(() => {
  const run = Date.now().toString(36);
  const make = (n: 1 | 2, url: string | undefined) => ({
    id: `it-two-${n}-${run}`,
    slug: `it-two-${n}-${run}`,
    tenantCode: `ittwo00${n}`,
    name: `Tenant ${n}`,
    databaseUrl: url as string,
    domain: null,
    adminEmail: "",
    plan: "test",
    maxProperties: 0,
    isActive: true,
    provisionedAt: new Date()
  });
  return {
    run,
    one: make(1, process.env.TEST_DATABASE_URL),
    two: make(2, process.env.TEST_SECOND_DATABASE_URL)
  };
});

// The registry is the one stand-in: it knows exactly these two tenants.
vi.mock("../../src/db/tenantRegistry.js", async (importOriginal) => {
  const all = [tenants.one, tenants.two];
  return {
    ...(await importOriginal<typeof import("../../src/db/tenantRegistry.js")>()),
    resolveTenantById: async (id: string) => all.find((t) => t.id === id) ?? null,
    resolveTenant: async (slug: string) => all.find((t) => t.slug === slug) ?? null,
    resolveTenantByCode: async (code: string) => all.find((t) => t.tenantCode === code) ?? null,
    listTenants: async () => all
  };
});

if (!environmentReady || !redisUrl) {
  describe.skip("two tenants (WP-A acceptance 5)", () => {
    it("requires TEST_DATABASE_URL, TEST_SECOND_DATABASE_URL and REDIS_URL; run pnpm test:integration", () => {
      expect(environmentReady).toBe(true);
    });
  });
} else {
  const { run } = tenants;
  const db = {
    one: new PrismaClient({ datasourceUrl: tenants.one.databaseUrl }),
    two: new PrismaClient({ datasourceUrl: tenants.two.databaseUrl })
  };
  type Key = keyof typeof db;
  const PROPERTY_CODE = `TT${run}`.slice(0, 20);
  const ACCOUNT_CODE = `T${run}`.slice(0, 20);

  describe("two tenants (WP-A acceptance 5)", () => {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    let app: FastifyInstance;
    const fixture = {} as Record<Key, { propertyId: string; userId: string; roleId: string }>;
    const tokens = {} as Record<Key, string>;

    function bypass<T>(key: Key, fn: (tx: Tx) => Promise<T>): Promise<T> {
      return db[key].$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });
    }

    const tenantOf = (key: Key) => (key === "one" ? tenants.one : tenants.two);

    async function signIn(key: Key): Promise<string> {
      const { userId } = fixture[key];
      const tenantId = tenantOf(key).id;
      const sessionId = `s-${userId}`;
      await redis.set(`session:${tenantId}:${userId}:${sessionId}`, "1", "EX", 600);
      return jwt.sign(
        { sub: userId, tenantId, sessionId, type: "access" },
        process.env.JWT_SECRET as string,
        { algorithm: "HS256", expiresIn: 600 }
      );
    }

    async function accounts(as: Key, entityId: string, headers: Record<string, string> = {}) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/gl/accounts",
        headers: { authorization: `Bearer ${tokens[as]}`, "x-entity-id": entityId, ...headers }
      });
      const body = response.json() as {
        data: Array<{ code: string; name: string }> | null;
        errors: Array<{ code: string }>;
      };
      return {
        status: response.statusCode,
        code: body.errors?.[0]?.code,
        names: (body.data ?? []).filter((a) => a.code === ACCOUNT_CODE).map((a) => a.name)
      };
    }

    beforeAll(async () => {
      if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
        throw new Error("two-tenants test: the application is not bound to the test database.");
      }
      if (tenants.one.databaseUrl === tenants.two.databaseUrl) {
        throw new Error("two-tenants test: the two tenants must use different databases.");
      }
      await redis.connect();
      const { createApp } = await import("../../src/app.js");
      app = await createApp();
      await app.ready();

      for (const key of ["one", "two"] as const) {
        const { GL_READ } = await ensurePermissions(db[key], ["GL_READ"] as const);
        fixture[key] = await bypass(key, async (tx) => {
          const property = await tx.entity.create({
            data: {
              name: `Property of tenant ${key}`,
              code: PROPERTY_CODE,
              type: "PROPERTY",
              countryCode: "TZ"
            }
          });
          await tx.account.create({
            data: {
              entityId: property.id,
              code: ACCOUNT_CODE,
              name: `Cash of tenant ${key}`,
              type: "ASSET",
              normalBalance: "DEBIT"
            }
          });
          const role = await tx.role.create({
            data: {
              code: `TT${run}_READER`,
              name: "Two-tenant reader",
              permissions: { create: [{ permissionId: GL_READ }] }
            }
          });
          // The same e-mail in both tenants: a person can belong to two chains.
          const user = await tx.user.create({
            data: { email: `reader-${run}@two.test`, name: `Reader ${key}` }
          });
          await tx.roleAssignment.create({
            data: { userId: user.id, roleId: role.id, scopeType: "ENTITY", entityId: property.id }
          });
          return { propertyId: property.id, userId: user.id, roleId: role.id };
        });
        await getAccessService().invalidateUser({
          tenantId: tenantOf(key).id,
          userId: fixture[key].userId
        });
        tokens[key] = await signIn(key);
      }
    });

    afterAll(async () => {
      setAccessService(null);
      await app?.close();
      for (const key of ["one", "two"] as const) {
        const f = fixture[key];
        if (!f) continue;
        await bypass(key, async (tx) => {
          await tx.account.deleteMany({ where: { code: ACCOUNT_CODE } });
          await tx.roleAssignment.deleteMany({ where: { userId: f.userId } });
          await tx.user.deleteMany({ where: { id: f.userId } });
          await tx.rolePermission.deleteMany({ where: { roleId: f.roleId } });
          await tx.role.deleteMany({ where: { id: f.roleId } });
          await tx.entity.deleteMany({ where: { id: f.propertyId } });
        });
        await db[key].$disconnect();
      }
      for (const t of [tenants.one, tenants.two]) {
        const keys = [
          ...(await redis.keys(`access:${t.id}:*`)),
          ...(await redis.keys(`session:${t.id}:*`))
        ];
        if (keys.length > 0) await redis.del(...keys);
      }
      await redis.quit();
      const { disconnectRedis } = await import("../../src/db/redis.js");
      await disconnectRedis();
      const { disconnectAllTenants } = await import("../../src/db/tenantPool.js");
      await disconnectAllTenants();
    });

    describe("each session reaches its own tenant's database only", () => {
      it("reads tenant 1's data with a tenant 1 session, and tenant 2's with a tenant 2 session", async () => {
        expect(await accounts("one", fixture.one.propertyId)).toMatchObject({
          status: 200,
          names: ["Cash of tenant one"]
        });
        expect(await accounts("two", fixture.two.propertyId)).toMatchObject({
          status: 200,
          names: ["Cash of tenant two"]
        });
      });

      it("keeps interleaved requests from the two tenants apart", async () => {
        const calls = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? "one" : "two") as Key);
        const results = await Promise.all(
          calls.map(async (key) => ({ key, result: await accounts(key, fixture[key].propertyId) }))
        );
        for (const { key, result } of results) {
          expect(result).toMatchObject({ status: 200, names: [`Cash of tenant ${key}`] });
        }
      });
    });

    describe("a request for tenant 1 with a session from tenant 2 is refused", () => {
      it("when it names tenant 1 by code", async () => {
        const result = await accounts("two", fixture.two.propertyId, {
          "x-tenant-code": tenants.one.tenantCode
        });
        expect(result).toMatchObject({ status: 403, names: [] });
      });

      it("when it names tenant 1 by slug", async () => {
        const result = await accounts("two", fixture.two.propertyId, {
          "x-tenant-slug": tenants.one.slug
        });
        expect(result).toMatchObject({ status: 403, names: [] });
      });

      it("when it names a property of tenant 1", async () => {
        const result = await accounts("two", fixture.one.propertyId);
        expect(result).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED", names: [] });
      });

      it("when the token claims tenant 1 for a tenant 2 session", async () => {
        // Re-signing with another tenant needs the secret; without a session
        // registered for that tenant it is still refused.
        const forged = jwt.sign(
          {
            sub: fixture.two.userId,
            tenantId: tenants.one.id,
            sessionId: `s-${fixture.two.userId}`,
            type: "access"
          },
          process.env.JWT_SECRET as string,
          { algorithm: "HS256", expiresIn: 600 }
        );
        const response = await app.inject({
          method: "GET",
          url: "/api/v1/gl/accounts",
          headers: { authorization: `Bearer ${forged}`, "x-entity-id": fixture.one.propertyId }
        });
        expect(response.statusCode).toBe(401);
      });
    });

    describe("no query runs without a bound tenant", () => {
      it("refuses the shared client outside any tenant", async () => {
        const { prisma } = await import("../../src/db/prisma.js");
        const { TenantNotBoundError } = await import("../../src/db/tenantScope.js");
        const { runWithContext } = await import("../../src/db/requestContext.js");
        expect(() => prisma.account.findMany()).toThrow(TenantNotBoundError);
        await runWithContext({ entityId: fixture.one.propertyId }, async () => {
          expect(() => prisma.account.findMany()).toThrow(TenantNotBoundError);
        });
      });

      it("binds each tenant for work outside a request, and only that tenant", async () => {
        const { prisma } = await import("../../src/db/prisma.js");
        const { forEachActiveTenant, runForTenantId, TenantUnavailableError } =
          await import("../../src/db/tenantScope.js");
        const { withBypassRLS } = await import("../../src/db/rls-bypass.js");
        const cashNames = () =>
          withBypassRLS(prisma, async (tx: Tx) =>
            (await tx.account.findMany({ where: { code: ACCOUNT_CODE } })).map((a) => a.name)
          );

        expect(await runForTenantId(tenants.two.id, cashNames)).toEqual(["Cash of tenant two"]);
        const swept = await forEachActiveTenant(cashNames);
        expect(swept).toEqual([
          { tenantId: tenants.one.id, result: ["Cash of tenant one"] },
          { tenantId: tenants.two.id, result: ["Cash of tenant two"] }
        ]);
        await expect(runForTenantId("it-two-unknown", cashNames)).rejects.toBeInstanceOf(
          TenantUnavailableError
        );
      });
    });
  });
}
