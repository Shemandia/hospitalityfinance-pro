import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { FXService, FXServiceError } from "./service.js";
import {
  convertQuerySchema,
  currencyCreateSchema,
  fxRateCreateSchema,
  fxRateQuerySchema,
  revaluationRequestSchema
} from "./types.js";

const fxService = new FXService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof FXServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

export async function registerFXRouter(app: FastifyInstance): Promise<void> {
  app.register(async (router) => {
    router.addHook("preHandler", requireAuth);

    // ── Currencies ─────────────────────────────────────────────────────────────
    router.get("/currencies", async (_request, reply) => {
      try {
        const data = await fxService.listCurrencies();
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.post("/currencies", async (request, reply) => {
      try {
        const payload = currencyCreateSchema.parse(request.body);
        const data = await fxService.upsertCurrency(payload);
        return reply.code(201).send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    // ── FX Rates ───────────────────────────────────────────────────────────────
    router.get("/rates", async (request, reply) => {
      try {
        const query = fxRateQuerySchema.parse(request.query);
        const data = await fxService.listRates(query);
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    router.post("/rates", async (request, reply) => {
      try {
        const payload = fxRateCreateSchema.parse(request.body);
        const data = await fxService.upsertRate(payload);
        return reply.code(201).send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    // ── Convert ────────────────────────────────────────────────────────────────
    router.get("/convert", async (request, reply) => {
      try {
        const query = convertQuerySchema.parse(request.query);
        const data = await fxService.convert(query);
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    // ── ECB Import ─────────────────────────────────────────────────────────────
    router.post("/ecb-import", async (_request, reply) => {
      try {
        const data = await fxService.importEcbRates();
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });

    // ── Revaluation ────────────────────────────────────────────────────────────
    router.post("/revaluation", async (request, reply) => {
      try {
        const payload = revaluationRequestSchema.parse(request.body);
        const data = await fxService.runRevaluation(payload);
        return reply.send({ data, errors: [] });
      } catch (error) { return mapError(reply, error); }
    });
  }, { prefix: "/api/v1/fx" });
}
