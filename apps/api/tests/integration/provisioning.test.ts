/**
 * Provisioning a tenant end to end (WP-2 item 2, ARC-06, ARC-08, HC-38).
 *
 * Runs the real ProvisioningService against the test registry and the test
 * server, then checks what it built:
 *   - two roles per tenant; the database belongs to the owner, which owns
 *     every table; signing in as either role works (SCRAM verifiers);
 *   - the application role has data rights only: no DDL, no change to the
 *     audit log, no migration history, but it may refresh the view;
 *   - the registry holds the location and sealed passwords, no connection
 *     string, and the schema version;
 *   - the system user and the first administrator exist; setup progress is
 *     keyed by slug;
 *   - creating the database again (a retry) changes nothing.
 * Everything it creates is dropped afterwards.
 *
 * Needs TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL (migrated), REDIS_URL and
 * PLATFORM_ENCRYPTION_KEY; the test role needs CREATEDB and CREATEROLE.
 */
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

import { PrismaClient } from "../../src/db/client.js";
import { PrismaClient as RegistryClient } from "../../src/db/registry-client.js";
import { migrationNames } from "../../src/db/migrate.js";
import { dropTenantDatabase } from "../../src/db/tenant-roles.js";
import { appConnectionUrl, ownerConnectionUrl } from "../../src/db/tenant-location.js";
import { ProvisioningService } from "../../src/modules/tenant/provisioning-service.js";
import { createDatabase } from "../../src/modules/tenant/tenant-database.js";

if (!env.ready) {
  describe("tenant provisioning", () => {
    it("requires TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL and PLATFORM_ENCRYPTION_KEY", () => {
      expect(env.ready).toBe(true);
    });
  });
} else {
  describe("tenant provisioning", () => {
    const run = Date.now().toString(36);
    const slug = `it-prov-${run}`;
    const registry = new RegistryClient({ datasourceUrl: process.env.TEST_REGISTRY_DATABASE_URL });
    const admin = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    let row: Awaited<ReturnType<typeof registry.tenant.findUniqueOrThrow>>;
    let app: PrismaClient;
    let owner: PrismaClient;

    async function denied(promise: Promise<unknown>): Promise<string> {
      try {
        await promise;
        return "allowed";
      } catch (error) {
        const e = error as { meta?: { code?: string }; message: string };
        return e.meta?.code ?? e.message;
      }
    }

    beforeAll(async () => {
      await new ProvisioningService().provision(
        {
          tenant: { name: "IT Provisioning", slug, adminEmail: "owner@it.test", countryCode: "AE" },
          entitlements: {
            licenseType: "STANDARD",
            maxProperties: 5,
            maxUsers: 10,
            enabledModules: ["GL"],
            maxConcurrentSessions: 5,
            subscriptionStartDate: "2026-11-15"
          },
          adminUser: {
            firstName: "Ada",
            lastName: "Admin",
            email: "Admin@IT.test",
            temporaryPassword: "Temporary-Passw0rd"
          }
        },
        (event, data) => void events.push({ event, data })
      );
      row = await registry.tenant.findUniqueOrThrow({ where: { slug } });
      app = new PrismaClient({ datasourceUrl: appConnectionUrl(row) });
      owner = new PrismaClient({ datasourceUrl: ownerConnectionUrl(row) });
    }, 300_000);

    afterAll(async () => {
      await app?.$disconnect();
      await owner?.$disconnect();
      const t = await registry.tenant.findUnique({ where: { slug } });
      if (t?.dbName && t.ownerRole && t.appRole) {
        await dropTenantDatabase(admin, {
          dbName: t.dbName,
          ownerRole: t.ownerRole,
          appRole: t.appRole
        });
      }
      if (t) {
        await registry.tenantProvisioningStep.deleteMany({ where: { tenantId: t.id } });
        await registry.tenantEntitlement.deleteMany({ where: { tenantId: t.id } });
        await registry.tenant.delete({ where: { id: t.id } });
      }
      await registry.$disconnect();
      await admin.$disconnect();
    }, 60_000);

    it("completes every step", () => {
      expect(events.filter((e) => e.event === "error")).toEqual([]);
      expect(events.at(-1)?.event).toBe("complete");
    });

    it("records the location, sealed passwords and schema version, and no connection string", () => {
      expect(row.databaseUrl).toBeNull();
      expect(row.dbName).toBe(`hfp_${slug.replace(/-/g, "_")}`);
      expect(row.ownerRole).toBe(`hfp_${row.tenantCode}_owner`);
      expect(row.appRole).toBe(`hfp_${row.tenantCode}_app`);
      expect(row.ownerPasswordEnc).toMatch(/^v1\./);
      expect(row.appPasswordEnc).toMatch(/^v1\./);
      expect(row.schemaVersion).toBe(migrationNames("tenant").at(-1));
      expect(row.provisioningStatus).toBe("ACTIVE");
    });

    it("signs in as each role; the owner owns the database and every table", async () => {
      const [who] = await owner.$queryRawUnsafe<Array<{ me: string; db_owner: string }>>(
        "select current_user as me, pg_get_userbyid(datdba) as db_owner from pg_database where datname = current_database()"
      );
      expect(who).toEqual({ me: row.ownerRole, db_owner: row.ownerRole });
      const [others] = await owner.$queryRawUnsafe<Array<{ n: number }>>(
        `select count(*)::int as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
          where s.nspname = 'public' and c.relkind in ('r', 'm', 'S', 'v')
            and pg_get_userbyid(c.relowner) <> current_user`
      );
      expect(others?.n).toBe(0);
      const [me] = await app.$queryRawUnsafe<Array<{ me: string }>>("select current_user as me");
      expect(me?.me).toBe(row.appRole);
    });

    it("gives the application role data rights only", async () => {
      expect(await denied(app.$executeRawUnsafe("create table x_probe (id int)"))).toBe("42501");
      expect(await denied(app.$executeRawUnsafe("update audit_events set id = id"))).toBe("42501");
      expect(await denied(app.$queryRawUnsafe("select * from _prisma_migrations"))).toBe("42501");
      expect(
        await denied(app.$executeRawUnsafe("alter table journals disable row level security"))
      ).toBe("42501");
      const [attrs] = await admin.$queryRawUnsafe<
        Array<{ rolsuper: boolean; rolbypassrls: boolean }>
      >(`select rolsuper, rolbypassrls from pg_roles where rolname = '${row.appRole}'`);
      expect(attrs).toEqual({ rolsuper: false, rolbypassrls: false });
      expect(await denied(app.$executeRawUnsafe("select refresh_period_balances()"))).toBe(
        "allowed"
      );
    });

    it("lets only the two roles connect", async () => {
      const [rights] = await admin.$queryRawUnsafe<Array<{ public_connect: boolean }>>(
        `select has_database_privilege('public', '${row.dbName}', 'CONNECT') as public_connect`
      );
      expect(rights?.public_connect).toBe(false);
    });

    it("has the system user, the first administrator, and setup progress keyed by slug", async () => {
      const users = await app.$queryRawUnsafe<
        Array<{ email: string; is_system: boolean; is_active: boolean; has_password: boolean }>
      >(
        "select email, is_system, is_active, password_hash is not null as has_password from users order by email"
      );
      expect(users).toEqual([
        { email: "admin@it.test", is_system: false, is_active: true, has_password: true },
        { email: "system@hfp.invalid", is_system: true, is_active: false, has_password: false }
      ]);
      const progress = await app.$queryRawUnsafe<Array<{ tenant_id: string }>>(
        "select tenant_id from tenant_setup_progress"
      );
      expect(progress).toEqual([{ tenant_id: slug }]);
    });

    it("can create the database again without change (a retry)", async () => {
      await expect(
        createDatabase({
          dbHost: row.dbHost!,
          dbPort: row.dbPort!,
          dbName: row.dbName!,
          ownerRole: row.ownerRole!,
          ownerPasswordEnc: row.ownerPasswordEnc!,
          appRole: row.appRole!,
          appPasswordEnc: row.appPasswordEnc!
        })
      ).resolves.toBeUndefined();
      const [me] = await app.$queryRawUnsafe<Array<{ me: string }>>("select current_user as me");
      expect(me?.me).toBe(row.appRole);
    }, 60_000);
  });
}
