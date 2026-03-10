import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { enterRequestContext, updateRequestContext } from "./db/requestContext.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireRole } from "./middleware/requireRole.js";
import { registerGLRouter } from "./modules/gl/router.js";
import { registerPeriodRouter } from "./modules/period/router.js";
import { registerAuditRouter } from "./modules/audit/router.js";
import { registerReportingRouter } from "./modules/reporting/router.js";
import { registerAPRouter } from "./modules/ap/router.js";
import { registerARRouter } from "./modules/ar/router.js";
import { registerFXRouter } from "./modules/fx/router.js";
import { registerBudgetRouter } from "./modules/budget/router.js";
import { registerConsolidationRouter } from "./modules/consolidation/router.js";
import { registerIntegrationRouter } from "./modules/integration/router.js";
import { registerKPIRouter } from "./modules/kpi/router.js";
import authPlugin from "./plugins/auth.js";

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true
  });

  await app.register(authPlugin);

  app.addHook("onRequest", async (request) => {
    enterRequestContext({
      ipAddress: request.ip ?? null,
      userAgent: request.headers["user-agent"] ?? null
    });
  });

  app.addHook("preHandler", async (request) => {
    updateRequestContext({
      entityId: request.entityId ?? null,
      chainId: request.chainId ?? null,
      userId: typeof request.user?.sub === "string" ? request.user.sub : null
    });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/api/v1/me", { preHandler: [requireAuth] }, async (request) => {
    return {
      data: {
        user: request.user,
        entityId: request.entityId,
        chainId: request.chainId
      },
      errors: []
    };
  });

  app.get(
    "/api/v1/admin",
    { preHandler: [requireAuth, requireRole(["ADMIN", "SUPERADMIN"])] },
    async () => ({
      data: { message: "Role-gated endpoint is accessible." },
      errors: []
    })
  );

  await registerGLRouter(app);
  await registerPeriodRouter(app);
  await registerAuditRouter(app);
  await registerReportingRouter(app);
  await registerAPRouter(app);
  await registerARRouter(app);
  await registerFXRouter(app);
  await registerBudgetRouter(app);
  await registerConsolidationRouter(app);
  await registerIntegrationRouter(app);
  await registerKPIRouter(app);

  return app;
}
