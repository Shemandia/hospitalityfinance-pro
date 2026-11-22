/**
 * Schedule API routes — per-profile automation schedule CRUD.
 *
 * POST   /integrations/profiles/:id/schedule — set schedule
 * GET    /integrations/profiles/:id/schedule — get current
 * DELETE /integrations/profiles/:id/schedule — remove
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

      // ── GET /integrations/profiles/:id/schedule ─────────────────

      router.get<{ Params: { id: string } }>(
        "/integrations/profiles/:id/schedule",
        { preHandler: [requirePermission("INTEGRATIONS_READ")] },
        async (request, reply) => {
          try {
            const svc = getScheduleService(request);
            const data = await svc.get(request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── POST /integrations/profiles/:id/schedule ────────────────

      router.post<{ Params: { id: string } }>(
        "/integrations/profiles/:id/schedule",
        { preHandler: [requirePermission("INTEGRATIONS_CONFIG")] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const payload = scheduleCreateSchema.parse(request.body);
            const svc = getScheduleService(request);
            const data = await svc.create(request.params.id, userId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── DELETE /integrations/profiles/:id/schedule ──────────────

      router.delete<{ Params: { id: string } }>(
        "/integrations/profiles/:id/schedule",
        { preHandler: [requirePermission("INTEGRATIONS_CONFIG")] },
        async (request, reply) => {
          try {
            const svc = getScheduleService(request);
            const data = await svc.delete(request.params.id);
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
