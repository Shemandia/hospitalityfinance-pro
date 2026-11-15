/**
 * The tenant migrations build a complete, protected tenant database from an
 * empty one (WP-2 item 1, ARC-03).
 *
 * A new database is created, the migrations are applied with the same
 * function provisioning uses, and the result is checked: every migration is
 * recorded, the security functions, policies and audit triggers exist, and a
 * second deploy changes nothing. The database is dropped afterwards.
 *
 * Needs TEST_DATABASE_URL (its server and credentials; the role needs CREATEDB).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/db/client.js";
import { catalogLines } from "../../src/db/catalog.js";
import { assertTenantSecurity, deployMigrations, migrationNames } from "../../src/db/migrate.js";

const base = process.env.TEST_DATABASE_URL;

if (!base) {
  describe("tenant migrations from empty", () => {
    it("requires TEST_DATABASE_URL", () => expect(base).toBeDefined());
  });
} else {
  describe("tenant migrations from empty", () => {
    const name = `hfp_it_migrate_${Date.now().toString(36)}`;
    const url = new URL(base);
    url.pathname = `/${name}`;
    const admin = new PrismaClient({ datasourceUrl: base });
    const tenant = new PrismaClient({ datasourceUrl: url.toString() });
    let lines: string[] = [];

    beforeAll(async () => {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      await deployMigrations("tenant", url.toString());
      lines = await catalogLines((sql) => tenant.$queryRawUnsafe(sql));
    }, 300_000);

    afterAll(async () => {
      await tenant.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
    }, 60_000);

    it("records every migration and has the security objects", async () => {
      await expect(assertTenantSecurity(tenant)).resolves.toBeUndefined();
      const applied = await tenant.$queryRawUnsafe<Array<{ migration_name: string }>>(
        "select migration_name from _prisma_migrations order by migration_name"
      );
      expect(applied.map((r) => r.migration_name)).toEqual(migrationNames("tenant"));
    });

    it("protects the entity-scoped tables with forced row-level security", () => {
      for (const table of [
        "journals",
        "accounts",
        "ap_invoices",
        "role_assignments",
        "audit_events"
      ]) {
        expect(lines).toContain(`table: ${table} rls=true force=true`);
      }
      // The entity tree is read before an entity is chosen: enabled, not forced.
      expect(lines).toContain("table: entities rls=true force=false");
      expect(lines.filter((l) => l.startsWith("policy: ")).length).toBe(54);
    });

    it("keeps the audit log immutable", () => {
      expect(lines.some((l) => l.includes("trg_prevent_audit_event_update"))).toBe(true);
      expect(lines.some((l) => l.includes("trg_prevent_audit_event_delete"))).toBe(true);
    });

    it("creates the reporting view and the NULL-safe role assignment index", () => {
      expect(lines.some((l) => l.startsWith("view: mv_period_account_balances m"))).toBe(true);
      expect(lines).toContain(
        "index: CREATE UNIQUE INDEX role_assignments_user_id_role_id_entity_id_key ON public.role_assignments USING btree (user_id, role_id, entity_id) NULLS NOT DISTINCT"
      );
    });

    it("changes nothing when deployed again", async () => {
      const output = await deployMigrations("tenant", url.toString());
      expect(output).toMatch(/No pending migrations to apply/);
      expect(await catalogLines((sql) => tenant.$queryRawUnsafe(sql))).toEqual(lines);
    }, 120_000);
  });
}
