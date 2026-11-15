/**
 * Adopting a tenant database built before WP-2 (WP-2 item 4, ARC-03).
 *
 * Such a database was built with `db push` and the old setup scripts: it has
 * no migration history, it is owned by the platform role (which the API also
 * uses to connect), and its registry row holds a plain connection string.
 * Adoption gives it exactly what provisioning gives a new tenant, without
 * touching a row of its data:
 *
 *   1. check   build a reference database from the baseline migration and
 *              compare (src/db/catalog.ts). The only difference accepted is
 *              WP-A's legacy role tables, and only when WP-A's copy step has
 *              run; anything else stops adoption.
 *   2. legacy  if present, run WP-A's contract step (drop user_roles,
 *              entity_users, "EntityRole"); compare again: must be identical.
 *   3. roles   create the owner and application roles (new random
 *              passwords, SCRAM verifiers).
 *   4. owner   make the owner role own the database and, object by object,
 *              every table, view, sequence, type and function in it (never
 *              REASSIGN OWNED, which would also hand over the platform
 *              role's other databases).
 *   5. connect only the two roles may connect (run as the owner, verified).
 *   6. history record the baseline as applied (`migrate resolve`), as the
 *              owner.
 *   7. registry location, roles, sealed passwords, schema version
 *              0_baseline; the plain connection string is removed.
 *   8. migrate the migration runner brings the tenant to this release
 *              (later migrations, application role's rights, checks).
 *
 * Every step is safe to repeat, so a stopped adoption can be run again.
 * `dryRun` performs step 1 only.
 */

import { readFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "./client.js";
import { PrismaClient as RegistryClient } from "./registry-client.js";
import { childProcessEnv, registryDatabaseUrl } from "../config.js";
import { catalogLines, diffCatalogs, type CatalogDiff } from "./catalog.js";
import { API_ROOT, deployMigrations, migrationNames, schemaPath } from "./migrate.js";
import { randomPassword, scramSha256Verifier } from "./scram.js";
import { splitSqlStatements } from "./sql-split.js";
import { hasRoles, ownerConnectionUrl, postgresUrl } from "./tenant-location.js";
import { tenantRoleNames } from "./tenant-roles.js";
import { runTenantMigrations } from "./tenant-runner.js";
import { seal } from "../shared/secret-box.js";

const run = promisify(execFile);
const BASELINE = "0_baseline";
const LEGACY_CONTRACT = resolve(
  API_ROOT,
  "src/db/tenant/legacy/20261114000000_drop_legacy_role_tables.sql"
);
/** WP-A's legacy role objects: the one difference adoption accepts (then removes). */
const LEGACY_LINE =
  /^(table|column|constraint|index): (user_roles|entity_users)\b|^index: CREATE (UNIQUE )?INDEX \S+ ON public\.(user_roles|entity_users) |^enum: EntityRole /;

export type AdoptionReport = {
  slug: string;
  steps: string[];
  diff: CatalogDiff;
  legacy: boolean;
  adopted: boolean;
};

export class AdoptionRefused extends Error {
  constructor(
    message: string,
    readonly diff?: CatalogDiff
  ) {
    super(message);
    this.name = "AdoptionRefused";
  }
}

const quote = (name: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
};

async function withDb<T>(url: string, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

const lines = (url: string) => withDb(url, (db) => catalogLines((sql) => db.$queryRawUnsafe(sql)));

/** The catalog a database built from the baseline migration alone has. */
async function baselineCatalog(platformUrl: string, code: string): Promise<string[]> {
  const name = `hfp_adopt_ref_${code}`;
  const maintenance = new URL(platformUrl);
  maintenance.pathname = "/postgres";
  const refUrl = new URL(platformUrl);
  refUrl.pathname = `/${name}`;
  // A release folder holding the baseline only.
  const dir = mkdtempSync(join(tmpdir(), "hfp-baseline-"));
  try {
    cpSync(dirname(schemaPath("tenant")), dir, {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(dirname(schemaPath("tenant")).length);
        return (
          !rel.startsWith("/migrations/") ||
          rel.startsWith(`/migrations/${BASELINE}`) ||
          rel === "/migrations/migration_lock.toml"
        );
      }
    });
    return await withDb(maintenance.toString(), async (admin) => {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
      await admin.$executeRawUnsafe(`CREATE DATABASE ${quote(name)}`);
      try {
        await deployMigrations("tenant", refUrl.toString(), join(dir, "schema.prisma"));
        return await lines(refUrl.toString());
      } finally {
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Objects in public owned by `role`, as ALTER ... OWNER statements to `owner`. */
async function ownershipStatements(
  db: PrismaClient,
  role: string,
  owner: string
): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ sql: string }>>(
    `select format('ALTER %s %s OWNER TO %I',
              case c.relkind when 'r' then 'TABLE' when 'p' then 'TABLE' when 'v' then 'VIEW'
                             when 'm' then 'MATERIALIZED VIEW' when 'S' then 'SEQUENCE' end,
              format('%I.%I', n.nspname, c.relname), '${owner}') as sql
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
        and pg_get_userbyid(c.relowner) = '${role}'
        -- A sequence owned by a table column moves with its table.
        and not (c.relkind = 'S' and exists (select 1 from pg_depend d
              where d.objid = c.oid and d.deptype in ('a', 'i') and d.refobjsubid > 0))
     union all
     select format('ALTER TYPE %I.%I OWNER TO %I', n.nspname, t.typname, '${owner}')
       from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype in ('e', 'd') and pg_get_userbyid(t.typowner) = '${role}'
     union all
     select format('ALTER FUNCTION %s OWNER TO %I', p.oid::regprocedure, '${owner}')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and pg_get_userbyid(p.proowner) = '${role}'`
  );
  return rows.map((r) => r.sql);
}

export async function adoptTenant(
  slug: string,
  options: { dryRun?: boolean; log?: (line: string) => void } = {}
): Promise<AdoptionReport> {
  const log = options.log ?? (() => {});
  const steps: string[] = [];
  const step = (text: string) => {
    steps.push(text);
    log(`  ${text}`);
  };
  const registry = new RegistryClient({ datasourceUrl: registryDatabaseUrl() });
  try {
    const registryVersion = await registry
      .$queryRawUnsafe<
        Array<{ migration_name: string }>
      >("select migration_name from _prisma_migrations where finished_at is not null")
      .catch(() => []);
    const needed = migrationNames("registry");
    if (!needed.every((name) => registryVersion.some((r) => r.migration_name === name))) {
      throw new AdoptionRefused(
        "Adopt the registry first (db:adopt registry): it is not at this release's registry schema."
      );
    }
    const tenant = await registry.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new AdoptionRefused(`No tenant ${slug} in the registry.`);
    if (hasRoles(tenant) && !tenant.databaseUrl) {
      throw new AdoptionRefused(`${slug} is already adopted (it has owner and application roles).`);
    }
    if (!tenant.databaseUrl) throw new AdoptionRefused(`${slug} has no database location.`);

    // The platform role: the legacy connection string's, which owns the database.
    const platformUrl = tenant.databaseUrl;
    const location = new URL(platformUrl);
    const dbName = decodeURIComponent(location.pathname.slice(1));
    const platformRole = decodeURIComponent(location.username);
    const { ownerRole, appRole } = tenantRoleNames(tenant.tenantCode);

    // ── 1. check ──────────────────────────────────────────────────────────
    const expected = await baselineCatalog(platformUrl, tenant.tenantCode);
    const actual = await lines(platformUrl);
    const diff = diffCatalogs(expected, actual);
    const unexpected = {
      missing: diff.missing,
      extra: diff.extra.filter((line) => !LEGACY_LINE.test(line))
    };
    const legacy = diff.extra.length > unexpected.extra.length;
    step(
      `check: ${actual.length} catalog lines; ${diff.missing.length} missing, ${diff.extra.length} extra` +
        (legacy ? " (WP-A legacy role tables)" : "")
    );
    if (unexpected.missing.length + unexpected.extra.length > 0) {
      throw new AdoptionRefused(
        `${dbName} differs from the baseline beyond WP-A's legacy role tables; nothing was changed.`,
        unexpected
      );
    }
    if (legacy) {
      const copied = await withDb(platformUrl, (db) =>
        db.$queryRawUnsafe<Array<{ c: string | null }>>(
          "select obj_description('role_assignments'::regclass, 'pg_class') as c"
        )
      );
      if (!copied[0]?.c?.startsWith("legacy grants copied")) {
        throw new AdoptionRefused(
          `${dbName} still has WP-A's legacy role tables and their grants were never copied into role_assignments (src/db/tenant/legacy/20261111000000_role_assignments.sql); nothing was changed.`
        );
      }
    }
    if (options.dryRun) {
      step("dry run: stopped before any change");
      return { slug, steps, diff, legacy, adopted: false };
    }

    // ── 2. legacy ─────────────────────────────────────────────────────────
    if (legacy) {
      const statements = splitSqlStatements(readFileSync(LEGACY_CONTRACT, "utf8"));
      await withDb(platformUrl, (db) =>
        db.$transaction(async (tx) => {
          for (const sql of statements) await tx.$executeRawUnsafe(sql);
        })
      );
      const again = diffCatalogs(expected, await lines(platformUrl));
      if (again.missing.length + again.extra.length > 0) {
        throw new AdoptionRefused(`${dbName} still differs after WP-A's contract step.`, again);
      }
      step(
        'legacy: dropped user_roles, entity_users and "EntityRole" (WP-A contract step); now identical to the baseline'
      );
    }

    // ── 3. roles ──────────────────────────────────────────────────────────
    const ownerPassword = randomPassword();
    const appPassword = randomPassword();
    await withDb(platformUrl, async (db) => {
      for (const [role, password] of [
        [ownerRole, ownerPassword],
        [appRole, appPassword]
      ] as const) {
        const verifier = scramSha256Verifier(password);
        const exists = await db.$queryRawUnsafe<Array<{ n: number }>>(
          `select count(*)::int as n from pg_roles where rolname = '${role}'`
        );
        await db.$executeRawUnsafe(
          exists[0]?.n
            ? `ALTER ROLE ${quote(role)} WITH LOGIN PASSWORD '${verifier}'`
            : `CREATE ROLE ${quote(role)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}'`
        );
      }
      await db.$executeRawUnsafe(
        `GRANT ${quote(ownerRole)} TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`
      );
    });
    step(`roles: ${ownerRole} (owner), ${appRole} (application), new passwords`);

    // ── 4. owner ──────────────────────────────────────────────────────────
    let moved = 0;
    await withDb(platformUrl, async (db) => {
      await db.$executeRawUnsafe(`ALTER DATABASE ${quote(dbName)} OWNER TO ${quote(ownerRole)}`);
      const statements = await ownershipStatements(db, platformRole, ownerRole);
      await db.$transaction(
        async (tx) => {
          for (const sql of statements) await tx.$executeRawUnsafe(sql);
        },
        { timeout: 120_000 }
      );
      moved = statements.length;
      const [left] = await db.$queryRawUnsafe<Array<{ n: number }>>(
        `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and pg_get_userbyid(c.relowner) <> '${ownerRole}'`
      );
      if (left?.n)
        throw new Error(`${left.n} relations in ${dbName} are still not owned by ${ownerRole}.`);
    });
    step(`owner: ${dbName} and ${moved} objects now owned by ${ownerRole}`);

    const port = Number(location.port || "5432");
    const ownerUrl = postgresUrl(location.hostname, port, dbName, ownerRole, ownerPassword);

    // ── 5. connect ────────────────────────────────────────────────────────
    await withDb(ownerUrl, async (db) => {
      await db.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${quote(dbName)} FROM PUBLIC`);
      await db.$executeRawUnsafe(
        `GRANT CONNECT, TEMPORARY ON DATABASE ${quote(dbName)} TO ${quote(appRole)}`
      );
      const [rights] = await db.$queryRawUnsafe<Array<{ anyone: boolean; app: boolean }>>(
        `select has_database_privilege('public', '${dbName}', 'CONNECT') as anyone,
                has_database_privilege('${appRole}', '${dbName}', 'CONNECT') as app`
      );
      if (!rights || rights.anyone || !rights.app) {
        throw new Error(`Connect rights on ${dbName} are wrong after the revoke.`);
      }
    });
    step(`connect: PUBLIC may no longer connect to ${dbName}; ${appRole} may (and the owner)`);

    // ── 6. history ────────────────────────────────────────────────────────
    const prisma = resolve(API_ROOT, "node_modules/prisma/build/index.js");
    const recorded = await withDb(ownerUrl, (db) =>
      db
        .$queryRawUnsafe<
          Array<{ n: number }>
        >(`select count(*)::int as n from _prisma_migrations where migration_name = '${BASELINE}'`)
        .catch(() => [{ n: 0 }])
    );
    if (!recorded[0]?.n) {
      await run(
        process.execPath,
        [prisma, "migrate", "resolve", "--applied", BASELINE, "--schema", schemaPath("tenant")],
        { cwd: API_ROOT, env: childProcessEnv({ DATABASE_URL: ownerUrl }), timeout: 120_000 }
      );
    }
    step(`history: ${BASELINE} recorded as applied (no SQL run)`);

    // ── 7. registry ───────────────────────────────────────────────────────
    await registry.tenant.update({
      where: { id: tenant.id },
      data: {
        dbHost: location.hostname,
        dbPort: port,
        dbName,
        ownerRole,
        ownerPasswordEnc: seal(ownerPassword),
        appRole,
        appPasswordEnc: seal(appPassword),
        schemaVersion: BASELINE,
        databaseUrl: null
      }
    });
    step(
      "registry: location, roles and sealed passwords recorded; plain connection string removed"
    );

    // ── 8. migrate ────────────────────────────────────────────────────────
    const result = await runTenantMigrations({ only: [slug] });
    const outcome = result.outcomes[0];
    if (!result.ok || outcome?.status !== "SUCCEEDED") {
      throw new Error(
        `Migration after adoption failed: ${outcome?.detail ?? outcome?.status ?? "no outcome"}`
      );
    }
    step(
      `migrate: ${BASELINE} -> ${result.target} (${migrationNames("tenant").slice(1).join(", ")}), application role's rights granted and checked`
    );

    // Owner connection works with the sealed password, from the registry.
    const adopted = await registry.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    await withDb(ownerConnectionUrl(adopted), (db) => db.$queryRawUnsafe("select 1"));
    return { slug, steps, diff, legacy, adopted: true };
  } finally {
    await registry.$disconnect();
  }
}

/**
 * Adopts the registry database itself (before any tenant): checks it against
 * the registry baseline, records the baseline as applied, then applies the
 * later registry migrations. Safe to repeat.
 */
export async function adoptRegistry(
  options: { dryRun?: boolean; log?: (line: string) => void } = {}
): Promise<{ steps: string[]; diff: CatalogDiff }> {
  const log = options.log ?? (() => {});
  const steps: string[] = [];
  const step = (text: string) => {
    steps.push(text);
    log(`  ${text}`);
  };
  const url = registryDatabaseUrl();
  const history = await withDb(url, (db) =>
    db
      .$queryRawUnsafe<
        Array<{ migration_name: string }>
      >("select migration_name from _prisma_migrations")
      .catch(() => null)
  );
  let diff: CatalogDiff = { missing: [], extra: [] };
  if (history === null) {
    // No history: compare with a database built from the registry baseline.
    const name = `hfp_adopt_ref_registry`;
    const maintenance = new URL(url);
    maintenance.pathname = "/postgres";
    const refUrl = new URL(url);
    refUrl.pathname = `/${name}`;
    const dir = mkdtempSync(join(tmpdir(), "hfp-registry-baseline-"));
    try {
      const src = dirname(schemaPath("registry"));
      cpSync(src, dir, {
        recursive: true,
        filter: (p) => {
          const rel = p.slice(src.length);
          return (
            !rel.startsWith("/migrations/") ||
            rel.startsWith(`/migrations/${BASELINE}`) ||
            rel === "/migrations/migration_lock.toml"
          );
        }
      });
      const expected = await withDb(maintenance.toString(), async (admin) => {
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
        await admin.$executeRawUnsafe(`CREATE DATABASE ${quote(name)}`);
        try {
          await deployMigrations("registry", refUrl.toString(), join(dir, "schema.prisma"));
          return await lines(refUrl.toString());
        } finally {
          await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
        }
      });
      diff = diffCatalogs(expected, await lines(url));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    step(
      `check: ${diff.missing.length} missing, ${diff.extra.length} extra against the registry baseline`
    );
    if (diff.missing.length + diff.extra.length > 0) {
      throw new AdoptionRefused(
        "The registry differs from its baseline; nothing was changed.",
        diff
      );
    }
  } else {
    step(`check: the registry already has a migration history (${history.length} applied)`);
  }
  if (options.dryRun) {
    step("dry run: stopped before any change");
    return { steps, diff };
  }
  if (history === null) {
    const prisma = resolve(API_ROOT, "node_modules/prisma/build/index.js");
    await run(
      process.execPath,
      [prisma, "migrate", "resolve", "--applied", BASELINE, "--schema", schemaPath("registry")],
      { cwd: API_ROOT, env: childProcessEnv({ REGISTRY_DATABASE_URL: url }), timeout: 120_000 }
    );
    step(`history: ${BASELINE} recorded as applied (no SQL run)`);
  }
  await deployMigrations("registry", url);
  step(`migrate: registry at ${migrationNames("registry").at(-1)}`);
  return { steps, diff };
}
