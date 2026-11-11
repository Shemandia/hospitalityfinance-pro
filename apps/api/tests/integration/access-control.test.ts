/**
 * Integration tests: role assignments and AccessService against real
 * PostgreSQL and Redis (WP-A; working rule 3).
 *
 * Part 1 runs migration 20261111000000_role_assignments inside throwaway
 * schemas that hold the legacy tables (user_roles, entity_users.role), so the
 * copy rules are exercised on data this test controls: an empty tenant, a
 * tenant with every legacy shape, and a tenant the migration must refuse.
 *
 * Part 2 uses the real tenant tables: database constraints, row-level
 * security on role_assignments, and AccessService end to end with the Prisma
 * data source and the Redis cache.
 *
 * Run: TEST_DATABASE_URL=... REDIS_URL=... pnpm vitest run tests/integration/access-control.test.ts
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/db/client.js";
import { splitSqlStatements } from "../../src/db/sqlRunner.js";
import { PrismaAccessDataSource } from "../../src/modules/access/prisma-source.js";
import { RedisAccessCache } from "../../src/modules/access/redis-cache.js";
import { AccessInfrastructureError, AccessService } from "../../src/modules/access/service.js";
import { disconnectTestPrisma, getTestPrisma } from "./helpers.js";

type Tx = Prisma.TransactionClient;

const MIGRATION_FILE = fileURLToPath(
  new URL("../../src/db/migrations/20261111000000_role_assignments/migration.sql", import.meta.url)
);

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;

if (!process.env.TEST_DATABASE_URL || !redisUrl) {
  describe.skip("access control against real Postgres and Redis", () => {
    it("requires TEST_DATABASE_URL and REDIS_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
      expect(redisUrl).toBeDefined();
    });
  });
} else {
  const prisma = getTestPrisma();
  const run = Date.now().toString(36);

  // ── Part 1: the migration, on legacy data ──────────────────────────────────

  describe("role_assignments migration on legacy data", () => {
    const schemas: string[] = [];
    let migrationStatements: string[] = [];

    /** Runs `fn` in one transaction whose search_path is the scratch schema. */
    function inSchema<T>(schema: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
          return fn(tx);
        },
        { timeout: 30_000 }
      );
    }

    /** The legacy tables, reduced to the columns the migration reads. */
    async function createLegacySchema(label: string): Promise<string> {
      const schema = `access_mig_${label}_${run}`;
      schemas.push(schema);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await inSchema(schema, async (tx) => {
        const ddl = [
          `CREATE TYPE "EntityRole" AS ENUM ('ADMIN', 'CONTROLLER', 'VIEWER', 'SUPERADMIN')`,
          `CREATE TABLE users (id TEXT PRIMARY KEY)`,
          `CREATE TABLE entities (id TEXT PRIMARY KEY)`,
          `CREATE TABLE roles (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, is_system BOOLEAN NOT NULL DEFAULT false)`,
          `CREATE TABLE entity_users (
             entity_id TEXT NOT NULL REFERENCES entities(id),
             user_id TEXT NOT NULL REFERENCES users(id),
             role "EntityRole",
             created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
             PRIMARY KEY (entity_id, user_id))`,
          `CREATE TABLE user_roles (
             id TEXT PRIMARY KEY,
             user_id TEXT NOT NULL REFERENCES users(id),
             role_id TEXT NOT NULL REFERENCES roles(id),
             entity_id TEXT REFERENCES entities(id),
             created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`
        ];
        for (const statement of ddl) await tx.$executeRawUnsafe(statement);
      });
      return schema;
    }

    /** Applies the migration file atomically, as `prisma db execute` does. */
    function migrate(schema: string): Promise<void> {
      return inSchema(schema, async (tx) => {
        for (const statement of migrationStatements) await tx.$executeRawUnsafe(statement);
      });
    }

    type Row = { user_id: string; role: string; scope_type: string; entity_id: string | null };

    function assignments(schema: string): Promise<Row[]> {
      return inSchema(schema, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return tx.$queryRawUnsafe<Row[]>(
          `SELECT ra.user_id, r.code AS role, ra.scope_type::text AS scope_type, ra.entity_id
             FROM role_assignments ra JOIN roles r ON r.id = ra.role_id
            ORDER BY ra.user_id, r.code, ra.entity_id NULLS FIRST`
        );
      });
    }

    async function seedRoles(tx: Tx): Promise<void> {
      await tx.$executeRawUnsafe(
        `INSERT INTO roles (id, code, is_system) VALUES
           ('r-tadmin', 'TENANT_ADMIN', true), ('r-admin', 'ADMIN', false),
           ('r-ctrl', 'CONTROLLER', false), ('r-view', 'VIEWER', false)`
      );
    }

    beforeAll(async () => {
      migrationStatements = splitSqlStatements(await readFile(MIGRATION_FILE, "utf-8"));
    });

    afterAll(async () => {
      for (const schema of schemas) {
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    });

    it("applies to a tenant with no grants, and can be re-run", async () => {
      const schema = await createLegacySchema("empty");
      await migrate(schema);
      await migrate(schema);
      expect(await assignments(schema)).toEqual([]);
    });

    it("copies every legacy shape without widening anyone's access", async () => {
      const schema = await createLegacySchema("data");
      await inSchema(schema, async (tx) => {
        await seedRoles(tx);
        await tx.$executeRawUnsafe(`INSERT INTO entities (id) VALUES ('e1'), ('e2'), ('e3')`);
        await tx.$executeRawUnsafe(
          `INSERT INTO users (id) VALUES ('u1'), ('u2'), ('u3'), ('u4'), ('u5'), ('u6'), ('u7')`
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO user_roles (id, user_id, role_id, entity_id) VALUES
             ('ur1',  'u1', 'r-ctrl',   'e1'),   -- entity-scoped grant
             ('ur2a', 'u2', 'r-tadmin', NULL),   -- global system role ...
             ('ur2b', 'u2', 'r-tadmin', NULL),   -- ... stored twice (the user_roles NULL flaw)
             ('ur3',  'u3', 'r-ctrl',   NULL),   -- global ordinary role, member of e1 and e2
             ('ur4',  'u4', 'r-view',   NULL),   -- global ordinary role, member of nothing
             ('ur7',  'u7', 'r-view',   'e1')`
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO entity_users (entity_id, user_id, role) VALUES
             ('e1', 'u3', NULL), ('e2', 'u3', NULL),
             ('e2', 'u5', 'VIEWER'),       -- deprecated column only
             ('e1', 'u6', 'SUPERADMIN'),   -- deprecated cross-entity admin
             ('e1', 'u7', 'ADMIN')         -- deprecated value, but u7 has user_roles`
        );
      });

      await migrate(schema);
      const expected: Row[] = [
        { user_id: "u1", role: "CONTROLLER", scope_type: "ENTITY", entity_id: "e1" },
        { user_id: "u2", role: "TENANT_ADMIN", scope_type: "TENANT", entity_id: null },
        { user_id: "u3", role: "CONTROLLER", scope_type: "ENTITY", entity_id: "e1" },
        { user_id: "u3", role: "CONTROLLER", scope_type: "ENTITY", entity_id: "e2" },
        { user_id: "u5", role: "VIEWER", scope_type: "ENTITY", entity_id: "e2" },
        { user_id: "u6", role: "TENANT_ADMIN", scope_type: "TENANT", entity_id: null },
        { user_id: "u7", role: "VIEWER", scope_type: "ENTITY", entity_id: "e1" }
      ];
      expect(await assignments(schema)).toEqual(expected);

      // Re-running (the contract migration repeats the copy) changes nothing.
      await migrate(schema);
      expect(await assignments(schema)).toEqual(expected);
    });

    it("picks up grants written to the legacy tables after the first run", async () => {
      const schema = await createLegacySchema("late");
      await inSchema(schema, async (tx) => {
        await seedRoles(tx);
        await tx.$executeRawUnsafe(`INSERT INTO entities (id) VALUES ('e1')`);
        await tx.$executeRawUnsafe(`INSERT INTO users (id) VALUES ('u1')`);
      });
      await migrate(schema);
      await inSchema(schema, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO user_roles (id, user_id, role_id, entity_id) VALUES ('ur1', 'u1', 'r-view', 'e1')`
        )
      );
      await migrate(schema);
      expect(await assignments(schema)).toEqual([
        { user_id: "u1", role: "VIEWER", scope_type: "ENTITY", entity_id: "e1" }
      ]);
    });

    it("stops, and leaves nothing behind, when a legacy role has no role row", async () => {
      const schema = await createLegacySchema("missing");
      await inSchema(schema, async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO entities (id) VALUES ('e1')`);
        await tx.$executeRawUnsafe(`INSERT INTO users (id) VALUES ('u1')`);
        await tx.$executeRawUnsafe(
          `INSERT INTO entity_users (entity_id, user_id, role) VALUES ('e1', 'u1', 'CONTROLLER')`
        );
      });
      await expect(migrate(schema)).rejects.toThrow(/CONTROLLER -> CONTROLLER/);
      const table = await inSchema(schema, (tx) =>
        tx.$queryRawUnsafe<Array<{ found: string | null }>>(
          `SELECT to_regclass('role_assignments')::text AS found`
        )
      );
      expect(table[0]?.found).toBeNull();
    });

    it("does not map SUPERADMIN to a role that is not a system role", async () => {
      const schema = await createLegacySchema("nonsystem");
      await inSchema(schema, async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO roles (id, code, is_system) VALUES ('r-fake', 'TENANT_ADMIN', false)`
        );
        await tx.$executeRawUnsafe(`INSERT INTO entities (id) VALUES ('e1')`);
        await tx.$executeRawUnsafe(`INSERT INTO users (id) VALUES ('u1')`);
        await tx.$executeRawUnsafe(
          `INSERT INTO entity_users (entity_id, user_id, role) VALUES ('e1', 'u1', 'SUPERADMIN')`
        );
      });
      await expect(migrate(schema)).rejects.toThrow(/SUPERADMIN -> TENANT_ADMIN/);
    });
  });

  // ── Part 2: the real tables ────────────────────────────────────────────────

  describe("role assignments and AccessService on the tenant schema", () => {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    const tenantId = `it-tenant-${run}`;
    const ids = {
      group: "",
      propA: "",
      propB: "",
      propC: "",
      accountant: "",
      viewer: "",
      admin: "",
      alice: "",
      bob: ""
    };
    const POST = `T${run}_GL_POST`.toUpperCase();
    const READ = `T${run}_GL_READ`.toUpperCase();
    const USERS = `T${run}_ADMIN_USERS`.toUpperCase();

    function bypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });
    }

    function newService(): AccessService {
      return new AccessService(
        new PrismaAccessDataSource(prisma),
        new RedisAccessCache(redis, { ttlSeconds: 60 })
      );
    }

    const alice = () => ({ tenantId, userId: ids.alice });
    const bob = () => ({ tenantId, userId: ids.bob });

    beforeAll(async () => {
      await redis.connect();
      await bypass(async (tx) => {
        const entity = (name: string, type: "GROUP" | "PROPERTY", parentId: string | null) =>
          tx.entity.create({
            data: {
              name: `Access IT ${name} ${run}`,
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

        const permission = async (code: string) =>
          (await tx.permission.create({ data: { code } })).id;
        const post = await permission(POST);
        const read = await permission(READ);
        const users = await permission(USERS);

        const role = async (name: string, permissionIds: string[]) =>
          (
            await tx.role.create({
              data: {
                code: `T${run}_${name}`,
                name: `Access IT ${name}`,
                permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) }
              }
            })
          ).id;
        ids.accountant = await role("ACCOUNTANT", [post, read]);
        ids.viewer = await role("VIEWER", [read]);
        ids.admin = await role("ADMIN", [users]);

        const user = async (name: string) =>
          (await tx.user.create({ data: { email: `${name}-${run}@access.test`, name } })).id;
        ids.alice = await user("alice");
        ids.bob = await user("bob");
      });
    });

    afterAll(async () => {
      await bypass(async (tx) => {
        const userIds = [ids.alice, ids.bob].filter(Boolean);
        const roleIds = [ids.accountant, ids.viewer, ids.admin].filter(Boolean);
        await tx.roleAssignment.deleteMany({ where: { userId: { in: userIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
        await tx.role.deleteMany({ where: { id: { in: roleIds } } });
        await tx.permission.deleteMany({ where: { code: { in: [POST, READ, USERS] } } });
        // Children before the group they hang from.
        await tx.entity.deleteMany({
          where: { id: { in: [ids.propA, ids.propB, ids.propC].filter(Boolean) } }
        });
        await tx.entity.deleteMany({ where: { id: { in: [ids.group].filter(Boolean) } } });
      });
      const keys = await redis.keys(`access:${tenantId}:*`);
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
      await disconnectTestPrisma();
    });

    async function clearAssignments(): Promise<void> {
      await bypass((tx) =>
        tx.roleAssignment.deleteMany({ where: { userId: { in: [ids.alice, ids.bob] } } })
      );
      const service = newService();
      await service.invalidateUser(alice());
      await service.invalidateUser(bob());
    }

    describe("database constraints", () => {
      it("rejects the same tenant-wide grant twice", async () => {
        await clearAssignments();
        const grant = () =>
          bypass((tx) =>
            tx.roleAssignment.create({
              data: { userId: ids.alice, roleId: ids.admin, scopeType: "TENANT" }
            })
          );
        await grant();
        await expect(grant()).rejects.toThrow(/unique/i);
      });

      it("rejects the same entity grant twice", async () => {
        await clearAssignments();
        const grant = () =>
          bypass((tx) =>
            tx.roleAssignment.create({
              data: {
                userId: ids.alice,
                roleId: ids.viewer,
                scopeType: "ENTITY",
                entityId: ids.propA
              }
            })
          );
        await grant();
        await expect(grant()).rejects.toThrow(/unique/i);
      });

      it("rejects a tenant-wide grant that names an entity", async () => {
        await expect(
          bypass((tx) =>
            tx.roleAssignment.create({
              data: {
                userId: ids.bob,
                roleId: ids.admin,
                scopeType: "TENANT",
                entityId: ids.propA
              }
            })
          )
        ).rejects.toThrow(/role_assignments_scope_check/);
      });

      it("rejects an entity grant without an entity", async () => {
        await expect(
          bypass((tx) =>
            tx.roleAssignment.create({
              data: { userId: ids.bob, roleId: ids.viewer, scopeType: "ENTITY" }
            })
          )
        ).rejects.toThrow(/role_assignments_scope_check/);
      });

      it("removes a user's assignments when the role is deleted", async () => {
        await clearAssignments();
        const temp = await bypass(async (tx) => {
          const role = await tx.role.create({
            data: { code: `T${run}_TEMP`, name: "Access IT temp" }
          });
          await tx.roleAssignment.create({
            data: { userId: ids.bob, roleId: role.id, scopeType: "TENANT" }
          });
          return role.id;
        });
        await bypass((tx) => tx.role.delete({ where: { id: temp } }));
        const left = await bypass((tx) => tx.roleAssignment.count({ where: { userId: ids.bob } }));
        expect(left).toBe(0);
      });
    });

    describe("row-level security on role_assignments", () => {
      it("returns no rows to a query that does not set the bypass", async () => {
        await clearAssignments();
        await bypass((tx) =>
          tx.roleAssignment.create({
            data: { userId: ids.alice, roleId: ids.admin, scopeType: "TENANT" }
          })
        );
        const withoutBypass = await prisma.roleAssignment.findMany({
          where: { userId: ids.alice }
        });
        const scopedToEntity = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${ids.propA}, true)`;
          return tx.roleAssignment.findMany({ where: { userId: ids.alice } });
        });
        expect(withoutBypass).toEqual([]);
        expect(scopedToEntity).toEqual([]);
      });

      it("rejects a write that does not set the bypass", async () => {
        await expect(
          prisma.roleAssignment.create({
            data: { userId: ids.bob, roleId: ids.admin, scopeType: "TENANT" }
          })
        ).rejects.toThrow(/row-level security/i);
      });
    });

    describe("AccessService with the Prisma source and Redis cache", () => {
      it("Accountant on A and Viewer on B: posts on A, refused on B, cannot open C (acceptance 1)", async () => {
        await clearAssignments();
        await bypass((tx) =>
          tx.roleAssignment.createMany({
            data: [
              {
                userId: ids.alice,
                roleId: ids.accountant,
                scopeType: "ENTITY",
                entityId: ids.propA
              },
              { userId: ids.alice, roleId: ids.viewer, scopeType: "ENTITY", entityId: ids.propB }
            ]
          })
        );
        const service = newService();
        await service.invalidateUser(alice());

        expect(await service.can(alice(), POST, ids.propA)).toBe(true);
        expect(await service.can(alice(), POST, ids.propB)).toBe(false);
        expect(await service.can(alice(), READ, ids.propB)).toBe(true);
        expect(await service.canOpen(alice(), ids.propC)).toBe(false);
        expect(await service.canOpen(alice(), ids.group)).toBe(false);
        expect(await service.canAtTenant(alice(), POST)).toBe(false);
      });

      it("a role on the group gives the same permissions on all three properties (acceptance 2)", async () => {
        await clearAssignments();
        await bypass((tx) =>
          tx.roleAssignment.create({
            data: {
              userId: ids.alice,
              roleId: ids.accountant,
              scopeType: "ENTITY",
              entityId: ids.group
            }
          })
        );
        const access = await newService().resolve(alice());
        const expected = [POST, READ].sort();
        expect(access.entityPermissions[ids.propA]).toEqual(expected);
        expect(access.entityPermissions[ids.propB]).toEqual(expected);
        expect(access.entityPermissions[ids.propC]).toEqual(expected);
        expect(access.entityPermissions[ids.group]).toEqual(expected);
        expect(access.tenantPermissions).toEqual([]);
      });

      it("removing a role takes effect on the next check, through a second service instance (acceptance 3)", async () => {
        await clearAssignments();
        const assignment = await bypass((tx) =>
          tx.roleAssignment.create({
            data: {
              userId: ids.alice,
              roleId: ids.accountant,
              scopeType: "ENTITY",
              entityId: ids.propA
            }
          })
        );
        const apiProcess = newService();
        const adminProcess = newService();
        expect(await apiProcess.can(alice(), POST, ids.propA)).toBe(true);

        await bypass((tx) => tx.roleAssignment.delete({ where: { id: assignment.id } }));
        await adminProcess.invalidateUser(alice());

        expect(await apiProcess.can(alice(), POST, ids.propA)).toBe(false);
        expect(await apiProcess.canOpen(alice(), ids.propA)).toBe(false);
      });

      it("a tenant-wide role reaches every property and tenant-level routes", async () => {
        await clearAssignments();
        await bypass((tx) =>
          tx.roleAssignment.create({
            data: { userId: ids.bob, roleId: ids.admin, scopeType: "TENANT" }
          })
        );
        const service = newService();
        expect(await service.canAtTenant(bob(), USERS)).toBe(true);
        expect(await service.can(bob(), USERS, ids.propC)).toBe(true);
        expect(await service.canAtTenant(alice(), USERS)).toBe(false);
      });

      it("a change to a role's permissions reaches users after a tenant invalidation", async () => {
        await clearAssignments();
        await bypass((tx) =>
          tx.roleAssignment.create({
            data: {
              userId: ids.alice,
              roleId: ids.viewer,
              scopeType: "ENTITY",
              entityId: ids.propA
            }
          })
        );
        const service = newService();
        expect(await service.can(alice(), POST, ids.propA)).toBe(false);

        const post = await bypass((tx) =>
          tx.permission.findUniqueOrThrow({ where: { code: POST } })
        );
        await bypass((tx) =>
          tx.rolePermission.create({ data: { roleId: ids.viewer, permissionId: post.id } })
        );
        await service.invalidateTenant(tenantId);
        try {
          expect(await service.can(alice(), POST, ids.propA)).toBe(true);
        } finally {
          await bypass((tx) =>
            tx.rolePermission.delete({
              where: { roleId_permissionId: { roleId: ids.viewer, permissionId: post.id } }
            })
          );
          await service.invalidateTenant(tenantId);
        }
      });

      it("a deactivated user loses access", async () => {
        await clearAssignments();
        await bypass((tx) =>
          tx.roleAssignment.create({
            data: { userId: ids.bob, roleId: ids.admin, scopeType: "TENANT" }
          })
        );
        const service = newService();
        expect(await service.canAtTenant(bob(), USERS)).toBe(true);

        await bypass((tx) => tx.user.update({ where: { id: ids.bob }, data: { isActive: false } }));
        await service.invalidateUser(bob());
        try {
          expect(await service.canAtTenant(bob(), USERS)).toBe(false);
          expect(await service.canOpen(bob(), ids.propA)).toBe(false);
        } finally {
          await bypass((tx) =>
            tx.user.update({ where: { id: ids.bob }, data: { isActive: true } })
          );
          await service.invalidateUser(bob());
        }
      });

      it("reports an unreachable Redis as an infrastructure fault, not a denial (acceptance 6)", async () => {
        // Port 1 is never a Redis server; the connection is refused at once.
        const dead = new Redis({
          host: "127.0.0.1",
          port: 1,
          lazyConnect: true,
          maxRetriesPerRequest: 0,
          enableOfflineQueue: false,
          retryStrategy: () => null
        });
        dead.on("error", () => {
          // Expected: the connection is refused. The command rejection below is what is asserted.
        });
        const service = new AccessService(
          new PrismaAccessDataSource(prisma),
          new RedisAccessCache(dead, { ttlSeconds: 60 })
        );
        try {
          const attempt = service.canAtTenant(bob(), USERS);
          await expect(attempt).rejects.toBeInstanceOf(AccessInfrastructureError);
          await expect(attempt).rejects.toMatchObject({ dependency: "cache" });
        } finally {
          dead.disconnect();
        }
      });
    });
  });
}
