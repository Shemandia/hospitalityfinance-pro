import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Permission-based route guard. Checks if the authenticated user's JWT
 * contains ANY of the required permission codes.
 *
 * Usage:
 *   requirePermission("ADMIN_USERS")              // single permission
 *   requirePermission(["GL_WRITE", "GL_POST"])     // any of these
 */
export function requirePermission(requiredPermissions: string | string[]) {
  const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

  return async function permissionHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const userPermissions = (request.user?.permissions ?? []).map((p: string) => p.toUpperCase());
    const allowed = required.some((perm) => userPermissions.includes(perm.toUpperCase()));

    if (allowed) return;

    return reply.code(403).send({
      data: null,
      errors: [
        {
          code: "INSUFFICIENT_PERMISSIONS",
          message: `Required permission: ${required.join(" or ")}`
        }
      ]
    });
  };
}
