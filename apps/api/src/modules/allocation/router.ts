import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import {
  allocationCreateSchema,
  allocationUpdateSchema,
  allocationListQuerySchema,
  allocationExecuteSchema
} from "./types.js";
import { AllocationService, AllocationServiceError } from "./service.js";

const allocationService = new AllocationService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [
        {
          code: "VALIDATION_ERROR",
          message: error.issues.map((issue) => issue.message).join("; ")
        }
      ]
    });
  }

  if (error instanceof AllocationServiceError) {
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
    throw new AllocationServiceError(
      "ALLOCATION_ENTITY_CONTEXT_REQUIRED",
      "X-Entity-ID header is required.",
      400
    );
  }
  return entityId;
}

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new AllocationServiceError(
      "ALLOCATION_USER_CONTEXT_REQUIRED",
      "Token subject is required.",
      401
    );
  }
  return sub;
}

export async function registerAllocationRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      // ── CRUD ─────────────────────────────────────────────────────────────

      router.get("/allocations", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = allocationListQuerySchema.parse(request.query);
          const data = await allocationService.listDefinitions(entityId, query);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/allocations/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await allocationService.getDefinition(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post(
        "/allocations",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN", "CONTROLLER"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const payload = allocationCreateSchema.parse(request.body);
            const data = await allocationService.createDefinition(entityId, userId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/allocations/:id",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN", "CONTROLLER"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = allocationUpdateSchema.parse(request.body);
            const data = await allocationService.updateDefinition(
              entityId,
              request.params.id,
              payload
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/allocations/:id",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            await allocationService.deleteDefinition(entityId, request.params.id);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Dry-run ──────────────────────────────────────────────────────────

      router.post<{ Params: { id: string } }>(
        "/allocations/:id/dry-run",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN", "CONTROLLER"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = allocationExecuteSchema.parse(request.body ?? {});
            const data = await allocationService.calculateAllocation(
              entityId,
              request.params.id,
              periodId
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Execute ──────────────────────────────────────────────────────────

      router.post<{ Params: { id: string } }>(
        "/allocations/:id/execute",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const { periodId } = allocationExecuteSchema.parse(request.body ?? {});
            const data = await allocationService.executeAllocation(
              entityId,
              request.params.id,
              userId,
              periodId
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Run all stepped ──────────────────────────────────────────────────

      router.post(
        "/allocations/run-all",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const { periodId } = allocationExecuteSchema.parse(request.body ?? {});
            const data = await allocationService.runSteppedAllocations(entityId, userId, periodId);
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
