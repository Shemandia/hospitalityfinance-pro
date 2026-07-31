/**
 * Shared router utilities — eliminates copy-pasted mapError and requireEntityId
 * from 14+ router files.
 */
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { ServiceError } from "./service-error.js";

/**
 * Standard error handler for all module routers.
 *
 * Handles ZodError (validation), ServiceError (business logic), and unknown errors.
 * Logs unknown errors via Fastify's structured logger and returns a generic message.
 */
export function mapError(reply: FastifyReply, error: unknown): ReturnType<FastifyReply["send"]> {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof ServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  reply.log.error({ err: error }, "Unhandled error");
  return reply.code(500).send({
    data: null,
    errors: [{ code: "INTERNAL_SERVER_ERROR", message: "An internal error occurred" }]
  });
}

/**
 * Extract and validate X-Entity-ID from request context.
 * Throws ServiceError with ENTITY_CONTEXT_REQUIRED if missing.
 */
export function requireEntityId(entityId: string | undefined): string {
  if (!entityId) {
    throw new ServiceError("ENTITY_CONTEXT_REQUIRED", "X-Entity-ID header is required.", 400);
  }
  return entityId;
}
