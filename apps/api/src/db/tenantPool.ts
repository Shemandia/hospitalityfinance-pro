/**
 * Tenant database clients, one per tenant, kept per process (ARC-04).
 *
 * - Each client connects as the tenant's application role, through the
 *   connection pooler when TENANT_DB_POOLER_HOST is set, and opens at most
 *   TENANT_CONNECTION_LIMIT connections (runtimeConnectionUrl).
 * - At most TENANT_POOL_MAX clients stay open. To make room, the least
 *   recently used client with no work in flight is closed; a client running a
 *   query or a transaction is never closed under it. When every client is
 *   busy the pool grows past the limit for a while and says so in the log.
 * - getTenantClient returns a handle, not the client itself: every use of the
 *   handle resolves the tenant's live client, so code that holds a handle
 *   across a long pause (a job between two queries) carries on with a fresh
 *   client after an eviction instead of reviving a closed one.
 *
 * Requests reach this through `prisma` (prisma.ts), which binds the tenant
 * from the request context. docs/CONNECTION-POOLER.md.
 */

import { PrismaClient } from "./client.js";
import { createEntityScopeExtension } from "./entityScope.js";
import { getRequestContext } from "./requestContext.js";
import { registerRLSMiddleware } from "./rlsMiddleware.js";
import { registerAuditMiddleware } from "./auditMiddleware.js";
import { config } from "../config.js";
import { cachedTenant } from "./tenantRegistry.js";
import { assertSchemaServiceable } from "./schema-version.js";
import { runtimeConnectionUrl } from "./tenant-location.js";
import { moduleLogger } from "../shared/logger.js";

const log = moduleLogger("tenant-pool");

type Entry = {
  client: TenantClient;
  /** Queries and transactions running now. */
  inFlight: number;
  lastAccess: number;
};

type TenantClient = ReturnType<typeof createTenantClient>;

const pool = new Map<string, Entry>();

function createTenantClient(databaseUrl: string, entry: { inFlight: number }) {
  const cfg = config();
  const base = new PrismaClient({
    datasourceUrl: runtimeConnectionUrl(databaseUrl, {
      connectionLimit: cfg.TENANT_CONNECTION_LIMIT,
      poolerHost: cfg.TENANT_DB_POOLER_HOST,
      poolerPort: cfg.TENANT_DB_POOLER_PORT
    })
  });

  // RLS first, then audit (audit runs inside the RLS transaction)
  registerRLSMiddleware(base, () => getRequestContext().entityId);
  registerAuditMiddleware(base, () => getRequestContext().entityId);

  return base
    .$extends(createEntityScopeExtension(() => getRequestContext().entityId ?? null))
    .$extends({
      query: {
        // Counts every model operation and raw query, inside transactions too.
        async $allOperations({ args, query }) {
          entry.inFlight++;
          try {
            return await query(args);
          } finally {
            entry.inFlight--;
          }
        }
      }
    });
}

/** Closes a client once nothing runs on it, waiting up to `waitMs`. */
async function closeWhenIdle(slug: string, entry: Entry, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (entry.inFlight > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (entry.inFlight > 0) {
    log.warn(
      { tenant: slug, inFlight: entry.inFlight },
      "Closing a tenant client with work still running"
    );
  }
  try {
    await entry.client.$disconnect();
  } catch (error) {
    log.warn({ tenant: slug, err: error }, "Tenant client did not disconnect cleanly");
  }
}

/** Closes idle clients, least recently used first, until there is room for one more. */
function makeRoom(): void {
  const max = config().TENANT_POOL_MAX;
  while (pool.size >= max) {
    let oldest: [string, Entry] | undefined;
    for (const item of pool) {
      if (item[1].inFlight === 0 && (!oldest || item[1].lastAccess < oldest[1].lastAccess)) {
        oldest = item;
      }
    }
    if (!oldest) {
      log.warn(
        { open: pool.size, max },
        "Every tenant client is busy; opening one past TENANT_POOL_MAX"
      );
      return;
    }
    const [slug, entry] = oldest;
    pool.delete(slug);
    void closeWhenIdle(slug, entry, 30_000);
  }
}

function liveEntry(tenantSlug: string, databaseUrl: string): Entry {
  let entry = pool.get(tenantSlug);
  if (!entry) {
    makeRoom();
    const counter = { inFlight: 0, lastAccess: Date.now() } as Entry;
    counter.client = createTenantClient(databaseUrl, counter);
    entry = counter;
    pool.set(tenantSlug, entry);
  }
  entry.lastAccess = Date.now();
  return entry;
}

/** One handle per tenant, and the connection string its next client uses. */
const handles = new Map<string, TenantClient>();
const urls = new Map<string, string>();

function handleFor(tenantSlug: string): TenantClient {
  const live = () => liveEntry(tenantSlug, urls.get(tenantSlug) ?? "");
  return new Proxy({} as TenantClient, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      const entry = live();
      const value: unknown = Reflect.get(entry.client, prop, entry.client);
      if (prop !== "$transaction" || typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        entry.inFlight++;
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(entry.client, args);
        } finally {
          entry.inFlight--;
        }
      };
    },
    has(_target, prop) {
      return prop in live().client;
    }
  });
}

/**
 * The tenant's database client: the same handle for the same tenant. Every
 * use resolves the live client, and `$transaction` counts as work in flight
 * for its whole duration.
 */
export function getTenantClient(tenantSlug: string, databaseUrl: string): TenantClient {
  // Last line of defence behind the request and job checks: no connection to
  // a tenant whose database is behind this release's schema.
  const known = cachedTenant(tenantSlug);
  if (known) assertSchemaServiceable(known);
  // A new connection string (a password reset) takes effect with the next client.
  urls.set(tenantSlug, databaseUrl);
  // Opens the client now, as before; the handle re-resolves it on each use.
  liveEntry(tenantSlug, databaseUrl);
  let handle = handles.get(tenantSlug);
  if (!handle) {
    handle = handleFor(tenantSlug);
    handles.set(tenantSlug, handle);
  }
  return handle;
}

/** Disconnects every client (graceful shutdown), after its running work. */
export async function disconnectAllTenants(): Promise<void> {
  const entries = [...pool.entries()];
  pool.clear();
  handles.clear();
  await Promise.allSettled(entries.map(([slug, entry]) => closeWhenIdle(slug, entry, 10_000)));
}

/**
 * Removes a tenant's client (after deactivation or a password reset). New work
 * gets a new client at once; the old one closes when its running work ends.
 */
export async function evictTenant(tenantSlug: string): Promise<void> {
  // Later callers get a new handle; one already held keeps working.
  handles.delete(tenantSlug);
  const entry = pool.get(tenantSlug);
  if (!entry) return;
  pool.delete(tenantSlug);
  await closeWhenIdle(tenantSlug, entry, 30_000);
}

/** Open tenant clients. */
export function getPoolSize(): number {
  return pool.size;
}

/** Queries and transactions running on a tenant's client (for tests and monitoring). */
export function inFlight(tenantSlug: string): number {
  return pool.get(tenantSlug)?.inFlight ?? 0;
}
