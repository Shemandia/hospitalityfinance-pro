/**
 * Auth Routes — Public & Protected
 *
 * All /auth/* routes are public (no auth hook). Cookie-based token delivery.
 * Protected auth endpoints (logout, change-password, me, sessions) require
 * a valid JWT — enforced via the auth plugin's verifyAccessToken.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AuthService, AuthError, ValidationError } from "../../services/auth.service.js";
import { getRedisClient } from "../../db/redis.js";
import { resolveTenantByCode, resolveTenantById } from "../../db/tenantRegistry.js";
import { sendPasswordResetEmail } from "../../shared/email.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { AccessInfrastructureError } from "../access/service.js";

const COOKIE_SECURE =
  process.env.NODE_ENV === "production" ? true : process.env.COOKIE_SECURE === "true";
const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN?.trim() || undefined;
const REFRESH_EXPIRY = parseInt(process.env.JWT_REFRESH_EXPIRY ?? "604800", 10);

let authService: AuthService | null = null;

function getAuthService(): AuthService {
  if (!authService) {
    authService = new AuthService(getRedisClient());
  }
  return authService;
}

function sendError(reply: FastifyReply, error: unknown) {
  // An access-service outage is answered with 503 by the application's error handler.
  if (error instanceof AccessInfrastructureError) throw error;
  if (error instanceof AuthError) {
    return reply.code(error.statusCode).send({
      data: null,
      errors: [{ code: error.code, message: error.message }]
    });
  }
  if (error instanceof ValidationError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.message }]
    });
  }
  // Unknown error — don't leak internals
  return reply.code(500).send({
    data: null,
    errors: [{ code: "INTERNAL_ERROR", message: "An unexpected error occurred" }]
  });
}

function setCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  expiresIn: number
) {
  reply
    .setCookie("hfp_access_token", accessToken, {
      ...getAuthCookieBaseOptions(),
      maxAge: expiresIn
    })
    .setCookie("hfp_refresh_token", refreshToken, {
      ...getAuthCookieBaseOptions(),
      maxAge: REFRESH_EXPIRY
    });
}

function clearCookies(reply: FastifyReply) {
  reply
    .clearCookie("hfp_access_token", getAuthClearCookieOptions())
    .clearCookie("hfp_refresh_token", getAuthClearCookieOptions());
}

export function getAuthCookieBaseOptions() {
  return {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "strict" as const,
    path: "/",
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {})
  };
}

export function getAuthClearCookieOptions() {
  return {
    path: "/",
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {})
  };
}

export function buildLoginResponseData(result: {
  expiresIn: number;
  mustChangePassword: boolean;
  user: unknown;
}) {
  return {
    expiresIn: result.expiresIn,
    mustChangePassword: result.mustChangePassword,
    user: result.user
  };
}

export function buildRefreshResponseData(result: { expiresIn: number }) {
  return {
    expiresIn: result.expiresIn
  };
}

// ── Route Registration ───────────────────────────────────────────────────────

export async function registerAuthRouter(app: FastifyInstance): Promise<void> {
  // ── Public routes (no auth) ─────────────────────────────────────────────

  // POST /auth/login
  app.post<{
    Body: { email: string; password: string; tenantCode: string };
  }>(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password", "tenantCode"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 1 },
            tenantCode: { type: "string", minLength: 8, maxLength: 8 }
          }
        }
      },
      config: {
        access: "public",
        rateLimit: {
          max: 10,
          timeWindow: "15 minutes"
        }
      }
    },
    async (request, reply) => {
      try {
        const { email, password, tenantCode } = request.body;
        const result = await getAuthService().login(email, password, tenantCode, {
          ip: request.ip,
          userAgent: request.headers["user-agent"] ?? "unknown"
        });

        setCookies(reply, result.accessToken, result.refreshToken, result.expiresIn);

        return reply.send({
          data: buildLoginResponseData(result),
          errors: []
        });
      } catch (error) {
        request.log.warn({ err: error }, "Login failed");
        return sendError(reply, error);
      }
    }
  );

  // POST /auth/refresh
  app.post(
    "/auth/refresh",
    {
      config: {
        access: "public",
        rateLimit: {
          max: 30,
          timeWindow: "15 minutes"
        }
      }
    },
    async (request, reply) => {
      try {
        // Only accept refresh token from httpOnly cookie — never from body
        const refreshToken = request.cookies?.hfp_refresh_token;

        if (!refreshToken) {
          return reply.code(400).send({
            data: null,
            errors: [{ code: "MISSING_TOKEN", message: "Refresh token required" }]
          });
        }

        const result = await getAuthService().refresh(refreshToken);
        setCookies(reply, result.accessToken, result.refreshToken, result.expiresIn);

        return reply.send({
          data: buildRefreshResponseData(result),
          errors: []
        });
      } catch (error) {
        clearCookies(reply);
        return sendError(reply, error);
      }
    }
  );

  // GET /auth/tenant/:tenantCode — validate tenant code exists (public)
  app.get<{ Params: { tenantCode: string } }>(
    "/auth/tenant/:tenantCode",
    { config: { access: "public" } },
    async (request, reply) => {
      const result = await getAuthService().validateTenantCode(request.params.tenantCode);
      if (!result) {
        return reply.code(404).send({
          data: null,
          errors: [{ code: "NOT_FOUND", message: "Organisation not found" }]
        });
      }
      return reply.send({ data: result, errors: [] });
    }
  );

  // POST /auth/forgot-password
  app.post<{
    Body: { email: string; tenantCode: string };
  }>(
    "/auth/forgot-password",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "tenantCode"],
          properties: {
            email: { type: "string", format: "email" },
            tenantCode: { type: "string", minLength: 8, maxLength: 8 }
          }
        }
      },
      config: {
        access: "public",
        rateLimit: {
          max: 3,
          timeWindow: "1 hour"
        }
      }
    },
    async (request, reply) => {
      // Always return 200 — don't reveal if email/tenant exists
      try {
        const { email, tenantCode } = request.body;
        const result = await getAuthService().requestPasswordReset(email, tenantCode);
        if (result) {
          const tenant = await resolveTenantByCode(tenantCode);
          const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3001";
          const resetUrl = `${appBaseUrl}/t/${tenantCode}/reset-password?token=${result.token}`;
          try {
            await sendPasswordResetEmail({
              to: email,
              resetUrl,
              tenantName: tenant?.name ?? "HospitalityFinance Pro"
            });
            request.log.info({ userId: result.userId, tenantCode }, "Password reset email sent");
          } catch (emailErr) {
            request.log.warn({ err: emailErr, tenantCode }, "Failed to send password reset email");
          }
        }
      } catch {
        // Swallow errors — always return 200
      }
      return reply.send({
        data: { message: "If the email exists, a reset link has been sent." },
        errors: []
      });
    }
  );

  // POST /auth/reset-password
  app.post<{
    Body: { token: string; newPassword: string; tenantCode: string };
  }>(
    "/auth/reset-password",
    {
      config: { access: "public" },
      schema: {
        body: {
          type: "object",
          required: ["token", "newPassword", "tenantCode"],
          properties: {
            token: { type: "string", minLength: 1 },
            newPassword: { type: "string", minLength: 12 },
            tenantCode: { type: "string", minLength: 8, maxLength: 8 }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const { token, newPassword, tenantCode } = request.body;
        await getAuthService().resetPassword(token, newPassword, tenantCode);
        return reply.send({
          data: { message: "Password has been reset. Please log in." },
          errors: []
        });
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  // ── Protected routes (auth required) ────────────────────────────────────

  // POST /auth/logout
  app.post(
    "/auth/logout",
    { config: { access: "session" }, preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const user = request.user!;
        const refreshToken = request.cookies?.hfp_refresh_token;
        await getAuthService().logout(
          user.sub as string,
          user.tenantId as string,
          refreshToken,
          user.sessionId as string | undefined
        );
        clearCookies(reply);
        return reply.send({ data: { message: "Logged out" }, errors: [] });
      } catch (error) {
        clearCookies(reply);
        return sendError(reply, error);
      }
    }
  );

  // POST /auth/logout-all
  app.post(
    "/auth/logout-all",
    { config: { access: "session" }, preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const user = request.user!;
        await getAuthService().logoutAll(user.sub as string, user.tenantId as string);
        clearCookies(reply);
        return reply.send({
          data: { message: "All sessions terminated" },
          errors: []
        });
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  // POST /auth/change-password
  app.post<{
    Body: { currentPassword: string; newPassword: string };
  }>(
    "/auth/change-password",
    {
      config: { access: "session" },
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string", minLength: 1 },
            newPassword: { type: "string", minLength: 12 }
          }
        }
      }
    },
    async (request, reply) => {
      try {
        const user = request.user!;
        const tenant = await resolveTenantById(user.tenantId);
        if (!tenant) throw new AuthError("Invalid tenant");

        await getAuthService().changePassword(
          user.sub as string,
          tenant.slug,
          tenant.databaseUrl,
          request.body.currentPassword,
          request.body.newPassword
        );

        return reply.send({
          data: { message: "Password changed successfully" },
          errors: []
        });
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  // GET /auth/me
  app.get(
    "/auth/me",
    { config: { access: "session" }, preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const user = request.user!;
        const tenant = await resolveTenantById(user.tenantId);
        if (!tenant) throw new AuthError("Invalid tenant");

        const profile = await getAuthService().getProfile(
          user.sub,
          tenant.slug,
          tenant.databaseUrl
        );

        return reply.send({ data: profile, errors: [] });
      } catch (error) {
        request.log.error({ err: error }, "GET /auth/me failed");
        return sendError(reply, error);
      }
    }
  );

  // GET /auth/sessions
  app.get(
    "/auth/sessions",
    { config: { access: "session" }, preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const user = request.user!;
        const sessions = await getAuthService().listSessions(
          user.sub as string,
          user.tenantId as string
        );
        return reply.send({ data: sessions, errors: [] });
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );

  // DELETE /auth/sessions/:sessionId
  app.delete<{ Params: { sessionId: string } }>(
    "/auth/sessions/:sessionId",
    { config: { access: "session" }, preHandler: [requireAuth] },
    async (request, reply) => {
      try {
        const user = request.user!;
        await getAuthService().revokeSession(
          user.sub as string,
          user.tenantId as string,
          request.params.sessionId
        );
        return reply.send({ data: { message: "Session revoked" }, errors: [] });
      } catch (error) {
        return sendError(reply, error);
      }
    }
  );
}
