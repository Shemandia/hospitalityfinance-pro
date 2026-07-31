import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../db/client.js";
import { z } from "zod";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import {
  previewSAFFile,
  getAccountMapping,
  executeSAFImport,
  type GroupingStrategy
} from "../connectors/saf/saf-import-service.js";
import { importOperaSUNFile } from "../connectors/opera-cloud/opera-cloud-import-job.js";
import { mapError, requireEntityId } from "./_shared.js";

const safExecuteSchema = z.object({
  fileContent: z.string().min(1),
  filename: z.string().min(1).max(255),
  groupingStrategy: z
    .enum(["single_entry", "by_reference", "by_journal_type"])
    .default("by_reference"),
  autoPost: z.boolean().default(false),
  autoCreateAccounts: z.boolean().default(true),
  sourceModule: z.string().min(1).max(20).default("PROC"),
  descriptionPrefix: z.string().max(100).default("SAF Import"),
  departmentMapping: z.record(z.string()).optional()
});

export function registerSAFRoutes(router: FastifyInstance) {
  router.post(
    "/import/saf/preview",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { fileContent, filename } = request.body as {
          fileContent: string;
          filename?: string;
        };
        if (!fileContent)
          return reply.code(400).send({
            data: null,
            errors: [{ code: "MISSING_FILE", message: "fileContent is required" }]
          });
        const data = previewSAFFile(fileContent, filename);

        // Enrich with entity currency info and FX rate
        const entity = await (prisma as unknown as PrismaClient).entity.findUnique({
          where: { id: entityId },
          select: { functionalCurrency: true, reportingCurrency: true }
        });
        const fileCurrency = data.currency ?? entity?.functionalCurrency ?? "USD";
        const baseCurrency = entity?.functionalCurrency ?? "USD";
        const reportingCurrency = entity?.reportingCurrency ?? "USD";

        // Look up FX rate from file currency → reporting currency (if different)
        let fxRate: string | null = null;
        let fxRateDate: string | null = null;
        if (fileCurrency.toUpperCase() !== reportingCurrency.toUpperCase()) {
          const rate = await (prisma as unknown as PrismaClient).fXRate.findFirst({
            where: {
              fromCurrency: fileCurrency.toUpperCase(),
              toCurrency: reportingCurrency.toUpperCase()
            },
            orderBy: { effectiveDate: "desc" }
          });
          if (rate) {
            fxRate = rate.rate.toString();
            fxRateDate = rate.effectiveDate.toISOString().substring(0, 10);
          }
        }

        return reply.send({
          data: {
            ...data,
            baseCurrency,
            reportingCurrency,
            fileCurrency,
            fxRate,
            fxRateDate
          },
          errors: []
        });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.post(
    "/import/saf/account-mapping",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { fileContent, filename } = request.body as {
          fileContent: string;
          filename?: string;
        };
        if (!fileContent)
          return reply.code(400).send({
            data: null,
            errors: [{ code: "MISSING_FILE", message: "fileContent is required" }]
          });
        const data = await getAccountMapping(
          prisma as unknown as PrismaClient,
          entityId,
          fileContent,
          filename
        );
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.post(
    "/import/saf/execute",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = safExecuteSchema.parse(request.body);
        const data = await executeSAFImport(prisma as unknown as PrismaClient, {
          entityId,
          ...payload
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── Opera .SUN File Import ──────────────────────────────────────────────

  router.post(
    "/opera-sun/import",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { fileContent, filename, notifyEmail } = request.body as {
          fileContent: string;
          filename: string;
          notifyEmail?: string;
        };
        if (!fileContent || !filename) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "MISSING_FIELDS", message: "fileContent and filename are required" }]
          });
        }
        const data = await importOperaSUNFile(prisma as unknown as PrismaClient, {
          entityId,
          fileContent,
          filename,
          notifyEmail
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );
}
