/**
 * RBAC Middleware — Write Access Gate
 *
 * Blocks users who only have *_READ permissions from non-GET requests.
 * Users with any write/post/approve/manage/config permission pass through.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function requireWriteAccess(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Allow all GET/HEAD/OPTIONS requests (read-only)
  if (!WRITE_METHODS.has(request.method)) return;

  const userPermissions = (request.user?.permissions ?? []).map((p: string) => p.toUpperCase());

  // User has at least one non-read permission → can write
  const hasWritePerm = userPermissions.some((p: string) => !p.endsWith("_READ"));
  if (hasWritePerm) return;

  // Also allow if user has TENANT_ADMIN role (always has all permissions)
  const userRoles = (request.user?.roles ?? []).map((r: string) => r.toUpperCase());
  if (userRoles.includes("TENANT_ADMIN")) return;

  return reply.code(403).send({
    data: null,
    errors: [
      {
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Your permissions do not allow write operations. Contact your administrator."
      }
    ]
  });
}
