import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import {
  createReportRunSchema,
  createReportDefinitionSchema,
  updateReportDefinitionSchema
} from "./types.js";
import { ReportingService, ReportingServiceError } from "./service.js";

const reportingService = new ReportingService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [
        { code: "VALIDATION_ERROR", message: error.issues.map((issue) => issue.message).join("; ") }
      ]
    });
  }
  if (error instanceof ReportingServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

function requireEntityId(entityId: string | undefined): string {
  if (!entityId) {
    throw new ReportingServiceError(
      "REPORT_ENTITY_CONTEXT_REQUIRED",
      "X-Entity-ID header is required.",
      400
    );
  }
  return entityId;
}

export async function registerReportingRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      // ── Report Definitions CRUD ─────────────────────────────────────────

      router.get("/reports/definitions", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await reportingService.listDefinitions(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/reports/definitions/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await (prisma as unknown as PrismaClient).reportDefinition.findFirst({
            where: { entityId, id: request.params.id },
            include: { _count: { select: { runs: true } } }
          });
          if (!data)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "NOT_FOUND", message: "Report definition not found." }]
            });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/reports/definitions", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = createReportDefinitionSchema.parse(request.body);
          const data = await (prisma as unknown as PrismaClient).reportDefinition.create({
            data: {
              entityId,
              name: payload.name,
              type: payload.type as any,
              template: payload.template as any,
              isSystem: payload.isSystem
            }
          });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/reports/definitions/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = updateReportDefinitionSchema.parse(request.body);
          const existing = await (prisma as unknown as PrismaClient).reportDefinition.findFirst({
            where: { entityId, id: request.params.id }
          });
          if (!existing)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "NOT_FOUND", message: "Report definition not found." }]
            });
          if (existing.isSystem)
            return reply.code(403).send({
              data: null,
              errors: [
                {
                  code: "SYSTEM_REPORT",
                  message: "System report definitions cannot be modified."
                }
              ]
            });

          const updateData: Record<string, unknown> = {};
          if (payload.name !== undefined) updateData.name = payload.name;
          if (payload.type !== undefined) updateData.type = payload.type;
          if (payload.template !== undefined) updateData.template = payload.template;

          const data = await (prisma as unknown as PrismaClient).reportDefinition.update({
            where: { id: request.params.id },
            data: updateData
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { id: string } }>(
        "/reports/definitions/:id",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const existing = await (prisma as unknown as PrismaClient).reportDefinition.findFirst({
              where: { entityId, id: request.params.id }
            });
            if (!existing)
              return reply.code(404).send({
                data: null,
                errors: [{ code: "NOT_FOUND", message: "Report definition not found." }]
              });
            if (existing.isSystem)
              return reply.code(403).send({
                data: null,
                errors: [
                  {
                    code: "SYSTEM_REPORT",
                    message: "System report definitions cannot be deleted."
                  }
                ]
              });

            await (prisma as unknown as PrismaClient).reportRun.deleteMany({
              where: { definitionId: request.params.id }
            });
            await (prisma as unknown as PrismaClient).reportDefinition.delete({
              where: { id: request.params.id }
            });
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Report Definition Schedule ─────────────────────────────────────

      router.post<{ Params: { id: string } }>(
        "/reports/definitions/:id/schedule",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const body = request.body as Record<string, unknown> | null;
            if (!body || typeof body.cron !== "string") {
              return reply.code(400).send({
                data: null,
                errors: [
                  {
                    code: "VALIDATION_ERROR",
                    message:
                      "cron (string) is required. Optional: enabled (bool), notifyEmail (string), periodSelection ('AUTO'|'PREVIOUS')."
                  }
                ]
              });
            }

            // Validate cron has 5 fields
            const cronParts = (body.cron as string).trim().split(/\s+/);
            if (cronParts.length !== 5) {
              return reply.code(400).send({
                data: null,
                errors: [
                  {
                    code: "VALIDATION_ERROR",
                    message:
                      "cron must be a standard 5-field cron expression (minute hour dayOfMonth month dayOfWeek)."
                  }
                ]
              });
            }

            const existing = await (prisma as unknown as PrismaClient).reportDefinition.findFirst({
              where: { entityId, id: request.params.id }
            });
            if (!existing) {
              return reply.code(404).send({
                data: null,
                errors: [{ code: "NOT_FOUND", message: "Report definition not found." }]
              });
            }

            const currentTemplate =
              existing.template && typeof existing.template === "object"
                ? (existing.template as Record<string, unknown>)
                : {};

            const schedule: Record<string, unknown> = {
              enabled: body.enabled !== false, // default true
              cron: body.cron,
              periodSelection: body.periodSelection === "PREVIOUS" ? "PREVIOUS" : "AUTO"
            };
            if (typeof body.notifyEmail === "string" && body.notifyEmail.length > 0) {
              schedule.notifyEmail = body.notifyEmail;
            }

            const data = await (prisma as unknown as PrismaClient).reportDefinition.update({
              where: { id: request.params.id },
              data: {
                template: { ...currentTemplate, schedule } as any
              }
            });

            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/reports/definitions/:id/schedule",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);

            const existing = await (prisma as unknown as PrismaClient).reportDefinition.findFirst({
              where: { entityId, id: request.params.id }
            });
            if (!existing) {
              return reply.code(404).send({
                data: null,
                errors: [{ code: "NOT_FOUND", message: "Report definition not found." }]
              });
            }

            const currentTemplate =
              existing.template && typeof existing.template === "object"
                ? (existing.template as Record<string, unknown>)
                : {};

            // Remove the schedule key
            const { schedule: _removed, ...rest } = currentTemplate;

            const data = await (prisma as unknown as PrismaClient).reportDefinition.update({
              where: { id: request.params.id },
              data: {
                template: (Object.keys(rest).length > 0 ? rest : {}) as any
              }
            });

            return reply.code(200).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Report Runs ─────────────────────────────────────────────────────

      router.post("/reports/runs", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = createReportRunSchema.parse(request.body ?? {});
          const data = await reportingService.createRun(entityId, payload);
          return reply.code(202).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/reports/runs/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await reportingService.getRun(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Report Run History ──────────────────────────────────────────────

      router.get("/reports/history", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const { definitionId, status, limit } = request.query as {
            definitionId?: string;
            status?: string;
            limit?: string;
          };

          const data = await (prisma as unknown as PrismaClient).reportRun.findMany({
            where: {
              definition: { entityId },
              ...(definitionId ? { definitionId } : {}),
              ...(status ? { status: status as any } : {})
            },
            include: {
              definition: { select: { id: true, name: true, type: true } }
            },
            orderBy: { createdAt: "desc" },
            take: Math.min(parseInt(limit ?? "50", 10), 200)
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Report Download ─────────────────────────────────────────────────

      router.get<{ Params: { id: string } }>(
        "/reports/runs/:id/download",
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const run = await reportingService.getRun(entityId, request.params.id);
            if (run.status !== "COMPLETE" || !run.outputUrl) {
              return reply.code(404).send({
                data: null,
                errors: [{ code: "NOT_READY", message: "Report is not ready for download." }]
              });
            }

            // If it's a local file path, serve it
            if (!run.outputUrl.startsWith("s3://")) {
              const { readFile } = await import("node:fs/promises");
              const buffer = await readFile(run.outputUrl);
              const filename = `${run.definition.name.replace(/[^a-zA-Z0-9]/g, "-")}.pdf`;
              return reply
                .header("Content-Type", "application/pdf")
                .header("Content-Disposition", `attachment; filename="${filename}"`)
                .send(buffer);
            }

            // S3 presigned URL would go here
            return reply.send({ data: { downloadUrl: run.outputUrl }, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Report Types metadata ───────────────────────────────────────────

      router.get("/reports/types", async (_request, reply) => {
        return reply.send({
          data: {
            types: [
              {
                value: "USALI_PL",
                label: "USALI Departmental P&L",
                description: "Revenue and expenses by operated department per USALI 12th edition"
              },
              {
                value: "BALANCE_SHEET",
                label: "Balance Sheet",
                description: "Assets, liabilities, and equity at period end"
              },
              {
                value: "CASHFLOW",
                label: "Cash Flow Statement",
                description: "Operating, investing, and financing cash movements (indirect method)"
              },
              {
                value: "TRIAL_BALANCE",
                label: "Trial Balance",
                description: "All accounts with period debits, credits, and closing balances"
              },
              {
                value: "CUSTOM",
                label: "Custom Report",
                description: "Custom account grouping by USALI department and category"
              }
            ],
            templateOptions: {
              columns: [
                "code",
                "name",
                "type",
                "debit",
                "credit",
                "balance",
                "budget",
                "variance",
                "variancePct"
              ],
              groupBy: ["usali_department", "usali_category", "type", "parent_code"],
              sortBy: ["code", "name", "balance", "debit", "credit"],
              accountTypes: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]
            }
          },
          errors: []
        });
      });
    },
    { prefix: "/api/v1" }
  );
}
