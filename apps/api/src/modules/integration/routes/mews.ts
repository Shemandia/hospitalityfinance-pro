import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../db/client.js";
import { z } from "zod";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import { runMewsImport } from "../connectors/mews/mews-import-job.js";
import { mapError, requireEntityId } from "./_shared.js";

export function registerMewsRoutes(router: FastifyInstance) {
  router.post(
    "/mews/import",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const body = z
          .object({
            startUtc: z.string().min(1),
            endUtc: z.string().min(1),
            notifyEmail: z.string().email().optional()
          })
          .parse(request.body);

        const data = await runMewsImport(prisma as unknown as PrismaClient, {
          entityId,
          startUtc: body.startUtc,
          endUtc: body.endUtc,
          notifyEmail: body.notifyEmail
        });
        return reply.code(201).send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );

  router.get("/mews/logs", async (request, reply) => {
    try {
      const entityId = requireEntityId(request.entityId);
      const logs = await prisma.importLog.findMany({
        where: { entityId, connectorType: "MEWS_PMS" },
        orderBy: { createdAt: "desc" },
        take: 200
      });
      return reply.send({ data: logs, errors: [] });
    } catch (error) {
      return mapError(reply, error);
    }
  });
}
