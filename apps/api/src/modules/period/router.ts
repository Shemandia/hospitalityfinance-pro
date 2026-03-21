import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import { periodListQuerySchema, periodCreateSchema } from "./types.js";
import { PeriodService, PeriodServiceError } from "./service.js";

const periodService = new PeriodService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [
        { code: "VALIDATION_ERROR", message: error.issues.map((issue) => issue.message).join("; ") }
      ]
    });
  }

  if (error instanceof PeriodServiceError) {
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
    throw new PeriodServiceError(
      "PERIOD_ENTITY_CONTEXT_REQUIRED",
      "X-Entity-ID header is required.",
      400
    );
  }
  return entityId;
}

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new PeriodServiceError("PERIOD_USER_CONTEXT_REQUIRED", "Token subject is required.", 401);
  }
  return sub;
}

export async function registerPeriodRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      router.post("/periods", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = periodCreateSchema.parse(request.body);
          const data = await periodService.createPeriod(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/periods", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = periodListQuerySchema.parse(request.query);
          const data = await periodService.listPeriods(entityId, query);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>("/periods/:id/close", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const closedBy = requireUserId(request.user?.sub);
          const data = await periodService.closePeriod(entityId, request.params.id, closedBy);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>("/periods/:id/lock", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await periodService.lockPeriod(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>(
        "/periods/:id/reopen",
        { preHandler: [requireRole(["SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userRoles = request.user?.roles ?? [];
            const data = await periodService.reopenPeriod(entityId, request.params.id, userRoles);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1" }
  );
}
