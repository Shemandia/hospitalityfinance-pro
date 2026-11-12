import type { FastifyReply, FastifyRequest } from "fastify";
import { updateRequestContext } from "../db/requestContext.js";

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;
  const { statusCode } = error as { statusCode: unknown };
  return typeof statusCode === "number" ? statusCode : null;
}

/**
 * Authenticates the request (plugins/auth.ts) and binds the request context.
 * 401 and 403 are answers about the session; 503 means a dependency failed and
 * says nothing about the session (AUT-10). An error the plugin did not
 * classify is not turned into "signed out": it goes to the error handler.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.server.verifyAccessToken(request);
  } catch (error) {
    const statusCode = statusOf(error);
    if (statusCode === null) throw error;

    reply.code(statusCode).send({
      data: null,
      errors: [
        {
          code: statusCode === 503 ? "SERVICE_UNAVAILABLE" : "AUTHENTICATION_FAILED",
          message: error instanceof Error ? error.message : "Authentication failed."
        }
      ]
    });
    return;
  }

  updateRequestContext({
    entityId: request.entityId ?? null,
    chainId: request.chainId ?? null,
    userId: request.user?.sub ?? null
  });
}
