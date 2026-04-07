/**
 * Transfer Desk — per-tenant BullMQ worker.
 *
 * One worker per active tenant, lazily started when the matching queue gets
 * its first job. The worker name follows the spec pattern `transfer:{tenant-slug}`
 * (TD-BL-027).
 *
 * Responsibilities:
 *   1. Pull TransferDeskJobData from the per-tenant queue.
 *   2. Resolve the tenant DB and update the `transfer_executions` row through
 *      the QUEUED → RUNNING → COMPLETED / FAILED state machine.
 *   3. Set the per-job `app.current_entity_id` if the job operates on
 *      entity-scoped data (none of the TD tables today, but the runtime params
 *      may include an entityId for the actual import target).
 *   4. (Future) Hand off to the FSD parser → TML transformer → target writer
 *      pipeline. Currently a stub that immediately marks the execution as
 *      COMPLETED with zero records processed.
 *
 * Concurrency: defaults to 1 per tenant. Per-tenant license-tier limits
 * (Starter=1, Pro=3, Enterprise=10) will be enforced by reading the tenant
 * license entitlements when the BullMQ Worker is constructed — TODO once the
 * licensing module exists.
 *
 * Lifecycle:
 *   - Workers are NOT started at app boot. They start on first enqueue via
 *     `ensureTransferDeskWorker(tenantSlug, tenantDbUrl)`.
 *   - All workers are closed by `disconnectAllTransferDeskWorkers()` during
 *     graceful shutdown.
 */

import { Worker, type Job } from "bullmq";
import { getTenantClient } from "../db/tenantPool.js";
import {
  getTransferDeskQueueName,
  getTransferDeskRedisConnection,
  type TransferDeskJobData
} from "./transfer-desk-queue.js";

// ── Per-tenant worker cache ────────────────────────────────────────────────

const workers = new Map<string, Worker<TransferDeskJobData>>();

/**
 * Ensure a worker exists for the given tenant. Idempotent.
 *
 * The tenantDbUrl is captured in the closure so the worker can spin up its
 * own Prisma client without depending on AsyncLocalStorage (which is empty
 * inside a BullMQ worker — workers run outside the request lifecycle).
 */
export function ensureTransferDeskWorker(tenantSlug: string, tenantDbUrl: string): void {
  if (workers.has(tenantSlug)) return;

  const worker = new Worker<TransferDeskJobData>(
    getTransferDeskQueueName(tenantSlug),
    (job) => processJob(job, tenantSlug, tenantDbUrl),
    {
      connection: getTransferDeskRedisConnection(),
      concurrency: 1, // TODO: read from license entitlements (Starter=1, Pro=3, Enterprise=10)
      // Workers don't auto-restart failed jobs — TD failures require human inspection
      autorun: true
    }
  );

  worker.on("completed", (job) => {
    console.log(`[TransferDeskWorker:${tenantSlug}] Job ${job.id} completed`);
  });

  worker.on("failed", (job, error) => {
    console.error(
      `[TransferDeskWorker:${tenantSlug}] Job ${job?.id ?? "unknown"} failed:`,
      error.message
    );
  });

  worker.on("error", (error) => {
    console.error(`[TransferDeskWorker:${tenantSlug}] Worker error:`, error);
  });

  workers.set(tenantSlug, worker);
  console.log(`[TransferDeskWorker:${tenantSlug}] Worker started`);
}

/**
 * Job handler. Stub implementation — updates the `transfer_executions` row
 * through QUEUED → RUNNING → COMPLETED but doesn't actually run any FSD/TML
 * pipeline yet (those engines don't exist; they're scheduled for sprints 4-9).
 *
 * The lifecycle update is real so the UI can already poll for status changes
 * once the execute-profile endpoint lands.
 */
async function processJob(
  job: Job<TransferDeskJobData>,
  tenantSlug: string,
  tenantDbUrl: string
): Promise<{ executionId: string; status: "COMPLETED" | "FAILED"; recordsTotal: number }> {
  const { executionId, profileId } = job.data;
  const tenant = getTenantClient(tenantSlug, tenantDbUrl) as unknown as {
    transferExecution: {
      update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
      findUnique: (args: {
        where: { id: string };
      }) => Promise<{ id: string; status: string } | null>;
    };
  };

  console.log(
    `[TransferDeskWorker:${tenantSlug}] Picked up execution ${executionId} (profile ${profileId})`
  );

  // ── Mark RUNNING ────────────────────────────────────────────────────────
  try {
    await tenant.transferExecution.update({
      where: { id: executionId },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        jobId: job.id ?? executionId
      }
    });
  } catch (err) {
    console.error(
      `[TransferDeskWorker:${tenantSlug}] Failed to mark execution ${executionId} as RUNNING:`,
      err
    );
    throw err; // Let BullMQ record the failure
  }

  // ── (Stub) Run the actual profile here ──────────────────────────────────
  //
  // Real implementation will:
  //   1. Load the profile + its source/target format + transformation
  //   2. Pull the input file (from request payload, file repo, or external API)
  //   3. Run the FSD parser → produce JSON records
  //   4. Run the TML transformer → produce target records
  //   5. Write target records into the target component (GL_JOURNAL, AP_INVOICE, etc.)
  //   6. Stream per-record progress via SSE (UI-RT-001)
  //   7. Insert per-record rows into transfer_execution_logs
  //
  // For Sprint 2 we just simulate success after a brief delay so the lifecycle
  // is observable via the existing transfer_executions table.

  await new Promise((resolve) => setTimeout(resolve, 100));

  // ── Mark COMPLETED ──────────────────────────────────────────────────────
  try {
    await tenant.transferExecution.update({
      where: { id: executionId },
      data: {
        status: "COMPLETED",
        finishedAt: new Date(),
        recordsTotal: 0,
        recordsSucceeded: 0,
        recordsFailed: 0
      }
    });
  } catch (err) {
    console.error(
      `[TransferDeskWorker:${tenantSlug}] Failed to mark execution ${executionId} as COMPLETED:`,
      err
    );
    // Try to flip to FAILED so the UI doesn't see a stuck RUNNING row
    await tenant.transferExecution
      .update({
        where: { id: executionId },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: (err as Error).message
        }
      })
      .catch(() => {});
    throw err;
  }

  return { executionId, status: "COMPLETED", recordsTotal: 0 };
}

/**
 * Disconnect every running worker (graceful shutdown).
 */
export async function disconnectAllTransferDeskWorkers(): Promise<void> {
  const closes = [...workers.values()].map((w) =>
    w
      .close()
      .then(() => undefined)
      .catch(() => undefined)
  );
  await Promise.allSettled(closes);
  workers.clear();
}
