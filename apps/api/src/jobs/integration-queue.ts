/**
 * Integrations — per-tenant BullMQ queue.
 *
 * Per spec TD-BL-027 the queue name pattern is `integration-{tenant-slug}` —
 * one queue per tenant. This gives us:
 *   - Per-tenant concurrency limits (Starter=1, Pro=3, Enterprise=10)
 *   - Easier monitoring per tenant
 *   - Tenant isolation in Redis
 *
 * Queues are lazily created and cached per tenant. The first call to
 * `enqueueIntegrationExecution(tenantSlug, ...)` instantiates the queue.
 *
 * The matching workers run in their own process (integration-runner.ts,
 * under the worker supervisor), one per active tenant. A job enqueued here
 * waits in Redis until that process picks it up.
 */

import type { Queue } from "bullmq";
import { createQueue } from "./queues.js";

// ── Job payload type ────────────────────────────────────────────────────────

export type IntegrationJobData = {
  /** Tenant slug — also encoded in the queue name, kept here for ergonomics */
  tenantSlug: string;
  /** UUID of the row in integration_executions to process */
  executionId: string;
  /** UUID of the profile being executed */
  profileId: string;
  /** Optional automation step context (when run as part of an automation) */
  automationId?: string;
  automationStepOrder?: number;
};

// ── Per-tenant queue cache ─────────────────────────────────────────────────

const queues = new Map<string, Queue<IntegrationJobData>>();

/** Returns the BullMQ queue name for a given tenant. */
export function getIntegrationQueueName(tenantSlug: string): string {
  return `integration-${tenantSlug}`;
}

/**
 * Get or create the Integrations queue for a tenant. Cached.
 */
export function getIntegrationQueue(tenantSlug: string): Queue<IntegrationJobData> {
  let q = queues.get(tenantSlug);
  if (!q) {
    q = createQueue<IntegrationJobData>(getIntegrationQueueName(tenantSlug), {
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
 * Enqueue a Integrations profile execution. Returns the BullMQ job ID so
 * the caller can store it on the `integration_executions.job_id` column for
 * cancellation and progress streaming.
 */
export async function enqueueIntegrationExecution(data: IntegrationJobData): Promise<string> {
  const queue = getIntegrationQueue(data.tenantSlug);
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
export async function cancelIntegrationExecution(
  tenantSlug: string,
  executionId: string
): Promise<boolean> {
  const queue = getIntegrationQueue(tenantSlug);
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
export async function disconnectAllIntegrationQueues(): Promise<void> {
  const closes = [...queues.values()].map((q) => q.close().catch(() => {}));
  await Promise.allSettled(closes);
  queues.clear();
}
