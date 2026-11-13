import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../db/client.js";
import { z } from "zod";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import { runSimphonyImport } from "../connectors/simphony/simphony-import-job.js";
import { mapError, requireEntityId } from "./_shared.js";

export function registerSimphonyRoutes(router: FastifyInstance) {
  router.post(
    "/simphony/import",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const body = z
          .object({
            locationId: z.string().min(1),
            businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            notifyEmail: z.string().email().optional()
          })
          .parse(request.body);

        const data = await runSimphonyImport(prisma as unknown as PrismaClient, {
          entityId,
          locationId: body.locationId,
          businessDate: body.businessDate,
          notifyEmail: body.notifyEmail
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get(
    "/simphony/logs",
    { preHandler: [requirePermission("INTEGRATION_READ")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const logs = await prisma.importLog.findMany({
          where: { entityId, connectorType: "SIMPHONY_POS" },
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
