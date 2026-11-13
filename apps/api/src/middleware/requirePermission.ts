/**
 * The route guard — the single authorization check of the API (WP-A).
 *
 *   requirePermission("GL_POST")                       entity-scoped (default)
 *   requirePermission(["GL_WRITE", "GL_POST"])         any of these, at the entity
 *   requirePermission("ADMIN_ROLES_MANAGE", { scope: "tenant" })
 *   requirePermission("ADMIN_USERS", { scope: "any-entity" })
 *
 * Scopes:
 *   entity      The user must hold the permission at the entity the request
 *               acts on (X-Entity-ID). No entity is 400; no access is 403.
 *   tenant      The user must hold the permission through a tenant-wide
 *               assignment. Used by routes that act on the tenant as a whole.
 *   any-entity  The user must hold the permission tenant-wide or at one entity
 *               at least. Only for routes that take no entity of their own and
 *               whose handler narrows its work with `permittedEntityIds`.
 *
 * The decision comes from AccessService, never from the token. A database or
 * cache fault is answered with 503, not with a denial or a sign-out (AUT-10).
 * The guard must run after requireAuth; without an authenticated user it
 * answers 401.
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  canOpenEntity,
  hasEntityPermission,
  hasTenantPermission,
  normalizePermission,
  permittedEntityIds,
  type ResolvedAccess
} from "../modules/access/resolver.js";
import { getAccessService } from "../modules/access/runtime.js";
import { AccessInfrastructureError } from "../modules/access/service.js";

export { permittedEntityIds };

export type PermissionScope = "entity" | "tenant" | "any-entity";

/** How a route is protected. Read by the route registry (route-access.ts). */
export type GuardAccess = { scope: PermissionScope; anyOf: string[] };

export type PermissionGuard = ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) & {
  readonly access: GuardAccess;
};

declare module "fastify" {
  interface FastifyRequest {
    /** The caller's resolved access, loaded once per request by the guard. */
    access?: ResolvedAccess;
    /** The permission codes of the guard that admitted the request. */
    admittedBy?: readonly string[];
  }
}

function deny(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
): FastifyReply {
  return reply.code(statusCode).send({ data: null, errors: [{ code, message }] });
}

/**
 * Resolves and memoises the caller's access on the request. Returns null after
 * sending a 401 or 503 response.
 */
export async function loadRequestAccess(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<ResolvedAccess | null> {
  if (request.access) return request.access;

  const userId = request.user?.sub;
  const tenantId = request.user?.tenantId;
  if (typeof userId !== "string" || userId === "") {
    deny(reply, 401, "AUTHENTICATION_FAILED", "Authentication is required.");
    return null;
  }
  if (typeof tenantId !== "string" || tenantId === "") {
    deny(reply, 401, "AUTHENTICATION_FAILED", "The session is not bound to a tenant.");
    return null;
  }

  try {
    request.access = await getAccessService().resolve({ tenantId, userId });
    return request.access;
  } catch (error) {
    if (error instanceof AccessInfrastructureError) {
      request.log.error({ err: error, dependency: error.dependency }, "Access check unavailable");
      deny(
        reply,
        503,
        "SERVICE_UNAVAILABLE",
        "Access could not be checked. Try again in a moment."
      );
      return null;
    }
    throw error;
  }
}

export function requirePermission(
  requiredPermissions: string | string[],
  options: { scope: PermissionScope } = { scope: "entity" }
): PermissionGuard {
  const anyOf = (Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions])
    .map(normalizePermission)
    .filter((code) => code !== "");
  if (anyOf.length === 0) {
    throw new Error("requirePermission: at least one permission code is required");
  }
  const scope = options.scope;
  const requirement = `Required permission: ${anyOf.join(" or ")}`;

  async function permissionGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const access = await loadRequestAccess(request, reply);
    if (!access) return;
    request.admittedBy = anyOf;

    if (scope === "tenant") {
      if (anyOf.some((code) => hasTenantPermission(access, code))) return;
      deny(reply, 403, "INSUFFICIENT_PERMISSIONS", `${requirement} (tenant-wide)`);
      return;
    }

    if (scope === "any-entity") {
      const permitted = permittedEntityIds(access, anyOf);
      if (permitted === "all" || permitted.length > 0) return;
      deny(reply, 403, "INSUFFICIENT_PERMISSIONS", requirement);
      return;
    }

    const entityId = request.entityId;
    if (!entityId) {
      deny(reply, 400, "ENTITY_CONTEXT_REQUIRED", "X-Entity-ID header is required.");
      return;
    }
    if (!canOpenEntity(access, entityId)) {
      deny(reply, 403, "ENTITY_ACCESS_DENIED", "You do not have access to this entity.");
      return;
    }
    if (anyOf.some((code) => hasEntityPermission(access, entityId, code))) return;
    deny(reply, 403, "INSUFFICIENT_PERMISSIONS", requirement);
  }

  return Object.assign(permissionGuard, { access: { scope, anyOf } });
}
