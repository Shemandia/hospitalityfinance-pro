/**
 * Backups and the tested restore (WP-2 item 9, OPS-07; roadmap Stage 1 gate:
 * "a backup is restored into a throwaway database and its row counts match").
 *
 * A tenant is provisioned and given rows in tables whose row-level security is
 * forced on the owner too. Then:
 *   - a backup run dumps it and the registry, records both, and fails loudly
 *     for a tenant built before WP-2 (no owner role to dump it as);
 *   - the manifest's counts include the RLS-protected rows; files are 0600;
 *   - each dump restores into a new database whose every table's row count
 *     matches, owned by the tenant's owner, with no one else able to connect,
 *     and the copy is dropped afterwards;
 *   - a damaged dump is refused before anything is created; a manifest that
 *     does not match the dump reports the table that differs;
 *   - a second run is refused while one holds the lock;
 *   - pruning deletes old backups but never the newest of a database.
 *
 * Needs TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL (migrated),
 * PLATFORM_ENCRYPTION_KEY, and pg_dump/pg_restore for the server's version.
 */
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import type { BackupManifest } from "../../src/db/backup.js";
import {
  BackupBusyError,
  pruneBackups,
  restoreBackup,
  runBackups
} from "../../src/db/tenant-backup.js";
import { ownerConnectionUrl, type NewLocation } from "../../src/db/tenant-location.js";
import { dropTenantDatabase } from "../../src/db/tenant-roles.js";
import {
  createDatabase,
  migrateDatabase,
  planTenantDatabase,
  secureDatabase
} from "../../src/modules/tenant/tenant-database.js";

if (!env.ready) {
  describe("backups and restore", () => {
    it("requires TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL and PLATFORM_ENCRYPTION_KEY", () => {
      expect(env.ready).toBe(true);
    });
  });
} else {
  describe("backups and restore (OPS-07)", () => {
    const run = Date.now().toString(36);
    const registry = new RegistryClient({ datasourceUrl: process.env.TEST_REGISTRY_DATABASE_URL });
    const admin = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
    const slugs = { a: `it-bak-a-${run}`, legacy: `it-bak-old-${run}` };
    const dir = mkdtempSync(join(tmpdir(), "hfp-backups-"));
    const runIds: string[] = [];
    let location: NewLocation;
    let ownerUrl: string;

    async function withDb<T>(url: string, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
      const db = new PrismaClient({ datasourceUrl: url });
      try {
        return await fn(db);
      } finally {
        await db.$disconnect();
      }
    }
    const manifestOf = (file: string): BackupManifest =>
      JSON.parse(readFileSync(join(dir, `${file}.json`), "utf8")) as BackupManifest;
    const databaseExists = async (name: string) =>
      (
        await admin.$queryRawUnsafe<Array<{ found: boolean }>>(
          `select exists (select 1 from pg_database where datname = '${name}') as found`
        )
      )[0]!.found;

    beforeAll(async () => {
      const code = `${run.slice(-6)}b1`.slice(-8);
      location = planTenantDatabase(slugs.a, code);
      await registry.tenant.create({
        data: {
          slug: slugs.a,
          tenantCode: code,
          name: slugs.a,
          adminEmail: "ops@it.test",
          ...location,
          provisionedAt: new Date()
        }
      });
      await createDatabase(location);
      const schemaVersion = await migrateDatabase(location);
      await secureDatabase(location);
      await registry.tenant.update({ where: { slug: slugs.a }, data: { schemaVersion } });
      ownerUrl = ownerConnectionUrl({ ...location, databaseUrl: null });
      await withDb(ownerUrl, (db) =>
        db.$transaction([
          db.$executeRawUnsafe(`select set_config('app.bypass_rls', 'true', true)`),
          db.$executeRawUnsafe(
            `INSERT INTO "entities" ("id", "code", "name", "type", "country_code", "updated_at")
             VALUES ('e1', 'HQ', 'Head office', 'CORPORATE', 'AE', now()),
                    ('e2', 'P1', 'Hotel one', 'PROPERTY', 'AE', now())`
          ),
          db.$executeRawUnsafe(
            `INSERT INTO "users" ("id", "email", "name", "updated_at") VALUES ('u1', 'ada@it.test', 'Ada', now())`
          )
        ])
      );
      await registry.tenant.create({
        data: {
          slug: slugs.legacy,
          tenantCode: `${run.slice(-6)}b9`.slice(-8),
          name: slugs.legacy,
          adminEmail: "ops@it.test",
          databaseUrl: process.env.TEST_DATABASE_URL!,
          provisionedAt: new Date()
        }
      });
    }, 600_000);

    afterAll(async () => {
      await registry.databaseBackup.deleteMany({ where: { runId: { in: runIds } } });
      if (location) await dropTenantDatabase(admin, location);
      await registry.tenant.deleteMany({ where: { slug: { in: Object.values(slugs) } } });
      await registry.$disconnect();
      await admin.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    }, 120_000);

    let tenantFile: string;
    let registryFile: string;

    it("backs up the tenant and the registry, and fails for a tenant it cannot back up", async () => {
      // Forced RLS hides every entity from the owner without the bypass: the dump must set it.
      const hidden = await withDb(ownerUrl, (db) =>
        db.$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) as n from entities`)
      );
      expect(Number(hidden[0]!.n)).toBe(0);

      const result = await runBackups({ dir, only: [slugs.a, slugs.legacy] });
      runIds.push(result.runId);
      expect(result.ok).toBe(false);
      const by = Object.fromEntries(result.outcomes.map((o) => [o.label, o]));
      expect(by[slugs.a]!.status).toBe("SUCCEEDED");
      expect(by.registry!.status).toBe("SUCCEEDED");
      expect(by[slugs.legacy]!.status).toBe("FAILED");
      expect(by[slugs.legacy]!.detail).toMatch(/adopt it first/);
      tenantFile = by[slugs.a]!.file!;
      registryFile = by.registry!.file!;

      const rows = await registry.databaseBackup.findMany({ where: { runId: result.runId } });
      expect(rows.map((r) => `${r.label}:${r.status}`).sort()).toEqual(
        [`${slugs.a}:SUCCEEDED`, `${slugs.legacy}:FAILED`, "registry:SUCCEEDED"].sort()
      );
      const tenantRow = rows.find((r) => r.label === slugs.a)!;
      expect(tenantRow.target).toBe("TENANT");
      expect(tenantRow.dbName).toBe(location.dbName);
      expect(tenantRow.sha256).toMatch(/^[0-9a-f]{64}$/);
    }, 300_000);

    it("records exact row counts, RLS-protected rows included, in files only the owner can read", () => {
      const manifest = manifestOf(tenantFile);
      expect(manifest.target).toBe("TENANT");
      expect(manifest.rowCounts["public.entities"]).toBe(2);
      expect(manifest.rowCounts["public.users"]).toBeGreaterThanOrEqual(1);
      expect(manifest.rowCounts["public._prisma_migrations"]).toBeGreaterThan(0);
      expect(statSync(join(dir, tenantFile)).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, `${tenantFile}.json`)).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "tenants", slugs.a)).mode & 0o777).toBe(0o700);
      expect(existsSync(join(dir, `${tenantFile}.partial`))).toBe(false);
    });

    it("restores the tenant backup into a new database with every row count matching", async () => {
      const into = `hfp_it_restore_${run}`;
      const result = await restoreBackup(join(dir, `${tenantFile}.json`), { into, keep: true });
      try {
        expect(result.differences).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.tables).toBeGreaterThan(50);
        // The copy belongs to the tenant's owner, and only the owner may connect.
        const [rights] = await admin.$queryRawUnsafe<
          Array<{ owner: string; anyone: boolean; app: boolean }>
        >(
          `select pg_get_userbyid(datdba) as owner,
                  has_database_privilege('public', '${into}', 'CONNECT') as anyone,
                  has_database_privilege('${location.appRole}', '${into}', 'CONNECT') as app
             from pg_database where datname = '${into}'`
        );
        expect(rights).toEqual({ owner: location.ownerRole, anyone: false, app: false });
      } finally {
        await admin.$executeRawUnsafe(
          `GRANT "${location.ownerRole}" TO CURRENT_USER WITH INHERIT TRUE, SET TRUE`
        );
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${into}" WITH (FORCE)`);
        await admin.$executeRawUnsafe(
          `GRANT "${location.ownerRole}" TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`
        );
      }
    }, 300_000);

    it("drops the throwaway copy after the check unless asked to keep it", async () => {
      const result = await restoreBackup(join(dir, `${tenantFile}.json`));
      expect(result.ok).toBe(true);
      expect(result.database).toMatch(/^hfp_restore_it_bak_a_/);
      expect(await databaseExists(result.database)).toBe(false);
    }, 300_000);

    it("restores the registry backup with every row count matching", async () => {
      const result = await restoreBackup(join(dir, `${registryFile}.json`), {
        into: `hfp_it_restore_reg_${run}`
      });
      expect(result.differences).toEqual([]);
      expect(manifestOf(registryFile).rowCounts["public.tenants"]).toBeGreaterThanOrEqual(2);
      expect(await databaseExists(`hfp_it_restore_reg_${run}`)).toBe(false);
    }, 300_000);

    it("refuses a damaged dump before creating anything", async () => {
      const copy = join(dir, "damaged.dump");
      copyFileSync(join(dir, tenantFile), copy);
      const bytes = readFileSync(copy);
      bytes[bytes.length >> 1] ^= 0xff;
      writeFileSync(copy, bytes);
      writeFileSync(
        `${copy}.json`,
        JSON.stringify({ ...manifestOf(tenantFile), file: "damaged.dump" })
      );
      const into = `hfp_it_restore_bad_${run}`;
      await expect(restoreBackup(`${copy}.json`, { into })).rejects.toThrow(/damaged/);
      expect(await databaseExists(into)).toBe(false);
    }, 120_000);

    it("reports the table whose restored count is not the manifest's", async () => {
      const manifest = manifestOf(tenantFile);
      const wrong = join(dir, "wrong.json");
      writeFileSync(
        wrong,
        JSON.stringify({ ...manifest, rowCounts: { ...manifest.rowCounts, "public.entities": 3 } })
      );
      copyFileSync(join(dir, tenantFile), join(dir, manifest.file));
      const result = await restoreBackup(wrong, { into: `hfp_it_restore_diff_${run}` });
      expect(result.ok).toBe(false);
      expect(result.differences).toEqual([{ table: "public.entities", expected: 3, actual: 2 }]);
      expect(await databaseExists(`hfp_it_restore_diff_${run}`)).toBe(false);
    }, 300_000);

    it("refuses a second run while one holds the lock", async () => {
      const holder = new RegistryClient({
        datasourceUrl: `${process.env.TEST_REGISTRY_DATABASE_URL}${process.env.TEST_REGISTRY_DATABASE_URL!.includes("?") ? "&" : "?"}connection_limit=1`
      });
      try {
        await holder.$executeRawUnsafe(`select pg_advisory_lock(hashtext('hfp:backup-runner'))`);
        await expect(runBackups({ dir, only: [slugs.a] })).rejects.toBeInstanceOf(BackupBusyError);
        await holder.$executeRawUnsafe(`select pg_advisory_unlock(hashtext('hfp:backup-runner'))`);
      } finally {
        await holder.$disconnect();
      }
    }, 120_000);

    it("prunes old backups but keeps the newest of each database", async () => {
      const later = await runBackups({ dir, only: [slugs.a], registry: false });
      runIds.push(later.runId);
      expect(later.ok).toBe(true);
      const newest = later.outcomes[0]!.file!;

      const pruned = await pruneBackups({
        dir,
        retentionDays: 1,
        now: new Date(Date.now() + 3 * 86_400_000)
      });
      expect(pruned).toContain(tenantFile);
      expect(pruned).not.toContain(newest);
      expect(pruned).not.toContain(registryFile); // the only registry backup of this folder's runs
      expect(existsSync(join(dir, tenantFile))).toBe(false);
      expect(existsSync(join(dir, `${tenantFile}.json`))).toBe(false);
      expect(existsSync(join(dir, newest))).toBe(true);
      const first = await registry.databaseBackup.findFirst({
        where: { runId: runIds[0], label: slugs.a }
      });
      expect(first?.status).toBe("PRUNED");
      expect(first?.prunedAt).toBeInstanceOf(Date);
    }, 300_000);
  });
}
