import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { ConsolidationService, ConsolidationServiceError } from "./service.js";

const consolidationService = new ConsolidationService(prisma as unknown as PrismaClient);

const runConsolidationSchema = z.object({
  parentEntityId: z.string().uuid(),
  childEntityIds: z.array(z.string().uuid()).min(1),
  reportingCurrency: z.string().length(3).toUpperCase(),
  periodId: z.string().uuid()
});

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof ConsolidationServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

export async function registerConsolidationRouter(app: FastifyInstance): Promise<void> {
  app.register(async (router) => {
    router.addHook("preHandler", requireAuth);

    router.get<{ Params: { parentEntityId: string } }>(
      "/:parentEntityId/runs",
      async (request, reply) => {
        try {
          const data = await consolidationService.listRuns(request.params.parentEntityId);
          return reply.send({ data, errors: [] });
        } catch (error) { return mapError(reply, error); }
      }
    );

    router.get<{ Params: { parentEntityId: string; runId: string } }>(
      "/:parentEntityId/runs/:runId",
      async (request, reply) => {
        try {
          const data = await consolidationService.getRun(
            request.params.parentEntityId,
            request.params.runId
          );
          return reply.send({ data, errors: [] });
        } catch (error) { return mapError(reply, error); }
      }
    );

    router.post("/run", async (request, reply) => {
      try {
        const payload = runConsolidationSchema.parse(request.body);
        const data = await consolidationService.runConsolidation(payload);
        return reply.code(201).send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });
  }, { prefix: "/api/v1/consolidation" });
}
