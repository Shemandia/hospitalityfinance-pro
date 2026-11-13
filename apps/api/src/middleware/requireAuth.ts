import type { FastifyReply, FastifyRequest } from "fastify";
import { updateRequestContext } from "../db/requestContext.js";
import { canOpenEntity } from "../modules/access/resolver.js";
import { loadRequestAccess } from "./requirePermission.js";

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
 *
 * The entity named in X-Entity-ID is bound to the context — and so to
 * row-level security — only when the caller's resolved access can open it
 * (AUT-15). Otherwise the context carries no entity, and an entity route's
 * guard answers 403.
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

  let entityId: string | null = null;
  if (request.entityId) {
    // Memoised on the request; the guard reuses it.
    const access = await loadRequestAccess(request, reply);
    if (!access) return;
    if (canOpenEntity(access, request.entityId)) entityId = request.entityId;
  }

  updateRequestContext({ entityId, userId: request.user?.sub ?? null });
}
