/**
 * WP-A acceptance check 4: the menus shown for a property match exactly what
 * the API allows there, checked for every permission code.
 *
 * The web app decides what to show with apps/web/lib/access.ts, from the
 * payload of GET /api/v1/context and nothing else. This test runs that very
 * module against the API's route guard, through the real application, for
 * every permission code in the catalogue and on any route, at every scope,
 * for every entity in the tree, an entity outside it and no entity at all.
 *
 * The guard is exercised through probe routes that build
 * requirePermission(code, { scope }) per request, so each code is decided by
 * the same function the real routes use. Everything else is real: the auth
 * plugin, the access service, Redis, the tenant client pool, PostgreSQL.
 *
 * Run: pnpm test:integration (the environment must be set before the app is imported)
 */

import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "../../src/db/client.js";
import { getAccessService, setAccessService } from "../../src/modules/access/runtime.js";
import { SYSTEM_PERMISSIONS } from "../../src/modules/access/system-catalog.js";
import { disconnectTestPrisma, ensurePermissions, getTestPrisma } from "./helpers.js";

type Tx = Prisma.TransactionClient;
type Scope = "entity" | "tenant" | "any-entity";

/** The part of apps/web/lib/access.ts this test drives. Loaded by path: it lives in the web app. */
type WebAccess = {
  allows(context: unknown, scope: Scope, codes: string, entityId: string | null): boolean;
};
const WEB_ACCESS_MODULE = fileURLToPath(new URL("../../../web/lib/access.ts", import.meta.url));

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;

const environmentReady = vi.hoisted(() => {
  const ready = Boolean(
    process.env.TEST_DATABASE_URL && (process.env.TEST_REDIS_URL ?? process.env.REDIS_URL)
  );
  if (ready) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    process.env.JWT_SECRET ??= "menus-match-api-test-secret-menus-match-api";
    process.env.PLATFORM_API_KEY ??= "menus-match-api-test-platform-key";
  }
  return ready;
});

vi.mock("../../src/db/tenantRegistry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/tenantRegistry.js")>()),
  resolveTenantById: async (id: string) =>
    id.startsWith("it-menu-")
      ? {
          id,
          slug: id,
          tenantCode: "itmenu01",
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

if (!environmentReady || !redisUrl) {
  describe.skip("menus match the API (WP-A acceptance 4)", () => {
    it("requires TEST_DATABASE_URL and REDIS_URL in the environment; run pnpm test:integration", () => {
      expect(environmentReady).toBe(true);
    });
  });
} else {
  const prisma = getTestPrisma();
  const run = Date.now().toString(36);
  const tenantId = `it-menu-${run}`;

  describe("menus match the API (WP-A acceptance 4)", () => {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    let app: FastifyInstance;
    let web: WebAccess;
    let codes: string[] = [];
    const ids = { groupG: "", propA: "", propB: "", groupH: "", propC: "" };
    const users = { uma: "", tia: "" };
    const roleIds: string[] = [];
    const tokens = {} as Record<keyof typeof users, string>;

    function bypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });
    }

    async function signIn(userId: string): Promise<string> {
      const sessionId = `s-${userId}`;
      await redis.set(`session:${tenantId}:${userId}:${sessionId}`, "1", "EX", 600);
      return jwt.sign(
        { sub: userId, tenantId, sessionId, type: "access" },
        process.env.JWT_SECRET as string,
        { algorithm: "HS256", expiresIn: 600 }
      );
    }

    async function apiAllows(
      as: keyof typeof users,
      scope: Scope,
      code: string,
      entityId: string | null
    ): Promise<boolean> {
      const response = await app.inject({
        method: "GET",
        url: `/__it/menus/${scope}/${encodeURIComponent(code)}`,
        headers: {
          authorization: `Bearer ${tokens[as]}`,
          ...(entityId ? { "x-entity-id": entityId } : {})
        }
      });
      if (response.statusCode === 200) return true;
      // Anything but a refusal is a broken test, not a "no".
      expect([400, 403]).toContain(response.statusCode);
      return false;
    }

    beforeAll(async () => {
      if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
        throw new Error("menus test: the application is not bound to the test database.");
      }
      await redis.connect();
      web = (await import(/* @vite-ignore */ WEB_ACCESS_MODULE)) as WebAccess;

      const { createApp } = await import("../../src/app.js");
      const { requireAuth } = await import("../../src/middleware/requireAuth.js");
      const { requirePermission } = await import("../../src/middleware/requirePermission.js");
      app = await createApp();
      for (const scope of ["entity", "tenant", "any-entity"] as const) {
        app.get<{ Params: { code: string } }>(
          `/__it/menus/${scope}/:code`,
          {
            preHandler: [requireAuth],
            // Over a thousand probes: kept out of the global rate limit.
            config: { access: "session", rateLimit: false }
          },
          async (request, reply) => {
            await requirePermission(request.params.code, { scope })(request, reply);
            if (reply.sent) return reply;
            return { data: "allowed", errors: [] };
          }
        );
      }
      await app.ready();

      // Every code in the catalogue and every code a route asks for.
      const routeCodes = [...app.routeAccess.values()].flatMap((access) =>
        "anyOf" in access ? access.anyOf : []
      );
      codes = [...new Set([...SYSTEM_PERMISSIONS.map((p) => p.code), ...routeCodes])].sort();
      const permissionIds = await ensurePermissions(prisma, codes);

      // Three roles over different slices of the catalogue.
      const slice = (from: number, step: number) => codes.filter((_, i) => i % step === from);
      const roleCodes = {
        groupRole: slice(0, 2), // every other code
        propertyRole: slice(1, 3), // a different third
        tenantRole: slice(2, 5) // a fifth, tenant-wide
      };

      await bypass(async (tx) => {
        const entity = (name: string, type: "GROUP" | "PROPERTY", parentId: string | null) =>
          tx.entity.create({
            data: {
              name: `Menu IT ${name} ${run}`,
              code: `M${name}${run}`.slice(0, 20),
              type,
              countryCode: "TZ",
              parentId
            }
          });
        ids.groupG = (await entity("G", "GROUP", null)).id;
        ids.propA = (await entity("A", "PROPERTY", ids.groupG)).id;
        ids.propB = (await entity("B", "PROPERTY", ids.groupG)).id;
        ids.groupH = (await entity("H", "GROUP", null)).id;
        ids.propC = (await entity("C", "PROPERTY", ids.groupH)).id;

        const role = async (name: string, held: string[]) => {
          const id = (
            await tx.role.create({
              data: {
                code: `M${run}_${name}`,
                name: `Menu IT ${name}`,
                permissions: { create: held.map((code) => ({ permissionId: permissionIds[code] })) }
              }
            })
          ).id;
          roleIds.push(id);
          return id;
        };
        const groupRole = await role("GROUP", roleCodes.groupRole);
        const propertyRole = await role("PROPERTY", roleCodes.propertyRole);
        const tenantRole = await role("TENANT", roleCodes.tenantRole);

        const user = async (name: string) =>
          (await tx.user.create({ data: { email: `${name}-${run}@menu.test`, name } })).id;
        users.uma = await user("uma");
        users.tia = await user("tia");

        const grant = (userId: string, roleId: string, entityId: string | null) =>
          tx.roleAssignment.create({
            data: { userId, roleId, scopeType: entityId ? "ENTITY" : "TENANT", entityId }
          });
        // uma: one role on group G (so A and B), another on property A only.
        await grant(users.uma, groupRole, ids.groupG);
        await grant(users.uma, propertyRole, ids.propA);
        // tia: a tenant-wide role, and a property role on C.
        await grant(users.tia, tenantRole, null);
        await grant(users.tia, propertyRole, ids.propC);
      });
      for (const userId of Object.values(users)) {
        await getAccessService().invalidateUser({ tenantId, userId });
      }
      tokens.uma = await signIn(users.uma);
      tokens.tia = await signIn(users.tia);
    });

    afterAll(async () => {
      setAccessService(null);
      await app?.close();
      await bypass(async (tx) => {
        const userIds = Object.values(users).filter(Boolean);
        await tx.roleAssignment.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
        await tx.role.deleteMany({ where: { id: { in: roleIds } } });
        await tx.entity.deleteMany({ where: { parentId: { in: [ids.groupG, ids.groupH] } } });
        await tx.entity.deleteMany({ where: { id: { in: [ids.groupG, ids.groupH] } } });
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

    it.each(["uma", "tia"] as const)(
      "%s: the web's answer equals the guard's, for every code, scope and entity",
      async (as) => {
        const response = await app.inject({
          method: "GET",
          url: "/api/v1/context",
          headers: { authorization: `Bearer ${tokens[as]}` }
        });
        expect(response.statusCode).toBe(200);
        const context = response.json().data;

        const entityTargets: Array<string | null> = [
          ids.groupG,
          ids.propA,
          ids.propB,
          ids.groupH,
          ids.propC,
          "00000000-0000-4000-8000-000000000000",
          null
        ];
        const mismatches: string[] = [];
        let allowedCount = 0;
        let checked = 0;
        for (const code of codes) {
          const cases: Array<[Scope, string | null]> = [
            ...entityTargets.map((entityId): [Scope, string | null] => ["entity", entityId]),
            ["tenant", null],
            ["any-entity", null]
          ];
          for (const [scope, entityId] of cases) {
            const api = await apiAllows(as, scope, code, entityId);
            const shown = web.allows(context, scope, code, entityId);
            checked += 1;
            if (api) allowedCount += 1;
            if (api !== shown) {
              mismatches.push(`${code} ${scope} ${entityId ?? "-"}: api=${api} web=${shown}`);
            }
          }
        }
        expect(mismatches).toEqual([]);
        // The comparison means something only if both answers occur.
        expect(allowedCount).toBeGreaterThan(0);
        expect(allowedCount).toBeLessThan(checked);
      },
      120_000
    );
  });
}
