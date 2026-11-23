/**
 * Integration test: the rename of Transfer Desk to Integrations
 * (migration 4_rename_transfer_to_integration; import plan section 6b).
 *
 * A tenant at the previous release, with data in the old tables and the old
 * permissions granted to a role, is upgraded. Afterwards no object carries
 * the old name, every row is where it was under the new name, the sequence
 * keeps counting, and the role still holds the same permissions under their
 * new codes.
 *
 * Run: pnpm test:integration
 */

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/db/client.js";
import { catalogLines } from "../../src/db/catalog.js";
import { deployMigrations, schemaPath } from "../../src/db/migrate.js";

const base = process.env.TEST_DATABASE_URL;
const MIGRATION = "4_rename_transfer_to_integration";

async function asOwner(db: PrismaClient, ...sql: string[]): Promise<void> {
  await db.$transaction([
    db.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'true', true)`),
    ...sql.map((s) => db.$executeRawUnsafe(s))
  ]);
}

async function rowsAsOwner<T>(db: PrismaClient, sql: string): Promise<T[]> {
  const [, rows] = await db.$transaction([
    db.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'true', true)`),
    db.$queryRawUnsafe<T[]>(sql)
  ]);
  return rows as T[];
}

if (!base) {
  describe("Integrations rename", () => {
    it("requires TEST_DATABASE_URL", () => expect(base).toBeDefined());
  });
} else {
  describe("upgrading a tenant from Transfer Desk to Integrations", () => {
    const name = `hfp_it_rename_${Date.now().toString(36)}`;
    const url = new URL(base);
    url.pathname = `/${name}`;
    const admin = new PrismaClient({ datasourceUrl: base });
    const tenant = new PrismaClient({ datasourceUrl: url.toString() });
    let previousRelease = "";

    beforeAll(async () => {
      previousRelease = mkdtempSync(join(tmpdir(), "hfp-previous-"));
      cpSync(dirname(schemaPath("tenant")), previousRelease, {
        recursive: true,
        // Every migration before this one: the release this one upgrades from.
        filter: (p) => {
          const name = /migrations[\\/]([^\\/]+)/.exec(p)?.[1];
          return (
            !name || name === "migration_lock.toml" || parseInt(name, 10) < parseInt(MIGRATION, 10)
          );
        }
      });
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      await deployMigrations("tenant", url.toString(), join(previousRelease, "schema.prisma"));

      await asOwner(
        tenant,
        `INSERT INTO permissions (id, code, description, category, updated_at) VALUES
           ('p-read', 'TRANSFER_DESK_READ', 'View import profiles and execution history', 'Transfer Desk', now()),
           ('p-run', 'TRANSFER_DESK_EXECUTE', 'Execute import profiles', 'Transfer Desk', now()),
           ('p-config', 'TRANSFER_DESK_CONFIG', 'Configure profiles, formats, transformations', 'Transfer Desk', now()),
           ('p-old', 'INTEGRATION_READ', 'View import logs and connector mappings', 'Integrations', now())`,
        `INSERT INTO roles (id, code, name, updated_at) VALUES ('r1', 'CLERK', 'Clerk', now())`,
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ('r1', 'p-read'), ('r1', 'p-run')`,
        `INSERT INTO transfer_lookup_tables (id, name, updated_at) VALUES ('l1', 'Revenue codes', now())`,
        `INSERT INTO transfer_profiles (id, name, profile_type, updated_at)
           VALUES ('pr1', 'Opera night audit', 'IMPORT', now())`,
        `INSERT INTO transfer_executions (id, profile_id) VALUES ('x1', 'pr1')`,
        `INSERT INTO transfer_execution_logs (execution_id, record_index, status)
           VALUES ('x1', 0, 'SUCCESS'), ('x1', 1, 'FAILED')`
      );
      await deployMigrations("tenant", url.toString());
    }, 300_000);

    afterAll(async () => {
      await tenant.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(previousRelease, { recursive: true, force: true });
    }, 60_000);

    it("leaves no table, index, constraint, sequence or type named after Transfer Desk", async () => {
      const lines = await catalogLines((sql) => tenant.$queryRawUnsafe(sql));
      expect(lines.filter((l) => /transfer_|"?Transfer[A-Z]/.test(l))).toEqual([]);
      const leftovers = await tenant.$queryRawUnsafe<Array<{ name: string }>>(
        `select relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and relname like 'transfer%'
         union all select conname from pg_constraint where conname like 'transfer%'
         union all select typname from pg_type where typname ilike 'transfer%'`
      );
      expect(leftovers).toEqual([]);
    });

    it("keeps every row under the new names, and the log sequence keeps counting", async () => {
      expect(await rowsAsOwner(tenant, `SELECT id, name FROM integration_lookup_tables`)).toEqual([
        { id: "l1", name: "Revenue codes" }
      ]);
      expect(await rowsAsOwner(tenant, `SELECT id FROM integration_profiles`)).toEqual([
        { id: "pr1" }
      ]);
      await asOwner(
        tenant,
        `INSERT INTO integration_execution_logs (execution_id, record_index, status) VALUES ('x1', 2, 'SUCCESS')`
      );
      const logs = await rowsAsOwner<{ id: bigint; record_index: number }>(
        tenant,
        `SELECT id, record_index FROM integration_execution_logs ORDER BY id`
      );
      expect(logs.map((l) => [Number(l.id), l.record_index])).toEqual([
        [1, 0],
        [2, 1],
        [3, 2]
      ]);
    });

    it("renames the permissions in place, so roles keep what they had", async () => {
      const permissions = await rowsAsOwner<{ id: string; code: string; category: string }>(
        tenant,
        // Only the rows this test wrote: later migrations add permissions of their own.
        `SELECT id, code, category FROM permissions WHERE id IN ('p-read', 'p-run', 'p-config', 'p-old') ORDER BY id`
      );
      expect(permissions).toEqual([
        { id: "p-config", code: "INTEGRATIONS_CONFIG", category: "Integrations" },
        { id: "p-old", code: "INTEGRATION_READ", category: "Integrations (connectors)" },
        { id: "p-read", code: "INTEGRATIONS_READ", category: "Integrations" },
        { id: "p-run", code: "INTEGRATIONS_RUN", category: "Integrations" }
      ]);
      const held = await rowsAsOwner<{ code: string }>(
        tenant,
        `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = 'r1' ORDER BY p.code`
      );
      expect(held.map((h) => h.code)).toEqual(["INTEGRATIONS_READ", "INTEGRATIONS_RUN"]);
    });
  });
}
