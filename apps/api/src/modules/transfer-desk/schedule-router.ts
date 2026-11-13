/**
 * Schedule API routes — per-profile automation schedule CRUD.
 *
 * POST   /transfer-desk/profiles/:profileId/schedule — set schedule
 * GET    /transfer-desk/profiles/:profileId/schedule — get current
 * DELETE /transfer-desk/profiles/:profileId/schedule — remove
 *
 * After create/delete, the ScheduleService syncs BullMQ repeatable
 * jobs so cron-scheduled profiles execute on time.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { scheduleCreateSchema } from "./schedule-types.js";
import { ScheduleService, ScheduleServiceError } from "./schedule-service.js";

function getScheduleService(request: FastifyRequest): ScheduleService {
  return new ScheduleService(prisma as unknown as PrismaClient, request.tenantSlug ?? "");
}

// ── Error mapper ─────────────────────────────────────────────────────────────

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [
        {
          code: "VALIDATION_ERROR",
          message: error.issues.map((i) => i.message).join("; ")
        }
      ]
    });
  }

  if (error instanceof ScheduleServiceError) {
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

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new ScheduleServiceError(
      "SCHEDULE_USER_CONTEXT_REQUIRED",
      "Token subject is required.",
      401
    );
  }
  return sub;
}

// ── Router registration ──────────────────────────────────────────────────────

export async function registerScheduleRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── GET /transfer-desk/profiles/:profileId/schedule ─────────────────

      router.get<{ Params: { profileId: string } }>(
        "/transfer-desk/profiles/:profileId/schedule",
        { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
        async (request, reply) => {
          try {
            const svc = getScheduleService(request);
            const data = await svc.get(request.params.profileId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── POST /transfer-desk/profiles/:profileId/schedule ────────────────

      router.post<{ Params: { profileId: string } }>(
        "/transfer-desk/profiles/:profileId/schedule",
        { preHandler: [requirePermission("TRANSFER_DESK_CONFIG")] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const payload = scheduleCreateSchema.parse(request.body);
            const svc = getScheduleService(request);
            const data = await svc.create(request.params.profileId, userId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── DELETE /transfer-desk/profiles/:profileId/schedule ──────────────

      router.delete<{ Params: { profileId: string } }>(
        "/transfer-desk/profiles/:profileId/schedule",
        { preHandler: [requirePermission("TRANSFER_DESK_CONFIG")] },
        async (request, reply) => {
          try {
            const svc = getScheduleService(request);
            const data = await svc.delete(request.params.profileId);
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
