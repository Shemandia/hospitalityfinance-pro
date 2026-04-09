import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import {
  stageCreateSchema,
  stageUpdateSchema,
  teamCreateSchema,
  teamUpdateSchema,
  delegationCreateSchema,
  rejectionCodeCreateSchema,
  approveSchema,
  rejectSchema,
  returnSchema,
  voidSchema,
  bulkApproveSchema,
  bulkRejectSchema,
  setCreateSchema,
  setAddJournalsSchema,
  setRejectSchema,
  queueFilterSchema
} from "./types.js";
import { AuthorizationService, AuthorizationServiceError } from "./service.js";

const authorizationService = new AuthorizationService(prisma as unknown as PrismaClient);

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

  if (error instanceof AuthorizationServiceError) {
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
    throw new AuthorizationServiceError(
      "AUTH_ENTITY_CONTEXT_REQUIRED",
      "X-Entity-ID header is required.",
      400
    );
  }
  return entityId;
}

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new AuthorizationServiceError(
      "AUTH_USER_CONTEXT_REQUIRED",
      "Token subject is required.",
      401
    );
  }
  return sub;
}

export async function registerAuthorizationRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      // ── Stages ────────────────────────────────────────────────────────

      router.get("/authorization/stages", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { journalTypeId } = request.query as any;
          const data = await authorizationService.listStages(entityId, journalTypeId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post(
        "/authorization/stages",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = stageCreateSchema.parse(request.body);
            const data = await authorizationService.createStage(entityId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/authorization/stages/:id",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = stageUpdateSchema.parse(request.body);
            const data = await authorizationService.updateStage(
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
        "/authorization/stages/:id",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            await authorizationService.deleteStage(entityId, request.params.id);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Teams ─────────────────────────────────────────────────────────

      router.get("/authorization/teams", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await authorizationService.listTeams(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post(
        "/authorization/teams",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = teamCreateSchema.parse(request.body);
            const data = await authorizationService.createTeam(entityId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/authorization/teams/:id",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = teamUpdateSchema.parse(request.body);
            const data = await authorizationService.updateTeam(
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
        "/authorization/teams/:id",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            await authorizationService.deleteTeam(entityId, request.params.id);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Delegations ───────────────────────────────────────────────────

      router.get("/authorization/delegations", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await authorizationService.listDelegations(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post(
        "/authorization/delegations",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = delegationCreateSchema.parse(request.body);
            const data = await authorizationService.createDelegation(entityId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/authorization/delegations/:id",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            await authorizationService.revokeDelegation(entityId, request.params.id);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Rejection Codes ───────────────────────────────────────────────

      router.get("/authorization/rejection-codes", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await authorizationService.listRejectionCodes(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post(
        "/authorization/rejection-codes",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = rejectionCodeCreateSchema.parse(request.body);
            const data = await authorizationService.createRejectionCode(entityId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Authorization Queue ───────────────────────────────────────────

      router.get("/authorization/queue", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const userId = requireUserId(request.user?.sub);
          const filters = queueFilterSchema.parse(request.query);
          const data = await authorizationService.getAuthorizationQueue(entityId, userId, filters);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Workflow Actions ──────────────────────────────────────────────

      router.post<{ Params: { journalId: string } }>(
        "/authorization/approve/:journalId",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const { comments } = approveSchema.parse(request.body);
            const data = await authorizationService.approveStage(
              entityId,
              request.params.journalId,
              userId,
              comments
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { journalId: string } }>(
        "/authorization/reject/:journalId",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const { rejectionCodeId, comments } = rejectSchema.parse(request.body);
            const data = await authorizationService.rejectStage(
              entityId,
              request.params.journalId,
              userId,
              rejectionCodeId,
              comments
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { journalId: string } }>(
        "/authorization/return/:journalId",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const { comments } = returnSchema.parse(request.body);
            const data = await authorizationService.returnForAmendment(
              entityId,
              request.params.journalId,
              userId,
              comments
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { journalId: string } }>(
        "/authorization/void/:journalId",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const { comments } = voidSchema.parse(request.body);
            const data = await authorizationService.voidJournal(
              entityId,
              request.params.journalId,
              userId,
              comments
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { journalId: string } }>(
        "/authorization/resubmit/:journalId",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const data = await authorizationService.resubmit(
              entityId,
              request.params.journalId,
              userId
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Bulk Actions ──────────────────────────────────────────────────

      router.post("/authorization/bulk-approve", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const userId = requireUserId(request.user?.sub);
          const { journalIds, comments } = bulkApproveSchema.parse(request.body);
          const data = await authorizationService.bulkApprove(
            entityId,
            journalIds,
            userId,
            comments
          );
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/authorization/bulk-reject", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const userId = requireUserId(request.user?.sub);
          const { journalIds, rejectionCodeId, comments } = bulkRejectSchema.parse(request.body);
          const data = await authorizationService.bulkReject(
            entityId,
            journalIds,
            userId,
            rejectionCodeId,
            comments
          );
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Authorization Sets ────────────────────────────────────────────

      router.get("/authorization/sets", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await authorizationService.listSets(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/authorization/sets", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const userId = requireUserId(request.user?.sub);
          const payload = setCreateSchema.parse(request.body);
          const data = await authorizationService.createSet(entityId, userId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>(
        "/authorization/sets/:id/add",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { journalIds } = setAddJournalsSchema.parse(request.body);
            const data = await authorizationService.addJournalsToSet(
              entityId,
              request.params.id,
              journalIds
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/authorization/sets/:id/approve",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const { comments } = approveSchema.parse(request.body);
            const data = await authorizationService.approveSet(
              entityId,
              request.params.id,
              userId,
              comments
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/authorization/sets/:id/reject",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const { rejectionCodeId, comments } = setRejectSchema.parse(request.body);
            const data = await authorizationService.rejectSet(
              entityId,
              request.params.id,
              userId,
              rejectionCodeId,
              comments
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── History ───────────────────────────────────────────────────────

      router.get<{ Params: { journalId: string } }>(
        "/authorization/history/:journalId",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await authorizationService.getHistory(entityId, request.params.journalId);
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
