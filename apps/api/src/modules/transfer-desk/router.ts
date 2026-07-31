import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import {
  profileCreateSchema,
  profileUpdateSchema,
  profileListQuerySchema,
  profileStatusChangeSchema
} from "./types.js";
import { ProfileService, ProfileServiceError } from "./service.js";

const profileService = new ProfileService(prisma as unknown as PrismaClient);

// ── Error mapper ─────────────────────────────────────────────────────────────

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

  if (error instanceof ProfileServiceError) {
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

// ── Context helpers ──────────────────────────────────────────────────────────

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new ProfileServiceError(
      "PROFILE_USER_CONTEXT_REQUIRED",
      "Token subject is required.",
      401
    );
  }
  return sub;
}

// ── Router registration ──────────────────────────────────────────────────────

export async function registerTransferDeskProfileRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── POST /transfer-desk/profiles — create new profile (DRAFT) ───────

      router.post(
        "/transfer-desk/profiles",
        { preHandler: [requirePermission("TRANSFER_DESK_CONFIG")] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const payload = profileCreateSchema.parse(request.body);
            const data = await profileService.create(userId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── GET /transfer-desk/profiles — list (paginated, filterable) ──────

      router.get("/transfer-desk/profiles", async (request, reply) => {
        try {
          const query = profileListQuerySchema.parse(request.query);
          const result = await profileService.list(query);
          return reply.send({
            data: result.data,
            meta: {
              total: result.total,
              limit: result.limit,
              offset: result.offset
            },
            errors: []
          });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── GET /transfer-desk/profiles/:profileId — get detail ─────────────

      router.get<{ Params: { profileId: string } }>(
        "/transfer-desk/profiles/:profileId",
        async (request, reply) => {
          try {
            const data = await profileService.get(request.params.profileId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── PUT /transfer-desk/profiles/:profileId — update ─────────────────

      router.put<{ Params: { profileId: string } }>(
        "/transfer-desk/profiles/:profileId",
        { preHandler: [requirePermission("TRANSFER_DESK_CONFIG")] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const payload = profileUpdateSchema.parse(request.body);
            const data = await profileService.update(request.params.profileId, userId, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── PATCH /transfer-desk/profiles/:profileId/status — change status ─

      router.patch<{ Params: { profileId: string } }>(
        "/transfer-desk/profiles/:profileId/status",
        { preHandler: [requirePermission("TRANSFER_DESK_CONFIG")] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const payload = profileStatusChangeSchema.parse(request.body);
            const data = await profileService.changeStatus(
              request.params.profileId,
              userId,
              payload
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── DELETE /transfer-desk/profiles/:profileId — soft delete ─────────

      router.delete<{ Params: { profileId: string } }>(
        "/transfer-desk/profiles/:profileId",
        { preHandler: [requirePermission("TRANSFER_DESK_CONFIG")] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const data = await profileService.softDelete(request.params.profileId, userId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── GET /transfer-desk/profiles/:profileId/versions — list versions ─

      router.get<{ Params: { profileId: string } }>(
        "/transfer-desk/profiles/:profileId/versions",
        async (request, reply) => {
          try {
            const data = await profileService.listVersions(request.params.profileId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── GET /transfer-desk/profiles/:profileId/versions/:versionId ──────

      router.get<{ Params: { profileId: string; versionId: string } }>(
        "/transfer-desk/profiles/:profileId/versions/:versionId",
        async (request, reply) => {
          try {
            const data = await profileService.getVersion(
              request.params.profileId,
              request.params.versionId
            );
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
