import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import { ConsolidationService } from "./service.js";
import { mapError } from "../../shared/router-utils.js";

const consolidationService = new ConsolidationService(prisma as unknown as PrismaClient);

const runConsolidationSchema = z.object({
  parentEntityId: z.string().uuid(),
  childEntityIds: z.array(z.string().uuid()).min(1),
  reportingCurrency: z.string().length(3).toUpperCase(),
  periodId: z.string().uuid()
});

export async function registerConsolidationRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      router.get<{ Params: { parentEntityId: string } }>(
        "/:parentEntityId/runs",
        async (request, reply) => {
          try {
            if (request.entityId !== request.params.parentEntityId) {
              return reply.code(403).send({
                data: null,
                errors: [{ code: "CONSOLIDATION_FORBIDDEN", message: "No access to this entity." }]
              });
            }
            const data = await consolidationService.listRuns(request.params.parentEntityId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { parentEntityId: string; runId: string } }>(
        "/:parentEntityId/runs/:runId",
        async (request, reply) => {
          try {
            if (request.entityId !== request.params.parentEntityId) {
              return reply.code(403).send({
                data: null,
                errors: [{ code: "CONSOLIDATION_FORBIDDEN", message: "No access to this entity." }]
              });
            }
            const data = await consolidationService.getRun(
              request.params.parentEntityId,
              request.params.runId
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/run",
        { preHandler: [requirePermission("CONSOLIDATION_RUN")] },
        async (request, reply) => {
          try {
            const payload = runConsolidationSchema.parse(request.body);
            if (request.entityId !== payload.parentEntityId) {
              return reply.code(403).send({
                data: null,
                errors: [{ code: "CONSOLIDATION_FORBIDDEN", message: "No access to this entity." }]
              });
            }
            const data = await consolidationService.runConsolidation(payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1/consolidation" }
  );
}
