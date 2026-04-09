import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import type { PrismaClient } from "../../db/client.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import { IntercompanyService, IntercompanyServiceError } from "./service.js";
import {
  createICAccountPairSchema,
  updateICAccountPairSchema,
  createICJournalSchema
} from "./types.js";

const icService = new IntercompanyService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof IntercompanyServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

export async function registerIntercompanyRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      // ── IC Account Pairs ─────────────────────────────────────────────────

      router.get("/account-pairs", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
            });
          const data = await icService.listAccountPairs(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/account-pairs", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
            });
          const payload = createICAccountPairSchema.parse(request.body);
          const data = await icService.createAccountPair(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/account-pairs/:id", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
            });
          const payload = updateICAccountPairSchema.parse(request.body);
          const data = await icService.updateAccountPair(entityId, request.params.id, payload);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { id: string } }>("/account-pairs/:id", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
            });
          await icService.deleteAccountPair(entityId, request.params.id);
          return reply.code(204).send();
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── IC Journals ──────────────────────────────────────────────────────

      router.get("/journals", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
            });
          const data = await icService.listICJournals(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/journals", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
            });
          const payload = createICJournalSchema.parse(request.body);
          const actorId = (request as any).user?.id ?? (request as any).user?.sub ?? "system";
          const data = await icService.createICJournal(entityId, payload, actorId);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>("/journals/:id/approve", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
            });
          const actorId = (request as any).user?.id ?? (request as any).user?.sub ?? "system";
          const data = await icService.approveICJournal(request.params.id, entityId, actorId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>("/journals/:id/reject", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId)
            return reply.code(400).send({
              data: null,
              errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
            });
          const actorId = (request as any).user?.id ?? (request as any).user?.sub ?? "system";
          const body = request.body as any;
          const data = await icService.rejectICJournal(
            request.params.id,
            entityId,
            actorId,
            body?.reason
          );
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });
    },
    { prefix: "/api/v1/intercompany" }
  );
}
