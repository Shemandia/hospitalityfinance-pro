import { startupConfig } from "./config.js";

// First, before any other module loads: exit naming every missing or invalid
// setting, rather than failing inside whichever module needs it first.
const { PORT: port } = startupConfig("api");

const { logger: startLog, reportRenamedSettings } = await import("./shared/logger.js");
reportRenamedSettings(startLog);
const { createApp } = await import("./app.js");
const { disconnectAllTenants } = await import("./db/tenantPool.js");
const { disconnectRegistry } = await import("./db/tenantRegistry.js");
const { disconnectRedis } = await import("./db/redis.js");
const { disconnectAllIntegrationQueues } = await import("./jobs/integration-queue.js");

async function start(): Promise<void> {
  const app = await createApp();
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info(`API listening on port ${port}`);

  // Background workers, Integrations included, run in the worker process
  // (pnpm workers), not here. The API only enqueues (OPS-10).

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

      await disconnectAllIntegrationQueues();
      app.log.info("Integrations queues closed");

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
  startLog.fatal({ err: error }, "API failed to start");
  process.exit(1);
});
