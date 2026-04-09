import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { ProcessLockService, ProcessLockError } from "./service.js";

const lockService = new ProcessLockService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProcessLockError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({
    data: null,
    errors: [{ code: "INTERNAL_SERVER_ERROR", message }]
  });
}

export async function registerProcessLockRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireRole(["ADMIN", "SUPERADMIN"]));

      // POST /process-locks/acquire
      router.post<{
        Body: { processType: string; ledger?: string; timeoutMinutes?: number };
      }>("/process-locks/acquire", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "ENTITY_REQUIRED", message: "X-Entity-ID header is required" }]
            });
          }
          const { processType, ledger, timeoutMinutes } = request.body ?? {};
          if (!processType) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "VALIDATION_ERROR", message: "processType is required" }]
            });
          }
          const data = await lockService.acquireLock({
            entityId,
            processType,
            ledger,
            userId: request.user?.sub as string | undefined,
            timeoutMinutes
          });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // POST /process-locks/release
      router.post<{
        Body: { processType: string; ledger?: string };
      }>("/process-locks/release", async (request, reply) => {
        try {
          const entityId = request.entityId;
          if (!entityId) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "ENTITY_REQUIRED", message: "X-Entity-ID header is required" }]
            });
          }
          const { processType, ledger } = request.body ?? {};
          if (!processType) {
            return reply.code(400).send({
              data: null,
              errors: [{ code: "VALIDATION_ERROR", message: "processType is required" }]
            });
          }
          const data = await lockService.releaseLock({ entityId, processType, ledger });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // GET /process-locks/status
      router.get<{ Querystring: { ledger?: string } }>(
        "/process-locks/status",
        async (request, reply) => {
          try {
            const entityId = request.entityId;
            if (!entityId) {
              return reply.code(400).send({
                data: null,
                errors: [{ code: "ENTITY_REQUIRED", message: "X-Entity-ID header is required" }]
              });
            }
            const data = await lockService.getLockStatus(entityId, request.query?.ledger);
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
