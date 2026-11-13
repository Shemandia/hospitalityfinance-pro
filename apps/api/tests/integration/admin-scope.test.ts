/**
 * Integration tests: what an administrator can see and change (WP-A).
 *
 * Driven through the real application against PostgreSQL and Redis, like
 * route-guard.test.ts. Three things are proven:
 *
 *  1. Privilege ceiling — nobody can grant a role containing a permission they
 *     do not hold at the place of the grant.
 *  2. Scope — a property-level administrator cannot grant above or beside their
 *     own property, and every route that takes no entity of its own
 *     ("any-entity") refuses, or leaves out, what lies outside the caller's reach.
 *  3. Grants made and removed through the admin API take effect on the user's
 *     next request.
 *
 * The cast:
 *
 *   G (group) ─┬─ A ── A1        O (a separate group)
 *              └─ B
 *
 *   pam   property administrator on A (so A and A1); holds GL_POST only on B
 *   tara  tenant administrator
 *   ivan  clerk on A and on B
 *   olga  clerk on B only        — outside pam's reach
 *   ana   clerk on A1 only       — wholly inside pam's reach
 *
 * Run: pnpm test:integration
 */

import jwt from "jsonwebtoken";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "../../src/db/client.js";
import { grantRole } from "../../src/modules/access/grants.js";
import { getAccessService } from "../../src/modules/access/runtime.js";
import { disconnectTestPrisma, ensurePermissions, getTestPrisma } from "./helpers.js";

type Tx = Prisma.TransactionClient;

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;

// See route-guard.test.ts: the environment must be decided before any import.
const environmentReady = vi.hoisted(() => {
  const ready = Boolean(
    process.env.TEST_DATABASE_URL && (process.env.TEST_REDIS_URL ?? process.env.REDIS_URL)
  );
  if (ready) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    process.env.JWT_SECRET ??= "admin-scope-test-secret-admin-scope-test-secret";
    process.env.PLATFORM_API_KEY ??= "admin-scope-test-platform-key";
  }
  return ready;
});

vi.mock("../../src/shared/email.js", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined)
}));

// Every route guarded with the any-entity scope. The last test in this file
// fails when a route is added to the application without being added here —
// and so without a test for what lies outside the caller's reach.
const ANY_ENTITY_ROUTES = [
  "DELETE /api/v1/admin/users/:userId/roles/:roleId",
  "DELETE /api/v1/entities/:id",
  "GET /api/v1/admin/all-users",
  "GET /api/v1/admin/entity-tree",
  "GET /api/v1/admin/login-audit",
  "GET /api/v1/admin/permissions",
  "GET /api/v1/admin/roles",
  "GET /api/v1/admin/roles/:id",
  "GET /api/v1/admin/users/:userId/access",
  "GET /api/v1/admin/users/:userId/detail",
  "GET /api/v1/admin/users/:userId/roles",
  "POST /api/v1/admin/login-audit",
  "POST /api/v1/admin/users/:userId/roles",
  "POST /api/v1/admin/users/invite",
  "POST /api/v1/admin/users/revoke-scope",
  "POST /api/v1/entities",
  "PUT /api/v1/admin/users/:userId/status",
  "PUT /api/v1/entities/:id"
];

// The tenant registry is the one stand-in: the session's tenant resolves to the
// test database. Requests therefore run through the tenant client pool, with
// its row-level-security middleware, exactly as in production. Tests with two
// real tenant databases follow with the removal of the default-database fallback.
vi.mock("../../src/db/tenantRegistry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/tenantRegistry.js")>()),
  resolveTenantById: async (id: string) =>
    id.startsWith("it-admin-")
      ? {
          id,
          slug: id,
          tenantCode: "itadmin1",
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
  describe.skip("admin scope against real Postgres and Redis", () => {
    it("requires TEST_DATABASE_URL and REDIS_URL in the environment; run pnpm test:integration", () => {
      expect(environmentReady).toBe(true);
    });
  });
} else {
  const prisma = getTestPrisma();
  const run = Date.now().toString(36);
  const tenantId = `it-admin-${run}`;
  const origin = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000").split(",")[0]!.trim();
  const UNKNOWN_ID = "00000000-0000-4000-8000-00000000dead";

  const CODES = [
    "ADMIN_USERS",
    "ADMIN_USERS_READ",
    "ADMIN_ENTITIES",
    "ADMIN_AUDIT_LOG",
    "ADMIN_ROLES_MANAGE",
    "GL_READ",
    "GL_POST"
  ] as const;
  type Code = (typeof CODES)[number];

  describe("admin scope against real Postgres and Redis", () => {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    let app: FastifyInstance;

    const ent = { G: "", A: "", A1: "", B: "", O: "" };
    const roles = { propAdmin: "", clerk: "", poster: "", sysClerk: "", tenantAdmin: "" };
    const users = { pam: "", tara: "", ivan: "", olga: "", ana: "" };
    type UserName = keyof typeof users;
    const tokens = {} as Record<UserName, string>;
    let permissionIds = {} as Record<Code, string>;
    const invitedEmails: string[] = [];

    function bypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });
    }

    type Call = {
      method: "GET" | "POST" | "PUT" | "DELETE";
      url: string;
      as: UserName;
      entityId?: string;
      body?: unknown;
    };

    async function call({ method, url, as, entityId, body }: Call) {
      const hasBody = method === "POST" || method === "PUT";
      const response = await app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${tokens[as]}`,
          ...(entityId ? { "x-entity-id": entityId } : {}),
          ...(method === "GET" ? {} : { origin }),
          ...(hasBody ? { "content-type": "application/json" } : {})
        },
        ...(hasBody ? { payload: JSON.stringify(body ?? {}) } : {})
      });
      const json =
        response.body === ""
          ? { data: null, errors: [] }
          : (response.json() as { data: unknown; errors: Array<{ code: string }> });
      return { status: response.statusCode, code: json.errors?.[0]?.code, data: json.data };
    }

    /** "ROLE@scope" for every grant the user holds, sorted. */
    async function grantsOf(userId: string): Promise<string[]> {
      const rows = await bypass((tx) =>
        tx.roleAssignment.findMany({
          where: { userId },
          select: { scopeType: true, entityId: true, role: { select: { id: true } } }
        })
      );
      const roleName = (id: string) =>
        Object.entries(roles).find(([, roleId]) => roleId === id)?.[0] ?? id;
      const entityName = (id: string | null) =>
        id === null ? "TENANT" : (Object.entries(ent).find(([, eid]) => eid === id)?.[0] ?? id);
      return rows.map((row) => `${roleName(row.role.id)}@${entityName(row.entityId)}`).sort();
    }

    const email = (name: string) => `${name}-${run}@admin-scope.test`;

    beforeAll(async () => {
      if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
        throw new Error("admin-scope test: the application is not bound to the test database.");
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
              name: `Admin IT ${name} ${run}`,
              code: `${name}${run}`.slice(0, 20),
              type,
              countryCode: "TZ",
              parentId
            }
          });
        ent.G = (await entity("G", "GROUP", null)).id;
        ent.A = (await entity("A", "PROPERTY", ent.G)).id;
        ent.A1 = (await entity("A1", "PROPERTY", ent.A)).id;
        ent.B = (await entity("B", "PROPERTY", ent.G)).id;
        ent.O = (await entity("O", "GROUP", null)).id;

        const role = async (name: string, codes: readonly Code[], isSystem = false) =>
          (
            await tx.role.create({
              data: {
                code: `A${run}_${name}`,
                name: `Admin IT ${name}`,
                isSystem,
                permissions: {
                  create: codes.map((code) => ({ permissionId: permissionIds[code] }))
                }
              }
            })
          ).id;
        roles.propAdmin = await role("PROP_ADMIN", [
          "ADMIN_USERS",
          "ADMIN_USERS_READ",
          "ADMIN_ENTITIES",
          "ADMIN_AUDIT_LOG",
          "ADMIN_ROLES_MANAGE",
          "GL_READ"
        ]);
        roles.clerk = await role("CLERK", ["GL_READ"]);
        roles.poster = await role("POSTER", ["GL_READ", "GL_POST"]);
        roles.sysClerk = await role("SYS_CLERK", ["GL_READ"], true);
        roles.tenantAdmin = await role("TENANT_ADMIN", CODES, true);

        for (const name of Object.keys(users) as UserName[]) {
          users[name] = (await tx.user.create({ data: { email: email(name), name } })).id;
        }

        const give = async (user: UserName, roleId: string, entityId: string | null) => {
          await grantRole(
            tx,
            users[user],
            roleId,
            entityId ? { scope: "ENTITY", entityId } : { scope: "TENANT" }
          );
        };
        await give("pam", roles.propAdmin, ent.A);
        await give("pam", roles.poster, ent.B);
        await give("tara", roles.tenantAdmin, null);
        await give("ivan", roles.clerk, ent.A);
        await give("ivan", roles.clerk, ent.B);
        await give("olga", roles.clerk, ent.B);
        await give("ana", roles.clerk, ent.A1);
      });

      for (const name of Object.keys(users) as UserName[]) {
        const userId = users[name];
        const sessionId = `s-${userId}`;
        await redis.set(`session:${tenantId}:${userId}:${sessionId}`, "1", "EX", 600);
        tokens[name] = jwt.sign(
          { sub: userId, tenantId, sessionId, type: "access" },
          process.env.JWT_SECRET as string,
          { algorithm: "HS256", expiresIn: 600 }
        );
        await getAccessService().invalidateUser({ tenantId, userId });
      }
    });

    afterAll(async () => {
      await app?.close();
      await bypass(async (tx) => {
        const invited = await tx.user.findMany({
          where: { email: { in: invitedEmails } },
          select: { id: true }
        });
        const userIds = [...Object.values(users), ...invited.map((u) => u.id)].filter(Boolean);
        const roleIds = Object.values(roles).filter(Boolean);
        await tx.loginAudit.deleteMany({ where: { userId: { in: userIds } } });
        await tx.roleAssignment.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
        await tx.role.deleteMany({ where: { id: { in: roleIds } } });
        // Deepest first.
        await tx.entity.deleteMany({ where: { parentId: ent.A } });
        await tx.entity.deleteMany({ where: { parentId: { in: [ent.G, ent.O] } } });
        await tx.entity.deleteMany({ where: { id: { in: [ent.G, ent.O] } } });
      });
      const keys = [
        ...(await redis.keys(`access:${tenantId}:*`)),
        ...(await redis.keys(`session:${tenantId}:*`))
      ];
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
      const { disconnectRedis } = await import("../../src/db/redis.js");
      await disconnectRedis();
      const { disconnectAllTenants } = await import("../../src/db/tenantPool.js");
      await disconnectAllTenants();
      await disconnectTestPrisma();
    });

    const assign = (as: UserName, user: UserName, body: object, entityId?: string) =>
      call({ method: "POST", url: `/api/v1/admin/users/${users[user]}/roles`, as, entityId, body });

    const invite = (as: UserName, name: string, body: object, entityId?: string) => {
      invitedEmails.push(email(name));
      return call({
        method: "POST",
        url: "/api/v1/admin/users/invite",
        as,
        entityId,
        body: { email: email(name), name, ...body }
      });
    };

    const userByEmail = (name: string) =>
      bypass((tx) => tx.user.findUnique({ where: { email: email(name) }, select: { id: true } }));

    // ── 1. Privilege ceiling ────────────────────────────────────────────────

    describe("privilege ceiling", () => {
      it("lets a property administrator grant a role they cover, inside their property", async () => {
        const result = await assign("pam", "ivan", { roleId: roles.clerk, entityId: ent.A1 });
        expect(result.status).toBe(201);
        expect(await grantsOf(users.ivan)).toEqual(["clerk@A", "clerk@A1", "clerk@B"]);
      });

      it("refuses a role with a permission the administrator does not hold there", async () => {
        // pam holds GL_POST on B, not on A: what counts is the place of the grant.
        const result = await assign("pam", "ivan", { roleId: roles.poster, entityId: ent.A });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await grantsOf(users.ivan)).not.toContain("poster@A");
      });

      it("refuses a property administrator raising their own privileges", async () => {
        const result = await assign("pam", "pam", { roleId: roles.poster, entityId: ent.A });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await grantsOf(users.pam)).toEqual(["poster@B", "propAdmin@A"]);
      });

      it("refuses a system role to a property administrator, whatever it contains", async () => {
        const result = await assign("pam", "ivan", { roleId: roles.sysClerk, entityId: ent.A });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
      });

      it("refuses an invitation carrying a role above the ceiling, and creates nothing", async () => {
        const result = await invite("pam", "mallory", {
          roleId: roles.poster,
          entityIds: [ent.A]
        });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await userByEmail("mallory")).toBeNull();
      });

      it("accepts an invitation carrying a role within the ceiling", async () => {
        const result = await invite("pam", "nina", { roleId: roles.clerk, entityIds: [ent.A] });
        expect(result.status).toBe(201);
        const nina = await userByEmail("nina");
        expect(await grantsOf(nina!.id)).toEqual(["clerk@A"]);
      });

      it("refuses an invitation naming a role that does not exist, and creates nothing", async () => {
        const result = await invite("pam", "nobody", { roleId: UNKNOWN_ID, entityIds: [ent.A] });
        expect(result).toMatchObject({ status: 404, code: "ROLE_NOT_FOUND" });
        expect(await userByEmail("nobody")).toBeNull();
      });

      it("lets the tenant administrator grant what a property administrator cannot", async () => {
        const poster = await assign("tara", "ivan", { roleId: roles.poster, entityId: ent.A });
        expect(poster.status).toBe(201);
        const system = await assign("tara", "ivan", { roleId: roles.sysClerk, scope: "TENANT" });
        expect(system.status).toBe(201);
        expect(await grantsOf(users.ivan)).toEqual([
          "clerk@A",
          "clerk@A1",
          "clerk@B",
          "poster@A",
          "sysClerk@TENANT"
        ]);
      });
    });

    // ── 2. Above and beside ─────────────────────────────────────────────────

    describe("a property administrator cannot grant above or beside their property", () => {
      it.each([
        ["the group above", () => ({ entityId: ent.G })],
        ["a sibling property", () => ({ entityId: ent.B })],
        ["a separate group", () => ({ entityId: ent.O })],
        ["an entity that does not exist", () => ({ entityId: UNKNOWN_ID })],
        ["the whole tenant", () => ({ scope: "TENANT" })]
      ])("refuses a grant at %s", async (_label, target) => {
        const before = await grantsOf(users.ana);
        const result = await assign("pam", "ana", { roleId: roles.clerk, ...target() });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await grantsOf(users.ana)).toEqual(before);
      });

      it("uses the selected entity when the body names none, and checks it the same way", async () => {
        const beside = await assign("pam", "ana", { roleId: roles.clerk }, ent.B);
        expect(beside).toMatchObject({ status: 403, code: "FORBIDDEN" });
        const inside = await assign("pam", "ana", { roleId: roles.clerk }, ent.A);
        expect(inside.status).toBe(201);
        expect(await grantsOf(users.ana)).toEqual(["clerk@A", "clerk@A1"]);
      });

      it("asks for an entity when neither the body nor the request names one", async () => {
        const result = await assign("pam", "ana", { roleId: roles.clerk });
        expect(result).toMatchObject({ status: 400, code: "ENTITY_REQUIRED" });
      });

      it("refuses a user who has nothing inside the administrator's reach", async () => {
        const result = await assign("pam", "olga", { roleId: roles.clerk, entityId: ent.A });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await grantsOf(users.olga)).toEqual(["clerk@B"]);
      });

      it.each([
        ["a sibling property", () => [ent.B]],
        ["their own property together with a sibling", () => [ent.A, ent.B]],
        ["the group above", () => [ent.G]]
      ])("refuses an invitation into %s, and creates nothing", async (_label, entityIds) => {
        const result = await invite("pam", "oscar", {
          roleId: roles.clerk,
          entityIds: entityIds()
        });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await userByEmail("oscar")).toBeNull();
      });

      it("refuses an invitation that names no entity at all (it would be tenant-wide)", async () => {
        const result = await invite("pam", "oscar", { roleId: roles.clerk });
        expect(result).toMatchObject({ status: 400, code: "ENTITY_REQUIRED" });
        expect(await userByEmail("oscar")).toBeNull();
      });
    });

    // ── 3. Every any-entity route ───────────────────────────────────────────

    describe("every any-entity route keeps to the caller's reach", () => {
      const idsIn = (data: unknown) => (data as Array<{ id: string }>).map((row) => row.id);

      it("GET /admin/roles counts only the grants the caller can see", async () => {
        const result = await call({ method: "GET", url: "/api/v1/admin/roles", as: "pam" });
        expect(result.status).toBe(200);
        const clerk = (result.data as Array<{ id: string; _count: { users: number } }>).find(
          (role) => role.id === roles.clerk
        );
        const visible = await bypass((tx) =>
          tx.roleAssignment.count({
            where: { roleId: roles.clerk, entityId: { in: [ent.A, ent.A1] } }
          })
        );
        const all = await bypass((tx) =>
          tx.roleAssignment.count({ where: { roleId: roles.clerk } })
        );
        expect(all).toBeGreaterThan(visible);
        expect(clerk?._count.users).toBe(visible);
      });

      it("GET /admin/roles/:id lists only the holders inside the caller's reach", async () => {
        const result = await call({
          method: "GET",
          url: `/api/v1/admin/roles/${roles.clerk}`,
          as: "pam"
        });
        expect(result.status).toBe(200);
        const holders = (
          result.data as { users: Array<{ entityId: string | null; user: { id: string } }> }
        ).users;
        expect(holders.length).toBeGreaterThan(0);
        for (const holder of holders) expect([ent.A, ent.A1]).toContain(holder.entityId);
        expect(holders.map((holder) => holder.user.id)).not.toContain(users.olga);
      });

      it("GET /admin/permissions returns the catalogue, which belongs to no entity", async () => {
        const result = await call({ method: "GET", url: "/api/v1/admin/permissions", as: "pam" });
        expect(result.status).toBe(200);
        const first = (result.data as Array<Record<string, unknown>>)[0] ?? {};
        expect(Object.keys(first).sort()).toEqual(
          ["_count", "category", "code", "createdAt", "description", "id", "updatedAt"].sort()
        );
      });

      it("POST /admin/users/:userId/roles refuses a user outside the reach", async () => {
        const result = await assign("pam", "olga", { roleId: roles.clerk, entityId: ent.A1 });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
      });

      it("DELETE /admin/users/:userId/roles/:roleId refuses a user or an entity outside the reach", async () => {
        const outsideUser = await call({
          method: "DELETE",
          url: `/api/v1/admin/users/${users.olga}/roles/${roles.clerk}`,
          as: "pam"
        });
        expect(outsideUser).toMatchObject({ status: 403, code: "FORBIDDEN" });
        const outsideEntity = await call({
          method: "DELETE",
          url: `/api/v1/admin/users/${users.ivan}/roles/${roles.clerk}?entityId=${ent.B}`,
          as: "pam"
        });
        expect(outsideEntity).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await grantsOf(users.olga)).toEqual(["clerk@B"]);
        expect(await grantsOf(users.ivan)).toContain("clerk@B");
      });

      it("DELETE /admin/users/:userId/roles/:roleId removes only the grants inside the reach", async () => {
        const result = await call({
          method: "DELETE",
          url: `/api/v1/admin/users/${users.ivan}/roles/${roles.clerk}`,
          as: "pam"
        });
        expect(result.status).toBe(204);
        // The grants on A and A1 are gone; the one on B and the tenant-wide one stay.
        expect(await grantsOf(users.ivan)).toEqual(["clerk@B", "poster@A", "sysClerk@TENANT"]);
      });

      it("GET /admin/users/:userId/roles refuses an outside user and hides outside grants", async () => {
        const outside = await call({
          method: "GET",
          url: `/api/v1/admin/users/${users.olga}/roles`,
          as: "pam"
        });
        expect(outside).toMatchObject({ status: 403, code: "FORBIDDEN" });

        const inside = await call({
          method: "GET",
          url: `/api/v1/admin/users/${users.ivan}/roles`,
          as: "pam"
        });
        expect(inside.status).toBe(200);
        const seen = inside.data as Array<{ id: string; scopeType: string; entityId: string }>;
        expect(seen.map((row) => `${row.id}@${row.entityId}`)).toEqual([
          `${roles.poster}@${ent.A}`
        ]);
      });

      it("POST /admin/users/invite refuses an entity outside the reach", async () => {
        const result = await invite("pam", "oscar", { roleId: roles.clerk, entityIds: [ent.O] });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await userByEmail("oscar")).toBeNull();
      });

      it("GET /admin/entity-tree shows only the entities inside the reach", async () => {
        const result = await call({ method: "GET", url: "/api/v1/admin/entity-tree", as: "pam" });
        expect(result.status).toBe(200);
        const tree = result.data as { flat: Array<{ id: string }>; tree: Array<{ id: string }> };
        expect(idsIn(tree.flat).sort()).toEqual([ent.A, ent.A1].sort());
        expect(idsIn(tree.tree)).toEqual([ent.A]);
      });

      it("GET /admin/users/:userId/access refuses an outside user and hides outside grants", async () => {
        const outside = await call({
          method: "GET",
          url: `/api/v1/admin/users/${users.olga}/access`,
          as: "pam"
        });
        expect(outside).toMatchObject({ status: 403, code: "FORBIDDEN" });

        // ivan holds roles at A and at B; pam reaches A and A1 only.
        const inside = await call({
          method: "GET",
          url: `/api/v1/admin/users/${users.ivan}/access`,
          as: "pam"
        });
        expect(inside.status).toBe(200);
        const view = inside.data as {
          assignments: Array<{ roleId: string; entity: { id: string } | null }>;
          effective: Array<{ entity: { id: string }; permissions: string[] }>;
        };
        // Earlier tests change which roles ivan holds at A; none outside the reach is shown.
        expect(view.assignments.length).toBeGreaterThan(0);
        for (const grant of view.assignments) expect(grant.entity?.id).toBe(ent.A);
        // Effective access comes from the resolver: the grant at A reaches A1.
        expect(view.effective.map((e) => e.entity.id).sort()).toEqual([ent.A, ent.A1].sort());
        const atA = view.effective.find((e) => e.entity.id === ent.A)?.permissions;
        expect(view.effective.find((e) => e.entity.id === ent.A1)?.permissions).toEqual(atA);
      });

      it("POST /admin/login-audit refuses an entity outside the reach, and a missing one", async () => {
        const body = { userId: users.olga, email: email("olga"), action: "ADMIN_NOTE" };
        const outside = await call({
          method: "POST",
          url: "/api/v1/admin/login-audit",
          as: "pam",
          body: { ...body, entityId: ent.B }
        });
        expect(outside).toMatchObject({ status: 403, code: "FORBIDDEN" });
        const missing = await call({
          method: "POST",
          url: "/api/v1/admin/login-audit",
          as: "pam",
          body
        });
        expect(missing).toMatchObject({ status: 400, code: "ENTITY_REQUIRED" });
      });

      it("GET /admin/login-audit refuses an outside entity and lists only rows inside the reach", async () => {
        for (const entityId of [ent.A, ent.B]) {
          const written = await call({
            method: "POST",
            url: "/api/v1/admin/login-audit",
            as: "tara",
            body: { userId: users.ivan, email: email("ivan"), action: "ADMIN_NOTE", entityId }
          });
          expect(written.status).toBe(201);
        }

        const outside = await call({
          method: "GET",
          url: `/api/v1/admin/login-audit?entityId=${ent.B}`,
          as: "pam"
        });
        expect(outside).toMatchObject({ status: 403, code: "FORBIDDEN" });

        const listed = await call({
          method: "GET",
          url: `/api/v1/admin/login-audit?userId=${users.ivan}`,
          as: "pam"
        });
        expect(listed.status).toBe(200);
        const entityIds = (listed.data as Array<{ entityId: string }>).map((row) => row.entityId);
        expect(entityIds).toEqual([ent.A]);
      });

      it("PUT /admin/users/:userId/status refuses a user the caller does not wholly manage", async () => {
        const status = (user: UserName, isActive: boolean) =>
          call({
            method: "PUT",
            url: `/api/v1/admin/users/${users[user]}/status`,
            as: "pam",
            body: { isActive }
          });
        // olga is outside; ivan is also on B and holds a tenant-wide grant.
        expect(await status("olga", false)).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await status("ivan", false)).toMatchObject({ status: 403, code: "FORBIDDEN" });
        const stillActive = await bypass((tx) =>
          tx.user.findMany({
            where: { id: { in: [users.olga, users.ivan] }, isActive: true },
            select: { id: true }
          })
        );
        expect(stillActive).toHaveLength(2);

        // ana is wholly inside pam's reach.
        expect((await status("ana", false)).status).toBe(200);
        expect((await status("ana", true)).status).toBe(200);
      });

      it("GET /admin/users/:userId/detail refuses an outside user and hides outside grants", async () => {
        const outside = await call({
          method: "GET",
          url: `/api/v1/admin/users/${users.olga}/detail`,
          as: "pam"
        });
        expect(outside).toMatchObject({ status: 403, code: "FORBIDDEN" });

        const inside = await call({
          method: "GET",
          url: `/api/v1/admin/users/${users.ivan}/detail`,
          as: "pam"
        });
        expect(inside.status).toBe(200);
        const detail = inside.data as {
          roleAssignments: Array<{ scopeType: string; entity: { id: string } | null }>;
        };
        expect(detail.roleAssignments.length).toBeGreaterThan(0);
        for (const grant of detail.roleAssignments) {
          expect([ent.A, ent.A1]).toContain(grant.entity?.id);
        }
      });

      it("GET /admin/all-users leaves out users outside the reach", async () => {
        const result = await call({ method: "GET", url: "/api/v1/admin/all-users", as: "pam" });
        expect(result.status).toBe(200);
        const listed = idsIn(result.data);
        expect(listed).toEqual(expect.arrayContaining([users.pam, users.ivan, users.ana]));
        expect(listed).not.toContain(users.olga);
        expect(listed).not.toContain(users.tara);
      });

      it("POST /admin/users/revoke-scope refuses an entity outside the reach", async () => {
        const result = await call({
          method: "POST",
          url: "/api/v1/admin/users/revoke-scope",
          as: "pam",
          body: { userId: users.ivan, entityId: ent.B, cascade: false }
        });
        expect(result).toMatchObject({ status: 403, code: "FORBIDDEN" });
        expect(await grantsOf(users.ivan)).toContain("clerk@B");
      });

      it("POST /admin/users/revoke-scope removes the grants, to any depth", async () => {
        const result = await call({
          method: "POST",
          url: "/api/v1/admin/users/revoke-scope",
          as: "pam",
          body: { userId: users.ana, entityId: ent.A, cascade: true }
        });
        expect(result.status).toBe(200);
        expect(await grantsOf(users.ana)).toEqual([]);
      });

      it("POST /entities refuses a parent outside the reach, and the root", async () => {
        for (const parentId of [ent.B, ent.G, null]) {
          const result = await call({
            method: "POST",
            url: "/api/v1/entities",
            as: "pam",
            body: { name: `Admin IT X ${run}`, type: "PROPERTY", countryCode: "TZ", parentId }
          });
          expect(result.status, String(parentId)).toBe(403);
        }
      });

      it("PUT /entities/:id refuses an entity outside the reach", async () => {
        const outside = await call({
          method: "PUT",
          url: `/api/v1/entities/${ent.B}`,
          as: "pam",
          body: { city: "Elsewhere" }
        });
        expect(outside.status).toBe(403);
        const moveOut = await call({
          method: "PUT",
          url: `/api/v1/entities/${ent.A1}`,
          as: "pam",
          body: { parentId: ent.B }
        });
        expect(moveOut.status).toBe(403);
        const inside = await call({
          method: "PUT",
          url: `/api/v1/entities/${ent.A1}`,
          as: "pam",
          body: { city: "Dar es Salaam" }
        });
        expect(inside.status).toBe(200);
      });

      it("DELETE /entities/:id refuses an entity outside the reach", async () => {
        const result = await call({
          method: "DELETE",
          url: `/api/v1/entities/${ent.B}`,
          as: "pam"
        });
        expect(result.status).toBe(403);
        const stillThere = await bypass((tx) => tx.entity.count({ where: { id: ent.B } }));
        expect(stillThere).toBe(1);
      });

      it("covers every any-entity route the application has", () => {
        const anyEntity = [...app.routeAccess.entries()]
          .filter(([, access]) => access.scope === "any-entity")
          .map(([key]) => key)
          .sort();
        expect(anyEntity).toEqual([...ANY_ENTITY_ROUTES].sort());
      });
    });

    // ── 4. Effect on the next request ───────────────────────────────────────

    describe("grants made through the admin API apply on the user's next request", () => {
      const journalsAtA = () =>
        call({ method: "GET", url: "/api/v1/gl/journals", as: "olga", entityId: ent.A });

      it("opens the property as soon as the role is granted, and closes it when revoked", async () => {
        // The refusal is cached; the grant must not wait for the cache to expire.
        expect(await journalsAtA()).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED" });

        const granted = await assign("tara", "olga", { roleId: roles.clerk, entityId: ent.A });
        expect(granted.status).toBe(201);
        expect((await journalsAtA()).status).toBe(200);

        const revoked = await call({
          method: "DELETE",
          url: `/api/v1/admin/users/${users.olga}/roles/${roles.clerk}?entityId=${ent.A}`,
          as: "tara"
        });
        expect(revoked.status).toBe(204);
        expect(await journalsAtA()).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED" });
      });

      it("ends a user's access to a property when they are removed from it", async () => {
        const journalsAtB = () =>
          call({ method: "GET", url: "/api/v1/gl/journals", as: "olga", entityId: ent.B });
        expect((await journalsAtB()).status).toBe(200);

        const removed = await call({
          method: "DELETE",
          url: `/api/v1/admin/users/${users.olga}`,
          as: "tara",
          entityId: ent.B
        });
        expect(removed.status).toBe(204);
        expect(await journalsAtB()).toMatchObject({ status: 403, code: "ENTITY_ACCESS_DENIED" });
        expect(await grantsOf(users.olga)).toEqual([]);
      });

      it("feeds the context the web client reads from the same grants", async () => {
        const context = await call({ method: "GET", url: "/api/v1/context", as: "pam" });
        expect(context.status).toBe(200);
        const data = context.data as {
          tenantPermissions: string[];
          entities: Array<{ id: string; parentId: string | null; permissions: string[] }>;
        };
        expect(data.tenantPermissions).toEqual([]);
        // The entities are the ones pam can open: A and A1 as administrator, B as poster.
        const byId = new Map(data.entities.map((entity) => [entity.id, entity]));
        expect([...byId.keys()].sort()).toEqual([ent.A, ent.A1, ent.B].sort());
        expect(byId.get(ent.A)!.permissions).toContain("ADMIN_USERS");
        expect(byId.get(ent.A)!.permissions).not.toContain("GL_POST");
        expect(byId.get(ent.B)!.permissions).toEqual(["GL_POST", "GL_READ"]);
        // A1 hangs under A; A and B have no parent pam can open.
        expect(byId.get(ent.A1)!.parentId).toBe(ent.A);
        expect(byId.get(ent.A)!.parentId).toBeNull();
        expect(byId.get(ent.B)!.parentId).toBeNull();
      });

      it("keeps /auth/me to identity: no roles, permissions or entities", async () => {
        const me = await call({ method: "GET", url: "/auth/me", as: "pam" });
        expect(me.status).toBe(200);
        expect(me.data).not.toHaveProperty("roles");
        expect(me.data).not.toHaveProperty("permissions");
        expect(me.data).not.toHaveProperty("entities");
      });

      it("refuses to delete a role that is still granted to someone", async () => {
        const result = await call({
          method: "DELETE",
          url: `/api/v1/admin/roles/${roles.clerk}`,
          as: "tara"
        });
        expect(result).toMatchObject({ status: 409, code: "ROLE_IN_USE" });
      });
    });
  });
}
