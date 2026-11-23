/**
 * Backups of every tenant database and of the registry (WP-2 item 9, OPS-07).
 *
 *   runBackups      one dump per provisioned tenant (as its owner role), then
 *                   one of the registry; each recorded in database_backups.
 *                   Carries on past a failed database; the run fails if any did.
 *   pruneBackups    deletes successful backups older than the retention
 *                   period, never the newest successful one of a database.
 *   restoreBackup   loads a dump into a new database beside the live one and
 *                   checks every table's row count against the manifest; then
 *                   drops it, unless asked to keep it. It never writes to a
 *                   live database.
 *
 * Layout under BACKUP_DIR (folders 0700, files 0600):
 *
 *   tenants/<slug>/<slug>-<UTC time>.dump  and  .dump.json (the manifest)
 *   registry/registry-<UTC time>.dump      and  .dump.json
 *
 * Only one backup run at a time (a PostgreSQL advisory lock on the registry).
 * Point-in-time recovery of the whole server and the copy off the server are
 * the hosting's part: docs/GO-LIVE-RUNBOOK.md, section 3.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { PrismaClient } from "./client.js";
import { PrismaClient as RegistryClient } from "./registry-client.js";
import { config, registryDatabaseUrl } from "../config.js";
import {
  assertDumpIntact,
  compareRowCounts,
  databaseName,
  dumpDatabase,
  onDatabase,
  restoreDump,
  restoredRowCounts,
  singleConnectionUrl,
  type BackupManifest,
  type BackupTargetKind,
  type RowDifference
} from "./backup.js";
import { hasRoles, ownerConnectionUrl } from "./tenant-location.js";
import { dropDatabaseForce, ident } from "./tenant-roles.js";
import { platformAdminUrl } from "../modules/tenant/tenant-database.js";

const LOCK_KEY = "hfp:backup-runner";
export const REGISTRY_LABEL = "registry";

export class BackupBusyError extends Error {
  constructor() {
    super("Another backup run holds the lock; try again when it has finished.");
    this.name = "BackupBusyError";
  }
}

/** The backup folder: the option, else BACKUP_DIR. */
export function backupDir(dir?: string): string {
  const value = dir ?? config().BACKUP_DIR;
  if (!value) throw new Error("BACKUP_DIR is not set: there is nowhere to write backups.");
  return resolve(value);
}

/** A path from the registry, resolved under the backup folder; refuses one outside it. */
function underDir(dir: string, file: string): string {
  const full = resolve(dir, file);
  if (full !== dir && !full.startsWith(dir + sep)) {
    throw new Error(`${file} is outside the backup folder.`);
  }
  return full;
}

/** 2026-11-23T02:30:00.123Z -> 20261123T023000123Z (sorts, and is safe in a file name). */
function stamp(at: Date): string {
  return at.toISOString().replace(/[-:.]/g, "");
}

export type BackupOutcome = {
  label: string;
  target: BackupTargetKind;
  status: "SUCCEEDED" | "FAILED";
  /** Relative to the backup folder. */
  file?: string;
  detail?: string;
};

export type BackupOptions = {
  dir?: string;
  /** Only these tenant slugs. */
  only?: string[];
  /** Back up the registry as well (default true). */
  registry?: boolean;
  log?: (line: string) => void;
};

export type BackupRunResult = { runId: string; outcomes: BackupOutcome[]; ok: boolean };

type Job = {
  target: BackupTargetKind;
  label: string;
  tenantId: string | null;
  schemaVersion: string | null;
  /** Null when the database cannot be backed up; `skip` says why. */
  url: string | null;
  skip?: string;
};

export async function runBackups(options: BackupOptions = {}): Promise<BackupRunResult> {
  const log = options.log ?? (() => {});
  const dir = backupDir(options.dir);
  const registryUrl = registryDatabaseUrl();
  const registry = new RegistryClient({ datasourceUrl: singleConnectionUrl(registryUrl) });

  try {
    const [lock] = await registry.$queryRawUnsafe<Array<{ locked: boolean }>>(
      `select pg_try_advisory_lock(hashtext('${LOCK_KEY}')) as locked`
    );
    if (!lock?.locked) throw new BackupBusyError();

    try {
      const runId = randomUUID();
      log(`Backup run ${runId} into ${dir}`);
      await mkdir(dir, { recursive: true, mode: 0o700 });

      const tenants = await registry.tenant.findMany({
        where: {
          provisionedAt: { not: null },
          ...(options.only ? { slug: { in: options.only } } : {})
        },
        orderBy: { createdAt: "asc" }
      });
      const jobs: Job[] = tenants.map((t) =>
        hasRoles(t)
          ? {
              target: "TENANT",
              label: t.slug,
              tenantId: t.id,
              schemaVersion: t.schemaVersion,
              url: ownerConnectionUrl(t)
            }
          : {
              target: "TENANT",
              label: t.slug,
              tenantId: t.id,
              schemaVersion: t.schemaVersion,
              url: null,
              skip: "built before WP-2: there is no owner role to back it up as; adopt it first (db:adopt)"
            }
      );
      // Last, so the registry's dump records this run's tenant backups.
      if (options.registry !== false) {
        jobs.push({
          target: "REGISTRY",
          label: REGISTRY_LABEL,
          tenantId: null,
          schemaVersion: null,
          url: registryUrl
        });
      }

      const outcomes: BackupOutcome[] = [];
      for (const job of jobs) {
        const startedAt = new Date();
        const folder = job.target === "REGISTRY" ? "registry" : join("tenants", job.label);
        const file = join(folder, `${job.label}-${stamp(startedAt)}.dump`);
        const row = await registry.databaseBackup.create({
          data: {
            runId,
            target: job.target,
            tenantId: job.tenantId,
            label: job.label,
            dbName: job.url ? databaseName(job.url) : "",
            schemaVersion: job.schemaVersion,
            file,
            status: "RUNNING",
            startedAt
          }
        });
        try {
          if (!job.url) throw new Error(job.skip);
          await mkdir(join(dir, folder), { recursive: true, mode: 0o700 });
          const manifest = await dumpDatabase({
            url: job.url,
            target: job.target,
            label: job.label,
            schemaVersion: job.schemaVersion,
            file: join(dir, file),
            bypassRls: job.target === "TENANT"
          });
          await registry.databaseBackup.update({
            where: { id: row.id },
            data: {
              status: "SUCCEEDED",
              sizeBytes: BigInt(manifest.sizeBytes),
              sha256: manifest.sha256,
              rowCounts: manifest.rowCounts,
              finishedAt: new Date()
            }
          });
          outcomes.push({ label: job.label, target: job.target, status: "SUCCEEDED", file });
          const rows = Object.values(manifest.rowCounts).reduce((a, b) => a + b, 0);
          log(`  ✓ ${job.label}: ${file} (${manifest.sizeBytes} bytes, ${rows} rows)`);
        } catch (error) {
          const detail = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
          await registry.databaseBackup.update({
            where: { id: row.id },
            data: { status: "FAILED", error: detail, finishedAt: new Date() }
          });
          outcomes.push({ label: job.label, target: job.target, status: "FAILED", detail });
          log(`  ✗ ${job.label}: ${detail.split("\n")[0]}`);
        }
      }
      return { runId, outcomes, ok: outcomes.every((o) => o.status === "SUCCEEDED") };
    } finally {
      await registry.$queryRawUnsafe(`select pg_advisory_unlock(hashtext('${LOCK_KEY}'))`);
    }
  } finally {
    await registry.$disconnect();
  }
}

export type PruneOptions = {
  dir?: string;
  /** Default BACKUP_RETENTION_DAYS; with neither, nothing is pruned. */
  retentionDays?: number;
  now?: Date;
  log?: (line: string) => void;
};

/**
 * Deletes the files of successful backups older than the retention period and
 * marks them PRUNED. The newest successful backup of each database is kept
 * however old it is. Returns the pruned backups' files.
 */
export async function pruneBackups(options: PruneOptions = {}): Promise<string[]> {
  const log = options.log ?? (() => {});
  const days = options.retentionDays ?? config().BACKUP_RETENTION_DAYS;
  if (!days) return [];
  const dir = backupDir(options.dir);
  const cutoff = new Date((options.now ?? new Date()).getTime() - days * 86_400_000);
  const registry = new RegistryClient({ datasourceUrl: registryDatabaseUrl() });
  try {
    const old = await registry.databaseBackup.findMany({
      where: { status: "SUCCEEDED", startedAt: { lt: cutoff } }
    });
    const pruned: string[] = [];
    for (const backup of old) {
      const newest = await registry.databaseBackup.findFirst({
        where: { label: backup.label, target: backup.target, status: "SUCCEEDED" },
        orderBy: { startedAt: "desc" }
      });
      if (!newest || newest.id === backup.id) continue;
      const file = underDir(dir, backup.file);
      await rm(file, { force: true });
      await rm(`${file}.json`, { force: true });
      await registry.databaseBackup.update({
        where: { id: backup.id },
        data: { status: "PRUNED", prunedAt: new Date() }
      });
      pruned.push(backup.file);
      log(`  - pruned ${backup.file}`);
    }
    return pruned;
  } finally {
    await registry.$disconnect();
  }
}

export type RestoreOptions = {
  /** The database to create and restore into; it must not exist and must start with hfp_. */
  into?: string;
  /** Keep the restored database instead of dropping it after the check. */
  keep?: boolean;
  log?: (line: string) => void;
};

export type RestoreResult = {
  database: string;
  differences: RowDifference[];
  tables: number;
  rows: number;
  ok: boolean;
  kept: boolean;
};

const RESTORE_NAME = /^hfp_[a-z0-9_]{1,59}$/;

async function readManifest(path: string): Promise<BackupManifest> {
  const manifest = JSON.parse(await readFile(path, "utf8")) as BackupManifest;
  if (manifest.format !== 1 || !manifest.file || !manifest.rowCounts) {
    throw new Error(`${path} is not a backup manifest.`);
  }
  return manifest;
}

/**
 * Restores the backup whose manifest is `manifestPath` into a new database on
 * the tenant server and compares every table's row count with the manifest.
 *
 * A tenant backup is restored as the tenant's owner role (from the registry),
 * so the copy has the live database's owner, policies and grants; nobody but
 * the owner may connect to it. The registry backup is restored as the
 * registry's role.
 */
export async function restoreBackup(
  manifestPath: string,
  options: RestoreOptions = {}
): Promise<RestoreResult> {
  const log = options.log ?? (() => {});
  const manifest = await readManifest(manifestPath);
  const file = join(dirname(resolve(manifestPath)), manifest.file);
  await assertDumpIntact(file, manifest);

  const suffix = stamp(new Date()).toLowerCase();
  const database =
    options.into ??
    `hfp_restore_${manifest.label.replace(/-/g, "_")}`.slice(0, 63 - suffix.length - 1) +
      `_${suffix}`;
  if (!RESTORE_NAME.test(database)) {
    throw new Error(`${database}: a restore database is named hfp_ followed by a-z, 0-9 or _.`);
  }

  // As whom the copy is created, loaded and read.
  let role: string;
  let roleUrl: string;
  if (manifest.target === "TENANT") {
    const registry = new RegistryClient({ datasourceUrl: registryDatabaseUrl() });
    try {
      const tenant = await registry.tenant.findUnique({ where: { slug: manifest.label } });
      if (!tenant || !hasRoles(tenant)) {
        throw new Error(`Tenant ${manifest.label} has no owner role in the registry.`);
      }
      role = tenant.ownerRole;
      roleUrl = ownerConnectionUrl(tenant);
    } finally {
      await registry.$disconnect();
    }
  } else {
    roleUrl = registryDatabaseUrl();
    role = decodeURIComponent(new URL(roleUrl).username);
  }
  const bypassRls = manifest.target === "TENANT";

  const platform = new PrismaClient({ datasourceUrl: singleConnectionUrl(platformAdminUrl()) });
  try {
    const [present] = await platform.$queryRawUnsafe<Array<{ found: boolean }>>(
      `select exists (select 1 from pg_database where datname = '${database}') as found`
    );
    if (present?.found) throw new Error(`Database ${database} already exists; choose another.`);

    const platformRole = decodeURIComponent(new URL(platformAdminUrl()).username);
    const asOwner = role !== platformRole;
    if (asOwner) {
      // As in provisioning: the right to create the database for the owner, and nothing else.
      await platform.$executeRawUnsafe(
        `GRANT ${ident(role)} TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`
      );
    }
    await platform.$executeRawUnsafe(`CREATE DATABASE ${ident(database)} OWNER ${ident(role)}`);
    log(`Created ${database} (owner ${role}).`);
    let kept = false;
    try {
      await platform.$transaction(async (tx) => {
        if (asOwner) await tx.$executeRawUnsafe(`SET LOCAL ROLE ${ident(role)}`);
        await tx.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${ident(database)} FROM PUBLIC`);
      });

      const target = onDatabase(roleUrl, database);
      log(`Restoring ${manifest.file} ...`);
      await restoreDump(file, target, { bypassRls });
      const actual = await restoredRowCounts(target, bypassRls);
      const differences = compareRowCounts(manifest.rowCounts, actual);
      const tables = Object.keys(manifest.rowCounts).length;
      const rows = Object.values(manifest.rowCounts).reduce((a, b) => a + b, 0);
      kept = Boolean(options.keep);
      return { database, differences, tables, rows, ok: differences.length === 0, kept };
    } finally {
      if (!kept) {
        // Dropped as the owner (SET ROLE), so the platform role never takes the owner's rights.
        if (asOwner) await platform.$executeRawUnsafe(`SET ROLE ${ident(role)}`);
        try {
          await dropDatabaseForce(platform, ident(database));
        } finally {
          if (asOwner) await platform.$executeRawUnsafe(`RESET ROLE`);
        }
        log(`Dropped ${database}.`);
      }
    }
  } finally {
    await platform.$disconnect();
  }
}
