/**
 * Materialized View Refresh Job
 *
 * Refreshes mv_period_account_balances concurrently.
 * Triggered after:
 *   - Period close (via direct call from period service)
 *   - Journal posting (significant batch operations)
 *   - Scheduled cron (every 15 minutes as a safety net)
 *
 * The CONCURRENTLY keyword allows reads during refresh (requires unique index).
 */

import { createQueue } from "./queues.js";
import { prisma } from "../db/prisma.js";
import { currentTenantId, forEachActiveTenant, runForTenantId } from "../db/tenantScope.js";

export const MV_REFRESH_QUEUE = "mv-refresh";

// ── Queue (exported so other modules can enqueue refreshes) ─────────────────

export type MVRefreshJob = { tenantId?: string; reason?: string; requestedAt?: string };

let queue: ReturnType<typeof createQueue<MVRefreshJob>> | null = null;

/** Built on first use, so importing this module opens no connection. */
export function mvRefreshQueue() {
  queue ??= createQueue<MVRefreshJob>(MV_REFRESH_QUEUE);
  return queue;
}

/**
 * Enqueues a refresh of the bound tenant's view. One pending refresh per
 * tenant: the job ID is the tenant's, so a second request while one waits is
 * dropped. The job is removed when it finishes; a kept job would hold the ID
 * and silently drop every later request for that tenant.
 */
export async function enqueueMVRefresh(reason: string): Promise<void> {
  const tenantId = currentTenantId();
  await mvRefreshQueue().add(
    "refresh",
    { tenantId, reason, requestedAt: new Date().toISOString() },
    {
      jobId: `mv-refresh-${tenantId}`,
      removeOnComplete: true,
      removeOnFail: true,
      attempts: 1
    }
  );
}

// ── Refresh function (also usable directly without BullMQ) ──────────────────

/**
 * Rebuild mv_period_account_balances.
 *
 * Calls refresh_period_balances() (tenant migration
 * 1_system_user_and_view_refresh). Only the view's owner may refresh it, and
 * the API and the workers connect as the tenant's application role, which owns
 * nothing; the function runs with the owner's rights and does only the
 * refresh. It also lifts row-level security for the refresh alone: the view
 * aggregates entity-scoped tables, and refreshed without that it would be
 * rebuilt empty (no entity is bound in this job), which once made every KPI,
 * balance sheet and cash flow silently return nothing.
 *
 * Not CONCURRENTLY: a function call runs inside a transaction, where
 * PostgreSQL forbids it. The rebuild briefly blocks readers of the view.
 */
export async function refreshMaterializedView(): Promise<{ durationMs: number }> {
  const start = Date.now();
  // A statement, not a query: the function returns void, which Prisma cannot read.
  await prisma.$executeRawUnsafe("SELECT refresh_period_balances()");
  const durationMs = Date.now() - start;
  return { durationMs };
}
