/**
 * TML Mapping API routes — target fields and pre-built functions.
 *
 * These are read-only endpoints that return the HFP target journal
 * field definitions and the pre-built transform function library.
 * Both are static constants (not DB-driven).
 */

import type { FastifyInstance } from "fastify";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { HFP_TARGET_FIELDS, PREBUILT_FUNCTIONS } from "./constants.js";

// ── Router registration ──────────────────────────────────────────────────────

export async function registerMappingsRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── GET /transfer-desk/mappings/target-fields ─────────────────────

      router.get(
        "/transfer-desk/mappings/target-fields",
        { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
        async (_request, reply) => {
          return reply.send({ data: HFP_TARGET_FIELDS, errors: [] });
        }
      );

      // ── GET /transfer-desk/mappings/functions ─────────────────────────

      router.get(
        "/transfer-desk/mappings/functions",
        { preHandler: [requirePermission("TRANSFER_DESK_READ")] },
        async (_request, reply) => {
          return reply.send({ data: PREBUILT_FUNCTIONS, errors: [] });
        }
      );
    },
    { prefix: "/api/v1" }
  );
}
