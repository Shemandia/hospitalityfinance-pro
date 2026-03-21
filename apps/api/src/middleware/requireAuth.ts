import type { FastifyReply, FastifyRequest } from "fastify";
import { updateRequestContext } from "../db/requestContext.js";

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.server.verifyAccessToken(request);
    updateRequestContext({
      entityId: request.entityId ?? null,
      chainId: request.chainId ?? null,
      userId: typeof request.user?.sub === "string" ? request.user.sub : null
    });
  } catch (error) {
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof (error as { statusCode: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 401;

    const message = error instanceof Error ? error.message : "Authentication failed.";

    reply.code(statusCode).send({
      data: null,
      errors: [
        {
          code: "AUTHENTICATION_FAILED",
          message
        }
      ]
    });
  }
}
