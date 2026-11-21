/**
 * Adopting a tenant database built before WP-2 (WP-2 item 4).
 *
 * A database is built the way the old setup built one: the baseline's SQL run
 * directly (no migration history), owned by the platform role, plus WP-A's
 * legacy role tables with the copy step recorded. Its registry row holds a
 * plain connection string. Then:
 *   - a database with an unexpected difference is refused, and nothing in it
 *     or in the registry changes;
 *   - the legacy database is adopted: legacy tables dropped, two roles, the
 *     owner owns everything, only the tenant's roles may connect, history and
 *     registry recorded, migrated to this release with a system user, data
 *     kept; the result has the same structure and security as a newly
 *     provisioned tenant.
 * Everything it creates is dropped afterwards.
 *
 * Needs TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL (migrated) and
 * PLATFORM_ENCRYPTION_KEY; the test role needs CREATEDB and CREATEROLE.
 */
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const ready = Boolean(
    process.env.TEST_DATABASE_URL &&
    process.env.TEST_REGISTRY_DATABASE_URL &&
    process.env.PLATFORM_ENCRYPTION_KEY
  );
  if (ready) process.env.REGISTRY_DATABASE_URL = process.env.TEST_REGISTRY_DATABASE_URL;
  return { ready };
});

import { resolve } from "node:path";
import { PrismaClient } from "../../src/db/client.js";
import { PrismaClient as RegistryClient } from "../../src/db/registry-client.js";
import { catalogLines } from "../../src/db/catalog.js";
import { API_ROOT, deployMigrations, migrationNames, schemaPath } from "../../src/db/migrate.js";
import { appConnectionUrl, ownerConnectionUrl } from "../../src/db/tenant-location.js";
import { dropTenantDatabase, tenantRoleNames } from "../../src/db/tenant-roles.js";
import { AdoptionRefused, adoptTenant } from "../../src/db/tenant-adoption.js";
import { whenRunnerFree } from "./runner-lock.js";

if (!env.ready) {
  describe("tenant adoption", () => {
    it("requires TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL and PLATFORM_ENCRYPTION_KEY", () => {
      expect(env.ready).toBe(true);
    });
  });
} else {
  describe("tenant adoption", () => {
    const run = Date.now().toString(36);
    const base = process.env.TEST_DATABASE_URL!;
    const registry = new RegistryClient({ datasourceUrl: process.env.TEST_REGISTRY_DATABASE_URL });
    const admin = new PrismaClient({ datasourceUrl: base });
    const tenants = {
      legacy: {
        slug: `it-adopt-${run}`,
        code: run.slice(-8).padStart(8, "a"),
        db: `hfp_it_adopt_${run}`
      },
      odd: {
        slug: `it-adopt-odd-${run}`,
        code: run.slice(-7).padStart(8, "b"),
        db: `hfp_it_adopt_odd_${run}`
      }
    };
    const urlOf = (db: string) => {
      const u = new URL(base);
      u.pathname = `/${db}`;
      return u.toString();
    };
    const lines = async (url: string) => {
      const db = new PrismaClient({ datasourceUrl: url });
      try {
        return await catalogLines((sql) => db.$queryRawUnsafe(sql));
      } finally {
        await db.$disconnect();
      }
    };

    /** A database as the old setup left it: baseline SQL, no history, WP-A legacy tables. */
    async function buildLegacy(dbName: string, slug: string, code: string) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
      execFileSync(
        process.execPath,
        [
          resolve(API_ROOT, "node_modules/prisma/build/index.js"),
          "db",
          "execute",
          "--schema",
          schemaPath("tenant"),
          "--file",
          resolve(API_ROOT, "src/db/tenant/migrations/0_baseline/migration.sql")
        ],
        { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: urlOf(dbName) }, stdio: "pipe" }
      );
      const db = new PrismaClient({ datasourceUrl: urlOf(dbName) });
      try {
        for (const sql of [
          `CREATE TYPE "EntityRole" AS ENUM ('ADMIN', 'CONTROLLER', 'VIEWER', 'SUPERADMIN')`,
          `CREATE TABLE "user_roles" ("id" TEXT PRIMARY KEY, "user_id" TEXT NOT NULL, "role_id" TEXT NOT NULL, "entity_id" TEXT)`,
          `CREATE TABLE "entity_users" ("entity_id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "role" "EntityRole", PRIMARY KEY ("entity_id", "user_id"))`,
          `COMMENT ON TABLE "role_assignments" IS 'legacy grants copied 2026-11-13T15:31:44+03'`,
          `SELECT set_config('app.bypass_rls', 'true', false)`,
          `INSERT INTO "entities" ("id", "code", "name", "type", "country_code", "updated_at") VALUES ('e1', 'HQ', 'Head office', 'CORPORATE', 'AE', now())`,
          `INSERT INTO "users" ("id", "email", "name", "updated_at") VALUES ('u1', 'ada@it.test', 'Ada', now())`
        ]) {
          await db.$executeRawUnsafe(sql);
        }
      } finally {
        await db.$disconnect();
      }
      await registry.tenant.create({
        data: {
          slug,
          tenantCode: code,
          name: slug,
          adminEmail: "ops@it.test",
          databaseUrl: urlOf(dbName),
          provisionedAt: new Date()
        }
      });
    }

    beforeAll(async () => {
      await buildLegacy(tenants.legacy.db, tenants.legacy.slug, tenants.legacy.code);
      await buildLegacy(tenants.odd.db, tenants.odd.slug, tenants.odd.code);
      const odd = new PrismaClient({ datasourceUrl: urlOf(tenants.odd.db) });
      await odd.$executeRawUnsafe(`CREATE TABLE "hand_made" ("id" INT)`);
      await odd.$disconnect();
    }, 600_000);

    afterAll(async () => {
      for (const t of Object.values(tenants)) {
        await dropTenantDatabase(admin, { dbName: t.db, ...tenantRoleNames(t.code) });
      }
      await registry.tenant.deleteMany({
        where: { slug: { in: Object.values(tenants).map((t) => t.slug) } }
      });
      await registry.$disconnect();
      await admin.$disconnect();
    }, 120_000);

    it("refuses a database with an unexpected difference, and changes nothing", async () => {
      const before = await lines(urlOf(tenants.odd.db));
      const refusal = await adoptTenant(tenants.odd.slug).catch((e) => e);
      expect(refusal).toBeInstanceOf(AdoptionRefused);
      expect((refusal as AdoptionRefused).diff?.extra.some((l) => l.includes("hand_made"))).toBe(
        true
      );
      expect(await lines(urlOf(tenants.odd.db))).toEqual(before);
      const row = await registry.tenant.findUniqueOrThrow({ where: { slug: tenants.odd.slug } });
      expect([row.databaseUrl, row.ownerRole]).toEqual([urlOf(tenants.odd.db), null]);
    }, 300_000);

    it("adopts the legacy database", async () => {
      const report = await whenRunnerFree(() => adoptTenant(tenants.legacy.slug));
      expect(report.adopted).toBe(true);
      expect(report.legacy).toBe(true);

      const row = await registry.tenant.findUniqueOrThrow({ where: { slug: tenants.legacy.slug } });
      const roles = tenantRoleNames(tenants.legacy.code);
      expect(row.databaseUrl).toBeNull();
      expect([row.ownerRole, row.appRole, row.dbName]).toEqual([
        roles.ownerRole,
        roles.appRole,
        tenants.legacy.db
      ]);
      expect(row.schemaVersion).toBe(migrationNames("tenant").at(-1));

      // Same structure and security as a newly provisioned tenant.
      const refName = `hfp_it_adopt_ref_${run}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE "${refName}"`);
      try {
        await deployMigrations("tenant", urlOf(refName));
        expect(await lines(ownerConnectionUrl(row))).toEqual(await lines(urlOf(refName)));
      } finally {
        await admin.$executeRawUnsafe(`DROP DATABASE "${refName}" WITH (FORCE)`);
      }

      const app = new PrismaClient({ datasourceUrl: appConnectionUrl(row) });
      try {
        // The application role bypasses only through the owner's function (SEC-11).
        const [users, entities] = await app
          .$transaction([
            app.$executeRawUnsafe(`SELECT app_begin_rls_bypass()`),
            app.$queryRawUnsafe<Array<{ email: string; is_system: boolean }>>(
              "select email, is_system from users order by email"
            ),
            app.$queryRawUnsafe(`select id from entities`)
          ])
          .then(([, u, e]) => [u, e] as const);
        expect(users).toEqual([
          { email: "ada@it.test", is_system: false },
          { email: "system@hfp.invalid", is_system: true }
        ]);
        expect(entities).toEqual([{ id: "e1" }]);
      } finally {
        await app.$disconnect();
      }

      const [rights] = await admin.$queryRawUnsafe<
        Array<{ anyone: boolean; platform: boolean; owner: string }>
      >(
        `select has_database_privilege('public', '${tenants.legacy.db}', 'CONNECT') as anyone,
                has_database_privilege(current_user, '${tenants.legacy.db}', 'CONNECT') as platform,
                (select pg_get_userbyid(datdba) from pg_database where datname = '${tenants.legacy.db}') as owner`
      );
      expect(rights).toMatchObject({ anyone: false, platform: false, owner: roles.ownerRole });
      const owner = new PrismaClient({ datasourceUrl: ownerConnectionUrl(row) });
      try {
        const [notOwned] = await owner.$queryRawUnsafe<Array<{ n: number }>>(
          `select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and pg_get_userbyid(c.relowner) <> current_user`
        );
        expect(notOwned?.n).toBe(0);
      } finally {
        await owner.$disconnect();
      }
    }, 600_000);

    it("refuses to adopt the same tenant twice", async () => {
      await expect(adoptTenant(tenants.legacy.slug)).rejects.toThrow(/already adopted/);
    });
  });
}
