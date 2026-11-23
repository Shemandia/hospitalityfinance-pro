/**
 * Where a tenant database is, and how to connect to it (WP-2, ARC-06).
 *
 * The registry keeps host, port, database name and two roles per tenant, with
 * the roles' passwords sealed (shared/secret-box.ts). A connection string is
 * built from them only in memory, when a connection is about to be made.
 *
 * Tenants provisioned before WP-2 still have a plain-text database_url; it is
 * used as is until the tenant is adopted (WP-2 item 4).
 */

import { open } from "../shared/secret-box.js";

export type TenantLocation = {
  databaseUrl: string | null;
  dbHost: string | null;
  dbPort: number | null;
  dbName: string | null;
  ownerRole: string | null;
  ownerPasswordEnc: string | null;
  appRole: string | null;
  appPasswordEnc: string | null;
};

/** The registry fields of a new location (the passwords already sealed). */
export type NewLocation = {
  dbHost: string;
  dbPort: number;
  dbName: string;
  ownerRole: string;
  ownerPasswordEnc: string;
  appRole: string;
  appPasswordEnc: string;
};

export function postgresUrl(
  host: string,
  port: number,
  database: string,
  role: string,
  password: string
): string {
  // Every part is set below; the placeholder host is replaced.
  const url = new URL("postgresql://placeholder.invalid");
  url.hostname = host;
  url.port = String(port);
  url.pathname = `/${encodeURIComponent(database)}`;
  url.username = encodeURIComponent(role);
  url.password = encodeURIComponent(password);
  return url.toString();
}

/** True when the tenant has the WP-2 location (owner and application roles). */
export function hasRoles(t: TenantLocation): t is TenantLocation & NewLocation {
  return Boolean(
    t.dbHost &&
    t.dbPort &&
    t.dbName &&
    t.ownerRole &&
    t.ownerPasswordEnc &&
    t.appRole &&
    t.appPasswordEnc
  );
}

/**
 * The connection string the API and the workers use: the application role's,
 * or a pre-WP-2 tenant's stored database_url.
 */
export function appConnectionUrl(t: TenantLocation): string {
  if (hasRoles(t)) {
    return postgresUrl(t.dbHost, t.dbPort, t.dbName, t.appRole, open(t.appPasswordEnc));
  }
  if (t.databaseUrl) return t.databaseUrl;
  throw new Error("The tenant has no database location.");
}

/** The owner's connection string, for migrations and grants. Never for requests. */
export function ownerConnectionUrl(t: TenantLocation): string {
  if (!hasRoles(t)) {
    throw new Error("The tenant has no owner role yet (provisioned before WP-2).");
  }
  return postgresUrl(t.dbHost, t.dbPort, t.dbName, t.ownerRole, open(t.ownerPasswordEnc));
}

export type RuntimeConnection = {
  /** Most connections the client opens (Prisma `connection_limit`). */
  connectionLimit: number;
  /** The connection pooler; unset to connect directly. */
  poolerHost?: string;
  /** The pooler's port; defaults to the database's. */
  poolerPort?: number;
};

/**
 * The connection string requests and jobs use: the application role's, routed
 * through the pooler when there is one, with a small per-client connection
 * limit. Only for transaction-scoped work: settings made with
 * set_config(..., true) survive a transaction-mode pooler, session settings
 * and session advisory locks do not (docs/CONNECTION-POOLER.md). Migrations,
 * adoption and provisioning use the direct connection strings above.
 */
export function runtimeConnectionUrl(direct: string, options: RuntimeConnection): string {
  const url = new URL(direct);
  if (options.poolerHost) {
    url.hostname = options.poolerHost;
    if (options.poolerPort) url.port = String(options.poolerPort);
  }
  url.searchParams.set("connection_limit", String(options.connectionLimit));
  return url.toString();
}
