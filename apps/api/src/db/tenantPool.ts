/**
 * Tenant Connection Pool
 *
 * Manages a pool of PrismaClient instances, one per tenant database.
 * Lazily creates clients on first request and caches them.
 *
 * The active tenant's client is stored in AsyncLocalStorage (via requestContext)
 * so that existing code importing `prisma` from prisma.ts automatically uses
 * the correct tenant's database — NO changes needed to services or repositories.
 */

import { PrismaClient } from "./client.js";
import { createEntityScopeExtension } from "./entityScope.js";
import { getRequestContext } from "./requestContext.js";
import { registerRLSMiddleware } from "./rlsMiddleware.js";
import { registerAuditMiddleware } from "./auditMiddleware.js";
import { config } from "../config.js";

// ── Pool (LRU-bounded) ──────────────────────────────────────────────────────

type TenantClient = ReturnType<typeof createTenantClient>;

const maxPoolSize = () => config().TENANT_POOL_MAX;

const pool = new Map<string, TenantClient>();
const lastAccess = new Map<string, number>();

function createTenantClient(databaseUrl: string) {
  const base = new PrismaClient({ datasourceUrl: databaseUrl });

  // RLS first, then audit (audit runs inside the RLS transaction)
  registerRLSMiddleware(base, () => getRequestContext().entityId);
  registerAuditMiddleware(base, () => getRequestContext().entityId);

  // Entity scope extension
  const extended = base.$extends(
    createEntityScopeExtension(() => getRequestContext().entityId ?? null)
  );

  return extended;
}

/**
 * Evict the least-recently-used tenant to make room for a new one.
 */
async function evictLRU(): Promise<void> {
  let oldestSlug: string | null = null;
  let oldestTime = Infinity;

  for (const [slug, time] of lastAccess) {
    if (time < oldestTime) {
      oldestTime = time;
      oldestSlug = slug;
    }
  }

  if (oldestSlug) {
    await evictTenant(oldestSlug);
  }
}

/**
 * Get or create a PrismaClient for a given tenant database URL.
 * Enforces maxPoolSize() by evicting the least-recently-used client.
 */
export function getTenantClient(tenantSlug: string, databaseUrl: string): TenantClient {
  let client = pool.get(tenantSlug);
  if (!client) {
    // Evict LRU if pool is full (fire-and-forget — eviction is async but non-blocking)
    if (pool.size >= maxPoolSize()) {
      void evictLRU();
    }
    client = createTenantClient(databaseUrl);
    pool.set(tenantSlug, client);
  }
  lastAccess.set(tenantSlug, Date.now());
  return client;
}

/**
 * Disconnect all pooled clients (for graceful shutdown).
 */
export async function disconnectAllTenants(): Promise<void> {
  const disconnects = [...pool.entries()].map(async ([, client]) => {
    try {
      await (client as any).$disconnect();
    } catch {
      // best effort
    }
  });
  await Promise.allSettled(disconnects);
  pool.clear();
  lastAccess.clear();
}

/**
 * Remove a specific tenant from the pool (e.g. after deactivation).
 */
export async function evictTenant(tenantSlug: string): Promise<void> {
  const client = pool.get(tenantSlug);
  if (client) {
    try {
      await (client as any).$disconnect();
    } catch {
      // best effort
    }
    pool.delete(tenantSlug);
    lastAccess.delete(tenantSlug);
  }
}

/**
 * Get the number of active connections in the pool.
 */
export function getPoolSize(): number {
  return pool.size;
}
