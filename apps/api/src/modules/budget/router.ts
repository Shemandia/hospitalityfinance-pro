import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import { BudgetService, BudgetServiceError } from "./service.js";
import { previewBudgetExcel, executeBudgetExcelImport } from "./excel-import.js";
import {
  budgetDefinitionCreateSchema,
  budgetLinesBulkSchema,
  budgetVarianceQuerySchema
} from "./types.js";

const budgetService = new BudgetService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof BudgetServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

function requireEntityId(entityId: string | undefined): string {
  if (!entityId)
    throw new BudgetServiceError("BUDGET_ENTITY_REQUIRED", "X-Entity-ID required.", 400);
  return entityId;
}

export async function registerBudgetRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      router.get("/definitions", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await budgetService.listDefinitions(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/definitions/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await budgetService.getDefinition(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/definitions", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = budgetDefinitionCreateSchema.parse(request.body);
          const data = await budgetService.createDefinition(entityId, payload);
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/definitions/:id/lines", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const def = await budgetService.getDefinition(entityId, request.params.id);
          return reply.send({ data: def.lines, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/definitions/:id/lines", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = budgetLinesBulkSchema.parse(request.body);
          const data = await budgetService.upsertLines(entityId, request.params.id, payload);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/variance", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = budgetVarianceQuerySchema.parse(request.query);
          const data = await budgetService.getVarianceReport(entityId, query);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Excel Import ─────────────────────────────────────────────────────────

      router.post<{ Params: { id: string } }>(
        "/definitions/:id/import-excel/preview",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const body = request.body as { file?: string; filename?: string };
            if (!body?.file) {
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_FILE", message: "Base64-encoded file is required." }]
              });
            }
            const buffer = Buffer.from(body.file, "base64");
            const filename = body.filename ?? "budget.xlsx";
            const data = await previewBudgetExcel(
              prisma as unknown as PrismaClient,
              entityId,
              buffer,
              filename
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/definitions/:id/import-excel/execute",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const body = request.body as { file?: string; filename?: string };
            if (!body?.file) {
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_FILE", message: "Base64-encoded file is required." }]
              });
            }
            const buffer = Buffer.from(body.file, "base64");
            const filename = body.filename ?? "budget.xlsx";
            const data = await executeBudgetExcelImport(
              prisma as unknown as PrismaClient,
              entityId,
              request.params.id,
              buffer,
              filename
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1/budget" }
  );
}
