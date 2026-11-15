/**
 * Materialized view refresh worker (OPS-11).
 *
 * Processes the refreshes the period service queues, and registers the
 * 15-minute safety net that refreshes every active tenant. Run by the worker
 * supervisor.
 */

import { createWorker } from "./queues.js";
import {
  MV_REFRESH_QUEUE,
  mvRefreshQueue,
  refreshMaterializedView,
  type MVRefreshJob
} from "./mv-refresh-job.js";
import { forEachActiveTenant, runForTenantId } from "../db/tenantScope.js";

const SCHEDULE = "*/15 * * * *";

async function registerSchedule(): Promise<void> {
  const queue = mvRefreshQueue();
  for (const job of await queue.getRepeatableJobs()) {
    await queue.removeRepeatableByKey(job.key);
  }
  await queue.add(
    "refresh-scheduled",
    { reason: "scheduled" },
    { repeat: { pattern: SCHEDULE }, removeOnComplete: 20, removeOnFail: 20 }
  );
  console.log(`[MVRefreshWorker] Scheduled refresh registered: ${SCHEDULE}.`);
}

const worker = createWorker<MVRefreshJob>(
  MV_REFRESH_QUEUE,
  async (job) => {
    console.log(`[MVRefreshWorker] Refreshing MV — reason: ${job.data?.reason ?? "unknown"}`);
    // A queued refresh names its tenant; the scheduled safety net refreshes every tenant.
    const tenantId = job.data?.tenantId;
    if (tenantId) return runForTenantId(tenantId, () => refreshMaterializedView());
    return forEachActiveTenant(() => refreshMaterializedView());
  },
  { concurrency: 1 }
);

worker.on("completed", (job, result) => {
  const r = result as { durationMs: number } | undefined;
  console.log(`[MVRefreshWorker] Job ${job.id} completed in ${r?.durationMs ?? "?"}ms.`);
});

worker.on("failed", (job, error) => {
  console.error(`[MVRefreshWorker] Job ${job?.id ?? "unknown"} failed:`, error);
});

registerSchedule().catch((err) => {
  console.error("[MVRefreshWorker] Failed to register the scheduled refresh:", err);
  process.exit(1);
});

console.log("MV refresh worker started.");
