import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";

const queueName = "report-generation";

let redisConnection: ConnectionOptions | null = null;
let reportQueue: Queue<{ reportRunId: string }> | null = null;

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

export function getReportQueue(): Queue<{ reportRunId: string }> {
  if (!reportQueue) {
    reportQueue = new Queue(queueName, {
      connection: getRedisConnection()
    });
  }

  return reportQueue;
}

export function getReportQueueName(): string {
  return queueName;
}
