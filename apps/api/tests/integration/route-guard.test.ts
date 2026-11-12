/**
 * Integration tests: the route guard through the real application, against
 * real PostgreSQL and Redis (WP-A steps 1-3; working rule 3).
 *
 * Requests go through createApp(): the auth plugin, the route guard, the
 * access service, the Prisma data source and the Redis cache. Only the sign-in
 * itself is replaced — the test mints an access token and registers its
 * session in Redis, as /auth/login would.
 *
 * The token still carries the legacy entityIds claim, which the auth plugin
 * checks until the token is slimmed (step 5). Each test user's claim lists
 * every entity the test addresses, so a denial here is the guard's decision.
 * The token carries no roles and no permissions.
 *
 * Covers section 10 acceptance checks 1, 2, 3 and 6 at API level. Checks 4, 5
 * and 7 need two tenant databases and the web client; they follow with the
 * token and context-endpoint steps.
 *
 * Run: pnpm test:integration (the environment must be set before the app is imported)
 */

import jwt from "jsonwebtoken";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "../../src/db/client.js";
import { PrismaAccessDataSource } from "../../src/modules/access/prisma-source.js";
import { RedisAccessCache } from "../../src/modules/access/redis-cache.js";
import { getAccessService, setAccessService } from "../../src/modules/access/runtime.js";
import { AccessService } from "../../src/modules/access/service.js";
import { disconnectTestPrisma, ensurePermissions, getTestPrisma } from "./helpers.js";

type Tx = Prisma.TransactionClient;

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;

// Decided before any import: the application binds its default database
// client to DATABASE_URL when it is first imported, so the test database must
// be known by then. (Prisma loads .env as a side effect of a later import,
// which is too late; `pnpm test:integration` sets the environment up front.)
const environmentReady = vi.hoisted(() => {
  const ready = Boolean(
    process.env.TEST_DATABASE_URL && (process.env.TEST_REDIS_URL ?? process.env.REDIS_URL)
  );
  if (ready) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    process.env.JWT_SECRET ??= "route-guard-test-secret-route-guard-test-secret";
    process.env.PLATFORM_API_KEY ??= "route-guard-test-platform-key";
  }
  return ready;
});

if (!environmentReady || !redisUrl) {
  describe.skip("route guard against real Postgres and Redis", () => {
    it("requires TEST_DATABASE_URL and REDIS_URL in the environment; run pnpm test:integration", () => {
      expect(environmentReady).toBe(true);
    });
  });
} else {
  const prisma = getTestPrisma();
  const run = Date.now().toString(36);
  const tenantId = `it-guard-${run}`;
  const origin = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000").split(",")[0]!.trim();

  // The routes under test name these real permission codes.
  const CODES = [
    "GL_READ",
    "GL_WRITE",
    "PERIOD_READ",
    "ADMIN_USERS",
    "ADMIN_ROLES_MANAGE",
    "ADMIN_ENTITIES"
  ] as const;
  type Code = (typeof CODES)[number];

  describe("route guard against real Postgres and Redis", () => {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    let app: FastifyInstance;

    const ids = { group: "", propA: "", propB: "", propC: "", other: "" };
    const roles = { accountant: "", viewer: "", entityAdmin: "", tenantAdmin: "" };
    const users = { alice: "", gina: "", eve: "", tara: "", nobody: "" };
    let permissionIds = {} as Record<Code, string>;
    const tokens = {} as Record<keyof typeof users, string>;

    function bypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });
    }

    async function signIn(userId: string, entityIds: string[]): Promise<string> {
      const sessionId = `s-${userId}`;
      await redis.set(`session:${tenantId}:${userId}:${sessionId}`, "1", "EX", 600);
      return jwt.sign(
        {
          sub: userId,
          email: `${userId}@guard.test`,
          tenantId,
          tenantCode: "",
          tenantSlug: "",
          entityIds,
          roles: [],
          permissions: [],
          sessionId,
          type: "access"
        },
        process.env.JWT_SECRET as string,
        { algorithm: "HS256", expiresIn: 600 }
      );
    }

    type Call = {
      method: "GET" | "POST" | "PUT";
      url: string;
      as: keyof typeof users;
      entityId?: string;
      body?: unknown;
    };

    async function call({ method, url, as, entityId, body }: Call) {
      const response = await app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${tokens[as]}`,
          ...(entityId ? { "x-entity-id": entityId } : {}),
          ...(method === "GET" ? {} : { origin, "content-type": "application/json" })
        },
        ...(method === "GET" ? {} : { payload: JSON.stringify(body ?? {}) })
      });
      const json = response.json() as {
        data: unknown;
        errors: Array<{ code: string; message: string }>;
      };
      return {
        status: response.statusCode,
        code: json.errors?.[0]?.code,
        message: json.errors?.[0]?.message,
        data: json.data
      };
    }

    async function assign(userId: string, roleId: string, entityId: string | null): Promise<void> {
      await bypass((tx) =>
        tx.roleAssignment.create({
          data: { userId, roleId, scopeType: entityId ? "ENTITY" : "TENANT", entityId }
        })
      );
      await getAccessService().invalidateUser({ tenantId, userId });
    }

    beforeAll(async () => {
      if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
        throw new Error("route-guard test: the application is not bound to the test database.");
      }
      await redis.connect();
      const { createApp } = await import("../../src/app.js");
      app = await createApp();
      await app.ready();

      permissionIds = await ensurePermissions(prisma, CODES);

      await bypass(async (tx) => {
        const entity = (name: string, type: "GROUP" | "PROPERTY", parentId: string | null) =>
          tx.entity.create({
            data: {
              name: `Guard IT ${name} ${run}`,
              code: `${name}${run}`.slice(0, 20),
              type,
              countryCode: "TZ",
              parentId
            }
          });
        ids.group = (await entity("G", "GROUP", null)).id;
        ids.propA = (await entity("A", "PROPERTY", ids.group)).id;
        ids.propB = (await entity("B", "PROPERTY", ids.group)).id;
        ids.propC = (await entity("C", "PROPERTY", ids.group)).id;
        ids.other = (await entity("O", "GROUP", null)).id;

        const role = async (name: string, codes: Code[], isSystem = false) =>
          (
            await tx.role.create({
              data: {
                code: `G${run}_${name}`,
                name: `Guard IT ${name}`,
                isSystem,
                permissions: {
                  create: codes.map((code) => ({ permissionId: permissionIds[code] }))
                }
              }
            })
          ).id;
        roles.accountant = await role("ACCOUNTANT", ["GL_READ", "GL_WRITE"]);
        roles.viewer = await role("VIEWER", ["GL_READ"]);
        roles.entityAdmin = await role("ENTITY_ADMIN", ["ADMIN_USERS", "ADMIN_ROLES_MANAGE"]);
        roles.tenantAdmin = await role("TENANT_ADMIN", [...CODES], true);

        const user = async (name: string) =>
          (await tx.user.create({ data: { email: `${name}-${run}@guard.test`, name } })).id;
        users.alice = await user("alice");
        users.gina = await user("gina");
        users.eve = await user("eve");
        users.tara = await user("tara");
        users.nobody = await user("nobody");
      });

      const properties = [ids.propA, ids.propB, ids.propC];
      tokens.alice = await signIn(users.alice, properties);
      tokens.gina = await signIn(users.gina, [ids.group, ids.other]);
      tokens.eve = await signIn(users.eve, properties);
      tokens.tara = await signIn(users.tara, [ids.group, ids.other]);
      tokens.nobody = await signIn(users.nobody, properties);

      // Alice: accountant on A, viewer on B, nothing on C.
      await assign(users.alice, roles.accountant, ids.propA);
      await assign(users.alice, roles.viewer, ids.propB);
      // Gina: accountant on the group.
      await assign(users.gina, roles.accountant, ids.group);
      // Eve: user administrator on A only (holds ADMIN_ROLES_MANAGE there, not tenant-wide).
      await assign(users.eve, roles.entityAdmin, ids.propA);
      // Tara: tenant-wide administrator.
      await assign(users.tara, roles.tenantAdmin, null);
    });

    afterAll(async () => {
      setAccessService(null);
      await app?.close();
      await bypass(async (tx) => {
        const userIds = Object.values(users).filter(Boolean);
        const roleIds = Object.values(roles).filter(Boolean);
        await tx.roleAssignment.deleteMany({ where: { userId: { in: userIds } } });
        await tx.entityUser.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
        await tx.role.deleteMany({ where: { id: { in: roleIds } } });
        await tx.entity.deleteMany({ where: { parentId: { in: [ids.group, ids.other] } } });
        await tx.entity.deleteMany({ where: { id: { in: [ids.group, ids.other] } } });
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

    const journals = "/api/v1/gl/journals";

    describe("acceptance 1: different roles on different properties", () => {
      it("lets the accountant on A read and write there", async () => {
        const read = await call({ method: "GET", url: journals, as: "alice", entityId: ids.propA });
        expect(read).toMatchObject({ status: 200 });
        // An empty body passes the guard and is rejected by validation, not by access.
        const write = await call({
          method: "POST",
          url: journals,
          as: "alice",
          entityId: ids.propA
        });
        expect(write).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
      });

      it("lets the viewer on B read but not write there", async () => {
        const read = await call({ method: "GET", url: journals, as: "alice", entityId: ids.propB });
        expect(read).toMatchObject({ status: 200 });
        const write = await call({
          method: "POST",
          url: journals,
          as: "alice",
          entityId: ids.propB
        });
        expect(write).toMatchObject({ status: 403, code: "INSUFFICIENT_PERMISSIONS" });
      });

      it("refuses C, where the user has no assignment", async () => {
        const read = await call({ method: "GET", url: journals, as: "alice", entityId: ids.propC });
        expect(read).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED" });
      });

      it("lists only the entities the user can open", async () => {
        const list = await call({ method: "GET", url: "/api/v1/entities", as: "alice" });
        expect(list.status).toBe(200);
        const listed = (list.data as Array<{ id: string }>).map((e) => e.id).sort();
        expect(listed).toEqual([ids.propA, ids.propB].sort());
        const detail = await call({
          method: "GET",
          url: `/api/v1/entities/${ids.propC}`,
          as: "alice"
        });
        expect(detail.status).toBe(403);
      });

      it("answers 400 when a property-scoped request names no entity", async () => {
        const response = await call({ method: "GET", url: journals, as: "alice" });
        expect(response.status).toBe(400);
      });

      it("gives a user without assignments nothing", async () => {
        const read = await call({
          method: "GET",
          url: journals,
          as: "nobody",
          entityId: ids.propA
        });
        expect(read).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED" });
        const list = await call({ method: "GET", url: "/api/v1/entities", as: "nobody" });
        expect(list.data).toEqual([]);
      });
    });

    describe("acceptance 2: a group assignment covers every property below", () => {
      it("grants the same permissions on A, B and C", async () => {
        for (const entityId of [ids.propA, ids.propB, ids.propC]) {
          const write = await call({ method: "POST", url: journals, as: "gina", entityId });
          expect(write, entityId).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
        }
      });

      it("does not reach a separate group", async () => {
        const read = await call({ method: "GET", url: journals, as: "gina", entityId: ids.other });
        expect(read).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED" });
      });
    });

    describe("tenant-level routes", () => {
      it("refuses role definitions to a user who holds the permission at one entity only", async () => {
        const create = await call({
          method: "POST",
          url: "/api/v1/admin/roles",
          as: "eve",
          entityId: ids.propA
        });
        expect(create).toMatchObject({ status: 403, code: "INSUFFICIENT_PERMISSIONS" });
      });

      it("lets that user read the role list, which user management needs", async () => {
        const list = await call({ method: "GET", url: "/api/v1/admin/roles", as: "eve" });
        expect(list.status).toBe(200);
      });

      it("allows role definitions through a tenant-wide assignment, with no entity", async () => {
        const create = await call({ method: "POST", url: "/api/v1/admin/roles", as: "tara" });
        expect(create).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
      });

      it("refuses an accountant the admin routes entirely", async () => {
        const list = await call({ method: "GET", url: "/api/v1/admin/roles", as: "gina" });
        expect(list).toMatchObject({ status: 403, code: "INSUFFICIENT_PERMISSIONS" });
      });
    });

    describe("entity management checks the entity acted on", () => {
      it("refuses an update from a user without ADMIN_ENTITIES there", async () => {
        const update = await call({
          method: "PUT",
          url: `/api/v1/entities/${ids.propA}`,
          as: "eve",
          body: { name: "renamed" }
        });
        expect(update.status).toBe(403);
      });
    });

    describe("acceptance 3: changes apply on the next request", () => {
      it("applies a permission added to a role through the admin API at once", async () => {
        const before = await call({
          method: "POST",
          url: journals,
          as: "alice",
          entityId: ids.propB
        });
        expect(before.status).toBe(403);

        const bind = await call({
          method: "POST",
          url: `/api/v1/admin/roles/${roles.viewer}/permissions`,
          as: "tara",
          body: { permissionId: permissionIds.GL_WRITE }
        });
        expect(bind.status).toBe(201);

        const after = await call({
          method: "POST",
          url: journals,
          as: "alice",
          entityId: ids.propB
        });
        expect(after).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
      });

      it("removes access when the role is removed, without a new sign-in", async () => {
        const before = await call({
          method: "GET",
          url: journals,
          as: "alice",
          entityId: ids.propA
        });
        expect(before.status).toBe(200);

        await bypass((tx) =>
          tx.roleAssignment.deleteMany({ where: { userId: users.alice, entityId: ids.propA } })
        );
        await getAccessService().invalidateUser({ tenantId, userId: users.alice });

        const after = await call({
          method: "GET",
          url: journals,
          as: "alice",
          entityId: ids.propA
        });
        expect(after).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED" });
        const list = await call({ method: "GET", url: "/api/v1/entities", as: "alice" });
        expect((list.data as Array<{ id: string }>).map((e) => e.id)).toEqual([ids.propB]);
      });

      it("closes an entity to its users as soon as it is deactivated through the API", async () => {
        const before = await call({
          method: "GET",
          url: journals,
          as: "gina",
          entityId: ids.propC
        });
        expect(before.status).toBe(200);

        const deactivate = await call({
          method: "PUT",
          url: `/api/v1/entities/${ids.propC}`,
          as: "tara",
          body: { isActive: false }
        });
        expect(deactivate.status).toBe(200);

        const after = await call({ method: "GET", url: journals, as: "gina", entityId: ids.propC });
        expect(after).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED" });
      });

      it("removes all access when the user is deactivated through the admin API", async () => {
        const deactivate = await call({
          method: "PUT",
          url: `/api/v1/admin/users/${users.gina}/status`,
          as: "tara",
          body: { isActive: false }
        });
        expect(deactivate.status).toBe(200);

        const after = await call({ method: "GET", url: journals, as: "gina", entityId: ids.propA });
        expect(after).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED" });
      });
    });

    describe("acceptance 6: an infrastructure fault is not a denial or a sign-out", () => {
      it("answers 503 when the access cache is unreachable", async () => {
        const dead = new Redis({
          host: "127.0.0.1",
          port: 1,
          lazyConnect: true,
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
          retryStrategy: () => null
        });
        dead.on("error", () => undefined);
        setAccessService(
          new AccessService(
            new PrismaAccessDataSource(prisma),
            new RedisAccessCache(dead, { ttlSeconds: 60 })
          )
        );
        try {
          const response = await call({
            method: "GET",
            url: journals,
            as: "tara",
            entityId: ids.propA
          });
          expect(response).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
        } finally {
          setAccessService(null);
          dead.disconnect();
        }

        const recovered = await call({
          method: "GET",
          url: journals,
          as: "tara",
          entityId: ids.propA
        });
        expect(recovered.status).toBe(200);
      });
    });
  });
}
