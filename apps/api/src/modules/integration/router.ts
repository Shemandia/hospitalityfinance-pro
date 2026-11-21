import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { requireAuth } from "../../middleware/requireAuth.js";
import { registerOperaRoutes } from "./routes/opera.js";
import { registerJanaRoutes } from "./routes/jana.js";
import { registerBankRoutes } from "./routes/bank.js";
import { registerSimphonyRoutes } from "./routes/simphony.js";
import { registerMewsRoutes } from "./routes/mews.js";
import { registerPayrollRoutes } from "./routes/payroll.js";
import { registerSAFRoutes } from "./routes/saf.js";
import { registerInboundRoutes } from "./routes/inbound.js";
import { registerInterfaceRoutes } from "./routes/interfaces.js";
import { registerIntegrationRoutes } from "./routes/pipeline.js";
import { registerImportOpsRoutes } from "./routes/imports.js";

export async function registerIntegrationRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      await router.register(rateLimit, { max: 10, timeWindow: "1 minute" });

      registerOperaRoutes(router);
      registerJanaRoutes(router);
      registerBankRoutes(router);
      registerSimphonyRoutes(router);
      registerMewsRoutes(router);
      registerPayrollRoutes(router);
      registerSAFRoutes(router);
      registerInboundRoutes(router);
      registerInterfaceRoutes(router);
      registerIntegrationRoutes(router);
      registerImportOpsRoutes(router);
    },
    { prefix: "/api/v1/integrations" }
  );
}
