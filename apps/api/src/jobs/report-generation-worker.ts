import { Worker } from "bullmq";
import { getReportQueueName } from "../modules/reporting/queue.js";
import { processReportRun } from "./report-generation-job.js";

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

const worker = new Worker(
  getReportQueueName(),
  async (job) => {
    await processReportRun(job.data.reportRunId);
  },
  {
    connection,
    concurrency: 2
  }
);

worker.on("completed", (job) => {
  console.log(`Report job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Report job ${job?.id ?? "unknown"} failed`, error);
});

console.log("Report generation worker started.");
