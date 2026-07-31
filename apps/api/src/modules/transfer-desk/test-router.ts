/**
 * Test & Preview API routes — dry-run test execution with SSE streaming.
 *
 * POST /transfer-desk/profiles/:profileId/test
 *   → Run dry-run test, stream SSE progress events, cache results
 *
 * GET /transfer-desk/profiles/:profileId/test/:testId/results
 *   → Return cached test results
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { testExecuteSchema } from "./test-types.js";
import { TestRunnerService, TestServiceError } from "./test-service.js";

const testService = new TestRunnerService(prisma as unknown as PrismaClient);

// ── Error mapper ─────────────────────────────────────────────────────────────

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [
        {
          code: "VALIDATION_ERROR",
          message: error.issues.map((i) => i.message).join("; ")
        }
      ]
    });
  }

  if (error instanceof TestServiceError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({
    data: null,
    errors: [{ code: "INTERNAL_SERVER_ERROR", message }]
  });
}

function requireUserId(sub: unknown): string {
  if (typeof sub !== "string" || sub.length === 0) {
    throw new TestServiceError("TEST_USER_CONTEXT_REQUIRED", "Token subject is required.", 401);
  }
  return sub;
}

// ── Router registration ──────────────────────────────────────────────────────

export async function registerTestRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── POST /transfer-desk/profiles/:profileId/test — SSE stream ───────
      //
      // Validates input, then switches to SSE mode and streams progress.
      // The response is an SSE stream, not a JSON envelope.

      router.post<{ Params: { profileId: string } }>(
        "/transfer-desk/profiles/:profileId/test",
        { preHandler: [requirePermission(["TRANSFER_DESK_EXECUTE", "TRANSFER_DESK_CONFIG"])] },
        async (request, reply) => {
          // Validate input before switching to SSE
          let payload;
          try {
            payload = testExecuteSchema.parse(request.body);
          } catch (error) {
            return mapError(reply, error);
          }

          const userId = requireUserId(request.user?.sub);
          const fileBuffer = Buffer.from(payload.file, "base64");

          // Size guard: 10 MB
          if (fileBuffer.length > 10 * 1024 * 1024) {
            return reply.code(400).send({
              data: null,
              errors: [
                {
                  code: "FILE_TOO_LARGE",
                  message: "File exceeds 10 MB limit."
                }
              ]
            });
          }

          // Switch to SSE mode (following tenant provisioning pattern)
          const origin = request.headers.origin ?? "*";
          reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true"
          });
          reply.raw.flushHeaders();

          const sse = (event: string, data: Record<string, unknown>) => {
            reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          };

          try {
            await testService.runTest(request.params.profileId, userId, fileBuffer, sse);
          } catch (error) {
            const msg = error instanceof Error ? error.message : "Unknown error";
            const code = error instanceof TestServiceError ? error.code : "TEST_EXECUTION_ERROR";
            sse("error", { code, message: msg });
          } finally {
            reply.raw.end();
          }
        }
      );

      // ── GET /transfer-desk/profiles/:profileId/test/:testId/results ─────

      router.get<{ Params: { profileId: string; testId: string } }>(
        "/transfer-desk/profiles/:profileId/test/:testId/results",
        async (request, reply) => {
          try {
            const data = await testService.getResults(
              request.params.profileId,
              request.params.testId
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1" }
  );
}
