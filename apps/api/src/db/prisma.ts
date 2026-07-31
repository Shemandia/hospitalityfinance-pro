/**
 * Prisma Client — Tenant-Aware
 *
 * Exports `prisma` which resolves per-request to the correct tenant's database.
 * When a tenant context is set (via requestContext), it uses the tenant pool.
 * Otherwise it falls back to the default DATABASE_URL (dev database).
 *
 * Existing code that imports `prisma` works unchanged — the proxy transparently
 * routes to the correct PrismaClient based on the current request context.
 *
 * Two distinct Prisma clients:
 * - Tenant client (from schema-tenant.prisma): business data models
 * - Registry client (from schema-registry.prisma): tenant management models
 */

import { PrismaClient as TenantPrismaClient } from "./generated/tenant/index.js";
import { PrismaClient as RegistryPrismaClient } from "./generated/registry/index.js";
import { createEntityScopeExtension } from "./entityScope.js";
import { getRequestContext } from "./requestContext.js";
import { getTenantClient } from "./tenantPool.js";
import { registerRLSMiddleware } from "./rlsMiddleware.js";
import { registerAuditMiddleware } from "./auditMiddleware.js";

let fallbackEntityContext: string | null = null;

// ── Default tenant client (dev fallback) ───────────────────────────────────

const baseClient = new TenantPrismaClient();

function getEntityFromContext(): string | null {
  return getRequestContext().entityId ?? fallbackEntityContext;
}

// Order matters: RLS middleware wraps writes in a transaction that sets
// app.current_entity_id.  Audit middleware runs INSIDE that transaction
// so it inherits the RLS context and can write audit_events.
registerRLSMiddleware(baseClient, () => getEntityFromContext());
registerAuditMiddleware(baseClient, () => getEntityFromContext());

export function setEntityContext(entityId: string | null): void {
  fallbackEntityContext = entityId;
}

const defaultClient = baseClient.$extends(createEntityScopeExtension(() => getEntityFromContext()));

// ── Registry client (shared registry DB) ───────────────────────────────────

const registryBaseClient = new RegistryPrismaClient({
  datasourceUrl: process.env.REGISTRY_DATABASE_URL ?? process.env.DATABASE_URL
});

// ── Tenant-aware proxy ──────────────────────────────────────────────────────
// When tenantSlug + tenantDbUrl are set in request context, route to that
// tenant's PrismaClient. Otherwise use the default (dev) client.

type PrismaLike = typeof defaultClient;

/** @deprecated No longer needed — context is now scoped via AsyncLocalStorage.run() */
export function setActiveTenant(_slug: string | null, _dbUrl: string | null): void {
  // No-op: tenant context is now scoped via AsyncLocalStorage.run()
}

function getActiveTenant(): { slug: string; dbUrl: string } | null {
  const context = getRequestContext();
  if (context.tenantSlug && context.tenantDbUrl) {
    return { slug: context.tenantSlug, dbUrl: context.tenantDbUrl };
  }
  return null;
}

export const prisma: PrismaLike = new Proxy(defaultClient, {
  get(target, prop, receiver) {
    // Non-configurable properties on the target must return the target's own
    // value — the JS Proxy invariant enforces this.  Prisma's internal
    // `_extensions` (and potentially others) are non-configurable, so we must
    // check the descriptor before delegating to a tenant client.
    const desc = Object.getOwnPropertyDescriptor(target, prop);
    if (desc && !desc.configurable) {
      return Reflect.get(target, prop, receiver);
    }

    const tenant = getActiveTenant();
    if (tenant) {
      const tenantClient = getTenantClient(tenant.slug, tenant.dbUrl);
      return Reflect.get(tenantClient, prop, tenantClient);
    }
    return Reflect.get(target, prop, receiver);
  }
}) as PrismaLike;

/**
 * Direct access to the registry client (bypasses tenant routing).
 * Used by tenant management, provisioning, and platform admin endpoints.
 */
export const registryPrisma = registryBaseClient;
