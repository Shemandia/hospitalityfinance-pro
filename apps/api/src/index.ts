import { createApp } from "./app.js";
import { disconnectAllTenants } from "./db/tenantPool.js";
import { disconnectRegistry } from "./db/tenantRegistry.js";
import { disconnectAllTransferDeskQueues } from "./jobs/transfer-desk-queue.js";
import { disconnectAllTransferDeskWorkers } from "./jobs/transfer-desk-worker.js";

const port = Number(process.env.PORT ?? 3001);

async function start(): Promise<void> {
  const app = await createApp();
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API listening on port ${port}`);

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

      await Promise.allSettled([disconnectAllTenants(), disconnectRegistry()]);
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
