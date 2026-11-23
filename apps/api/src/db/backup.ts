/**
 * Dumping and restoring one PostgreSQL database (WP-2 item 9, OPS-07).
 *
 * A dump is taken with pg_dump (custom format) inside a REPEATABLE READ
 * transaction that first exports its snapshot and counts the rows of every
 * table; pg_dump is then pointed at that snapshot (--snapshot). The counts in
 * the manifest are therefore exactly the rows in the dump, and a restore is
 * checked against them table by table.
 *
 * Tenant databases force row-level security on the owner too, so a tenant
 * dump runs as the owner role with app.bypass_rls set (the owner may set it;
 * migration 2_rls_bypass_by_function) and --enable-row-security. Without the
 * setting pg_dump would see no rows of an entity table; the restore check
 * would then fail rather than pass on an incomplete backup.
 *
 * Passwords reach pg_dump and pg_restore through PGPASSWORD, never on the
 * command line. Dumps and manifests are written mode 0600.
 */

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "./client.js";
import { childProcessEnv, config } from "../config.js";

export type BackupTargetKind = "TENANT" | "REGISTRY";

/** Rows per table: `schema.table` -> count. */
export type RowCounts = Record<string, number>;

/** What a dump holds; written beside it as `<dump>.json`. */
export type BackupManifest = {
  format: 1;
  target: BackupTargetKind;
  /** The tenant's slug, or "registry". */
  label: string;
  dbName: string;
  schemaVersion: string | null;
  /** The dump's file name, in the manifest's folder. */
  file: string;
  sizeBytes: number;
  sha256: string;
  rowCounts: RowCounts;
  serverVersion: string;
  startedAt: string;
  finishedAt: string;
};

export type RowDifference = { table: string; expected: number | null; actual: number | null };

type Query = { $queryRawUnsafe<T = unknown>(sql: string): Promise<T> };

const minutes = (n: number) => n * 60_000;

/** A connection string with one connection, so session settings stay on it. */
export function singleConnectionUrl(url: string): string {
  const u = new URL(url);
  u.searchParams.set("connection_limit", "1");
  return u.toString();
}

/** A connection string for another database on the same server, as the same role. */
export function onDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Every table's row count, in the caller's transaction. Materialized views are derived: left out. */
export async function countRows(db: Query): Promise<RowCounts> {
  const tables = await db.$queryRawUnsafe<Array<{ schema: string; name: string }>>(
    `select n.nspname as schema, c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname not like 'pg\\_toast%' and n.nspname not like 'pg\\_temp%'
      order by 1, 2`
  );
  const counts: RowCounts = {};
  for (const t of tables) {
    const [row] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from ${quoteIdent(t.schema)}.${quoteIdent(t.name)}`
    );
    counts[`${t.schema}.${t.name}`] = Number(row?.n ?? 0);
  }
  return counts;
}

/** Tables whose counts differ, or that only one side has. */
export function compareRowCounts(expected: RowCounts, actual: RowCounts): RowDifference[] {
  const tables = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  return tables
    .filter((t) => expected[t] !== actual[t])
    .map((t) => ({ table: t, expected: expected[t] ?? null, actual: actual[t] ?? null }));
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function toolPath(tool: "pg_dump" | "pg_restore"): string {
  const dir = config().PG_BIN_DIR;
  return dir ? join(dir, tool) : tool;
}

/** The major version of pg_dump or pg_restore, e.g. 18. */
export async function pgToolMajor(tool: "pg_dump" | "pg_restore"): Promise<number> {
  const { stdout } = await promisify(execFile)(toolPath(tool), ["--version"]);
  const match = /\(PostgreSQL\)\s+(\d+)/.exec(stdout);
  if (!match) throw new Error(`Could not read the version of ${tool}: ${stdout.trim()}`);
  return Number(match[1]);
}

/**
 * pg_restore writes settings of its own version (pg_restore 17 and later set
 * transaction_timeout), which an older server rejects. A restore therefore
 * needs a pg_restore no newer than the server; pg_dump only needs to be at
 * least as new as the server it reads.
 */
export async function assertRestoreToolFits(serverMajor: number): Promise<void> {
  const tool = await pgToolMajor("pg_restore");
  if (tool > serverMajor) {
    throw new Error(
      `pg_restore is version ${tool}, the server ${serverMajor}: restore with pg_restore ${serverMajor} (set PG_BIN_DIR to its folder).`
    );
  }
}

/**
 * Runs pg_dump or pg_restore against `url`. The connection details go in the
 * environment (PGPASSWORD included), not on the command line. Rejects with
 * the tool's own error output on a non-zero exit or after `timeoutMs`.
 */
export function runPgTool(
  tool: "pg_dump" | "pg_restore",
  url: string,
  args: string[],
  options: { bypassRls: boolean; timeoutMs: number }
): Promise<void> {
  const u = new URL(url);
  const env = childProcessEnv({
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: databaseName(url),
    PGCONNECT_TIMEOUT: "15",
    ...(u.searchParams.get("sslmode") ? { PGSSLMODE: u.searchParams.get("sslmode")! } : {}),
    PGOPTIONS: options.bypassRls ? "-c app.bypass_rls=true" : ""
  });
  return new Promise((resolve, reject) => {
    const child = spawn(toolPath(tool), ["--no-password", ...args], {
      env,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${tool} took longer than ${Math.round(options.timeoutMs / 60_000)} min.`));
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`${tool} could not be started (${error.message}); set PG_BIN_DIR.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${tool} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

export type DumpRequest = {
  /** A role that can read every row: the tenant's owner role, or the registry's role. */
  url: string;
  target: BackupTargetKind;
  label: string;
  schemaVersion: string | null;
  /** Where the dump goes; the manifest is written to `<file>.json`. */
  file: string;
  /** Tenant databases: set app.bypass_rls for the dump and the counts. */
  bypassRls: boolean;
  timeoutMs?: number;
};

/** Dumps one database and writes its manifest. Nothing is left behind on failure. */
export async function dumpDatabase(request: DumpRequest): Promise<BackupManifest> {
  const timeoutMs = request.timeoutMs ?? minutes(config().BACKUP_TIMEOUT_MINUTES);
  const partial = `${request.file}.partial`;
  const startedAt = new Date().toISOString();
  const db = new PrismaClient({ datasourceUrl: singleConnectionUrl(request.url) });
  try {
    const { rowCounts, serverVersion } = await db.$transaction(
      async (tx) => {
        if (request.bypassRls) {
          await tx.$queryRawUnsafe(`select set_config('app.bypass_rls', 'true', true)`);
        }
        const [snap] = await tx.$queryRawUnsafe<Array<{ id: string; version: string }>>(
          `select pg_export_snapshot() as id, current_setting('server_version') as version`
        );
        const rowCounts = await countRows(tx);
        await runPgTool(
          "pg_dump",
          request.url,
          [
            "--format=custom",
            `--snapshot=${snap!.id}`,
            `--file=${partial}`,
            ...(request.bypassRls ? ["--enable-row-security"] : [])
          ],
          { bypassRls: request.bypassRls, timeoutMs }
        );
        return { rowCounts, serverVersion: snap!.version };
      },
      { isolationLevel: "RepeatableRead", timeout: timeoutMs + 60_000, maxWait: 30_000 }
    );
    await chmod(partial, 0o600);
    await rename(partial, request.file);
    const manifest: BackupManifest = {
      format: 1,
      target: request.target,
      label: request.label,
      dbName: databaseName(request.url),
      schemaVersion: request.schemaVersion,
      file: basename(request.file),
      sizeBytes: (await stat(request.file)).size,
      sha256: await sha256File(request.file),
      rowCounts,
      serverVersion,
      startedAt,
      finishedAt: new Date().toISOString()
    };
    await writeFile(`${request.file}.json`, `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: 0o600
    });
    return manifest;
  } catch (error) {
    await rm(partial, { force: true });
    await rm(request.file, { force: true });
    await rm(`${request.file}.json`, { force: true });
    throw error;
  } finally {
    await db.$disconnect();
  }
}

/** Refuses a dump whose size or checksum is not the manifest's. */
export async function assertDumpIntact(file: string, manifest: BackupManifest): Promise<void> {
  const size = (await stat(file)).size;
  if (size !== manifest.sizeBytes) {
    throw new Error(`${file}: ${size} bytes, the manifest says ${manifest.sizeBytes}.`);
  }
  const sha = await sha256File(file);
  if (sha !== manifest.sha256) {
    throw new Error(`${file}: the checksum is not the manifest's; the file is damaged.`);
  }
}

/**
 * Loads a dump into an existing, empty database as `url`'s role, in one
 * transaction: on any error nothing is loaded. Objects end up owned by that
 * role.
 */
export async function restoreDump(
  file: string,
  url: string,
  options: { bypassRls: boolean; timeoutMs?: number }
): Promise<void> {
  await runPgTool(
    "pg_restore",
    url,
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      // pg_restore turns row security off by default; for the owner of a
      // tenant database, whose tables force it, every policed statement
      // (the materialized view refresh at the end) would then fail. With it
      // on and app.bypass_rls set, the owner's policies let every row through.
      ...(options.bypassRls ? ["--enable-row-security"] : []),
      `--dbname=${databaseName(url)}`,
      file
    ],
    {
      bypassRls: options.bypassRls,
      timeoutMs: options.timeoutMs ?? minutes(config().BACKUP_TIMEOUT_MINUTES)
    }
  );
}

/** Row counts of a restored database, read the way the dump read them. */
export async function restoredRowCounts(url: string, bypassRls: boolean): Promise<RowCounts> {
  const db = new PrismaClient({ datasourceUrl: singleConnectionUrl(url) });
  try {
    return await db.$transaction(
      async (tx) => {
        if (bypassRls) {
          await tx.$queryRawUnsafe(`select set_config('app.bypass_rls', 'true', true)`);
        }
        return countRows(tx);
      },
      { isolationLevel: "RepeatableRead", timeout: minutes(30) }
    );
  } finally {
    await db.$disconnect();
  }
}
