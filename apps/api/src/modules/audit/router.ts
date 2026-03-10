import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { auditQuerySchema } from "./types.js";
import { AuditService, AuditServiceError } from "./service.js";

const auditService = new AuditService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((issue) => issue.message).join("; ") }]
    });
  }

  if (error instanceof AuditServiceError) {
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
    throw new AuditServiceError(
      "AUDIT_ENTITY_CONTEXT_REQUIRED",
      "X-Entity-ID header is required.",
      400
    );
  }
  return entityId;
}

export async function registerAuditRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      router.get("/audit", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = auditQuerySchema.parse(request.query);
          const data = await auditService.getEvents(entityId, query);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });
    },
    { prefix: "/api/v1" }
  );
}
