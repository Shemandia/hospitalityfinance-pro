/**
 * Binding a tenant to work outside a request (WP-A step 7, AUT-05).
 *
 * The shared `prisma` client has no default database: it refuses to run a
 * query unless the current async context names a tenant. Requests get their
 * tenant from the auth plugin. Jobs, workers and scripts get it from here:
 *
 *   await runForTenantId(job.data.tenantId, () => service.doWork());
 *   await forEachActiveTenant((tenant) => sweep(tenant));
 *
 * Each call runs inside its own AsyncLocalStorage scope (runWithContext), so
 * two tenants' work in one process can never see each other's binding.
 */

import { getRequestContext, runWithContext } from "./requestContext.js";
import { listTenants, resolveTenantById, type TenantRecord } from "./tenantRegistry.js";

/** A database call was made with no tenant bound. A programming error; never retried. */
export class TenantNotBoundError extends Error {
  constructor() {
    super(
      "No tenant is bound to this context. Requests bind it through authentication; " +
        "jobs and scripts must use runForTenant (db/tenantScope.ts)."
    );
    this.name = "TenantNotBoundError";
  }
}

/** The tenant a job names is unknown or deactivated. */
export class TenantUnavailableError extends Error {
  constructor(tenantId: string) {
    super(`Tenant ${tenantId} is not an active, provisioned tenant.`);
    this.name = "TenantUnavailableError";
  }
}

type TenantBinding = Pick<TenantRecord, "id" | "slug" | "databaseUrl">;

/** Runs `fn` with `tenant` bound, and nothing else from the caller's context. */
export function runForTenant<T>(tenant: TenantBinding, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDbUrl: tenant.databaseUrl },
    fn
  );
}

/** Resolves the tenant in the registry and runs `fn` with it bound. */
export async function runForTenantId<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const tenant = await resolveTenantById(tenantId);
  if (!tenant || !tenant.isActive) throw new TenantUnavailableError(tenantId);
  return runForTenant(tenant, fn);
}

/**
 * Runs `fn` once per active tenant, each in its own binding. A failure in one
 * tenant does not stop the others; when any failed, the sweep throws an
 * AggregateError after all have run, so the job is reported as failed.
 */
export async function forEachActiveTenant<T>(
  fn: (tenant: TenantRecord) => Promise<T>
): Promise<Array<{ tenantId: string; result: T }>> {
  const results: Array<{ tenantId: string; result: T }> = [];
  const failures: Error[] = [];
  for (const tenant of await listTenants()) {
    try {
      results.push({ tenantId: tenant.id, result: await runForTenant(tenant, () => fn(tenant)) });
    } catch (error) {
      failures.push(
        new Error(`Tenant ${tenant.slug}: ${error instanceof Error ? error.message : error}`, {
          cause: error
        })
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} tenant(s) failed`);
  }
  return results;
}

/** The tenant bound to the current context. Throws when there is none. */
export function currentTenantId(): string {
  const { tenantId } = getRequestContext();
  if (!tenantId) throw new TenantNotBoundError();
  return tenantId;
}
