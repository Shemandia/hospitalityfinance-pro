import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { auditQuerySchema } from "./types.js";
import { AuditService } from "./service.js";
import { mapError, requireEntityId } from "../../shared/router-utils.js";

const auditService = new AuditService(prisma as unknown as PrismaClient);

export async function registerAuditRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      router.get(
        "/audit",
        { preHandler: [requirePermission(["AUDIT_READ", "ADMIN_AUDIT_LOG"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const query = auditQuerySchema.parse(request.query);
            const data = await auditService.getEvents(entityId, query);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1" }
  );
}
