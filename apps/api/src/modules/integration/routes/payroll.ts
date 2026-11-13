import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../db/client.js";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import { importPayrollBatch, importPayrollFile } from "../connectors/payroll/payroll-service.js";
import {
  payrollBatchSchema,
  payrollFileUploadSchema
} from "../connectors/payroll/payroll-types.js";
import { mapError, requireEntityId } from "./_shared.js";

export function registerPayrollRoutes(router: FastifyInstance) {
  router.post(
    "/payroll/import",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const batch = payrollBatchSchema.parse(request.body);
        const data = await importPayrollBatch(prisma as unknown as PrismaClient, entityId, batch);
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.post(
    "/payroll/import-file",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const payload = payrollFileUploadSchema.parse(request.body);
        const data = await importPayrollFile(
          prisma as unknown as PrismaClient,
          entityId,
          payload.file,
          payload.filename,
          payload.postingDate,
          payload.currency,
          payload.autoPost
        );
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get(
    "/payroll/logs",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const logs = await prisma.importLog.findMany({
          where: { entityId, connectorType: "PAYROLL" },
          orderBy: { createdAt: "desc" },
          take: 200
        });
        return reply.send({ data: logs, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );
}
