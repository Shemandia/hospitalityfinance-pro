/**
 * The tenant migration runner (WP-2 item 3; WP-2 acceptance: "a second
 * release with a new migration upgrades two tenants through the runner").
 *
 * Two tenants are provisioned on this release. A copy of the tenant
 * migrations with one more migration stands in for the next release. Tenant B
 * is given a table that makes the new migration fail. Then:
 *   1. the runner upgrades A, fails on B, stops, records both, reports failure;
 *   2. after B is repaired, --resume upgrades B under the same run id;
 *   3. a third run finds both up to date;
 * and along the way: the application role can use the new table (default
 * privileges), a tenant built before WP-2 is skipped with the reason, and a
 * second runner is refused while one holds the lock.
 *
 * Needs TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL (migrated) and
 * PLATFORM_ENCRYPTION_KEY; the test role needs CREATEDB and CREATEROLE.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { migrationNames, schemaPath } from "../../src/db/migrate.js";
import {
  appConnectionUrl,
  ownerConnectionUrl,
  type NewLocation
} from "../../src/db/tenant-location.js";
import { dropTenantDatabase } from "../../src/db/tenant-roles.js";
import { RunnerBusyError, runTenantMigrations } from "../../src/db/tenant-runner.js";
import { whenRunnerFree } from "./runner-lock.js";
import {
  createDatabase,
  migrateDatabase,
  planTenantDatabase,
  secureDatabase
} from "../../src/modules/tenant/tenant-database.js";

if (!env.ready) {
  describe("tenant migration runner", () => {
    it("requires TEST_DATABASE_URL, TEST_REGISTRY_DATABASE_URL and PLATFORM_ENCRYPTION_KEY", () => {
      expect(env.ready).toBe(true);
    });
  });
} else {
  describe("tenant migration runner", () => {
    const run = Date.now().toString(36);
    const registry = new RegistryClient({ datasourceUrl: process.env.TEST_REGISTRY_DATABASE_URL });
    const admin = new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL });
    const current = migrationNames("tenant").at(-1)!;
    const NEXT = "9999_runner_probe";
    const slugs = { a: `it-run-a-${run}`, b: `it-run-b-${run}`, legacy: `it-run-old-${run}` };
    const all = Object.values(slugs);
    const locations = new Map<string, NewLocation>();
    let release: string;
    let releaseDir: string;

    async function provision(slug: string, n: number) {
      const code = `${run.slice(-6)}${n}`.padStart(8, "0").slice(-8);
      const location = planTenantDatabase(slug, code);
      await registry.tenant.create({
        data: {
          slug,
          tenantCode: code,
          name: slug,
          adminEmail: "ops@it.test",
          ...location,
          provisionedAt: new Date(Date.now() + n)
        }
      });
      await createDatabase(location);
      const schemaVersion = await migrateDatabase(location);
      await secureDatabase(location);
      await registry.tenant.update({ where: { slug }, data: { schemaVersion } });
      locations.set(slug, location);
    }

    async function withDb<T>(url: string, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
      const db = new PrismaClient({ datasourceUrl: url });
      try {
        return await fn(db);
      } finally {
        await db.$disconnect();
      }
    }
    const asLocation = (l: NewLocation) => ({ ...l, databaseUrl: null });

    beforeAll(async () => {
      // The "next release": this release's tenant schema and migrations, plus one.
      releaseDir = mkdtempSync(join(tmpdir(), "hfp-release-"));
      cpSync(dirname(schemaPath("tenant")), releaseDir, { recursive: true });
      mkdirSync(join(releaseDir, "migrations", NEXT));
      writeFileSync(
        join(releaseDir, "migrations", NEXT, "migration.sql"),
        `CREATE TABLE "runner_probe" ("id" INTEGER PRIMARY KEY);\nINSERT INTO "runner_probe" VALUES (1);\n`
      );
      release = join(releaseDir, "schema.prisma");

      await provision(slugs.a, 1);
      await provision(slugs.b, 2);
      // Built before WP-2: a connection string, no roles, no version.
      await registry.tenant.create({
        data: {
          slug: slugs.legacy,
          tenantCode: `${run.slice(-6)}9`.padStart(8, "0").slice(-8),
          name: slugs.legacy,
          adminEmail: "ops@it.test",
          databaseUrl: process.env.TEST_DATABASE_URL!,
          provisionedAt: new Date(Date.now() + 3)
        }
      });
      // Make the next release's migration fail for B.
      await withDb(ownerConnectionUrl(asLocation(locations.get(slugs.b)!)), (db) =>
        db.$executeRawUnsafe(`CREATE TABLE "runner_probe" ("id" INTEGER)`)
      );
    }, 600_000);

    afterAll(async () => {
      for (const location of locations.values()) await dropTenantDatabase(admin, location);
      await registry.tenant.deleteMany({ where: { slug: { in: all } } });
      await registry.$disconnect();
      await admin.$disconnect();
      rmSync(releaseDir, { recursive: true, force: true });
    }, 120_000);

    const version = async (slug: string) =>
      (await registry.tenant.findUniqueOrThrow({ where: { slug } })).schemaVersion;

    let firstRunId = "";

    it("upgrades A, stops at B's failure, records both, and reports failure", async () => {
      const result = await whenRunnerFree(() =>
        runTenantMigrations({ schema: release, only: all })
      );
      firstRunId = result.runId;
      expect(result.ok).toBe(false);
      expect(result.outcomes.map((o) => [o.slug, o.status])).toEqual([
        [slugs.a, "SUCCEEDED"],
        [slugs.b, "FAILED"]
      ]);
      expect(await version(slugs.a)).toBe(NEXT);
      expect(await version(slugs.b)).toBe(current);
      const rows = await registry.tenantMigrationRun.findMany({
        where: { runId: result.runId },
        include: { tenant: { select: { slug: true } } },
        orderBy: { startedAt: "asc" }
      });
      expect(rows.map((r) => [r.tenant.slug, r.status, r.fromVersion, r.toVersion])).toEqual([
        [slugs.a, "SUCCEEDED", current, NEXT],
        [slugs.b, "FAILED", current, NEXT]
      ]);
      expect(rows[1]?.error).toMatch(/runner_probe/);
    }, 300_000);

    it("gives the application role the new table through default privileges", async () => {
      const rows = await withDb(appConnectionUrl(asLocation(locations.get(slugs.a)!)), (db) =>
        db.$queryRawUnsafe<Array<{ id: number }>>(`select id from runner_probe`)
      );
      expect(rows).toEqual([{ id: 1 }]);
    });

    it("resumes the run after B is repaired, retrying the failed migration", async () => {
      await withDb(ownerConnectionUrl(asLocation(locations.get(slugs.b)!)), (db) =>
        db.$executeRawUnsafe(`DROP TABLE "runner_probe"`)
      );
      const result = await whenRunnerFree(() =>
        runTenantMigrations({ schema: release, only: all, resume: true })
      );
      expect(result.runId).toBe(firstRunId);
      expect(result.ok).toBe(true);
      expect(result.outcomes.map((o) => [o.slug, o.status])).toEqual([
        [slugs.a, "UP_TO_DATE"],
        [slugs.b, "SUCCEEDED"],
        [slugs.legacy, "SKIPPED"]
      ]);
      expect(result.outcomes[2]?.detail).toMatch(/adopt it first/);
      expect(await version(slugs.b)).toBe(NEXT);
    }, 300_000);

    it("finds everything up to date on the next run, and changes nothing in a dry run", async () => {
      const dry = await whenRunnerFree(() =>
        runTenantMigrations({
          schema: release,
          only: [slugs.a, slugs.b],
          dryRun: true
        })
      );
      expect(dry.outcomes.map((o) => o.status)).toEqual(["UP_TO_DATE", "UP_TO_DATE"]);
      const result = await whenRunnerFree(() =>
        runTenantMigrations({ schema: release, only: [slugs.a, slugs.b] })
      );
      expect(result.ok).toBe(true);
      expect(await registry.tenantMigrationRun.count({ where: { runId: result.runId } })).toBe(0);
    }, 120_000);

    it("refuses to run while another run holds the lock", async () => {
      const holder = new RegistryClient({
        datasourceUrl: `${process.env.TEST_REGISTRY_DATABASE_URL}${process.env.TEST_REGISTRY_DATABASE_URL!.includes("?") ? "&" : "?"}connection_limit=1`
      });
      try {
        await holder.$executeRawUnsafe(
          `select pg_advisory_lock(hashtext('hfp:tenant-migration-runner'))`
        );
        await expect(runTenantMigrations({ schema: release, only: [slugs.a] })).rejects.toThrow(
          RunnerBusyError
        );
      } finally {
        await holder.$disconnect();
      }
    }, 60_000);
  });
}
