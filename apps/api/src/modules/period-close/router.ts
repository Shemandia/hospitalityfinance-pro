import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import type { PrismaClient } from "../../db/client.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { runYearEndCleardown, YearEndCleardownError } from "./year-end-cleardown.js";
import {
  createYearEndConfigSchema,
  updateYearEndConfigSchema,
  runYearEndCleardownSchema
} from "./year-end-types.js";

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof YearEndCleardownError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

export async function registerPeriodCloseRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── Year-End Config ──────────────────────────────────────────────────

      router.get(
        "/year-end-config",
        { preHandler: [requirePermission(["PERIOD_READ", "PERIOD_MANAGE"])] },
        async (request, reply) => {
          try {
            const entityId = request.entityId;
            if (!entityId)
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
              });
            const data = await (prisma as unknown as PrismaClient as any).yearEndConfig.findFirst({
              where: { entityId }
            });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/year-end-config",
        { preHandler: [requirePermission("PERIOD_MANAGE")] },
        async (request, reply) => {
          try {
            const entityId = request.entityId;
            if (!entityId)
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
              });
            const payload = createYearEndConfigSchema.parse(request.body);
            // Upsert
            const existing = await (
              prisma as unknown as PrismaClient as any
            ).yearEndConfig.findFirst({ where: { entityId } });
            let data;
            if (existing) {
              data = await (prisma as unknown as PrismaClient as any).yearEndConfig.update({
                where: { id: existing.id },
                data: {
                  retainedEarningsCode: payload.retainedEarningsCode,
                  journalTypeCode: payload.journalTypeCode ?? null,
                  fiscalYearStartMonth: payload.fiscalYearStartMonth,
                  description: payload.description ?? null
                }
              });
            } else {
              data = await (prisma as unknown as PrismaClient as any).yearEndConfig.create({
                data: {
                  entityId,
                  retainedEarningsCode: payload.retainedEarningsCode,
                  journalTypeCode: payload.journalTypeCode ?? null,
                  fiscalYearStartMonth: payload.fiscalYearStartMonth,
                  description: payload.description ?? null
                }
              });
            }
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Year-End Cleardown Execution ─────────────────────────────────────

      router.post(
        "/year-end-cleardown",
        {
          preHandler: [requirePermission("PERIOD_MANAGE")],
          config: { rateLimit: { max: 3, timeWindow: "1 minute" } }
        },
        async (request, reply) => {
          try {
            const entityId = request.entityId;
            if (!entityId)
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
              });
            const payload = runYearEndCleardownSchema.parse(request.body);
            const actorId = (request as any).user?.id ?? (request as any).user?.sub ?? "system";
            const data = await runYearEndCleardown(
              prisma as unknown as PrismaClient,
              entityId,
              actorId,
              payload
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1/period-close" }
  );
}
