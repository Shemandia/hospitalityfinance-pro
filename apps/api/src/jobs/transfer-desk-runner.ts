/**
 * Transfer Desk worker process (OPS-10).
 *
 * The supervisor's entry point for Transfer Desk. It runs one BullMQ worker per
 * active tenant (queue `transfer-{slug}`) and keeps that set in step with the
 * registry: every TRANSFER_DESK_TENANT_POLL_MS (default 60s) it starts workers
 * for new tenants, and stops the workers of tenants that were deactivated.
 * When a tenant's worker starts, its automation schedules are synced to BullMQ.
 *
 * The API process starts no workers; it only enqueues.
 *
 * Run as: node dist/jobs/transfer-desk-runner.js (through the supervisor).
 */

import { disconnectAllTenants, getTenantClient } from "../db/tenantPool.js";
import {
  disconnectRegistry,
  invalidateTenantCache,
  listTenants,
  type TenantRecord
} from "../db/tenantRegistry.js";
import { syncAutomationSchedules } from "./automation-scheduler.js";
import { disconnectAllTransferDeskQueues } from "./transfer-desk-queue.js";
import {
  disconnectAllTransferDeskWorkers,
  ensureTransferDeskWorker,
  runningTransferDeskWorkers,
  stopTransferDeskWorker
} from "./transfer-desk-worker.js";

const raw = process.env.TRANSFER_DESK_TENANT_POLL_MS;
const POLL_MS = raw ? Number(raw) : 60_000;
if (!Number.isInteger(POLL_MS) || POLL_MS < 1) {
  console.error(`[TransferDeskRunner] TRANSFER_DESK_TENANT_POLL_MS must be a positive integer.`);
  process.exit(1);
}

async function startTenant(tenant: TenantRecord): Promise<void> {
  ensureTransferDeskWorker(tenant.slug, tenant.databaseUrl);
  try {
    const db = getTenantClient(tenant.slug, tenant.databaseUrl);
    const result = await syncAutomationSchedules(db, tenant.slug);
    if (result.synced > 0 || result.removed > 0) {
      console.log(
        `[TransferDeskRunner:${tenant.slug}] Synced ${result.synced} schedules, removed ${result.removed}`
      );
    }
  } catch (err) {
    console.warn(
      `[TransferDeskRunner:${tenant.slug}] Schedule sync failed: ${(err as Error).message}`
    );
  }
}

/** Brings the running workers in line with the registry's active tenants. */
async function reconcile(): Promise<void> {
  await invalidateTenantCache();
  const tenants = await listTenants();
  const active = new Set(tenants.map((t) => t.slug));
  const running = new Set(runningTransferDeskWorkers());

  for (const tenant of tenants) {
    if (!running.has(tenant.slug)) await startTenant(tenant);
  }
  for (const slug of running) {
    if (!active.has(slug)) {
      await stopTransferDeskWorker(slug);
      console.log(`[TransferDeskRunner:${slug}] Tenant no longer active; worker stopped`);
    }
  }
}

let timer: NodeJS.Timeout | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(timer);
  console.log(`[TransferDeskRunner] ${signal} received; stopping workers`);
  await disconnectAllTransferDeskWorkers();
  await disconnectAllTransferDeskQueues();
  await Promise.allSettled([disconnectAllTenants(), disconnectRegistry()]);
  process.exit(0);
}

function scheduleNext(): void {
  if (shuttingDown) return;
  timer = setTimeout(() => {
    reconcile()
      .catch((err) => {
        console.error(`[TransferDeskRunner] Tenant refresh failed: ${(err as Error).message}`);
      })
      .finally(scheduleNext);
  }, POLL_MS);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// A first refresh that fails (registry or Redis unreachable) ends the process
// with an error, so the supervisor restarts it with backoff.
reconcile()
  .then(() => {
    console.log(
      `[TransferDeskRunner] Started; ${runningTransferDeskWorkers().length} tenant worker(s), ` +
        `checking for tenant changes every ${POLL_MS}ms`
    );
    scheduleNext();
  })
  .catch((err) => {
    console.error(`[TransferDeskRunner] Could not start: ${(err as Error).message}`);
    process.exit(1);
  });
