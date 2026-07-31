import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../../db/client.js";
import { prisma } from "../../../db/prisma.js";
import { requirePermission } from "../../../middleware/requirePermission.js";
import { runSkyJanaSync } from "../connectors/sky-jana/sky-jana-sync-job.js";
import { mapError, requireEntityId } from "./_shared.js";

export function registerJanaRoutes(router: FastifyInstance) {
  router.post(
    "/sky-jana/sync",
    { preHandler: [requirePermission("INTEGRATION_IMPORT")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const data = await runSkyJanaSync(prisma as unknown as PrismaClient, entityId);
        return reply.send({ data, errors: [] });
      } catch (error) {
        return mapError(reply, error);
      }
    }
  );
}
