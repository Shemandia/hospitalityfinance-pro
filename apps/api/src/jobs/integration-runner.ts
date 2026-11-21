/**
 * Integrations worker process (OPS-10).
 *
 * The supervisor's entry point for Integrations. It runs one BullMQ worker per
 * active tenant (queue `integration-{slug}`) and keeps that set in step with the
 * registry: every INTEGRATION_TENANT_POLL_MS (default 60s) it starts workers
 * for new tenants, and stops the workers of tenants that were deactivated.
 * When a tenant's worker starts, its automation schedules are synced to BullMQ.
 *
 * The API process starts no workers; it only enqueues.
 *
 * Run as: node dist/jobs/integration-runner.js (through the supervisor).
 */

import { disconnectAllTenants, getTenantClient } from "../db/tenantPool.js";
import {
  disconnectRegistry,
  invalidateTenantCache,
  listTenants,
  type TenantRecord
} from "../db/tenantRegistry.js";
import { syncAutomationSchedules } from "./automation-scheduler.js";
import { disconnectAllIntegrationQueues } from "./integration-queue.js";
import {
  disconnectAllIntegrationWorkers,
  ensureIntegrationWorker,
  runningIntegrationWorkers,
  stopIntegrationWorker
} from "./integration-worker.js";
import { startupConfig } from "../config.js";
import { moduleLogger } from "../shared/logger.js";

const log = moduleLogger("integration-runner");

const { INTEGRATION_TENANT_POLL_MS: POLL_MS } = startupConfig("workers");

async function startTenant(tenant: TenantRecord): Promise<void> {
  ensureIntegrationWorker(tenant.slug, tenant.databaseUrl);
  try {
    const db = getTenantClient(tenant.slug, tenant.databaseUrl);
    const result = await syncAutomationSchedules(db, tenant.slug);
    if (result.synced > 0 || result.removed > 0) {
      log.info(
        { tenantSlug: tenant.slug },
        `Synced ${result.synced} schedules, removed ${result.removed}`
      );
    }
  } catch (err) {
    log.warn({ tenantSlug: tenant.slug }, `Schedule sync failed: ${(err as Error).message}`);
  }
}

/** Brings the running workers in line with the registry's active tenants. */
async function reconcile(): Promise<void> {
  await invalidateTenantCache();
  const tenants = await listTenants();
  const active = new Set(tenants.map((t) => t.slug));
  const running = new Set(runningIntegrationWorkers());

  for (const tenant of tenants) {
    if (!running.has(tenant.slug)) await startTenant(tenant);
  }
  for (const slug of running) {
    if (!active.has(slug)) {
      await stopIntegrationWorker(slug);
      log.info({ tenantSlug: slug }, `Tenant no longer active; worker stopped`);
    }
  }
}

let timer: NodeJS.Timeout | undefined;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(timer);
  log.info(`${signal} received; stopping workers`);
  await disconnectAllIntegrationWorkers();
  await disconnectAllIntegrationQueues();
  await Promise.allSettled([disconnectAllTenants(), disconnectRegistry()]);
  process.exit(0);
}

function scheduleNext(): void {
  if (shuttingDown) return;
  timer = setTimeout(() => {
    reconcile()
      .catch((err) => {
        log.error(`Tenant refresh failed: ${(err as Error).message}`);
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
    log.info(
      `Started; ${runningIntegrationWorkers().length} tenant worker(s), ` +
        `checking for tenant changes every ${POLL_MS}ms`
    );
    scheduleNext();
  })
  .catch((err) => {
    log.error(`Could not start: ${(err as Error).message}`);
    process.exit(1);
  });
