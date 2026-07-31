import { createApp } from "./app.js";
import { disconnectAllTenants, getTenantClient } from "./db/tenantPool.js";
import { disconnectRegistry, listTenants } from "./db/tenantRegistry.js";
import { disconnectRedis } from "./db/redis.js";
import { disconnectAllTransferDeskQueues } from "./jobs/transfer-desk-queue.js";
import {
  disconnectAllTransferDeskWorkers,
  ensureTransferDeskWorker
} from "./jobs/transfer-desk-worker.js";
import { syncAutomationSchedules } from "./jobs/automation-scheduler.js";

const port = Number(process.env.PORT ?? 3001);

async function start(): Promise<void> {
  const app = await createApp();
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API listening on port ${port}`);

  // ── Sync automation schedules for all active tenants ────────────────────
  // Runs after server is listening so Redis connection is available.
  try {
    const tenants = await listTenants();
    for (const tenant of tenants) {
      try {
        const db = getTenantClient(tenant.slug, tenant.databaseUrl);
        const result = await syncAutomationSchedules(db, tenant.slug);
        if (result.synced > 0) {
          ensureTransferDeskWorker(tenant.slug, tenant.databaseUrl);
          app.log.info(
            `[AutomationScheduler:${tenant.slug}] Synced ${result.synced} schedules, removed ${result.removed}`
          );
        }
      } catch (err) {
        app.log.warn(
          `[AutomationScheduler:${tenant.slug}] Schedule sync failed: ${(err as Error).message}`
        );
      }
    }
  } catch (err) {
    app.log.warn(
      `[AutomationScheduler] Failed to sync schedules on startup: ${(err as Error).message}`
    );
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal} — shutting down gracefully…`);

    // Stop accepting new requests (30s timeout for in-flight)
    const closeTimeout = setTimeout(() => {
      app.log.warn("Graceful shutdown timed out after 30s — forcing exit");
      process.exit(1);
    }, 30_000);

    try {
      await app.close();
      app.log.info("Fastify server closed");

      // Stop the Transfer Desk workers BEFORE closing tenant DB connections
      // — workers hold tenant Prisma clients via the same pool.
      await disconnectAllTransferDeskWorkers();
      await disconnectAllTransferDeskQueues();
      app.log.info("Transfer Desk workers + queues closed");

      await Promise.allSettled([disconnectAllTenants(), disconnectRegistry(), disconnectRedis()]);
      app.log.info("All database connections released");
    } catch (err) {
      app.log.error(err, "Error during shutdown");
    } finally {
      clearTimeout(closeTimeout);
      process.exit(0);
    }
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
