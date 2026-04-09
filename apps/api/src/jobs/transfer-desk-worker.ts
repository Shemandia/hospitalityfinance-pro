/**
 * Transfer Desk — per-tenant BullMQ worker.
 *
 * One worker per active tenant, lazily started when the matching queue gets
 * its first job. The worker name follows the spec pattern `transfer:{tenant-slug}`
 * (TD-BL-027).
 *
 * Responsibilities:
 *   1. Pull TransferDeskJobData from the per-tenant queue.
 *   2. Resolve the tenant DB and load the profile + execution row.
 *   3. Update transfer_executions through QUEUED → RUNNING → COMPLETED / FAILED.
 *   4. Dispatch to the appropriate pipeline (import / export / process).
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
import {
  executeImport,
  executeExport,
  executeProcess,
  type PipelineContext,
  type PipelineResult,
  type ProfileWithRelations
} from "./transfer-desk-pipeline.js";
import { getStorageBackend } from "./transfer-desk-storage.js";

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
 * Job handler. Loads the profile + execution, dispatches to the appropriate
 * pipeline (import / export / process), and updates the execution row.
 */
async function processJob(
  job: Job<TransferDeskJobData>,
  tenantSlug: string,
  tenantDbUrl: string
): Promise<{ executionId: string; status: "COMPLETED" | "FAILED"; recordsTotal: number }> {
  const { executionId, profileId } = job.data;
  const prisma = getTenantClient(tenantSlug, tenantDbUrl) as any;

  console.log(
    `[TransferDeskWorker:${tenantSlug}] Picked up execution ${executionId} (profile ${profileId})`
  );

  // ── Mark RUNNING ────────────────────────────────────────────────────────
  try {
    await prisma.transferExecution.update({
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
    throw err;
  }

  // ── Load profile ────────────────────────────────────────────────────────
  let profile: ProfileWithRelations | null;
  try {
    profile = await prisma.transferProfile.findUnique({
      where: { id: profileId },
      include: {
        sourceFormat: true,
        targetFormat: true,
        transformation: {
          select: { id: true, rulesJson: true, functionsJson: true }
        }
      }
    });
  } catch (err) {
    await markFailed(prisma, executionId, `Failed to load profile: ${(err as Error).message}`);
    throw err;
  }

  if (!profile) {
    const msg = `Profile ${profileId} not found`;
    await markFailed(prisma, executionId, msg);
    throw new Error(msg);
  }

  // ── Load execution for runtimeParams ────────────────────────────────────
  let runtimeParams: Record<string, unknown> = {};
  try {
    const execution = await prisma.transferExecution.findUnique({
      where: { id: executionId },
      select: { runtimeParams: true }
    });
    if (execution?.runtimeParams) {
      runtimeParams =
        typeof execution.runtimeParams === "string"
          ? JSON.parse(execution.runtimeParams)
          : (execution.runtimeParams as Record<string, unknown>);
    }
  } catch {
    // Non-fatal — proceed with empty params
  }

  // ── Build pipeline context ──────────────────────────────────────────────
  const ctx: PipelineContext = {
    db: prisma,
    storage: getStorageBackend(),
    tenantSlug,
    tenantDbUrl
  };

  // ── Dispatch to pipeline ────────────────────────────────────────────────
  let result: PipelineResult;

  try {
    switch (profile.profileType) {
      case "IMPORT":
        result = await executeImport(ctx, executionId, profile, runtimeParams);
        break;
      case "EXPORT":
        result = await executeExport(ctx, executionId, profile, runtimeParams);
        break;
      case "PROCESS":
      case "INTERNAL_TRANSFER":
      case "EXTERNAL_TRANSFER":
        result = await executeProcess(ctx, executionId, profile);
        break;
      default:
        result = {
          recordsTotal: 0,
          recordsSucceeded: 0,
          recordsFailed: 0,
          errorMessage: `Unknown profile type: ${profile.profileType}`
        };
    }
  } catch (err) {
    await markFailed(prisma, executionId, (err as Error).message);
    throw err;
  }

  // ── Mark COMPLETED or FAILED ────────────────────────────────────────────
  const finalStatus = result.errorMessage ? "FAILED" : "COMPLETED";

  try {
    await prisma.transferExecution.update({
      where: { id: executionId },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        recordsTotal: result.recordsTotal,
        recordsSucceeded: result.recordsSucceeded,
        recordsFailed: result.recordsFailed,
        errorMessage: result.errorMessage ?? null
      }
    });
  } catch (err) {
    console.error(
      `[TransferDeskWorker:${tenantSlug}] Failed to mark execution ${executionId} as ${finalStatus}:`,
      err
    );
    await markFailed(prisma, executionId, (err as Error).message);
    throw err;
  }

  return {
    executionId,
    status: finalStatus,
    recordsTotal: result.recordsTotal
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function markFailed(prisma: any, executionId: string, message: string): Promise<void> {
  await prisma.transferExecution
    .update({
      where: { id: executionId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: message
      }
    })
    .catch(() => {});
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
