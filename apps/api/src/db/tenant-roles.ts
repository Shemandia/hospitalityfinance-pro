/**
 * A tenant database's two roles (WP-2 item 2, ARC-08).
 *
 *   hfp_<code>_owner  owns the database and its schema; runs migrations.
 *   hfp_<code>_app    reads and writes rows; nothing else. The API and the
 *                     workers connect as this role.
 *
 * The application role owns no table, so row-level security applies to it
 * whether or not a table forces it, and it cannot change the schema, drop a
 * policy, alter the audit log or read the migration history.
 *
 * The platform role (the registry's, which needs CREATEDB and CREATEROLE but
 * not superuser) creates both roles and the database. Passwords are set as
 * SCRAM verifiers, so they never appear in SQL text. Every step is safe to
 * repeat, so a failed provisioning can be retried.
 *
 * Requires PostgreSQL 16+ (GRANT ... WITH SET).
 */

import { scramSha256Verifier } from "./scram.js";

type Exec = { $executeRawUnsafe(sql: string): Promise<unknown> };
type Query = { $queryRawUnsafe<T = unknown>(sql: string): Promise<T> };
type Transactional = {
  $transaction<T>(fn: (tx: Exec & Query) => Promise<T>): Promise<T>;
};

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Not a safe PostgreSQL identifier: ${name}`);
  return `"${name}"`;
}

export function tenantRoleNames(tenantCode: string): { ownerRole: string; appRole: string } {
  return { ownerRole: `hfp_${tenantCode}_owner`, appRole: `hfp_${tenantCode}_app` };
}

export function tenantDatabaseName(slug: string): string {
  return `hfp_${slug.replace(/-/g, "_")}`;
}

export type TenantDatabaseSpec = {
  dbName: string;
  ownerRole: string;
  ownerPassword: string;
  appRole: string;
  appPassword: string;
};

async function exists(platform: Query, sql: string): Promise<boolean> {
  const rows = await platform.$queryRawUnsafe<Array<{ found: boolean }>>(sql);
  return Boolean(rows[0]?.found);
}

/**
 * Creates (or brings up to date) both roles and the database, as the platform
 * role. The owner owns the database; only the two roles may connect.
 */
export async function createTenantDatabase(
  platform: Exec & Query & Transactional,
  spec: TenantDatabaseSpec
): Promise<void> {
  const db = ident(spec.dbName);
  const owner = ident(spec.ownerRole);
  const app = ident(spec.appRole);

  for (const [role, password] of [
    [spec.ownerRole, spec.ownerPassword],
    [spec.appRole, spec.appPassword]
  ] as const) {
    const verifier = scramSha256Verifier(password);
    const present = await exists(
      platform,
      `select exists (select 1 from pg_roles where rolname = '${role}') as found`
    );
    await platform.$executeRawUnsafe(
      present
        ? `ALTER ROLE ${ident(role)} WITH LOGIN PASSWORD '${verifier}'`
        : `CREATE ROLE ${ident(role)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${verifier}'`
    );
  }

  // CREATE DATABASE ... OWNER needs the platform role to be able to SET ROLE to
  // the owner. It gains nothing else: no inherited rights.
  await platform.$executeRawUnsafe(`GRANT ${owner} TO CURRENT_USER WITH INHERIT FALSE, SET TRUE`);

  const dbPresent = await exists(
    platform,
    `select exists (select 1 from pg_database where datname = '${spec.dbName}') as found`
  );
  if (!dbPresent) {
    await platform.$executeRawUnsafe(`CREATE DATABASE ${db} OWNER ${owner}`);
  }
  // Only the owner may grant on the database: run as the platform role, these
  // statements would merely warn and change nothing, leaving every role on the
  // server able to connect. So run them as the owner, then check the result.
  await platform.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${owner}`);
    await tx.$executeRawUnsafe(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await tx.$executeRawUnsafe(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${app}`);
  });
  const [rights] = await platform.$queryRawUnsafe<Array<{ anyone: boolean; app: boolean }>>(
    `select has_database_privilege('public', '${spec.dbName}', 'CONNECT') as anyone,
            has_database_privilege('${spec.appRole}', '${spec.dbName}', 'CONNECT') as app`
  );
  if (!rights || rights.anyone || !rights.app) {
    throw new Error(
      `Database ${spec.dbName}: connect rights are wrong (anyone: ${rights?.anyone}, application role: ${rights?.app}).`
    );
  }
}

/**
 * Gives the application role its data rights in the tenant database, as the
 * owner: rows of every table, the sequences, the view refresh. Not the audit
 * log's UPDATE or DELETE, not the migration history. Default privileges carry
 * the same rights to tables later migrations create. Safe to repeat; the
 * migration runner repeats it after every deploy.
 */
export async function grantApplicationRole(
  owner: Exec,
  roles: { ownerRole: string; appRole: string }
): Promise<void> {
  const o = ident(roles.ownerRole);
  const a = ident(roles.appRole);
  const statements = [
    `GRANT USAGE ON SCHEMA public TO ${a}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${a}`,
    `GRANT SELECT ON mv_period_account_balances TO ${a}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${a}`,
    `REVOKE ALL ON _prisma_migrations FROM ${a}`,
    `REVOKE UPDATE, DELETE ON audit_events FROM ${a}`,
    `GRANT EXECUTE ON FUNCTION refresh_period_balances() TO ${a}`,
    // The only way the application role may bypass row-level security (SEC-11).
    `GRANT EXECUTE ON FUNCTION app_begin_rls_bypass() TO ${a}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${o} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${a}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${o} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${a}`
  ];
  for (const sql of statements) await owner.$executeRawUnsafe(sql);
}

/**
 * Throws unless the application role has data rights only: it owns nothing
 * (not the database either), cannot create in the schema, cannot change the
 * audit log or read the migration history, cannot reach the bypass grants
 * in schema app_private, and can read a business table. Checked by provisioning
 * before the first user is written.
 */
export async function assertApplicationRoleRights(db: Query, appRole: string): Promise<void> {
  const [row] = await db.$queryRawUnsafe<
    Array<{
      owns: number;
      can_create: boolean;
      audit_update: boolean;
      history: boolean;
      owns_db: boolean;
      bypass_grants: boolean;
      can_read: boolean;
    }>
  >(
    `select
       (select count(*)::int from pg_class c join pg_roles r on r.oid = c.relowner
         where r.rolname = '${appRole}') as owns,
       has_schema_privilege('${appRole}', 'public', 'CREATE') as can_create,
       has_table_privilege('${appRole}', 'audit_events', 'UPDATE') as audit_update,
       has_table_privilege('${appRole}', '_prisma_migrations', 'SELECT') as history,
       (select pg_get_userbyid(datdba) = '${appRole}' from pg_database
         where datname = current_database()) as owns_db,
       has_schema_privilege('${appRole}', 'app_private', 'USAGE') as bypass_grants,
       has_table_privilege('${appRole}', 'journals', 'SELECT') as can_read`
  );
  const problems = [
    row?.owns ? `owns ${row.owns} relations` : "",
    row?.can_create ? "can create in schema public" : "",
    row?.audit_update ? "can update audit_events" : "",
    row?.history ? "can read _prisma_migrations" : "",
    row?.owns_db ? "owns the database" : "",
    row?.bypass_grants ? "can use schema app_private (bypass grants)" : "",
    row?.can_read ? "" : "cannot read journals"
  ].filter(Boolean);
  if (problems.length > 0) {
    throw new Error(`Application role ${appRole} has the wrong rights: ${problems.join("; ")}.`);
  }
}

/**
 * Drops a tenant database and both its roles, as the platform role (for
 * tests, a failed first provisioning, and offboarding after the retention
 * period). The platform role holds the tenant's roles without their rights, so
 * it first takes them: only the owner may drop the database, and ending the
 * application role's open sessions needs that role's rights. Safe to repeat.
 */
export async function dropTenantDatabase(
  platform: Exec & Query,
  names: { dbName: string; ownerRole: string; appRole: string }
): Promise<void> {
  const owner = ident(names.ownerRole);
  const ownerExists = await exists(
    platform,
    `select exists (select 1 from pg_roles where rolname = '${names.ownerRole}') as found`
  );
  // The owner's rights to drop the database; the application role's too, because
  // DROP ... WITH (FORCE) ends that role's open sessions, which needs its rights.
  for (const [role, name] of [
    [owner, names.ownerRole],
    [ident(names.appRole), names.appRole]
  ] as const) {
    const present =
      role === owner
        ? ownerExists
        : await exists(
            platform,
            `select exists (select 1 from pg_roles where rolname = '${name}') as found`
          );
    if (present) {
      await platform.$executeRawUnsafe(`GRANT ${role} TO CURRENT_USER WITH INHERIT TRUE, SET TRUE`);
    }
  }
  await platform.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${ident(names.dbName)} WITH (FORCE)`);
  await platform.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ident(names.appRole)}`);
  await platform.$executeRawUnsafe(`DROP ROLE IF EXISTS ${owner}`);
}
