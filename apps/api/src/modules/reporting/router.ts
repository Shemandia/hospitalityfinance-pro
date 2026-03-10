import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { createReportRunSchema } from "./types.js";
import { ReportingService, ReportingServiceError } from "./service.js";

const reportingService = new ReportingService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((issue) => issue.message).join("; ") }]
    });
  }

  if (error instanceof ReportingServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({
    data: null,
    errors: [{ code: "INTERNAL_SERVER_ERROR", message }]
  });
}

function requireEntityId(entityId: string | undefined): string {
  if (!entityId) {
    throw new ReportingServiceError(
      "REPORT_ENTITY_CONTEXT_REQUIRED",
      "X-Entity-ID header is required.",
      400
    );
  }
  return entityId;
}

export async function registerReportingRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      router.get("/reports/definitions", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await reportingService.listDefinitions(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/reports/runs", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = createReportRunSchema.parse(request.body ?? {});
          const data = await reportingService.createRun(entityId, payload);
          return reply.code(202).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/reports/runs/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await reportingService.getRun(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });
    },
    { prefix: "/api/v1" }
  );
}
