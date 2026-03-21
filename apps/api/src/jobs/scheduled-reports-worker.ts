/**
 * Scheduled Reports Worker
 *
 * BullMQ worker that runs every hour (cron: "0 * * * *") to check
 * for due scheduled reports and enqueue them for generation.
 *
 * Start with:  npm run scheduled-reports:worker
 *              (or: tsx src/jobs/scheduled-reports-worker.ts)
 */

import { Queue, Worker } from "bullmq";
import { checkAndRunScheduledReports } from "./scheduled-reports.js";

const QUEUE_NAME = "scheduled-reports";

// ── Redis connection (same pattern as report-generation-worker) ──────────────

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

// ── Set up the repeatable job ────────────────────────────────────────────────

const queue = new Queue(QUEUE_NAME, { connection });

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

  console.log("[ScheduledReportsWorker] Repeatable job registered: every hour at :00.");
}

// ── Worker ───────────────────────────────────────────────────────────────────

const worker = new Worker(
  QUEUE_NAME,
  async (_job) => {
    const count = await checkAndRunScheduledReports();
    return { enqueuedCount: count };
  },
  {
    connection,
    concurrency: 1
  }
);

worker.on("completed", (job, result) => {
  console.log(
    `[ScheduledReportsWorker] Job ${job.id} completed — ` +
      `enqueued ${(result as { enqueuedCount: number })?.enqueuedCount ?? 0} report(s).`
  );
});

worker.on("failed", (job, error) => {
  console.error(`[ScheduledReportsWorker] Job ${job?.id ?? "unknown"} failed:`, error);
});

// ── Bootstrap ────────────────────────────────────────────────────────────────

setupRepeatable().catch((err) => {
  console.error("[ScheduledReportsWorker] Failed to set up repeatable job:", err);
  process.exit(1);
});

console.log("Scheduled reports worker started.");
