/**
 * Integration test for AUT-15: the database context is bound to the entity in
 * X-Entity-ID only when the caller can open that entity.
 *
 * The request context's entity drives row-level security: every query on an
 * entity-scoped table runs with app.current_entity_id set to it. If the header
 * were bound before access is checked, a route that does not itself check the
 * entity (session and any-entity routes) would run its queries inside an
 * entity the caller cannot open.
 *
 * The test adds two probe routes to the real application — one session route
 * and one any-entity route — that read the accounts table through the
 * application's own database client and report what the request context and
 * the database let them see. Everything else is real: the auth plugin, the
 * guard, the access service, Redis, the tenant client pool and its RLS
 * middleware, PostgreSQL with FORCE row-level security.
 *
 * Run: pnpm test:integration (the environment must be set before the app is imported)
 */

import jwt from "jsonwebtoken";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "../../src/db/client.js";
import { getAccessService, setAccessService } from "../../src/modules/access/runtime.js";
import { disconnectTestPrisma, ensurePermissions, getTestPrisma } from "./helpers.js";

type Tx = Prisma.TransactionClient;

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;

const environmentReady = vi.hoisted(() => {
  const ready = Boolean(
    process.env.TEST_DATABASE_URL && (process.env.TEST_REDIS_URL ?? process.env.REDIS_URL)
  );
  if (ready) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    process.env.JWT_SECRET ??= "entity-context-test-secret-entity-context-test";
    process.env.PLATFORM_API_KEY ??= "entity-context-test-platform-key";
  }
  return ready;
});

vi.mock("../../src/db/tenantRegistry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/tenantRegistry.js")>()),
  resolveTenantById: async (id: string) =>
    id.startsWith("it-ctx-")
      ? {
          id,
          slug: id,
          tenantCode: "itctx001",
          name: "Integration test tenant",
          databaseUrl: process.env.TEST_DATABASE_URL as string,
          domain: null,
          adminEmail: "",
          plan: "test",
          maxProperties: 0,
          isActive: true,
          provisionedAt: null
        }
      : null
}));

type Probe = { contextEntityId: string | null; visible: string[] };

if (!environmentReady || !redisUrl) {
  describe.skip("entity context binding (AUT-15)", () => {
    it("requires TEST_DATABASE_URL and REDIS_URL in the environment; run pnpm test:integration", () => {
      expect(environmentReady).toBe(true);
    });
  });
} else {
  const prisma = getTestPrisma();
  const run = Date.now().toString(36);
  const tenantId = `it-ctx-${run}`;
  const accountCode = `X${run}`.slice(0, 20);
  const CODES = ["GL_READ", "ADMIN_USERS"] as const;

  describe("entity context binding (AUT-15)", () => {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    let app: FastifyInstance;
    const ids = { groupA: "", propA: "", groupB: "", propB: "" };
    let userId = "";
    let roleId = "";
    let token = "";

    function bypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });
    }

    async function probe(path: "session" | "any-entity", entityId?: string) {
      const response = await app.inject({
        method: "GET",
        url: `/__it/aut15/${path}`,
        headers: {
          authorization: `Bearer ${token}`,
          ...(entityId ? { "x-entity-id": entityId } : {})
        }
      });
      return { status: response.statusCode, body: response.json() as Probe };
    }

    beforeAll(async () => {
      if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
        throw new Error("entity-context test: the application is not bound to the test database.");
      }
      await redis.connect();
      const { createApp } = await import("../../src/app.js");
      const { prisma: appPrisma } = await import("../../src/db/prisma.js");
      const { getRequestContext } = await import("../../src/db/requestContext.js");
      const { requireAuth } = await import("../../src/middleware/requireAuth.js");
      const { requirePermission } = await import("../../src/middleware/requirePermission.js");

      app = await createApp();
      const report = async (): Promise<Probe> => {
        const context = getRequestContext();
        const rows = await appPrisma.account.findMany({
          where: { code: accountCode },
          select: { entityId: true }
        });
        return {
          contextEntityId: context.entityId,
          visible: rows.map((row) => row.entityId).sort()
        };
      };
      app.get(
        "/__it/aut15/session",
        { preHandler: [requireAuth], config: { access: "session" } },
        report
      );
      app.get(
        "/__it/aut15/any-entity",
        { preHandler: [requireAuth, requirePermission("ADMIN_USERS", { scope: "any-entity" })] },
        report
      );
      await app.ready();

      const permissionIds = await ensurePermissions(prisma, CODES);
      await bypass(async (tx) => {
        const entity = (name: string, type: "GROUP" | "PROPERTY", parentId: string | null) =>
          tx.entity.create({
            data: {
              name: `Ctx IT ${name} ${run}`,
              code: `C${name}${run}`.slice(0, 20),
              type,
              countryCode: "TZ",
              parentId
            }
          });
        ids.groupA = (await entity("GA", "GROUP", null)).id;
        ids.propA = (await entity("PA", "PROPERTY", ids.groupA)).id;
        ids.groupB = (await entity("GB", "GROUP", null)).id;
        ids.propB = (await entity("PB", "PROPERTY", ids.groupB)).id;

        for (const entityId of [ids.propA, ids.propB]) {
          await tx.account.create({
            data: {
              entityId,
              code: accountCode,
              name: "Entity context probe",
              type: "ASSET",
              normalBalance: "DEBIT"
            }
          });
        }

        roleId = (
          await tx.role.create({
            data: {
              code: `CTX${run}_ADMIN`,
              name: "Ctx IT property admin",
              permissions: {
                create: CODES.map((code) => ({ permissionId: permissionIds[code] }))
              }
            }
          })
        ).id;
        userId = (await tx.user.create({ data: { email: `pat-${run}@ctx.test`, name: "pat" } })).id;
        await tx.roleAssignment.create({
          data: { userId, roleId, scopeType: "ENTITY", entityId: ids.propA }
        });
      });
      await getAccessService().invalidateUser({ tenantId, userId });

      const sessionId = `s-${userId}`;
      await redis.set(`session:${tenantId}:${userId}:${sessionId}`, "1", "EX", 600);
      token = jwt.sign(
        { sub: userId, tenantId, sessionId, type: "access" },
        process.env.JWT_SECRET as string,
        { algorithm: "HS256", expiresIn: 600 }
      );
    });

    afterAll(async () => {
      setAccessService(null);
      await app?.close();
      await bypass(async (tx) => {
        await tx.account.deleteMany({ where: { code: accountCode } });
        await tx.roleAssignment.deleteMany({ where: { userId } });
        await tx.user.deleteMany({ where: { id: userId } });
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.role.deleteMany({ where: { id: roleId } });
        await tx.entity.deleteMany({ where: { id: { in: [ids.propA, ids.propB] } } });
        await tx.entity.deleteMany({ where: { id: { in: [ids.groupA, ids.groupB] } } });
      });
      const keys = [
        ...(await redis.keys(`access:${tenantId}:*`)),
        ...(await redis.keys(`session:${tenantId}:*`))
      ];
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
      const { disconnectRedis } = await import("../../src/db/redis.js");
      await disconnectRedis();
      await disconnectTestPrisma();
    });

    describe.each(["session", "any-entity"] as const)("on a %s route", (path) => {
      it("binds the property the caller can open", async () => {
        const { status, body } = await probe(path, ids.propA);
        expect(status).toBe(200);
        expect(body).toEqual({ contextEntityId: ids.propA, visible: [ids.propA] });
      });

      it("binds nothing when the header names a property the caller cannot open", async () => {
        const { status, body } = await probe(path, ids.propB);
        expect(status).toBe(200);
        // Neither the context nor the database may be scoped to property B.
        expect(body).toEqual({ contextEntityId: null, visible: [] });
      });

      it("binds nothing when the header names an entity that does not exist", async () => {
        const { status, body } = await probe(path, "00000000-0000-4000-8000-000000000000");
        expect(status).toBe(200);
        expect(body).toEqual({ contextEntityId: null, visible: [] });
      });
    });

    it("still refuses an entity route for a property the caller cannot open", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/gl/journals",
        headers: { authorization: `Bearer ${token}`, "x-entity-id": ids.propB }
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().errors[0].code).toBe("ENTITY_ACCESS_DENIED");
    });

    it("reports the chain on /api/v1/me only for a property the caller can open", async () => {
      const me = async (entityId: string) => {
        const response = await app.inject({
          method: "GET",
          url: "/api/v1/me",
          headers: { authorization: `Bearer ${token}`, "x-entity-id": entityId }
        });
        expect(response.statusCode).toBe(200);
        return response.json().data as { entityId: string | null; chainId: string | null };
      };
      expect(await me(ids.propA)).toMatchObject({ entityId: ids.propA, chainId: ids.groupA });
      expect(await me(ids.propB)).toMatchObject({ entityId: null, chainId: null });
    });
  });
}
