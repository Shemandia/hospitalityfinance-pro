import type { Queue } from "bullmq";
import { createQueue } from "./queues.js";
import type { DunningJobData } from "./dunning-job.js";

const queueName = "ar-dunning";

let dunningQueue: Queue<DunningJobData> | null = null;

export function getDunningQueue(): Queue<DunningJobData> {
  if (!dunningQueue) {
    dunningQueue = createQueue<DunningJobData>(queueName);
  }

  return dunningQueue;
}

export function getDunningQueueName(): string {
  return queueName;
}

/**
 * Register a repeatable dunning job that runs daily at 08:00 UTC.
 */
export async function registerDunningSchedule(): Promise<void> {
  const queue = getDunningQueue();

  // Remove any existing repeatable jobs to avoid duplicates
  const existing = await queue.getRepeatableJobs();
  for (const job of existing) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Schedule: daily at 08:00 UTC
  await queue.add(
    "daily-dunning",
    { scope: "all" },
    {
      repeat: { pattern: "0 8 * * *" },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 50 }
    }
  );

  console.log("[DunningQueue] Registered daily dunning schedule (08:00 UTC)");
}

/**
 * Enqueue an immediate dunning run for a specific entity.
 */
export async function enqueueDunningRun(tenantId: string, entityId: string): Promise<string> {
  const queue = getDunningQueue();
  const job = await queue.add(
    "manual-dunning",
    { scope: "entity", tenantId, entityId },
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 }
    }
  );
  return job.id ?? "unknown";
}
