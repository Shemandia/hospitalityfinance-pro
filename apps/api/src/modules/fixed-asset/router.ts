import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
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
import { mapError, requireEntityId } from "../../shared/router-utils.js";

const fixedAssetService = new FixedAssetService(prisma as unknown as PrismaClient);

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
        { preHandler: [requirePermission("ADMIN_SETTINGS")] },
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
        { preHandler: [requirePermission("GL_WRITE")] },
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
        { preHandler: [requirePermission("GL_WRITE")] },
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
        { preHandler: [requirePermission("ADMIN_SETTINGS")] },
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
        { preHandler: [requirePermission("GL_WRITE")] },
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
        { preHandler: [requirePermission("ADMIN_SETTINGS")] },
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
        { preHandler: [requirePermission("ADMIN_SETTINGS")] },
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
        { preHandler: [requirePermission("GL_WRITE")] },
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
        { preHandler: [requirePermission("ADMIN_SETTINGS")] },
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
