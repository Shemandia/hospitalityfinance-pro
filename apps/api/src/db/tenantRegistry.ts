/**
 * Tenant Registry Client
 *
 * Connects to the shared registry database (REGISTRY_DATABASE_URL) to look up
 * tenant configuration. In dev mode, falls back to the main DATABASE_URL.
 *
 * The registry holds ONLY the `tenants` table. All financial data lives in
 * each tenant's own database (tenant.databaseUrl).
 */

import { PrismaClient } from "./registry-client.js";
import { registryDatabaseUrlIfSet } from "../config.js";

export type TenantRecord = {
  id: string;
  slug: string;
  tenantCode: string;
  name: string;
  databaseUrl: string;
  domain: string | null;
  adminEmail: string;
  plan: string;
  maxProperties: number;
  isActive: boolean;
  provisionedAt: Date | null;
};

// Registry client — connects to the shared registry DB

let registryClient: PrismaClient | null = null;

export function getRegistryClient(): PrismaClient {
  if (!registryClient) {
    registryClient = new PrismaClient({
      datasourceUrl: registryDatabaseUrlIfSet()
    });
  }
  return registryClient;
}

// ── In-memory cache (refreshed periodically) ──────────────────────────────────

const tenantCache = new Map<string, TenantRecord>();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

async function refreshCache(): Promise<void> {
  const client = getRegistryClient();
  const tenants = await client.tenant.findMany({
    where: { isActive: true, provisionedAt: { not: null } }
  });

  tenantCache.clear();
  for (const t of tenants) {
    tenantCache.set(t.slug, t);
    if (t.tenantCode) {
      tenantCache.set(t.tenantCode, t);
    }
    if (t.domain) {
      tenantCache.set(t.domain, t);
    }
  }
  cacheLoadedAt = Date.now();
}

function isCacheStale(): boolean {
  return Date.now() - cacheLoadedAt > CACHE_TTL_MS;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve a tenant by slug or domain. Returns null if not found or inactive.
 */
export async function resolveTenant(slugOrDomain: string): Promise<TenantRecord | null> {
  if (isCacheStale()) {
    await refreshCache();
  }
  return tenantCache.get(slugOrDomain) ?? null;
}

/**
 * Resolve a tenant by its 8-char opaque tenant code.
 */
export async function resolveTenantByCode(tenantCode: string): Promise<TenantRecord | null> {
  if (isCacheStale()) {
    await refreshCache();
  }
  return tenantCache.get(tenantCode) ?? null;
}

/**
 * Resolve tenant by ID.
 */
export async function resolveTenantById(id: string): Promise<TenantRecord | null> {
  if (isCacheStale()) {
    await refreshCache();
  }
  for (const t of tenantCache.values()) {
    if (t.id === id) return t;
  }
  return null;
}

/**
 * List all active tenants.
 */
export async function listTenants(): Promise<TenantRecord[]> {
  if (isCacheStale()) {
    await refreshCache();
  }
  // Deduplicate (cache has both slug and domain keys)
  const seen = new Set<string>();
  const result: TenantRecord[] = [];
  for (const t of tenantCache.values()) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      result.push(t);
    }
  }
  return result;
}

/**
 * Force refresh the tenant cache (e.g. after provisioning a new tenant).
 */
export async function invalidateTenantCache(): Promise<void> {
  cacheLoadedAt = 0;
  await refreshCache();
}

/**
 * Disconnect the registry client (for graceful shutdown).
 */
export async function disconnectRegistry(): Promise<void> {
  if (registryClient) {
    await registryClient.$disconnect();
    registryClient = null;
  }
}
