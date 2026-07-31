/**
 * Transfer Desk — per-tenant BullMQ queue.
 *
 * Per spec TD-BL-027 the queue name pattern is `transfer-{tenant-slug}` —
 * one queue per tenant. This gives us:
 *   - Per-tenant concurrency limits (Starter=1, Pro=3, Enterprise=10)
 *   - Easier monitoring per tenant
 *   - Tenant isolation in Redis
 *
 * Queues are lazily created and cached per tenant. The first call to
 * `enqueueTransferDeskExecution(tenantSlug, ...)` instantiates the queue.
 *
 * The matching worker (transfer-desk-worker.ts) is also lazy-created so a
 * tenant that never uses Transfer Desk consumes no Redis resources.
 */

import { Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";

// ── Job payload type ────────────────────────────────────────────────────────

export type TransferDeskJobData = {
  /** Tenant slug — also encoded in the queue name, kept here for ergonomics */
  tenantSlug: string;
  /** UUID of the row in transfer_executions to process */
  executionId: string;
  /** UUID of the profile being executed */
  profileId: string;
  /** Optional automation step context (when run as part of an automation) */
  automationId?: string;
  automationStepOrder?: number;
};

// ── Redis connection (shared across all tenant queues) ─────────────────────

let redisConnection: ConnectionOptions | null = null;

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
    } else {
      redisConnection = {
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD ?? undefined
      };
    }
  }
  return redisConnection;
}

export function getTransferDeskRedisConnection(): ConnectionOptions {
  return getRedisConnection();
}

// ── Per-tenant queue cache ─────────────────────────────────────────────────

const queues = new Map<string, Queue<TransferDeskJobData>>();

/** Returns the BullMQ queue name for a given tenant. */
export function getTransferDeskQueueName(tenantSlug: string): string {
  return `transfer-${tenantSlug}`;
}

/**
 * Get or create the Transfer Desk queue for a tenant. Cached.
 */
export function getTransferDeskQueue(tenantSlug: string): Queue<TransferDeskJobData> {
  let q = queues.get(tenantSlug);
  if (!q) {
    q = new Queue<TransferDeskJobData>(getTransferDeskQueueName(tenantSlug), {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 100, age: 7 * 24 * 60 * 60 },
        removeOnFail: { count: 200, age: 30 * 24 * 60 * 60 },
        attempts: 1 // Retries are intentional in TD — failures must be inspected
      }
    });
    queues.set(tenantSlug, q);
  }
  return q;
}

/**
 * Enqueue a Transfer Desk profile execution. Returns the BullMQ job ID so
 * the caller can store it on the `transfer_executions.job_id` column for
 * cancellation and progress streaming.
 */
export async function enqueueTransferDeskExecution(data: TransferDeskJobData): Promise<string> {
  const queue = getTransferDeskQueue(data.tenantSlug);
  const job = await queue.add(`execute-${data.profileId}`, data, {
    jobId: data.executionId // Use the execution row id as the job id for easy lookup
  });
  return job.id ?? data.executionId;
}

/**
 * Cancel a queued or running execution by execution ID.
 *
 * Returns true if the job was found and removed/cancelled, false if no job
 * with that id existed (e.g. already finished).
 */
export async function cancelTransferDeskExecution(
  tenantSlug: string,
  executionId: string
): Promise<boolean> {
  const queue = getTransferDeskQueue(tenantSlug);
  const job = await queue.getJob(executionId);
  if (!job) return false;
  // If still waiting/delayed, just remove it. If active, signal cancellation —
  // the worker checks job.isCancelled() at safe points.
  if (await job.isActive()) {
    await job.moveToFailed(new Error("Cancelled by user"), executionId, true);
  } else {
    await job.remove();
  }
  return true;
}

/**
 * Disconnect all per-tenant queues. Called during graceful shutdown.
 */
export async function disconnectAllTransferDeskQueues(): Promise<void> {
  const closes = [...queues.values()].map((q) => q.close().catch(() => {}));
  await Promise.allSettled(closes);
  queues.clear();
}
