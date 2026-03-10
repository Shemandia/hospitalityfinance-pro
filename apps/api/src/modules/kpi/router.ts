import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError, z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { KPIService, KPIServiceError } from "./service.js";

const kpiService = new KPIService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof KPIServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

function requireEntityId(entityId: string | undefined): string {
  if (!entityId) throw new KPIServiceError("KPI_ENTITY_REQUIRED", "X-Entity-ID header is required.", 400);
  return entityId;
}

const periodQuerySchema = z.object({
  periodId: z.string().uuid()
});

export async function registerKPIRouter(app: FastifyInstance): Promise<void> {
  app.register(async (router) => {
    router.addHook("preHandler", requireAuth);

    router.get("/revpar", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { periodId } = periodQuerySchema.parse(request.query);
        const data = await kpiService.getRevPAR({ entityId, periodId });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/balance-sheet", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { periodId } = periodQuerySchema.parse(request.query);
        const data = await kpiService.getBalanceSheet({ entityId, periodId });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/cash-flow", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { periodId } = periodQuerySchema.parse(request.query);
        const data = await kpiService.getCashFlow({ entityId, periodId });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/usali", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { periodId } = periodQuerySchema.parse(request.query);
        const data = await kpiService.getUSALI({ entityId, periodId });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/usali-comparative", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { periodId } = periodQuerySchema.parse(request.query);
        const data = await kpiService.getUSALIComparative({ entityId, periodId });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/currency-exposure", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const data = await kpiService.getCurrencyExposure(entityId);
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/entity-summary", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { year, month } = z.object({
          year: z.coerce.number().int().min(2000).max(2100),
          month: z.coerce.number().int().min(1).max(12),
        }).parse(request.query);
        const data = await kpiService.getEntitySummary(entityId, year, month);
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/revpar-trend", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { periodId } = periodQuerySchema.parse(request.query);
        const data = await kpiService.getRevPARTrend({ entityId, periodId });
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.get("/dashboard", async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const { periodId } = periodQuerySchema.parse(request.query);
        const data = await kpiService.getKPIDashboard(entityId, periodId);
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

  }, { prefix: "/api/v1/kpi" });
}
