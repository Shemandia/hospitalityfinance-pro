/**
 * Scheduled Reports Worker
 *
 * BullMQ worker that runs every hour (cron: "0 * * * *") to check
 * for due scheduled reports and enqueue them for generation.
 *
 * Start with:  npm run scheduled-reports:worker
 *              (or: tsx src/jobs/scheduled-reports-worker.ts)
 */

import { createQueue, createWorker } from "./queues.js";
import { forEachActiveTenant } from "../db/tenantScope.js";
import { checkAndRunScheduledReports } from "./scheduled-reports.js";
import { moduleLogger } from "../shared/logger.js";

const log = moduleLogger("scheduled-reports-worker");

const QUEUE_NAME = "scheduled-reports";

// ── Set up the repeatable job ────────────────────────────────────────────────

const queue = createQueue(QUEUE_NAME);

async function setupRepeatable(): Promise<void> {
  // Remove any stale repeatable jobs first, then add the current one
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  await queue.add(
    "check-schedules",
    {},
    {
      repeat: {
        pattern: "0 * * * *" // every hour at minute 0
      },
      removeOnComplete: 50,
      removeOnFail: 50
    }
  );

  log.info("Repeatable job registered: every hour at :00.");
}

// ── Worker ───────────────────────────────────────────────────────────────────

const worker = createWorker(
  QUEUE_NAME,
  async (_job) => {
    const perTenant = await forEachActiveTenant(() => checkAndRunScheduledReports());
    return { enqueuedCount: perTenant.reduce((sum, t) => sum + t.result, 0) };
  },
  { concurrency: 1 }
);

worker.on("completed", (job, result) => {
  log.info(
    `Job ${job.id} completed — ` +
      `enqueued ${(result as { enqueuedCount: number })?.enqueuedCount ?? 0} report(s).`
  );
});

worker.on("failed", (job, error) => {
  log.error({ err: error }, `Job ${job?.id ?? "unknown"} failed`);
});

// ── Bootstrap ────────────────────────────────────────────────────────────────

setupRepeatable().catch((err) => {
  log.error({ err }, "Failed to set up repeatable job");
  process.exit(1);
});

log.info("Scheduled reports worker started.");
