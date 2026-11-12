import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import {
  allocationCreateSchema,
  allocationUpdateSchema,
  allocationListQuerySchema,
  allocationExecuteSchema
} from "./types.js";
import { AllocationService, AllocationServiceError } from "./service.js";
import { mapError, requireEntityId } from "../../shared/router-utils.js";

const allocationService = new AllocationService(prisma as unknown as PrismaClient);

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
        { preHandler: [requirePermission("GL_WRITE")] },
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
        { preHandler: [requirePermission("GL_WRITE")] },
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
        { preHandler: [requirePermission("ADMIN_SETTINGS")] },
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
        { preHandler: [requirePermission("GL_WRITE")] },
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
        { preHandler: [requirePermission("ADMIN_SETTINGS")] },
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
        { preHandler: [requirePermission("ADMIN_SETTINGS")] },
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
