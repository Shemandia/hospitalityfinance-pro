import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";
import { updateRequestContext } from "../db/requestContext.js";
import { withBypassRLS } from "../db/rls-bypass.js";
import type { Prisma } from "../db/client.js";
import { canOpenEntity } from "../modules/access/resolver.js";
import { loadRequestAccess } from "./requirePermission.js";

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;
  const { statusCode } = error as { statusCode: unknown };
  return typeof statusCode === "number" ? statusCode : null;
}

/** The top of the entity's tree: the chain the entity belongs to. */
async function resolveChainEntityId(entityId: string): Promise<string | null> {
  return withBypassRLS(prisma, async (tx: Prisma.TransactionClient) => {
    const visited = new Set<string>();
    let currentId: string | null = entityId;
    let top: string | null = null;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const entity: { id: string; parentId: string | null } | null = await tx.entity.findUnique({
        where: { id: currentId },
        select: { id: true, parentId: true }
      });
      if (!entity) break;
      top = entity.id;
      currentId = entity.parentId;
    }
    return top;
  });
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
 * guard answers 403. The entity's chain is looked up only for an entity the
 * caller can open.
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
  let chainId: string | null = null;
  if (request.entityId) {
    // Memoised on the request; the guard reuses it.
    const access = await loadRequestAccess(request, reply);
    if (!access) return;
    if (canOpenEntity(access, request.entityId)) {
      entityId = request.entityId;
      try {
        chainId = await resolveChainEntityId(entityId);
      } catch (error) {
        request.log.error({ err: error, dependency: "tenant database" }, "Chain lookup failed");
        reply.code(503).send({
          data: null,
          errors: [
            {
              code: "SERVICE_UNAVAILABLE",
              message: "The request could not be prepared. Try again in a moment."
            }
          ]
        });
        return;
      }
    }
  }
  request.chainId = chainId ?? undefined;

  updateRequestContext({
    entityId,
    chainId,
    userId: request.user?.sub ?? null
  });
}
