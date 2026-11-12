/**
 * Lookup Table API routes — CRUD for Transfer Desk lookup tables.
 *
 * Lookup tables are used in TML mappings via the fn_lookup function.
 * The DB schema uses a normalised column/row/value structure;
 * this API flattens it into a user-friendly shape.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { lookupTableCreateSchema, lookupTableUpdateSchema } from "./lookup-types.js";
import { LookupService, LookupServiceError } from "./lookup-service.js";

const lookupService = new LookupService(prisma as unknown as PrismaClient);

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

  if (error instanceof LookupServiceError) {
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
    throw new LookupServiceError("LOOKUP_USER_CONTEXT_REQUIRED", "Token subject is required.", 401);
  }
  return sub;
}

// ── Router registration ──────────────────────────────────────────────────────

export async function registerLookupRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── GET /transfer-desk/lookup-tables — list ─────────────────────────

      router.get(
        "/transfer-desk/lookup-tables",
        { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
        async (_request, reply) => {
          try {
            const data = await lookupService.list();
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── GET /transfer-desk/lookup-tables/:tableId — get with entries ────

      router.get<{ Params: { tableId: string } }>(
        "/transfer-desk/lookup-tables/:tableId",
        { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
        async (request, reply) => {
          try {
            const data = await lookupService.get(request.params.tableId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── POST /transfer-desk/lookup-tables — create ──────────────────────

      router.post(
        "/transfer-desk/lookup-tables",
        { preHandler: [requirePermission("TRANSFER_DESK_CONFIG")] },
        async (request, reply) => {
          try {
            const userId = requireUserId(request.user?.sub);
            const payload = lookupTableCreateSchema.parse(request.body);
            const data = await lookupService.create(userId, payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── PUT /transfer-desk/lookup-tables/:tableId — update ──────────────

      router.put<{ Params: { tableId: string } }>(
        "/transfer-desk/lookup-tables/:tableId",
        { preHandler: [requirePermission("TRANSFER_DESK_CONFIG")] },
        async (request, reply) => {
          try {
            const payload = lookupTableUpdateSchema.parse(request.body);
            const data = await lookupService.update(request.params.tableId, payload);
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
