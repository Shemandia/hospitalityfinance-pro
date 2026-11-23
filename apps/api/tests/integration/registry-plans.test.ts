/**
 * Plans and entitlements in the registry (WP-2 item 8, HC-40), against real
 * PostgreSQL:
 *
 *   1. Registry migration 3_plans on a registry holding entitlements in the
 *      old form: each gets the plan of its licence type, values equal to the
 *      plan's become "as the plan", others stay as exceptions, and a tenant
 *      without an entitlement gets the default plan. Built in a throwaway
 *      hfp_it_ database at migration 2, so the old form really exists.
 *   2. tenantEntitlements reads the test registry: exceptions over the plan,
 *      and the default plan for a tenant without a row.
 *
 * Needs TEST_DATABASE_URL (its server and role create the throwaway
 * database) and TEST_REGISTRY_DATABASE_URL (migrated).
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  const ready = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_REGISTRY_DATABASE_URL);
  if (ready) process.env.REGISTRY_DATABASE_URL = process.env.TEST_REGISTRY_DATABASE_URL;
  return { ready };
});

import { PrismaClient } from "../../src/db/client.js";
import { PrismaClient as RegistryClient } from "../../src/db/registry-client.js";
import { forgetEntitlements, tenantEntitlements } from "../../src/modules/tenant/entitlements.js";
import { config } from "../../src/config.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const registryDir = join(apiRoot, "src/db/registry");

/** Applies the registry migrations up to and including `upTo` to `url`. */
function migrateRegistry(url: string, upTo: string[]): void {
  const dir = mkdtempSync(join(tmpdir(), "hfp-it-registry-"));
  try {
    cpSync(join(registryDir, "schema.prisma"), join(dir, "schema.prisma"));
    cpSync(
      join(registryDir, "migrations/migration_lock.toml"),
      join(dir, "migrations/migration_lock.toml")
    );
    for (const name of upTo) {
      cpSync(join(registryDir, "migrations", name), join(dir, "migrations", name), {
        recursive: true
      });
    }
    execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], {
      cwd: apiRoot,
      env: { ...process.env, REGISTRY_DATABASE_URL: url },
      stdio: "pipe"
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (!env.ready) {
  describe("registry plans", () => {
    it("requires TEST_DATABASE_URL and TEST_REGISTRY_DATABASE_URL", () => {
      expect(env.ready).toBe(true);
    });
  });
} else {
  const run = Date.now().toString(36);

  describe("registry migration 3_plans on entitlements in the old form", () => {
    const server = new URL(process.env.TEST_DATABASE_URL!);
    const name = `hfp_it_plans_${run}`;
    const url = (() => {
      const u = new URL(server.toString());
      u.pathname = `/${name}`;
      return u.toString();
    })();
    const admin = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
    const db = new PrismaClient({ datasourceUrl: url });
    const before = ["0_baseline", "1_tenant_location_and_roles", "2_tenant_migration_runs"];

    beforeAll(async () => {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      migrateRegistry(url, before);
      const tenant = (slug: string, code: string) =>
        db.$executeRawUnsafe(
          `INSERT INTO tenants (id, slug, tenant_code, name, admin_email, database_url, updated_at)
           VALUES ('${slug}', '${slug}', '${code}', '${slug}', 'a@it.test',
                   'postgresql://nobody@localhost/hfp_none', now())`
        );
      await tenant("as-plan", "aaaa0001");
      await tenant("own-limits", "aaaa0002");
      await tenant("no-entitlement", "aaaa0003");
      await db.$executeRawUnsafe(
        `INSERT INTO tenant_entitlements (id, tenant_id, license_type, max_properties, max_users,
                                          enabled_modules, max_concurrent_sessions,
                                          subscription_start_date, updated_at)
         VALUES ('e1', 'as-plan', 'ENTERPRISE', 10, 50, ARRAY['GL','AP','AR','REPORTING'], 10, DATE '2026-01-01', now()),
                ('e2', 'own-limits', 'TRIAL', 3, 5, ARRAY['GL'], 2, DATE '2026-01-01', now())`
      );
      migrateRegistry(url, [...before, "3_plans"]);
    }, 300_000);

    afterAll(async () => {
      await db.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
    }, 60_000);

    type Row = {
      tenant: string;
      plan: string;
      max_properties: number | null;
      max_users: number | null;
      max_concurrent_sessions: number | null;
      enabled_modules: string[];
    };
    const rows = () =>
      db.$queryRawUnsafe<Row[]>(
        `SELECT e.tenant_id AS tenant, p.code AS plan, e.max_properties, e.max_users,
                e.max_concurrent_sessions, e.enabled_modules
           FROM tenant_entitlements e JOIN plans p ON p.id = e.plan_id ORDER BY e.tenant_id`
      );

    it("seeds the three plans with the values used until now, one of them the default", async () => {
      const plans = await db.$queryRawUnsafe<
        Array<{ code: string; max_properties: number; max_users: number; is_default: boolean }>
      >(`SELECT code, max_properties, max_users, is_default FROM plans ORDER BY code`);
      expect(plans).toEqual([
        { code: "ENTERPRISE", max_properties: 10, max_users: 50, is_default: false },
        { code: "STANDARD", max_properties: 10, max_users: 50, is_default: true },
        { code: "TRIAL", max_properties: 10, max_users: 50, is_default: false }
      ]);
    });

    it("maps each licence type to its plan and keeps only real exceptions", async () => {
      const byTenant = Object.fromEntries((await rows()).map((r) => [r.tenant, r]));
      expect(byTenant["as-plan"]).toMatchObject({
        plan: "ENTERPRISE",
        max_properties: null,
        max_users: null,
        max_concurrent_sessions: null,
        enabled_modules: []
      });
      expect(byTenant["own-limits"]).toMatchObject({
        plan: "TRIAL",
        max_properties: 3,
        max_users: 5,
        max_concurrent_sessions: 2,
        enabled_modules: ["GL"]
      });
    });

    it("gives a tenant without an entitlement the default plan", async () => {
      const row = (await rows()).find((r) => r.tenant === "no-entitlement");
      expect(row).toMatchObject({ plan: "STANDARD", max_properties: null, enabled_modules: [] });
    });

    it("drops the licence type column and its type", async () => {
      const [found] = await db.$queryRawUnsafe<Array<{ column: boolean; type: boolean }>>(
        `SELECT exists (SELECT 1 FROM information_schema.columns
                         WHERE table_name = 'tenant_entitlements' AND column_name = 'license_type') AS column,
                exists (SELECT 1 FROM pg_type WHERE typname = 'LicenseType') AS type`
      );
      expect(found).toEqual({ column: false, type: false });
    });
  });

  describe("tenantEntitlements against the test registry", () => {
    const registry = new RegistryClient({ datasourceUrl: process.env.TEST_REGISTRY_DATABASE_URL });
    const ids = { withRow: "", withoutRow: "", plan: "" };

    beforeAll(async () => {
      const tenant = (suffix: string, code: string) =>
        registry.tenant.create({
          data: {
            slug: `it-plans-${suffix}-${run}`,
            tenantCode: code,
            name: `IT plans ${suffix}`,
            adminEmail: "a@it.test",
            // A location is required; no database is ever opened here.
            databaseUrl: "postgresql://nobody@localhost/hfp_none"
          }
        });
      const code = run.slice(-6).padStart(6, "0");
      ids.withRow = (await tenant("own", `p1${code}`)).id;
      ids.withoutRow = (await tenant("none", `p2${code}`)).id;
      ids.plan = (
        await registry.plan.create({
          data: {
            code: `IT_${run}`.toUpperCase(),
            name: `IT plan ${run}`,
            maxProperties: 4,
            maxUsers: 8,
            maxConcurrentSessions: 2,
            enabledModules: ["GL", "AP"],
            uploadMaxMb: 2
          }
        })
      ).id;
      await registry.tenantEntitlement.create({
        data: {
          tenantId: ids.withRow,
          planId: ids.plan,
          maxUsers: 20,
          enabledModules: [],
          importConcurrency: 1,
          subscriptionStartDate: new Date("2026-01-01")
        }
      });
      forgetEntitlements();
    });

    afterAll(async () => {
      await registry.tenantEntitlement.deleteMany({ where: { tenantId: ids.withRow } });
      await registry.plan.deleteMany({ where: { id: ids.plan } });
      await registry.tenant.deleteMany({ where: { id: { in: [ids.withRow, ids.withoutRow] } } });
      await registry.$disconnect();
    });

    it("applies the tenant's exceptions over its plan, under the platform ceiling", async () => {
      const e = await tenantEntitlements(ids.withRow);
      expect(e).toMatchObject({
        maxProperties: 4,
        maxUsers: 20,
        enabledModules: ["GL", "AP"],
        uploadMaxMb: Math.min(2, config().UPLOAD_MAX_MB),
        importConcurrency: Math.min(1, config().IMPORT_CONCURRENCY)
      });
    });

    it("gives a tenant without an entitlement the default plan", async () => {
      const e = await tenantEntitlements(ids.withoutRow);
      expect(e.plan).toBe("STANDARD");
      expect(e.uploadMaxMb).toBe(config().UPLOAD_MAX_MB);
    });
  });
}
