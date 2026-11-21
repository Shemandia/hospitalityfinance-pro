/**
 * Applying the migrations (WP-2, ARC-03).
 *
 * Registry and tenant databases each have their own schema and migration
 * history: src/db/registry and src/db/tenant. `prisma migrate deploy` applies
 * the pending migrations of one database, in order, and records each in that
 * database's _prisma_migrations table. It never drops data and never prompts.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { childProcessEnv } from "../config.js";

const run = promisify(execFile);

/**
 * The API package's folder: the nearest folder above this file that holds the
 * tenant schema. Found by walking up, so it is the same whether this runs
 * from src/db (tsx) or compiled under dist/.
 */
function findApiRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(resolve(dir, "src/db/tenant/schema.prisma"))) return dir;
    const parent = dirname(dir);
    if (parent === dir)
      throw new Error("Cannot find the API folder (src/db/tenant/schema.prisma).");
    dir = parent;
  }
}

export type SchemaKind = "registry" | "tenant";

export const API_ROOT = findApiRoot();
const srcDb = resolve(API_ROOT, "src/db");

export function schemaPath(kind: SchemaKind): string {
  return resolve(srcDb, kind, "schema.prisma");
}

/**
 * Migration names in the order they apply. The last is the release's version.
 * `schema` names another schema.prisma, whose migrations folder is read
 * instead (tests use it to stand in for a later release).
 */
export function migrationNames(kind: SchemaKind, schema: string = schemaPath(kind)): string[] {
  return readdirSync(resolve(dirname(schema), "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

const URL_VARIABLE: Record<SchemaKind, string> = {
  registry: "REGISTRY_DATABASE_URL",
  tenant: "DATABASE_URL"
};

/**
 * Applies the pending migrations of `kind` to the database at `url`. Throws
 * with Prisma's output when a migration fails.
 */
export async function deployMigrations(
  kind: SchemaKind,
  url: string,
  schema: string = schemaPath(kind)
): Promise<string> {
  const prisma = resolve(API_ROOT, "node_modules/prisma/build/index.js");
  try {
    const { stdout } = await run(
      process.execPath,
      [prisma, "migrate", "deploy", "--schema", schema],
      {
        cwd: API_ROOT,
        env: childProcessEnv({ [URL_VARIABLE[kind]]: url }),
        timeout: 300_000
      }
    );
    return stdout;
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    throw new Error(
      `prisma migrate deploy (${kind}) failed: ${[e.stderr, e.stdout].filter(Boolean).join("\n") || e.message}`
    );
  }
}

type RawQuery = { $queryRawUnsafe<T = unknown>(sql: string): Promise<T> };

/**
 * Throws unless the tenant database at hand has every migration of this
 * release applied and the row-level security functions, policies and audit
 * triggers those migrations create. Provisioning checks it before it writes
 * the first user.
 */
export async function assertTenantSecurity(
  db: RawQuery,
  expected: string[] = migrationNames("tenant")
): Promise<void> {
  const applied = await db.$queryRawUnsafe<Array<{ migration_name: string }>>(
    "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null"
  );
  const have = new Set(applied.map((row) => row.migration_name));
  const pending = expected.filter((name) => !have.has(name));
  if (pending.length > 0) {
    throw new Error(`Tenant database is missing migrations: ${pending.join(", ")}`);
  }
  const [row] = await db.$queryRawUnsafe<
    Array<{ functions: number; policies: number; triggers: number }>
  >(
    `select
       (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('app_current_entity_id', 'app_rls_bypassed',
           'app_begin_rls_bypass', 'app_rls_bypass_granted')) as functions,
       (select count(*)::int from pg_policies where schemaname = 'public') as policies,
       (select count(*)::int from pg_trigger where tgname in
         ('trg_prevent_audit_event_update', 'trg_prevent_audit_event_delete')) as triggers`
  );
  if (!row || row.functions < 4 || row.policies === 0 || row.triggers < 2) {
    throw new Error(
      `Tenant database security is incomplete (functions ${row?.functions}/4, policies ${row?.policies}, audit triggers ${row?.triggers}/2).`
    );
  }
}

/**
 * Marks migrations that failed in the database at `url` as rolled back, so
 * `migrate deploy` will try them again (otherwise it refuses: P3009). Safe for
 * our migrations: Prisma sends each migration file as one multi-statement
 * query, which PostgreSQL runs as one implicit transaction, so a failed one
 * left nothing behind. (A migration that must run outside a transaction, such
 * as CREATE INDEX CONCURRENTLY, needs its own file and care.) Returns the
 * names it marked.
 */
export async function clearFailedMigrations(
  kind: SchemaKind,
  db: RawQuery,
  url: string,
  schema: string = schemaPath(kind)
): Promise<string[]> {
  const failed = await db.$queryRawUnsafe<Array<{ migration_name: string }>>(
    "select migration_name from _prisma_migrations where finished_at is null and rolled_back_at is null"
  );
  const prisma = resolve(API_ROOT, "node_modules/prisma/build/index.js");
  for (const { migration_name } of failed) {
    await run(
      process.execPath,
      [prisma, "migrate", "resolve", "--rolled-back", migration_name, "--schema", schema],
      { cwd: API_ROOT, env: childProcessEnv({ [URL_VARIABLE[kind]]: url }), timeout: 120_000 }
    );
  }
  return failed.map((row) => row.migration_name);
}
