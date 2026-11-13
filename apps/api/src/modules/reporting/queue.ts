import type { Queue } from "bullmq";
import { createQueue } from "../../jobs/queues.js";

const queueName = "report-generation";

/** A report run and the tenant whose database holds it. */
export type ReportJobData = { reportRunId: string; tenantId: string };

let reportQueue: Queue<ReportJobData> | null = null;

export function getReportQueue(): Queue<ReportJobData> {
  if (!reportQueue) {
    reportQueue = createQueue<ReportJobData>(queueName);
  }

  return reportQueue;
}

export function getReportQueueName(): string {
  return queueName;
}
