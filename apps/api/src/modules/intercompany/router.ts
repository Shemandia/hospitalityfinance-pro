import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../../db/prisma.js";
import type { PrismaClient } from "../../db/client.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import { IntercompanyService } from "./service.js";
import { mapError } from "../../shared/router-utils.js";
import {
  createICEntityPairSchema,
  updateICEntityPairSchema,
  createICAccountMappingSchema,
  updateICAccountMappingSchema,
  createICTransactionSchema,
  rejectICTransactionSchema,
  // Legacy schemas
  createICAccountPairSchema,
  updateICAccountPairSchema
} from "./types.js";

const icService = new IntercompanyService(prisma as unknown as PrismaClient);

function getActorId(request: any): string {
  return request.user?.id ?? request.user?.sub ?? "system";
}

function getEntityId(request: any, reply: FastifyReply): string | null {
  const entityId = request.entityId;
  if (!entityId) {
    reply.code(400).send({
      data: null,
      errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
    });
    return null;
  }
  return entityId;
}

export async function registerIntercompanyRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ═════════════════════════════════════════════════════════════════════
      // v2 Configuration Endpoints (IC_CONFIG permission)
      // ═════════════════════════════════════════════════════════════════════

      // ── Entity Pairs ──────────────────────────────────────────────────

      router.get("/v2/pairs", {
        preHandler: requirePermission(["IC_READ", "IC_CONFIG"]),
        handler: async (_request, reply) => {
          try {
            const data = await icService.listEntityPairs();
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.get<{ Params: { id: string } }>("/v2/pairs/:id", {
        preHandler: requirePermission(["IC_READ", "IC_CONFIG"]),
        handler: async (request, reply) => {
          try {
            const data = await icService.getEntityPair(request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.post("/v2/pairs", {
        preHandler: requirePermission("IC_CONFIG"),
        handler: async (request, reply) => {
          try {
            const payload = createICEntityPairSchema.parse(request.body);
            const data = await icService.createEntityPair(payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.put<{ Params: { id: string } }>("/v2/pairs/:id", {
        preHandler: requirePermission("IC_CONFIG"),
        handler: async (request, reply) => {
          try {
            const payload = updateICEntityPairSchema.parse(request.body);
            const data = await icService.updateEntityPair(request.params.id, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.delete<{ Params: { id: string } }>("/v2/pairs/:id", {
        preHandler: requirePermission("IC_CONFIG"),
        handler: async (request, reply) => {
          try {
            await icService.deleteEntityPair(request.params.id);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      // ── Account Mappings ──────────────────────────────────────────────

      router.get<{ Params: { pairId: string } }>("/v2/pairs/:pairId/mappings", {
        preHandler: requirePermission(["IC_READ", "IC_CONFIG"]),
        handler: async (request, reply) => {
          try {
            const data = await icService.listAccountMappings(request.params.pairId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.post("/v2/mappings", {
        preHandler: requirePermission("IC_CONFIG"),
        handler: async (request, reply) => {
          try {
            const payload = createICAccountMappingSchema.parse(request.body);
            const data = await icService.createAccountMapping(payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.put<{ Params: { id: string } }>("/v2/mappings/:id", {
        preHandler: requirePermission("IC_CONFIG"),
        handler: async (request, reply) => {
          try {
            const payload = updateICAccountMappingSchema.parse(request.body);
            const data = await icService.updateAccountMapping(request.params.id, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.delete<{ Params: { id: string } }>("/v2/mappings/:id", {
        preHandler: requirePermission("IC_CONFIG"),
        handler: async (request, reply) => {
          try {
            await icService.deleteAccountMapping(request.params.id);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      // ═════════════════════════════════════════════════════════════════════
      // v2 Transaction Endpoints
      // ═════════════════════════════════════════════════════════════════════

      router.get("/v2/transactions", {
        preHandler: requirePermission("IC_READ"),
        handler: async (request, reply) => {
          try {
            const query = request.query as any;
            const entityId = getEntityId(request, reply);
            if (!entityId) return;
            const data = await icService.listTransactions({
              entityId,
              pairId: query.pairId,
              status: query.status
            });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.get<{ Params: { id: string } }>("/v2/transactions/:id", {
        preHandler: requirePermission("IC_READ"),
        handler: async (request, reply) => {
          try {
            const data = await icService.getTransaction(request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.post("/v2/transactions", {
        preHandler: requirePermission("IC_CREATE"),
        handler: async (request, reply) => {
          try {
            const entityId = getEntityId(request, reply);
            if (!entityId) return;
            const payload = createICTransactionSchema.parse(request.body);
            const actorId = getActorId(request);
            const data = await icService.createTransaction(entityId, actorId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.post<{ Params: { id: string } }>("/v2/transactions/:id/approve", {
        preHandler: requirePermission("IC_APPROVE"),
        handler: async (request, reply) => {
          try {
            const actorId = getActorId(request);
            const data = await icService.approveTransaction(request.params.id, actorId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.post<{ Params: { id: string } }>("/v2/transactions/:id/reject", {
        preHandler: requirePermission("IC_APPROVE"),
        handler: async (request, reply) => {
          try {
            const body = rejectICTransactionSchema.parse(request.body ?? {});
            const actorId = getActorId(request);
            const data = await icService.rejectTransaction(request.params.id, actorId, body.reason);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.post<{ Params: { id: string } }>("/v2/transactions/:id/reverse", {
        preHandler: requirePermission("IC_REVERSE"),
        handler: async (request, reply) => {
          try {
            const actorId = getActorId(request);
            const body = request.body as any;
            const data = await icService.reverseTransaction(
              request.params.id,
              actorId,
              body?.reason
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      // ═════════════════════════════════════════════════════════════════════
      // v2 Reconciliation Endpoints
      // ═════════════════════════════════════════════════════════════════════

      router.get("/v2/reconciliation", {
        preHandler: requirePermission(["IC_READ", "IC_RECONCILE"]),
        handler: async (_request, reply) => {
          try {
            const data = await icService.getReconciliation();
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.post("/v2/reconciliation/snapshot", {
        preHandler: requirePermission("IC_RECONCILE"),
        handler: async (request, reply) => {
          try {
            const body = request.body as any;
            if (!body?.pairId || !body?.periodId) {
              return reply.code(400).send({
                data: null,
                errors: [{ code: "VALIDATION_ERROR", message: "pairId and periodId are required." }]
              });
            }
            const actorId = getActorId(request);
            const data = await icService.createReconciliationSnapshot(
              body.pairId,
              body.periodId,
              actorId,
              body.notes
            );
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      // ═════════════════════════════════════════════════════════════════════
      // Legacy v1 Endpoints (backward compatibility)
      // ═════════════════════════════════════════════════════════════════════

      router.get("/account-pairs", {
        preHandler: requirePermission("IC_READ"),
        handler: async (request, reply) => {
          try {
            const entityId = getEntityId(request, reply);
            if (!entityId) return;
            const data = await icService.listAccountPairs(entityId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.post("/account-pairs", {
        preHandler: [requirePermission("IC_CONFIG"), requireWriteAccess],
        handler: async (request, reply) => {
          try {
            const entityId = getEntityId(request, reply);
            if (!entityId) return;
            const payload = createICAccountPairSchema.parse(request.body);
            const data = await icService.createAccountPair(entityId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.put<{ Params: { id: string } }>("/account-pairs/:id", {
        preHandler: [requirePermission("IC_CONFIG"), requireWriteAccess],
        handler: async (request, reply) => {
          try {
            const entityId = getEntityId(request, reply);
            if (!entityId) return;
            const payload = updateICAccountPairSchema.parse(request.body);
            const data = await icService.updateAccountPair(entityId, request.params.id, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.delete<{ Params: { id: string } }>("/account-pairs/:id", {
        preHandler: [requirePermission("IC_CONFIG"), requireWriteAccess],
        handler: async (request, reply) => {
          try {
            const entityId = getEntityId(request, reply);
            if (!entityId) return;
            await icService.deleteAccountPair(entityId, request.params.id);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      router.get("/journals", {
        preHandler: requirePermission("IC_READ"),
        handler: async (request, reply) => {
          try {
            const entityId = getEntityId(request, reply);
            if (!entityId) return;
            const data = await icService.listICJournals(entityId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      });

      // IC-4 (audit 2026-07-08): the legacy create/approve path posts BOTH legs of
      // the IC journal into the SAME entity's pair accounts — economically null in
      // the source entity and nothing in the mirror entity (silent liability loss).
      // Creation and approval (which triggers the posting) are permanently disabled
      // in favor of the atomic dual-posting flow at POST /v2/transactions.
      // GET /journals and POST /journals/:id/reject remain for read access and
      // cleanup of pre-existing legacy drafts.
      router.post("/journals", {
        preHandler: [requirePermission("IC_CREATE"), requireWriteAccess],
        handler: async (_request, reply) => {
          return reply.code(410).send({
            data: null,
            errors: [
              {
                code: "IC_LEGACY_JOURNALS_GONE",
                message:
                  "The legacy intercompany /journals posting path has been retired because it posted both legs to the same entity. Use POST /api/v1/intercompany/v2/transactions instead."
              }
            ]
          });
        }
      });

      router.post<{ Params: { id: string } }>("/journals/:id/approve", {
        preHandler: [requirePermission("IC_APPROVE"), requireWriteAccess],
        handler: async (_request, reply) => {
          return reply.code(410).send({
            data: null,
            errors: [
              {
                code: "IC_LEGACY_JOURNALS_GONE",
                message:
                  "Approving legacy intercompany journals has been retired because posting was economically null. Recreate the journal via POST /api/v1/intercompany/v2/transactions; reject remains available for cleaning up legacy drafts."
              }
            ]
          });
        }
      });

      router.post<{ Params: { id: string } }>("/journals/:id/reject", {
        preHandler: [requirePermission("IC_APPROVE"), requireWriteAccess],
        handler: async (request, reply) => {
          try {
            const entityId = getEntityId(request, reply);
            if (!entityId) return;
            const actorId = getActorId(request);
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
        }
      });
    },
    { prefix: "/api/v1/intercompany" }
  );
}
