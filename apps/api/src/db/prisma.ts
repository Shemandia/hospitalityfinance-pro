/**
 * Prisma Client — Tenant-Aware
 *
 * Exports `prisma` which resolves per-request to the correct tenant's database.
 * When a tenant context is set (via requestContext), it uses the tenant pool.
 * Otherwise it falls back to the default DATABASE_URL (registry/dev database).
 *
 * Existing code that imports `prisma` works unchanged — the proxy transparently
 * routes to the correct PrismaClient based on the current request context.
 */

import { PrismaClient } from "@prisma/client";
import { createEntityScopeExtension } from "./entityScope.js";
import { getRequestContext } from "./requestContext.js";
import { getTenantClient } from "./tenantPool.js";
import { registerAuditMiddleware } from "./auditMiddleware.js";

let fallbackEntityContext: string | null = null;

// ── Default client (registry DB / dev fallback) ─────────────────────────────

const baseClient = new PrismaClient();

function getEntityFromContext(): string | null {
  return getRequestContext().entityId ?? fallbackEntityContext;
}

registerAuditMiddleware(baseClient, () => getEntityFromContext());

export function setEntityContext(entityId: string | null): void {
  fallbackEntityContext = entityId;
}

const defaultClient = baseClient.$extends(createEntityScopeExtension(() => getEntityFromContext()));

// ── Tenant-aware proxy ──────────────────────────────────────────────────────
// When tenantSlug + tenantDbUrl are set in request context, route to that
// tenant's PrismaClient. Otherwise use the default (registry/dev) client.

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
 * Direct access to the registry/default client (bypasses tenant routing).
 * Used by tenant management endpoints and health checks.
 */
export const registryPrisma = defaultClient;
