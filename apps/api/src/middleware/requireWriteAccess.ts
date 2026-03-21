/**
 * RBAC Middleware — Write Access Gate
 *
 * Blocks VIEWER-only users from non-GET requests.
 * This is the baseline access control layer.
 *
 * Role hierarchy (hospitality finance):
 *   VIEWER       → Read-only: dashboards, reports, trial balance
 *   CONTROLLER   → Post journals, approve invoices, close periods, run reports
 *   ADMIN        → Full module access, entity admin, imports, payment runs
 *   SUPERADMIN   → Cross-entity, system config, period reopen
 *
 * Usage: Add as preHandler on router to block viewers from all writes.
 * For stricter checks, use requireRole(["ADMIN"]) on individual endpoints.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Blocks VIEWER users from any non-GET request.
 * Users with CONTROLLER, ADMIN, or SUPERADMIN roles pass through.
 * Users with no roles (unauthenticated edge case) are blocked.
 */
export async function requireWriteAccess(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Allow all GET/HEAD/OPTIONS requests (read-only)
  if (!WRITE_METHODS.has(request.method)) return;

  const userRoles = (request.user?.roles ?? []).map((r: string) => r.toUpperCase());

  // Users with any write-capable role pass through
  const writeRoles = ["CONTROLLER", "ADMIN", "SUPERADMIN"];
  if (writeRoles.some((r) => userRoles.includes(r))) return;

  // Block: user has no write-capable role (VIEWER or no role)
  reply.code(403).send({
    data: null,
    errors: [
      {
        code: "INSUFFICIENT_ROLE",
        message:
          "Your role does not permit write operations. Contact your administrator for CONTROLLER or ADMIN access."
      }
    ]
  });
}
