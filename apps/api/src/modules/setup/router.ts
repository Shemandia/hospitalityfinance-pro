import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { SetupService } from "./service.js";

export async function registerSetupRouter(app: FastifyInstance): Promise<void> {
  const service = new SetupService();

  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      router.get("/progress", { config: { access: "session" } }, async (request, reply) => {
        const tenantSlug = request.tenantSlug ?? (request.user as any)?.tenantSlug;
        if (!tenantSlug) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "TENANT_REQUIRED", message: "Tenant context required." }]
          });
        }
        const progress = await service.getProgress(tenantSlug);
        return { data: progress, errors: [] };
      });

      router.put<{ Params: { step: string }; Querystring: { saveOnly?: string } }>(
        "/steps/:step",
        { preHandler: [requirePermission("ADMIN_SETTINGS", { scope: "tenant" })] },
        async (request, reply) => {
          const tenantSlug = request.tenantSlug ?? (request.user as any)?.tenantSlug;
          if (!tenantSlug) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "TENANT_REQUIRED", message: "Tenant context required." }]
            });
          }
          const step = parseInt(request.params.step, 10);
          if (isNaN(step) || step < 1 || step > 6) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "INVALID_STEP", message: "Step must be 1-6." }]
            });
          }
          const saveOnly = request.query.saveOnly === "true";
          try {
            const result = await service.saveStep(tenantSlug, step, request.body, saveOnly);
            return { data: result, errors: [] };
          } catch (err) {
            if (err instanceof ZodError) {
              return reply.code(400).send({
                data: null,
                errors: err.errors.map((e) => ({
                  code: "VALIDATION_ERROR",
                  message: e.message,
                  path: e.path
                }))
              });
            }
            throw err;
          }
        }
      );

      router.post(
        "/complete",
        { preHandler: [requirePermission("ADMIN_SETTINGS", { scope: "tenant" })] },
        async (request, reply) => {
          const tenantSlug = request.tenantSlug ?? (request.user as any)?.tenantSlug;
          if (!tenantSlug) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "TENANT_REQUIRED", message: "Tenant context required." }]
            });
          }
          try {
            const result = await service.complete(tenantSlug);
            return { data: result, errors: [] };
          } catch (err: any) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "SETUP_INCOMPLETE", message: err.message }]
            });
          }
        }
      );
    },
    { prefix: "/api/v1/setup" }
  );
}
