import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import type { DunningJobData } from "./dunning-job.js";

const queueName = "ar-dunning";

let redisConnection: ConnectionOptions | null = null;
let dunningQueue: Queue<DunningJobData> | null = null;

function getRedisConnection(): ConnectionOptions {
  if (!redisConnection) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const parsed = new URL(redisUrl);
      redisConnection = {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        password: parsed.password || undefined
      };
      return redisConnection;
    }

    redisConnection = {
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD ?? undefined
    };
  }

  return redisConnection;
}

export function getDunningQueue(): Queue<DunningJobData> {
  if (!dunningQueue) {
    dunningQueue = new Queue(queueName, {
      connection: getRedisConnection()
    });
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
    { entityId: "__ALL__" },
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
export async function enqueueDunningRun(entityId: string): Promise<string> {
  const queue = getDunningQueue();
  const job = await queue.add(
    "manual-dunning",
    { entityId },
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 }
    }
  );
  return job.id ?? "unknown";
}
