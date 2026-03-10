import type { FastifyReply, FastifyRequest } from "fastify";

export function requireRole(requiredRoles: string[]) {
  return async function roleHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const userRoles = request.user?.roles ?? [];
    const allowed = requiredRoles.some((role) => userRoles.includes(role));

    if (allowed) {
      return;
    }

    reply.code(403).send({
      data: null,
      errors: [
        {
          code: "AUTHORIZATION_FAILED",
          message: "You do not have sufficient role permissions."
        }
      ]
    });
  };
}
