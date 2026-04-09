import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireWriteAccess } from "../../middleware/requireWriteAccess.js";
import {
  assetCategoryCreateSchema,
  assetCreateSchema,
  assetUpdateSchema,
  assetListQuerySchema,
  assetDisposeSchema,
  assetTransferSchema,
  assetRevalueSchema,
  depreciationRunSchema
} from "./types.js";
import { FixedAssetService, FixedAssetServiceError } from "./service.js";

const fixedAssetService = new FixedAssetService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [
        {
          code: "VALIDATION_ERROR",
          message: error.issues.map((issue) => issue.message).join("; ")
        }
      ]
    });
  }

  if (error instanceof FixedAssetServiceError) {
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

function requireEntityId(entityId: string | undefined): string {
  if (!entityId) {
    throw new FixedAssetServiceError(
      "ASSET_ENTITY_CONTEXT_REQUIRED",
      "X-Entity-ID header is required.",
      400
    );
  }
  return entityId;
}

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new FixedAssetServiceError(
      "ASSET_USER_CONTEXT_REQUIRED",
      "Token subject is required.",
      401
    );
  }
  return sub;
}

export async function registerFixedAssetRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireWriteAccess);

      // ── Asset Categories ─────────────────────────────────────────────────

      router.get("/asset-categories", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await fixedAssetService.listCategories(entityId);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post(
        "/asset-categories",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = assetCategoryCreateSchema.parse(request.body);
            const data = await fixedAssetService.createCategory(entityId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Fixed Assets CRUD ────────────────────────────────────────────────

      router.get("/fixed-assets", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const query = assetListQuerySchema.parse(request.query);
          const data = await fixedAssetService.listAssets(entityId, query);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/fixed-assets/:id", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await fixedAssetService.getAsset(entityId, request.params.id);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post(
        "/fixed-assets",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN", "CONTROLLER"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const payload = assetCreateSchema.parse(request.body);
            const data = await fixedAssetService.createAsset(entityId, userId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/fixed-assets/:id",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN", "CONTROLLER"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = assetUpdateSchema.parse(request.body);
            const data = await fixedAssetService.updateAsset(entityId, request.params.id, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Lifecycle ────────────────────────────────────────────────────────

      router.post<{ Params: { id: string } }>(
        "/fixed-assets/:id/dispose",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const payload = assetDisposeSchema.parse(request.body);
            const data = await fixedAssetService.disposeAsset(
              entityId,
              request.params.id,
              userId,
              payload
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/fixed-assets/:id/transfer",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN", "CONTROLLER"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const payload = assetTransferSchema.parse(request.body);
            const data = await fixedAssetService.transferAsset(
              entityId,
              request.params.id,
              userId,
              payload
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/fixed-assets/:id/revalue",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const payload = assetRevalueSchema.parse(request.body);
            const data = await fixedAssetService.revalueAsset(
              entityId,
              request.params.id,
              userId,
              payload
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/fixed-assets/:id/write-off",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const data = await fixedAssetService.writeOffAsset(entityId, request.params.id, userId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Depreciation ─────────────────────────────────────────────────────

      router.post(
        "/fixed-assets/depreciation/preview",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN", "CONTROLLER"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const { periodId } = depreciationRunSchema.parse(request.body);
            const data = await fixedAssetService.calculateDepreciation(entityId, periodId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/fixed-assets/depreciation/run",
        { preHandler: [requireRole(["ADMIN", "SUPERADMIN"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const userId = requireUserId(request.user?.sub);
            const { periodId } = depreciationRunSchema.parse(request.body);
            const data = await fixedAssetService.runDepreciation(entityId, periodId, userId);
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
