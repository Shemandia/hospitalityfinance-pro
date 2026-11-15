import { createWorker } from "./queues.js";
import { getReportQueueName } from "../modules/reporting/queue.js";
import { processReportRun } from "./report-generation-job.js";
import { runForTenantId } from "../db/tenantScope.js";
import type { ReportJobData } from "../modules/reporting/queue.js";
import { moduleLogger } from "../shared/logger.js";

const log = moduleLogger("report-generation-worker");

const worker = createWorker<ReportJobData>(
  getReportQueueName(),
  async (job) => {
    await runForTenantId(job.data.tenantId, () => processReportRun(job.data.reportRunId));
  },
  { concurrency: 2 }
);

worker.on("completed", (job) => {
  log.info(`Report job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  log.error({ err: error }, `Report job ${job?.id ?? "unknown"} failed`);
});

log.info("Report generation worker started.");
