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

import { Prisma, PrismaClient, type Prisma as PrismaNamespace } from "@prisma/client";
import { createEntityScopeExtension } from "./entityScope.js";
import { serializeForAudit } from "./auditSerialization.js";
import { getRequestContext, runWithAuditDisabled } from "./requestContext.js";
import { getTenantClient } from "./tenantPool.js";

const AUDIT_MODELS = new Set([
  "Supplier",
  "Journal",
  "JournalLine",
  "Account",
  "APInvoice",
  "APInvoiceLine",
  "PaymentRun",
  "PaymentRunItem",
  "PaymentRunInvoice",
  "PurchaseOrder",
  "GoodsReceivedNote",
  "ARInvoice",
  "APPayment",
  "APPaymentAllocation"
]);

const AUDIT_ACTIONS = new Set(["create", "update", "delete", "upsert"]);

let fallbackEntityContext: string | null = null;

// ── Default client (registry DB / dev fallback) ─────────────────────────────

const baseClient = new PrismaClient();

function getEntityFromContext(): string | null {
  return getRequestContext().entityId ?? fallbackEntityContext;
}

function resolveResourceId(record: unknown, args: unknown): string {
  if (record && typeof record === "object" && "id" in (record as Record<string, unknown>)) {
    const id = (record as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  if (args && typeof args === "object" && "where" in (args as Record<string, unknown>)) {
    const where = (args as { where?: Record<string, unknown> }).where;
    if (where && typeof where.id === "string") return where.id;
  }
  return "unknown";
}

async function findPreviousState(
  client: PrismaClient,
  params: PrismaNamespace.MiddlewareParams
): Promise<unknown> {
  if (!params.model || !params.args || typeof params.args !== "object") return null;
  const delegate = (client as unknown as Record<string, unknown>)[
    params.model.charAt(0).toLowerCase() + params.model.slice(1)
  ] as
    | {
        findFirst?: (input: unknown) => Promise<unknown>;
        findUnique?: (input: unknown) => Promise<unknown>;
      }
    | undefined;
  if (!delegate) return null;
  const argsObject = params.args as { where?: Record<string, unknown> };
  const where = argsObject.where;
  if (!where) return null;
  if ("id" in where && delegate.findUnique) {
    return runWithAuditDisabled(() => delegate.findUnique!({ where }));
  }
  if (delegate.findFirst) {
    return runWithAuditDisabled(() => delegate.findFirst!({ where }));
  }
  return null;
}

baseClient.$use(async (params, next) => {
  const context = getRequestContext();
  const entityId = context.entityId ?? fallbackEntityContext;
  const modelName = params.model;
  if (
    context.disableAudit ||
    !modelName ||
    modelName === "AuditEvent" ||
    modelName === "Tenant" ||
    !AUDIT_MODELS.has(modelName) ||
    !AUDIT_ACTIONS.has(params.action) ||
    !entityId
  ) {
    return next(params);
  }
  const beforeState = await findPreviousState(baseClient, params);
  const result = await next(params);
  await runWithAuditDisabled(async () => {
    await baseClient.auditEvent.create({
      data: {
        entityId,
        userId: context.userId,
        eventType: params.action.toUpperCase(),
        resourceType: modelName.toLowerCase(),
        resourceId: resolveResourceId(result, params.args),
        beforeState: serializeForAudit(beforeState) as Prisma.InputJsonValue,
        afterState: serializeForAudit(result) as Prisma.InputJsonValue,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
      }
    });
  });
  return result;
});

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
