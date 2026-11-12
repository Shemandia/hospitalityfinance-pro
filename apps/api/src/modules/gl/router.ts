import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { setEntityDbContext } from "../../db/tenantContext.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { hasEntityPermission } from "../access/resolver.js";
import { GLService } from "./service.js";
import { mapError, requireEntityId } from "../../shared/router-utils.js";
import { ServiceError } from "../../shared/service-error.js";
import {
  accountCreateSchema,
  accountUpdateSchema,
  journalCreateSchema,
  journalDecisionSchema,
  journalListQuerySchema,
  trialBalanceQuerySchema,
  approvalRuleCreateSchema,
  approvalRuleUpdateSchema,
  journalTypeCreateSchema,
  journalTypeUpdateSchema
} from "./types.js";
import {
  previewCOAImport,
  executeCOAImport,
  getExcelSheetNames,
  type FileInput
} from "./coa-import-service.js";

import { RecurringJournalService } from "./recurring-service.js";

const recurringJournalSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUALLY"]),
  autoPost: z.boolean().default(false),
  autoReverse: z.boolean().default(false),
  maxOccurrences: z.number().int().min(0).default(0),
  endDate: z.coerce.date().nullable().optional(),
  journalTypeId: z.string().uuid().optional(),
  source: z.string().max(50).default("MANUAL"),
  functionalCurrency: z.string().length(3),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        debit: z.string(),
        credit: z.string(),
        currency: z.string().length(3),
        fxRate: z.string(),
        description: z.string().max(1000).optional(),
        dimension1: z.string().max(100).optional(),
        dimension2: z.string().max(100).optional(),
        dimension3: z.string().max(100).optional(),
        dimension4: z.string().max(100).optional(),
        lineNumber: z.number().int().positive()
      })
    )
    .min(1)
});

const glService = new GLService(prisma as unknown as PrismaClient);
const recurringService = new RecurringJournalService(prisma as unknown as PrismaClient);

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new ServiceError("GL_USER_CONTEXT_REQUIRED", "Token subject is required.", 401);
  }
  return sub;
}

export async function registerGLRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      router.get(
        "/accounts",
        { preHandler: [requirePermission(["COA_READ", "GL_READ"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.listAccounts(entityId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { id: string } }>(
        "/accounts/:id",
        { preHandler: [requirePermission(["COA_READ", "GL_READ"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.getAccount(entityId, request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { id: string } }>(
        "/accounts/:id/balance",
        { preHandler: [requirePermission(["COA_READ", "GL_READ"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.getAccountCurrentBalance(entityId, request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { id: string } }>(
        "/accounts/:id/ledger",
        { preHandler: [requirePermission(["COA_READ", "GL_READ"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const query = request.query as Record<string, string | undefined>;
            const limit = Math.min(Number(query.limit) || 100, 500);
            const offset = Math.min(Number(query.offset) || 0, 100000);
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
        }
      );

      router.post(
        "/accounts",
        { preHandler: [requirePermission("COA_CREATE")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = accountCreateSchema.parse(request.body);
            const data = await glService.createAccount(entityId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/accounts/:id",
        { preHandler: [requirePermission("COA_EDIT")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = accountUpdateSchema.parse(request.body);
            const data = await glService.updateAccount(entityId, request.params.id, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/accounts/:id",
        { preHandler: [requirePermission("COA_EDIT")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.deleteAccount(entityId, request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Chart of Accounts Import ──────────────────────────────────────

      router.post(
        "/accounts/import/preview",
        { preHandler: [requirePermission("COA_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { fileContent, fileBase64, sheetName } = request.body as FileInput;
            if (!fileContent && !fileBase64) {
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_FILE", message: "fileContent or fileBase64 is required" }]
              });
            }
            const data = await previewCOAImport(prisma as unknown as PrismaClient, entityId, {
              fileContent,
              fileBase64,
              sheetName
            });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/accounts/import/execute",
        { preHandler: [requirePermission(["COA_CREATE", "COA_EDIT"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const {
              fileContent,
              fileBase64,
              sheetName,
              updateExisting,
              reactivateInactive,
              skipErrors
            } = request.body as FileInput & {
              updateExisting?: boolean;
              reactivateInactive?: boolean;
              skipErrors?: boolean;
            };
            if (!fileContent && !fileBase64) {
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_FILE", message: "fileContent or fileBase64 is required" }]
              });
            }
            // RLS context is set inside executeCOAImport via withEntityRLS
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
        }
      );

      router.post(
        "/accounts/import/sheets",
        { preHandler: [requirePermission("COA_READ")] },
        async (request, reply) => {
          try {
            requireEntityId(request.entityId);
            const { fileBase64 } = request.body as { fileBase64: string };
            if (!fileBase64) {
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_FILE", message: "fileBase64 is required" }]
              });
            }
            const data = getExcelSheetNames(fileBase64);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Journals ───────────────────────────────────────────────────────

      router.post(
        "/journals",
        { preHandler: [requirePermission("GL_WRITE")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const payload = journalCreateSchema.parse(request.body);

            // Overriding a source restriction is an approver's decision.
            if (payload.sourceOverrideReason) {
              const allowed =
                request.access !== undefined &&
                hasEntityPermission(request.access, entityId, "GL_APPROVE");
              if (!allowed) {
                return reply.code(403).send({
                  data: null,
                  errors: [
                    {
                      code: "GL_SOURCE_OVERRIDE_FORBIDDEN",
                      message: "Overriding source restrictions requires the GL_APPROVE permission."
                    }
                  ]
                });
              }
            }

            const data = await glService.createJournal(entityId, userId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/journals/:id/post",
        { preHandler: [requirePermission("GL_POST")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const data = await glService.postJournal(entityId, request.params.id, userId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/journals/:id/approve",
        { preHandler: [requirePermission("GL_APPROVE")] },
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
        { preHandler: [requirePermission("GL_APPROVE")] },
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
        { preHandler: [requirePermission("GL_REVERSE")] },
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

      router.get(
        "/journals",
        { preHandler: [requirePermission("GL_READ")] },
        async (request, reply) => {
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
        }
      );

      router.get<{ Params: { id: string } }>(
        "/journals/:id",
        { preHandler: [requirePermission("GL_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.getJournal(entityId, request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Approval Rules ────────────────────────────────────────────────

      router.get(
        "/approval-rules",
        { preHandler: [requirePermission("GL_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.listApprovalRules(entityId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { id: string } }>(
        "/approval-rules/:id",
        { preHandler: [requirePermission("GL_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.getApprovalRule(entityId, request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/approval-rules",
        { preHandler: [requirePermission(["GL_WRITE", "ADMIN_SETTINGS"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = approvalRuleCreateSchema.parse(request.body);
            const data = await glService.createApprovalRule(entityId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/approval-rules/:id",
        { preHandler: [requirePermission(["GL_APPROVE", "ADMIN_SETTINGS"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = approvalRuleUpdateSchema.parse(request.body);
            const data = await glService.updateApprovalRule(entityId, request.params.id, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/approval-rules/:id",
        { preHandler: [requirePermission(["GL_APPROVE", "ADMIN_SETTINGS"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            await glService.deleteApprovalRule(entityId, request.params.id);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // Lightweight users list for approver picker
      router.get(
        "/users",
        { preHandler: [requirePermission("GL_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const users = await prisma.user.findMany({
              where: {
                entities: { some: { entityId } }
              },
              select: { id: true, name: true, email: true },
              orderBy: { name: "asc" }
            });
            return reply.send({ data: users, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Journal Types ──────────────────────────────────────────────────

      router.get(
        "/journal-types",
        { preHandler: [requirePermission("GL_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.listJournalTypes(entityId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { id: string } }>(
        "/journal-types/:id",
        { preHandler: [requirePermission("GL_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.getJournalType(entityId, request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/journal-types",
        { preHandler: [requirePermission(["GL_WRITE", "ADMIN_SETTINGS"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = journalTypeCreateSchema.parse(request.body);
            const data = await glService.createJournalType(entityId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/journal-types/:id",
        { preHandler: [requirePermission(["GL_WRITE", "ADMIN_SETTINGS"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = journalTypeUpdateSchema.parse(request.body);
            const data = await glService.updateJournalType(entityId, request.params.id, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/journal-types/:id",
        { preHandler: [requirePermission(["GL_WRITE", "ADMIN_SETTINGS"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await glService.deleteJournalType(entityId, request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/trial-balance",
        { preHandler: [requirePermission("GL_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const query = trialBalanceQuerySchema.parse(request.query);
            const result = await glService.getTrialBalance(
              entityId,
              query.period_id,
              query.comparative_period_id,
              query.show_zero_balances
            );
            return reply.send({
              data: result.data,
              meta: { isBalanced: result.isBalanced },
              errors: []
            });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
      // ── Recurring Journals ─────────────────────────────────────────────────

      router.get(
        "/recurring-journals",
        { preHandler: [requireAuth, requirePermission("GL_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await recurringService.list(entityId);
            return { data, errors: [] };
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { id: string } }>(
        "/recurring-journals/:id",
        { preHandler: [requireAuth, requirePermission("GL_READ")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await recurringService.getById(entityId, request.params.id);
            return { data, errors: [] };
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/recurring-journals",
        { preHandler: [requireAuth, requirePermission("GL_WRITE")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = (request.user as any)?.id ?? "";
            const data = await recurringService.create(
              entityId,
              userId,
              recurringJournalSchema.parse(request.body) as any
            );
            reply.code(201);
            return { data, errors: [] };
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/recurring-journals/:id",
        { preHandler: [requireAuth, requirePermission("GL_WRITE")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await recurringService.update(
              entityId,
              request.params.id,
              recurringJournalSchema.partial().parse(request.body) as any
            );
            return { data, errors: [] };
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/recurring-journals/:id",
        { preHandler: [requireAuth, requirePermission(["GL_WRITE", "ADMIN_SETTINGS"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            await recurringService.deactivate(entityId, request.params.id);
            reply.code(204);
            return;
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/recurring-journals/:id/generate",
        { preHandler: [requireAuth, requirePermission(["GL_WRITE", "ADMIN_SETTINGS"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = request.body as { periodId: string };
            if (!periodId) {
              reply.code(400);
              return {
                data: null,
                errors: [{ code: "MISSING_PERIOD", message: "periodId is required." }]
              };
            }
            // Look up period to get year/month
            const period = await (prisma as unknown as PrismaClient).period.findFirst({
              where: { id: periodId, entityId }
            });
            if (!period) {
              reply.code(404);
              return {
                data: null,
                errors: [{ code: "PERIOD_NOT_FOUND", message: "Period not found." }]
              };
            }
            const journalIds = await recurringService.generateDueJournals(
              entityId,
              periodId,
              period.year,
              period.month
            );
            return { data: { generated: journalIds.length, journalIds }, errors: [] };
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1/gl" }
  );
}
