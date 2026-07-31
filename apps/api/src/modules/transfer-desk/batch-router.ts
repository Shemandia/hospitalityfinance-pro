import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { z, ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { BatchReviewService, BatchReviewError } from "./batch-service.js";

const service = new BatchReviewService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof BatchReviewError) {
    return reply
      .code(error.statusCode)
      .send({ data: null, errors: [{ code: error.code, message: error.message }] });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

const rejectSchema = z.object({ reason: z.string().max(500).optional() });

/**
 * Every batch operation is scoped to the caller's entity. Without a resolved
 * entity there is nothing to scope to, and treating that as "match anything"
 * is precisely the cross-property exposure this guard exists to prevent — so
 * refuse rather than fall back.
 */
function requireEntityId(request: { entityId?: string }): string {
  if (!request.entityId) {
    throw new BatchReviewError(
      "ENTITY_CONTEXT_REQUIRED",
      "No entity context on the request; transfer batch operations are entity-scoped.",
      400
    );
  }
  return request.entityId;
}

export async function registerTransferDeskBatchRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requirePermission("TRANSFER_DESK_EXECUTE"));

      // ── GET /transfer-desk/batches — list batches ─────────────────────────

      router.get("/transfer-desk/batches", async (request, reply) => {
        try {
          const q = request.query as { status?: string; profileId?: string };
          const data = await service.listBatches({
            entityId: request.entityId,
            status: q.status,
            profileId: q.profileId
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── GET /transfer-desk/batches/:id — get batch detail ─────────────────

      router.get<{ Params: { id: string } }>(
        "/transfer-desk/batches/:id",
        async (request, reply) => {
          try {
            const data = await service.getBatch(requireEntityId(request), request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── POST /transfer-desk/batches/:id/items/:itemId/reject ──────────────

      router.post<{ Params: { id: string; itemId: string } }>(
        "/transfer-desk/batches/:id/items/:itemId/reject",
        async (request, reply) => {
          try {
            const { reason } = rejectSchema.parse(request.body ?? {});
            const userId = String((request.user as any)?.sub ?? "system");
            const data = await service.rejectItem(
              requireEntityId(request),
              request.params.id,
              request.params.itemId,
              userId,
              reason
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── POST /transfer-desk/batches/:id/items/:itemId/restore ─────────────

      router.post<{ Params: { id: string; itemId: string } }>(
        "/transfer-desk/batches/:id/items/:itemId/restore",
        async (request, reply) => {
          try {
            const data = await service.restoreItem(
              requireEntityId(request),
              request.params.id,
              request.params.itemId
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── POST /transfer-desk/batches/:id/commit ────────────────────────────

      router.post<{ Params: { id: string } }>(
        "/transfer-desk/batches/:id/commit",
        async (request, reply) => {
          try {
            const userId = String((request.user as any)?.sub ?? "system");
            const data = await service.commitBatch(
              requireEntityId(request),
              request.params.id,
              userId
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── POST /transfer-desk/batches/:id/discard ───────────────────────────

      router.post<{ Params: { id: string } }>(
        "/transfer-desk/batches/:id/discard",
        async (request, reply) => {
          try {
            const userId = String((request.user as any)?.sub ?? "system");
            const data = await service.discardBatch(
              requireEntityId(request),
              request.params.id,
              userId
            );
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
