import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import {
  runWithContext,
  enterRequestContext,
  getRequestContext,
  updateRequestContext
} from "./db/requestContext.js";
import { prisma } from "./db/prisma.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { logSerializers } from "./shared/log-redactor.js";
import { registerGLRouter } from "./modules/gl/router.js";
import { registerPeriodRouter } from "./modules/period/router.js";
import { registerPeriodCloseRouter } from "./modules/period-close/router.js";
import { registerAuditRouter } from "./modules/audit/router.js";
import { registerReportingRouter } from "./modules/reporting/router.js";
import { registerAPRouter } from "./modules/ap/router.js";
import { registerARRouter } from "./modules/ar/router.js";
import { registerFXRouter } from "./modules/fx/router.js";
import { registerBudgetRouter } from "./modules/budget/router.js";
import { registerConsolidationRouter } from "./modules/consolidation/router.js";
import { registerIntegrationRouter } from "./modules/integration/router.js";
import { registerKPIRouter } from "./modules/kpi/router.js";
import { registerProcessLockRouter } from "./modules/process-lock/router.js";
import { registerAllocationRouter } from "./modules/allocation/router.js";
import { registerFixedAssetRouter } from "./modules/fixed-asset/router.js";
import { registerAuthorizationRouter } from "./modules/authorization/router.js";
import { registerAdminRouter } from "./modules/admin/router.js";
import { registerTenantRouter } from "./modules/tenant/router.js";
import { registerAccountTypeRouter } from "./modules/account-type/router.js";
import { registerSetupRouter } from "./modules/setup/router.js";
import { registerTransferDeskProfileRouter } from "./modules/transfer-desk/router.js";
import { registerTransferDeskBatchRouter } from "./modules/transfer-desk/batch-router.js";
import { registerFsdRouter } from "./modules/transfer-desk/fsd-router.js";
import { registerMappingsRouter } from "./modules/transfer-desk/mappings-router.js";
import { registerLookupRouter } from "./modules/transfer-desk/lookup-router.js";
import { registerTestRouter } from "./modules/transfer-desk/test-router.js";
import { registerScheduleRouter } from "./modules/transfer-desk/schedule-router.js";
import { registerIntercompanyRouter } from "./modules/intercompany/router.js";
import authPlugin from "./plugins/auth.js";
import { registerRouteAccessRegistry, type RouteAccess } from "./modules/access/route-access.js";
import { AccessInfrastructureError } from "./modules/access/service.js";
import { registerAuthRouter } from "./modules/auth/router.js";
import { connectRedis } from "./db/redis.js";
import { registerEntityRouter } from "./modules/entity/router.js";

declare module "fastify" {
  interface FastifyInstance {
    /** "METHOD /url" -> how the route is protected. Filled as routes register. */
    routeAccess: ReadonlyMap<string, RouteAccess>;
  }
}

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      serializers: logSerializers
    },
    bodyLimit: 10 * 1024 * 1024 // 10 MB for file imports
  });

  // A database or cache fault while access is being checked or changed is an
  // outage, not a denial and not a sign-out (AUT-10).
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AccessInfrastructureError) {
      request.log.error({ err: error, dependency: error.dependency }, "Access service unavailable");
      return reply.code(503).send({
        data: null,
        errors: [
          {
            code: "SERVICE_UNAVAILABLE",
            message: "Access could not be checked or changed. Try again in a moment."
          }
        ]
      });
    }
    return reply.send(error);
  });

  // Before any route: a route without an access classification fails startup.
  app.decorate("routeAccess", registerRouteAccessRegistry(app));

  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:3001"
  )
    .split(",")
    .map((o) => o.trim());

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true
  });

  // CSRF protection: validate Origin header on state-mutating requests
  app.addHook("onRequest", async (request, reply) => {
    const method = request.method.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const origin = request.headers.origin;
      // Require Origin header on all mutations — reject if missing or not allowed
      // Exception: internal health-check and webhook paths that may lack a browser Origin
      const path = request.url;
      const isInternalPath = path === "/health" || path.startsWith("/webhooks/");
      if (!isInternalPath) {
        if (!origin) {
          reply.code(403);
          throw new Error("Origin header is required for state-mutating requests");
        }
        if (!allowedOrigins.includes(origin)) {
          reply.code(403);
          throw new Error(`Origin ${origin} not allowed`);
        }
      }
    }
  });

  // Global rate limit: 200 req/min per IP
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute"
  });

  await app.register(authPlugin);

  // Connect Redis for session management
  await connectRedis();

  app.addHook("onRequest", async (request, reply) => {
    // Generate or accept request ID for end-to-end tracing
    const requestId = (request.headers["x-request-id"] as string) || randomUUID();
    reply.header("x-request-id", requestId);

    // Initialize request context with ID, IP, UA. Tenant context set later by auth.
    enterRequestContext({
      requestId,
      ipAddress: request.ip ?? null,
      userAgent: request.headers["user-agent"] ?? null
    });

    // Attach to Fastify logger for structured log correlation
    (request as any).requestId = requestId;
  });

  // Auth routes (/auth/login, /auth/refresh, /auth/logout, etc.). Registered
  // after the hook above so that they run inside a request context too.
  await registerAuthRouter(app);

  // ── Health, Readiness & Version ───────────────────────────────────────────

  const startTime = Date.now();

  app.get("/health", { config: { access: "public" } }, async () => {
    let dbOk = false;
    let redisOk = false;

    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      /* database unreachable */
    }

    try {
      // Redis check — use the shared ioredis client
      const { getRedisClient } = await import("./db/redis.js");
      const redis = getRedisClient();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Redis ping timeout")), 3000)
      );
      await Promise.race([redis.ping(), timeout]);
      redisOk = true;
    } catch {
      /* redis unreachable */
    }

    const status = dbOk ? (redisOk ? "ok" : "degraded") : "down";
    return {
      status,
      version: process.env.APP_VERSION ?? "1.0.0",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      checks: {
        database: dbOk ? "ok" : "down",
        redis: redisOk ? "ok" : "down"
      }
    };
  });

  app.get("/ready", { config: { access: "public" } }, async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const { getRedisClient } = await import("./db/redis.js");
      await getRedisClient().ping();
      return reply.send({ ready: true });
    } catch {
      return reply.code(503).send({ ready: false, reason: "database or redis unreachable" });
    }
  });

  app.get("/api/v1/version", { config: { access: "public" } }, async () => ({
    version: process.env.APP_VERSION ?? "1.0.0",
    buildDate: process.env.BUILD_DATE ?? new Date().toISOString().split("T")[0],
    nodeVersion: process.version,
    environment: process.env.NODE_ENV ?? "development"
  }));

  app.get(
    "/api/v1/me",
    { preHandler: [requireAuth], config: { access: "session" } },
    async (request) => {
      return {
        data: {
          user: request.user,
          // The entity bound to the request: null unless the caller can open it (AUT-15).
          entityId: getRequestContext().entityId,
          chainId: getRequestContext().chainId
        },
        errors: []
      };
    }
  );

  await registerEntityRouter(app);

  await registerGLRouter(app);
  await registerPeriodRouter(app);
  await registerPeriodCloseRouter(app);
  await registerAuditRouter(app);
  await registerReportingRouter(app);
  await registerAPRouter(app);
  await registerARRouter(app);
  await registerFXRouter(app);
  await registerBudgetRouter(app);
  await registerConsolidationRouter(app);
  await registerIntegrationRouter(app);
  await registerKPIRouter(app);
  await registerProcessLockRouter(app);
  await registerAllocationRouter(app);
  await registerFixedAssetRouter(app);
  await registerAuthorizationRouter(app);
  await registerAdminRouter(app);
  await registerTenantRouter(app);
  await registerAccountTypeRouter(app);
  await registerSetupRouter(app);
  await registerTransferDeskProfileRouter(app);
  await registerTransferDeskBatchRouter(app);
  await registerFsdRouter(app);
  await registerMappingsRouter(app);
  await registerLookupRouter(app);
  await registerTestRouter(app);
  await registerScheduleRouter(app);
  await registerIntercompanyRouter(app);

  return app;
}
