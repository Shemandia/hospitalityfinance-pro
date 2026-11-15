/**
 * Creating a tenant's database (WP-2 item 2): location, roles, migrations and
 * rights. Used by tenant provisioning and the provisioning scripts, so every
 * tenant database is built one way.
 *
 *   planTenantDatabase   names, fresh passwords (sealed for the registry)
 *   createDatabase       both roles and the database, as the platform role
 *   migrateDatabase      the tenant migrations, as the owner
 *   secureDatabase       the application role's rights, then checks that the
 *                        security objects exist and the role has data rights only
 */

import { PrismaClient } from "../../db/client.js";
import { config, registryDatabaseUrl } from "../../config.js";
import { assertTenantSecurity, deployMigrations, migrationNames } from "../../db/migrate.js";
import { randomPassword } from "../../db/scram.js";
import {
  appConnectionUrl,
  ownerConnectionUrl,
  type NewLocation
} from "../../db/tenant-location.js";
import {
  assertApplicationRoleRights,
  createTenantDatabase,
  grantApplicationRole,
  tenantDatabaseName,
  tenantRoleNames
} from "../../db/tenant-roles.js";
import { open, seal } from "../../shared/secret-box.js";

/** Where tenant databases live: TENANT_DB_HOST/PORT, else the registry's server. */
function tenantServer(): { host: string; port: number } {
  const registry = new URL(registryDatabaseUrl());
  const settings = config();
  return {
    host: settings.TENANT_DB_HOST ?? registry.hostname,
    port: Number(settings.TENANT_DB_PORT ?? (registry.port || "5432"))
  };
}

/**
 * The platform role's connection to the tenant server: the registry's role, on
 * the maintenance database. It creates roles and databases; it never reads
 * tenant data.
 */
function platformAdminUrl(): string {
  const url = new URL(registryDatabaseUrl());
  const server = tenantServer();
  url.hostname = server.host;
  url.port = String(server.port);
  url.pathname = "/postgres";
  return url.toString();
}

/** The registry fields for a new tenant database: names and sealed fresh passwords. */
export function planTenantDatabase(slug: string, tenantCode: string): NewLocation {
  const { ownerRole, appRole } = tenantRoleNames(tenantCode);
  const server = tenantServer();
  return {
    dbHost: server.host,
    dbPort: server.port,
    dbName: tenantDatabaseName(slug),
    ownerRole,
    ownerPasswordEnc: seal(randomPassword()),
    appRole,
    appPasswordEnc: seal(randomPassword())
  };
}

const asLocation = (l: NewLocation) => ({ ...l, databaseUrl: null });

/** Connection strings for a planned location. In memory only. */
export function tenantUrls(location: NewLocation): { owner: string; app: string } {
  return {
    owner: ownerConnectionUrl(asLocation(location)),
    app: appConnectionUrl(asLocation(location))
  };
}

async function withClient<T>(url: string, fn: (db: PrismaClient) => Promise<T>): Promise<T> {
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    return await fn(db);
  } finally {
    await db.$disconnect();
  }
}

/** Creates (or updates) both roles and the database. Safe to repeat. */
export async function createDatabase(location: NewLocation): Promise<void> {
  await withClient(platformAdminUrl(), (platform) =>
    createTenantDatabase(platform, {
      dbName: location.dbName,
      ownerRole: location.ownerRole,
      ownerPassword: open(location.ownerPasswordEnc),
      appRole: location.appRole,
      appPassword: open(location.appPasswordEnc)
    })
  );
}

/** Applies the tenant migrations as the owner. Returns the schema version. */
export async function migrateDatabase(location: NewLocation): Promise<string> {
  await deployMigrations("tenant", tenantUrls(location).owner);
  return migrationNames("tenant").at(-1)!;
}

/**
 * Grants the application role its rights, then refuses to go on unless the
 * migrations' security objects are there and the role has data rights only.
 */
export async function secureDatabase(location: NewLocation): Promise<void> {
  await withClient(tenantUrls(location).owner, async (owner) => {
    await grantApplicationRole(owner, location);
    await assertTenantSecurity(owner);
    await assertApplicationRoleRights(owner, location.appRole);
  });
}
