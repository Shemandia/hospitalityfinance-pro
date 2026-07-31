import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../db/client.js";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import {
  importInvoiceBatch,
  importJournalBatch,
  syncSupplierBatch
} from "../connectors/inbound/inbound-service.js";
import {
  inboundInvoiceBatchSchema,
  inboundJournalBatchSchema,
  inboundSupplierBatchSchema,
  inboundFileImportSchema,
  inboundInvoiceSchema,
  inboundJournalSchema
} from "../connectors/inbound/inbound-types.js";
import { mapError, requireEntityId } from "./_shared.js";

export function registerInboundRoutes(router: FastifyInstance) {
  // ── API: Import AP Invoices ─────────────────────────────────────────────
  router.post(
    "/inbound/invoices",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const batch = inboundInvoiceBatchSchema.parse(request.body);
        const data = await importInvoiceBatch(prisma as unknown as PrismaClient, entityId, batch);
        const status = data.errors.length > 0 && data.created === 0 ? 422 : 201;
        return reply.code(status).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── API: Import GL Journals ─────────────────────────────────────────────
  router.post(
    "/inbound/journals",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const batch = inboundJournalBatchSchema.parse(request.body);
        const data = await importJournalBatch(prisma as unknown as PrismaClient, entityId, batch);
        const status = data.errors.length > 0 && data.created === 0 ? 422 : 201;
        return reply.code(status).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── API: Sync Suppliers ─────────────────────────────────────────────────
  router.post(
    "/inbound/suppliers",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const batch = inboundSupplierBatchSchema.parse(request.body);
        const data = await syncSupplierBatch(prisma as unknown as PrismaClient, entityId, batch);
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  // ── File Import: JSON batch upload (invoices or journals) ───────────────
  router.post(
    "/inbound/file-import",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = inboundFileImportSchema.parse(request.body);

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload.fileContent);
        } catch {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "INVALID_JSON", message: "fileContent is not valid JSON." }]
          });
        }

        if (!Array.isArray(parsed)) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "INVALID_FORMAT", message: "fileContent must be a JSON array." }]
          });
        }

        if (payload.dataType === "invoices") {
          // Validate each invoice against schema
          const invoices = [];
          const validationErrors: Array<{ index: number; message: string }> = [];
          for (let i = 0; i < parsed.length; i++) {
            const result = inboundInvoiceSchema.safeParse(parsed[i]);
            if (result.success) {
              invoices.push(result.data);
            } else {
              validationErrors.push({
                index: i,
                message: result.error.issues.map((iss) => iss.message).join("; ")
              });
            }
          }

          if (invoices.length === 0) {
            return reply.code(422).send({
              data: {
                batchRef: payload.batchRef,
                created: 0,
                skipped: parsed.length,
                errors: validationErrors,
                createdIds: [],
                duplicateRefs: []
              },
              errors: []
            });
          }

          const data = await importInvoiceBatch(prisma as unknown as PrismaClient, entityId, {
            sourceSystem: payload.sourceSystem,
            batchRef: payload.batchRef,
            autoPost: payload.autoPost,
            invoices
          });
          // Merge validation errors
          data.errors = [...validationErrors, ...data.errors];
          data.skipped += validationErrors.length;
          return reply.code(201).send({ data, errors: [] });
        } else {
          // journals
          const journals = [];
          const validationErrors: Array<{ index: number; message: string }> = [];
          for (let i = 0; i < parsed.length; i++) {
            const result = inboundJournalSchema.safeParse(parsed[i]);
            if (result.success) {
              journals.push(result.data);
            } else {
              validationErrors.push({
                index: i,
                message: result.error.issues.map((iss) => iss.message).join("; ")
              });
            }
          }

          if (journals.length === 0) {
            return reply.code(422).send({
              data: {
                batchRef: payload.batchRef,
                created: 0,
                skipped: parsed.length,
                errors: validationErrors,
                createdIds: [],
                duplicateRefs: []
              },
              errors: []
            });
          }

          const data = await importJournalBatch(prisma as unknown as PrismaClient, entityId, {
            sourceSystem: payload.sourceSystem,
            batchRef: payload.batchRef,
            autoPost: payload.autoPost,
            journals
          });
          data.errors = [...validationErrors, ...data.errors];
          data.skipped += validationErrors.length;
          return reply.code(201).send({ data, errors: [] });
        }
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );
}
