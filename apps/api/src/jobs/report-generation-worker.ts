import { createWorker } from "./queues.js";
import { getReportQueueName } from "../modules/reporting/queue.js";
import { processReportRun } from "./report-generation-job.js";
import { runForTenantId } from "../db/tenantScope.js";
import type { ReportJobData } from "../modules/reporting/queue.js";

const worker = createWorker<ReportJobData>(
  getReportQueueName(),
  async (job) => {
    await runForTenantId(job.data.tenantId, () => processReportRun(job.data.reportRunId));
  },
  { concurrency: 2 }
);

worker.on("completed", (job) => {
  console.log(`Report job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Report job ${job?.id ?? "unknown"} failed`, error);
});

console.log("Report generation worker started.");
