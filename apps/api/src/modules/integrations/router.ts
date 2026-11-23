import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
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

export async function registerIntegrationProfileRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── POST /integrations/profiles — create new profile (DRAFT) ───────

      router.post(
        "/integrations/profiles",
        { preHandler: [requirePermission(["INTEGRATIONS_CONFIG", "INTEGRATION_CONFIG"])] },
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

      // ── GET /integrations/profiles — list (paginated, filterable) ──────

      router.get(
        "/integrations/profiles",
        { preHandler: [requirePermission("INTEGRATIONS_READ")] },
        async (request, reply) => {
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
        }
      );

      // ── GET /integrations/profiles/:id — get detail ─────────────

      router.get<{ Params: { id: string } }>(
        "/integrations/profiles/:id",
        { preHandler: [requirePermission("INTEGRATIONS_READ")] },
        async (request, reply) => {
          try {
            const data = await profileService.get(request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── PUT /integrations/profiles/:id — update ─────────────────

      router.put<{ Params: { id: string } }>(
        "/integrations/profiles/:id",
        { preHandler: [requirePermission(["INTEGRATIONS_CONFIG", "INTEGRATION_CONFIG"])] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const payload = profileUpdateSchema.parse(request.body);
            const data = await profileService.update(request.params.id, userId, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── PATCH /integrations/profiles/:id/status — change status ─

      router.patch<{ Params: { id: string } }>(
        "/integrations/profiles/:id/status",
        { preHandler: [requirePermission(["INTEGRATIONS_CONFIG", "INTEGRATION_CONFIG"])] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const payload = profileStatusChangeSchema.parse(request.body);
            const data = await profileService.changeStatus(request.params.id, userId, payload);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── DELETE /integrations/profiles/:id — soft delete ─────────

      router.delete<{ Params: { id: string } }>(
        "/integrations/profiles/:id",
        { preHandler: [requirePermission(["INTEGRATIONS_CONFIG", "INTEGRATION_CONFIG"])] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const data = await profileService.softDelete(request.params.id, userId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── GET /integrations/profiles/:id/versions — list versions ─

      router.get<{ Params: { id: string } }>(
        "/integrations/profiles/:id/versions",
        { preHandler: [requirePermission("INTEGRATIONS_READ")] },
        async (request, reply) => {
          try {
            const data = await profileService.listVersions(request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── GET /integrations/profiles/:id/versions/:versionId ──────

      router.get<{ Params: { id: string; versionId: string } }>(
        "/integrations/profiles/:id/versions/:versionId",
        { preHandler: [requirePermission("INTEGRATIONS_READ")] },
        async (request, reply) => {
          try {
            const data = await profileService.getVersion(
              request.params.id,
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
