import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { FXService } from "./service.js";
import { runLedgerRevaluation } from "./ledger-revaluation.js";
import { mapError } from "../../shared/router-utils.js";
import {
  convertQuerySchema,
  currencyCreateSchema,
  fxRateCreateSchema,
  fxRateQuerySchema,
  revaluationRequestSchema
} from "./types.js";
import {
  createRevaluationProfileSchema,
  updateRevaluationProfileSchema,
  runLedgerRevaluationSchema
} from "./revaluation-types.js";

const fxService = new FXService(prisma as unknown as PrismaClient);

export async function registerFXRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── Currencies ─────────────────────────────────────────────────────────────
      router.get(
        "/currencies",
        { preHandler: [requirePermission(["FX_READ", "GL_READ"])] },
        async (_request, reply) => {
          try {
            const data = await fxService.listCurrencies();
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/currencies",
        { preHandler: [requirePermission("FX_WRITE")] },
        async (request, reply) => {
          try {
            const payload = currencyCreateSchema.parse(request.body);
            const data = await fxService.upsertCurrency(payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── FX Rates ───────────────────────────────────────────────────────────────
      router.get(
        "/rates",
        { preHandler: [requirePermission(["FX_READ", "GL_READ"])] },
        async (request, reply) => {
          try {
            const query = fxRateQuerySchema.parse(request.query);
            const data = await fxService.listRates(query);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/rates",
        { preHandler: [requirePermission("FX_WRITE")] },
        async (request, reply) => {
          try {
            const payload = fxRateCreateSchema.parse(request.body);
            const data = await fxService.upsertRate(payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/rates/:id",
        {
          preHandler: [requirePermission("FX_WRITE")]
        },
        async (request, reply) => {
          try {
            await fxService.deleteRate(request.params.id);
            return reply.send({ data: { deleted: true }, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Convert ────────────────────────────────────────────────────────────────
      router.get(
        "/convert",
        { preHandler: [requirePermission(["FX_READ", "GL_READ"])] },
        async (request, reply) => {
          try {
            const query = convertQuerySchema.parse(request.query);
            const data = await fxService.convert(query);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── ECB Import ─────────────────────────────────────────────────────────────
      router.post(
        "/ecb-import",
        {
          preHandler: [requirePermission("FX_WRITE")],
          config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
        },
        async (_request, reply) => {
          try {
            const data = await fxService.importEcbRates();
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Revaluation ────────────────────────────────────────────────────────────
      router.post(
        "/revaluation",
        {
          preHandler: [requirePermission("FX_WRITE")],
          config: { rateLimit: { max: 5, timeWindow: "1 minute" } }
        },
        async (request, reply) => {
          try {
            const payload = revaluationRequestSchema.parse(request.body);

            // Enforce entity scope — revaluation entityId must match request context
            const requestEntityId = request.entityId;
            if (!requestEntityId) {
              return reply.code(400).send({
                data: null,
                errors: [{ code: "FX_ENTITY_REQUIRED", message: "X-Entity-ID header is required." }]
              });
            }
            if (payload.entityId !== requestEntityId) {
              return reply.code(403).send({
                data: null,
                errors: [
                  {
                    code: "FX_ENTITY_MISMATCH",
                    message: "Revaluation entityId must match your current entity context."
                  }
                ]
              });
            }

            const data = await fxService.runRevaluation(payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
      // ── Revaluation Profiles ──────────────────────────────────────────────

      router.get(
        "/revaluation-profiles",
        { preHandler: [requirePermission("FX_READ")] },
        async (request, reply) => {
          try {
            const entityId = request.entityId;
            if (!entityId)
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
              });
            const data = await (
              prisma as unknown as PrismaClient as any
            ).revaluationProfile.findMany({
              where: { entityId, isActive: true },
              orderBy: { name: "asc" }
            });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { id: string } }>(
        "/revaluation-profiles/:id",
        { preHandler: [requirePermission("FX_READ")] },
        async (request, reply) => {
          try {
            const entityId = request.entityId;
            if (!entityId)
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
              });
            const data = await (
              prisma as unknown as PrismaClient as any
            ).revaluationProfile.findFirst({
              where: { id: request.params.id, entityId }
            });
            if (!data)
              return reply.code(404).send({
                data: null,
                errors: [{ code: "NOT_FOUND", message: "Revaluation profile not found." }]
              });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/revaluation-profiles",
        { preHandler: [requirePermission("FX_WRITE")] },
        async (request, reply) => {
          try {
            const entityId = request.entityId;
            if (!entityId)
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
              });
            const payload = createRevaluationProfileSchema.parse(request.body);
            const data = await (prisma as unknown as PrismaClient as any).revaluationProfile.create(
              {
                data: {
                  entityId,
                  name: payload.name,
                  accountTypeFilter: payload.accountTypeFilter as any,
                  accountCodeFrom: payload.accountCodeFrom ?? null,
                  accountCodeTo: payload.accountCodeTo ?? null,
                  currencyFilter: payload.currencyFilter ?? null,
                  rateType: payload.rateType,
                  gainAccountCode: payload.gainAccountCode,
                  lossAccountCode: payload.lossAccountCode,
                  autoReverse: payload.autoReverse,
                  postDifferences: payload.postDifferences,
                  description: payload.description ?? null
                }
              }
            );
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/revaluation-profiles/:id",
        { preHandler: [requirePermission("FX_WRITE")] },
        async (request, reply) => {
          try {
            const entityId = request.entityId;
            if (!entityId)
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
              });
            const existing = await (
              prisma as unknown as PrismaClient as any
            ).revaluationProfile.findFirst({
              where: { id: request.params.id, entityId }
            });
            if (!existing)
              return reply.code(404).send({
                data: null,
                errors: [{ code: "NOT_FOUND", message: "Revaluation profile not found." }]
              });
            const payload = updateRevaluationProfileSchema.parse(request.body);
            const data: Record<string, unknown> = {};
            if (payload.name !== undefined) data.name = payload.name;
            if (payload.accountTypeFilter !== undefined)
              data.accountTypeFilter = payload.accountTypeFilter;
            if (payload.accountCodeFrom !== undefined)
              data.accountCodeFrom = payload.accountCodeFrom;
            if (payload.accountCodeTo !== undefined) data.accountCodeTo = payload.accountCodeTo;
            if (payload.currencyFilter !== undefined) data.currencyFilter = payload.currencyFilter;
            if (payload.rateType !== undefined) data.rateType = payload.rateType;
            if (payload.gainAccountCode !== undefined)
              data.gainAccountCode = payload.gainAccountCode;
            if (payload.lossAccountCode !== undefined)
              data.lossAccountCode = payload.lossAccountCode;
            if (payload.autoReverse !== undefined) data.autoReverse = payload.autoReverse;
            if (payload.postDifferences !== undefined)
              data.postDifferences = payload.postDifferences;
            if (payload.description !== undefined) data.description = payload.description;
            const updated = await (
              prisma as unknown as PrismaClient as any
            ).revaluationProfile.update({
              where: { id: request.params.id },
              data
            });
            return reply.send({ data: updated, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/revaluation-profiles/:id",
        { preHandler: [requirePermission("FX_WRITE")] },
        async (request, reply) => {
          try {
            const entityId = request.entityId;
            if (!entityId)
              return reply.code(400).send({
                data: null,
                errors: [{ code: "MISSING_ENTITY", message: "X-Entity-ID required." }]
              });
            await (prisma as unknown as PrismaClient as any).revaluationProfile.update({
              where: { id: request.params.id },
              data: { isActive: false }
            });
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Ledger Revaluation Execution ──────────────────────────────────────

      router.post(
        "/ledger-revaluation",
        {
          preHandler: [requirePermission("FX_WRITE")],
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
            const payload = runLedgerRevaluationSchema.parse(request.body);
            const actorId = (request as any).user?.id ?? (request as any).user?.sub ?? "system";
            const data = await runLedgerRevaluation(
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
    { prefix: "/api/v1/fx" }
  );
}
