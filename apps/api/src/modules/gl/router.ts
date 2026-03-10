import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { GLService, GLServiceError } from "./service.js";
import {
  accountCreateSchema,
  accountUpdateSchema,
  journalCreateSchema,
  journalDecisionSchema,
  journalListQuerySchema,
  trialBalanceQuerySchema
} from "./types.js";
import { previewCOAImport, executeCOAImport, getExcelSheetNames, type FileInput } from "./coa-import-service.js";

const glService = new GLService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((issue) => issue.message).join("; ") }]
    });
  }

  if (error instanceof GLServiceError) {
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
    throw new GLServiceError(
      "GL_ENTITY_CONTEXT_REQUIRED",
      "X-Entity-ID header is required.",
      400
    );
  }
  return entityId;
}

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new GLServiceError(
      "GL_USER_CONTEXT_REQUIRED",
      "Token subject is required.",
      401
    );
  }
  return sub;
}

export async function registerGLRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      router.get("/accounts", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await glService.listAccounts(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/accounts/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await glService.getAccount(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/accounts/:id/ledger", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = request.query as Record<string, string | undefined>;
          const limit = Math.min(Number(query.limit) || 100, 500);
          const offset = Number(query.offset) || 0;
          const data = await glService.getAccountLedger(entityId, request.params.id, {
            periodId: query.periodId,
            status: query.status,
            limit,
            offset
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/accounts", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = accountCreateSchema.parse(request.body);
          const data = await glService.createAccount(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/accounts/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = accountUpdateSchema.parse(request.body);
          const data = await glService.updateAccount(
            entityId,
            request.params.id,
            payload
          );
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { id: string } }>("/accounts/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await glService.deleteAccount(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Chart of Accounts Import ──────────────────────────────────────

      router.post("/accounts/import/preview", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { fileContent, fileBase64, sheetName } = request.body as FileInput;
          if (!fileContent && !fileBase64) {
            return reply.code(400).send({ data: null, errors: [{ code: "MISSING_FILE", message: "fileContent or fileBase64 is required" }] });
          }
          const data = await previewCOAImport(prisma as unknown as PrismaClient, entityId, { fileContent, fileBase64, sheetName });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/accounts/import/execute", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { fileContent, fileBase64, sheetName, updateExisting, reactivateInactive, skipErrors } = request.body as
            FileInput & { updateExisting?: boolean; reactivateInactive?: boolean; skipErrors?: boolean };
          if (!fileContent && !fileBase64) {
            return reply.code(400).send({ data: null, errors: [{ code: "MISSING_FILE", message: "fileContent or fileBase64 is required" }] });
          }
          const data = await executeCOAImport(
            prisma as unknown as PrismaClient,
            entityId,
            { fileContent, fileBase64, sheetName },
            { updateExisting, reactivateInactive, skipErrors }
          );
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/accounts/import/sheets", async (request, reply) => {
        try {
          requireEntityId(request.entityId);
          const { fileBase64 } = request.body as { fileBase64: string };
          if (!fileBase64) {
            return reply.code(400).send({ data: null, errors: [{ code: "MISSING_FILE", message: "fileBase64 is required" }] });
          }
          const data = getExcelSheetNames(fileBase64);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Journals ───────────────────────────────────────────────────────

      router.post("/journals", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const userId = requireUserId(request.user?.sub);
          const payload = journalCreateSchema.parse(request.body);
          const data = await glService.createJournal(entityId, userId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post<{ Params: { id: string } }>(
        "/journals/:id/post",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const data = await glService.postJournal(
              entityId,
              request.params.id,
              userId
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/journals/:id/approve",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const payload = journalDecisionSchema.parse(request.body ?? {});
            const data = await glService.approveJournal(
              entityId,
              request.params.id,
              userId,
              payload.reason
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/journals/:id/reject",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const payload = journalDecisionSchema.parse(request.body ?? {});
            const data = await glService.rejectJournal(
              entityId,
              request.params.id,
              userId,
              payload.reason
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/journals/:id/reverse",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const data = await glService.reverseJournal(entityId, request.params.id, userId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get("/journals", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = journalListQuerySchema.parse(request.query);
          const data = await glService.listJournals(entityId, query);
          return reply.send({
            data,
            meta: {
              limit: query.limit,
              cursor: data.length > 0 ? data[data.length - 1].id : null
            },
            errors: []
          });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/journals/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await glService.getJournal(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/trial-balance", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = trialBalanceQuerySchema.parse(request.query);
          const result = await glService.getTrialBalance(
            entityId,
            query.period_id,
            query.comparative_period_id,
            query.show_zero_balances
          );
          return reply.send({ data: result.data, meta: { isBalanced: result.isBalanced }, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });
    },
    { prefix: "/api/v1/gl" }
  );
}
