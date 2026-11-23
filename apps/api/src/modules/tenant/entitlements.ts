/**
 * A tenant's limits (WP-2 item 8, HC-35, HC-37, HC-40): the only reader of
 * plans and entitlements.
 *
 * The effective value of each limit is the tenant's own exception, else its
 * plan's. Upload size and import concurrency may be unset in both, meaning
 * the platform setting (UPLOAD_MAX_MB, IMPORT_CONCURRENCY); the platform
 * setting is also their ceiling, because it protects the server: a plan can
 * lower it, never raise it.
 */
import { registryPrisma } from "../../db/prisma.js";
import { config } from "../../config.js";
import { moduleLogger } from "../../shared/logger.js";

const log = moduleLogger("entitlements");

export type PlanLimits = {
  code: string;
  maxProperties: number;
  maxUsers: number;
  maxConcurrentSessions: number;
  enabledModules: string[];
  uploadMaxMb: number | null;
  importConcurrency: number | null;
};

export type EntitlementExceptions = {
  maxProperties: number | null;
  maxUsers: number | null;
  maxConcurrentSessions: number | null;
  /** Empty: as the plan. */
  enabledModules: string[];
  uploadMaxMb: number | null;
  importConcurrency: number | null;
};

export type PlatformCeilings = { uploadMaxMb: number; importConcurrency: number };

export type Entitlements = {
  plan: string;
  maxProperties: number;
  maxUsers: number;
  maxConcurrentSessions: number;
  enabledModules: string[];
  uploadMaxMb: number;
  /** In bytes, for comparing with a request body. */
  uploadMaxBytes: number;
  importConcurrency: number;
};

export class NoDefaultPlanError extends Error {
  constructor() {
    super("The registry has no active default plan.");
    this.name = "NoDefaultPlanError";
  }
}

/** The limits that apply, from the plan, the tenant's exceptions and the platform. */
export function effectiveEntitlements(
  plan: PlanLimits,
  own: EntitlementExceptions,
  platform: PlatformCeilings
): Entitlements {
  const capped = (value: number | null, ceiling: number) => Math.min(value ?? ceiling, ceiling);
  const uploadMaxMb = capped(own.uploadMaxMb ?? plan.uploadMaxMb, platform.uploadMaxMb);
  return {
    plan: plan.code,
    maxProperties: own.maxProperties ?? plan.maxProperties,
    maxUsers: own.maxUsers ?? plan.maxUsers,
    maxConcurrentSessions: own.maxConcurrentSessions ?? plan.maxConcurrentSessions,
    enabledModules: own.enabledModules.length > 0 ? own.enabledModules : plan.enabledModules,
    uploadMaxMb,
    uploadMaxBytes: uploadMaxMb * 1024 * 1024,
    importConcurrency: capped(
      own.importConcurrency ?? plan.importConcurrency,
      platform.importConcurrency
    )
  };
}

const cache = new Map<string, { value: Entitlements; until: number }>();

/**
 * The tenant's limits, cached for ENTITLEMENT_CACHE_SECONDS. A tenant with no
 * entitlement row gets the default plan, the rule registry migration 3_plans
 * applied to every tenant (provisioning always writes one, so a missing row
 * is logged); never the platform maximum outright. Throws NoDefaultPlanError
 * when there is no default plan either.
 */
export async function tenantEntitlements(tenantId: string): Promise<Entitlements> {
  const hit = cache.get(tenantId);
  if (hit && hit.until > Date.now()) return hit.value;
  const row = await registryPrisma.tenantEntitlement.findUnique({
    where: { tenantId },
    include: { plan: true }
  });
  const cfg = config();
  let plan = row?.plan;
  if (!plan) {
    log.warn({ tenantId }, "Tenant has no entitlement; using the default plan");
    plan =
      (await registryPrisma.plan.findFirst({ where: { isDefault: true, isActive: true } })) ??
      undefined;
    if (!plan) throw new NoDefaultPlanError();
  }
  const own: EntitlementExceptions = row ?? {
    maxProperties: null,
    maxUsers: null,
    maxConcurrentSessions: null,
    enabledModules: [],
    uploadMaxMb: null,
    importConcurrency: null
  };
  const value = effectiveEntitlements(plan, own, {
    uploadMaxMb: cfg.UPLOAD_MAX_MB,
    importConcurrency: cfg.IMPORT_CONCURRENCY
  });
  cache.set(tenantId, { value, until: Date.now() + cfg.ENTITLEMENT_CACHE_SECONDS * 1000 });
  return value;
}

/** Drops a tenant's cached limits (after a change), or all of them. */
export function forgetEntitlements(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/**
 * What a new tenant's entitlement stores, given its plan and the limits asked
 * for: only the values that differ from the plan.
 */
export function exceptionsFrom(
  plan: PlanLimits,
  asked: Partial<Omit<EntitlementExceptions, "enabledModules">> & { enabledModules?: string[] }
): EntitlementExceptions {
  const differs = (value: number | null | undefined, planValue: number | null) =>
    value === undefined || value === null || value === planValue ? null : value;
  const sameModules =
    asked.enabledModules === undefined ||
    (asked.enabledModules.length === plan.enabledModules.length &&
      asked.enabledModules.every((m) => plan.enabledModules.includes(m)));
  return {
    maxProperties: differs(asked.maxProperties, plan.maxProperties),
    maxUsers: differs(asked.maxUsers, plan.maxUsers),
    maxConcurrentSessions: differs(asked.maxConcurrentSessions, plan.maxConcurrentSessions),
    enabledModules: sameModules ? [] : [...(asked.enabledModules ?? [])],
    uploadMaxMb: differs(asked.uploadMaxMb, plan.uploadMaxMb),
    importConcurrency: differs(asked.importConcurrency, plan.importConcurrency)
  };
}

/** The active plans, for the platform administrator. */
export function activePlans() {
  return registryPrisma.plan.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
}

/** An active plan by its code, or null. */
export function activePlan(code: string) {
  return registryPrisma.plan.findFirst({ where: { code, isActive: true } });
}
