import { Worker } from "bullmq";
import { getDunningQueueName } from "./dunning-queue.js";
import { processDunningJob, processDunningForAllEntities } from "./dunning-job.js";
import type { DunningJobData } from "./dunning-job.js";

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

const worker = new Worker<DunningJobData>(
  getDunningQueueName(),
  async (job) => {
    if (job.data.entityId === "__ALL__") {
      return processDunningForAllEntities();
    }
    return processDunningJob(job.data);
  },
  {
    connection,
    concurrency: 1
  }
);

worker.on("completed", (job) => {
  console.log(`[DunningWorker] Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`[DunningWorker] Job ${job?.id ?? "unknown"} failed`, error);
});

console.log("AR Dunning worker started.");
