import { getDunningQueueName } from "./dunning-queue.js";
import { createWorker } from "./queues.js";
import { processDunningJob, processDunningForAllEntities } from "./dunning-job.js";
import type { DunningJobData } from "./dunning-job.js";
import { forEachActiveTenant, runForTenantId } from "../db/tenantScope.js";

const worker = createWorker<DunningJobData>(
  getDunningQueueName(),
  async (job) => {
    // Each tenant's work runs with that tenant bound; there is no default database.
    if (job.data.scope === "all") {
      return forEachActiveTenant(() => processDunningForAllEntities());
    }
    const { tenantId, entityId } = job.data;
    return runForTenantId(tenantId, () => processDunningJob({ entityId }));
  },
  { concurrency: 1 }
);

worker.on("completed", (job) => {
  console.log(`[DunningWorker] Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`[DunningWorker] Job ${job?.id ?? "unknown"} failed`, error);
});

console.log("AR Dunning worker started.");
