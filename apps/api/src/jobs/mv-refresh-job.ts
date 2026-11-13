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

import { Queue, Worker } from "bullmq";
import { prisma } from "../db/prisma.js";
import { currentTenantId, forEachActiveTenant, runForTenantId } from "../db/tenantScope.js";
import { withBypassRLS } from "../db/rls-bypass.js";

const QUEUE_NAME = "mv-refresh";

// ── Redis connection ────────────────────────────────────────────────────────

const redisUrl = process.env.REDIS_URL;
const connection = redisUrl
  ? (() => {
      const parsed = new URL(redisUrl);
      return {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        password: parsed.password || undefined
      };
    })()
  : {
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD ?? undefined
    };

// ── Queue (exported so other modules can enqueue refreshes) ─────────────────

export const mvRefreshQueue = new Queue(QUEUE_NAME, { connection });

/**
 * Enqueue a materialized view refresh.
 * Deduplicated by jobId to avoid concurrent refreshes.
 */
/** Enqueues a refresh of the bound tenant's view. One pending refresh per tenant. */
export async function enqueueMVRefresh(reason: string): Promise<void> {
  const tenantId = currentTenantId();
  await mvRefreshQueue.add(
    "refresh",
    { tenantId, reason, requestedAt: new Date().toISOString() },
    {
      jobId: `mv-refresh-${tenantId}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      // Debounce: if a refresh is already queued, skip
      attempts: 1
    }
  );
}

// ── Refresh function (also usable directly without BullMQ) ──────────────────

/**
 * Rebuild mv_period_account_balances.
 *
 * MUST run with RLS bypassed. The view aggregates account_period_balances,
 * accounts and periods — all entity-scoped tables whose policies require
 * app_current_entity_id() to be set. PostgreSQL applies those policies while
 * refreshing (the `hfp` role owns the tables but has no BYPASSRLS and RLS is
 * FORCEd), so a refresh from this scheduled job — which has no entity context —
 * rebuilt the view with ZERO rows.
 *
 * The failure was silent and total: the refresh reported success, and every
 * KPI, balance sheet, cash flow, consolidation and budget-variance query that
 * reads the view then returned nothing. Verified directly against Postgres:
 * refreshing without context yielded 0 rows, with bypass 1,267.
 *
 * A tenant-wide reporting view has no single entity context by definition, so
 * bypass is the correct scope here rather than a workaround.
 */
export async function refreshMaterializedView(): Promise<{ durationMs: number }> {
  const start = Date.now();

  // Refresh inside a transaction so the bypass and the REFRESH are guaranteed
  // to execute on the SAME connection. Setting the bypass in one $executeRaw
  // and refreshing in another is unsafe: Prisma pools connections, so the
  // REFRESH could land on a connection that never saw the bypass and would
  // silently rebuild the view empty again.
  //
  // The transaction requirement is why this is no longer CONCURRENTLY —
  // PostgreSQL forbids REFRESH … CONCURRENTLY inside a transaction block. The
  // cost is an ACCESS EXCLUSIVE lock on the view for the duration of the
  // rebuild, which blocks readers; the benefit is a view that actually has
  // rows in it. If the database role is later granted BYPASSRLS (or the view
  // is owned by such a role), the bypass becomes unnecessary and CONCURRENTLY
  // can be restored — the unique index it needs already exists.
  await withBypassRLS(prisma, async (tx: any) => {
    await tx.$executeRawUnsafe("REFRESH MATERIALIZED VIEW mv_period_account_balances");
  });

  const durationMs = Date.now() - start;
  return { durationMs };
}

// ── Worker (only starts when this file is run directly) ─────────────────────

if (process.argv[1]?.includes("mv-refresh-job")) {
  async function setupRepeatable(): Promise<void> {
    const existing = await mvRefreshQueue.getRepeatableJobs();
    for (const job of existing) {
      await mvRefreshQueue.removeRepeatableByKey(job.key);
    }

    await mvRefreshQueue.add(
      "refresh-scheduled",
      { reason: "scheduled", requestedAt: new Date().toISOString() },
      {
        repeat: {
          pattern: "*/15 * * * *" // every 15 minutes
        },
        removeOnComplete: 20,
        removeOnFail: 20
      }
    );

    console.log("[MVRefreshWorker] Repeatable job registered: every 15 minutes.");
  }

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log(`[MVRefreshWorker] Refreshing MV — reason: ${job.data?.reason ?? "unknown"}`);
      // A refresh names its tenant; the scheduled safety net refreshes every tenant.
      const tenantId: string | undefined = job.data?.tenantId;
      if (tenantId) return runForTenantId(tenantId, () => refreshMaterializedView());
      return forEachActiveTenant(() => refreshMaterializedView());
    },
    {
      connection,
      concurrency: 1
    }
  );

  worker.on("completed", (job, result) => {
    const r = result as { durationMs: number } | undefined;
    console.log(`[MVRefreshWorker] Job ${job.id} completed in ${r?.durationMs ?? "?"}ms.`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[MVRefreshWorker] Job ${job?.id ?? "unknown"} failed:`, error);
  });

  setupRepeatable().catch((err) => {
    console.error("[MVRefreshWorker] Failed to set up repeatable job:", err);
    process.exit(1);
  });

  console.log("MV refresh worker started.");
}
