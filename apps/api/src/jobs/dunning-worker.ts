import { Worker } from "bullmq";
import { getDunningQueueName } from "./dunning-queue.js";
import { processDunningJob, processDunningForAllEntities } from "./dunning-job.js";
import type { DunningJobData } from "./dunning-job.js";
import { forEachActiveTenant, runForTenantId } from "../db/tenantScope.js";

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
    // Each tenant's work runs with that tenant bound; there is no default database.
    if (job.data.scope === "all") {
      return forEachActiveTenant(() => processDunningForAllEntities());
    }
    const { tenantId, entityId } = job.data;
    return runForTenantId(tenantId, () => processDunningJob({ entityId }));
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
