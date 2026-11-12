/**
 * Authentication plugin (WP-A).
 *
 * verifyAccessToken answers one question: who is calling, in which tenant, on
 * which session. It does not decide what the caller may do — the route guard
 * (middleware/requirePermission.ts) does that from AccessService on every
 * request, so nothing about roles, permissions or entities is read from the
 * token.
 *
 * Status codes (AUT-10):
 *   401  the token or the session is missing, invalid, expired or revoked
 *   403  the request names a different tenant from the session's, or the
 *        tenant is deactivated
 *   503  the registry, Redis or the database could not be reached; the caller
 *        is not signed out and the cause is logged
 */

import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import jwt from "jsonwebtoken";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";
import { resolveTenantById } from "../db/tenantRegistry.js";
import { updateRequestContext } from "../db/requestContext.js";
import { getRedisClient } from "../db/redis.js";
import { withBypassRLS } from "../db/rls-bypass.js";
import type { Prisma } from "../db/client.js";
import type { AccessTokenClaims } from "../services/auth.service.js";

type ErrorWithStatus = Error & { statusCode: number };
type HeaderDecision = { error?: { statusCode: number; message: string } };

/** The authenticated caller. Tenant slug and code come from the registry, not the token. */
export type AuthenticatedUser = {
  sub: string;
  tenantId: string;
  tenantSlug: string;
  tenantCode: string;
  sessionId: string;
};

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    /** The entity the request acts on (X-Entity-ID). Access to it is the guard's decision. */
    entityId?: string;
    chainId?: string;
    tenantSlug?: string;
  }

  interface FastifyInstance {
    verifyAccessToken(request: FastifyRequest): Promise<void>;
  }
}

if (!process.env.JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is not set. Refusing to start with an insecure default."
  );
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ALGORITHM = "HS256" as const;

function buildError(statusCode: number, message: string): ErrorWithStatus {
  const error = new Error(message) as ErrorWithStatus;
  error.statusCode = statusCode;
  return error;
}

/**
 * Runs a call to a dependency. A failure there is an outage (503), never a
 * reason to treat the caller as signed out.
 */
async function dependency<T>(
  request: FastifyRequest,
  name: string,
  call: () => Promise<T>
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    request.log.error({ err: error, dependency: name }, "Authentication dependency failed");
    throw buildError(503, "Sign-in could not be checked. Try again in a moment.");
  }
}

function getSingleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] : undefined;
  }
  return value;
}

/**
 * A tenant header exists to catch cross-tenant confusion, so any value that
 * identifies the session's tenant — its slug or its code — is valid in either
 * header. The web's /t/[code] routes send the tenant code in the slug header.
 * A header naming any other tenant is refused.
 */
export function validateTenantHeaders(input: {
  headerTenantSlug?: string;
  headerTenantCode?: string;
  tenantSlug?: string;
  tenantCode?: string;
}): HeaderDecision {
  const sessionTenant = new Set(
    [input.tenantSlug, input.tenantCode].filter((v): v is string => !!v)
  );
  const mismatch = (header?: string) =>
    !!header && sessionTenant.size > 0 && !sessionTenant.has(header);

  if (mismatch(input.headerTenantSlug) || mismatch(input.headerTenantCode)) {
    return {
      error: {
        statusCode: 403,
        message: "Tenant header does not match authenticated tenant."
      }
    };
  }
  return {};
}

/** Checks the shape of a verified token. Anything else in it is ignored. */
export function readAccessTokenClaims(payload: unknown): AccessTokenClaims | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { sub, tenantId, sessionId, type } = payload as Record<string, unknown>;
  if (type !== "access") return null;
  if (typeof sub !== "string" || sub === "") return null;
  if (typeof tenantId !== "string" || tenantId === "") return null;
  if (typeof sessionId !== "string" || sessionId === "") return null;
  return { sub, tenantId, sessionId, type: "access" };
}

/** The top of the entity's tree: the chain the entity belongs to. */
async function resolveChainEntityId(entityId: string): Promise<string | undefined> {
  return withBypassRLS(prisma, async (tx: Prisma.TransactionClient) => {
    const visited = new Set<string>();
    let currentId: string | null = entityId;
    let top: string | undefined;
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

export default fp(async (fastify: FastifyInstance) => {
  await fastify.register(cookie);

  fastify.decorate("verifyAccessToken", async (request: FastifyRequest): Promise<void> => {
    // ── Token ───────────────────────────────────────────────────────────
    const token =
      request.cookies?.hfp_access_token ??
      (request.headers.authorization?.startsWith("Bearer ")
        ? request.headers.authorization.slice("Bearer ".length)
        : undefined);
    if (!token) {
      throw buildError(401, "Missing or invalid authentication token.");
    }

    let claims: AccessTokenClaims | null;
    try {
      claims = readAccessTokenClaims(
        jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] })
      );
    } catch (error) {
      const expired = error instanceof Error && error.name === "TokenExpiredError";
      throw buildError(401, expired ? "Token expired" : "Token verification failed.");
    }
    if (!claims) {
      throw buildError(401, "Token verification failed.");
    }

    // ── Tenant ──────────────────────────────────────────────────────────
    // The tenant comes from the registry by the id in the token. A token
    // whose tenant is unknown is not a session of any tenant.
    const tenant = await dependency(request, "tenant registry", () =>
      resolveTenantById(claims.tenantId)
    );
    if (!tenant) {
      throw buildError(401, "The session's tenant was not found.");
    }
    if (!tenant.isActive) {
      throw buildError(403, "This tenant is deactivated.");
    }

    const tenantHeaderCheck = validateTenantHeaders({
      headerTenantSlug: getSingleHeader(request.headers["x-tenant-slug"]),
      headerTenantCode: getSingleHeader(request.headers["x-tenant-code"]),
      tenantSlug: tenant.slug,
      tenantCode: tenant.tenantCode
    });
    if (tenantHeaderCheck.error) {
      throw buildError(tenantHeaderCheck.error.statusCode, tenantHeaderCheck.error.message);
    }

    // ── Session ─────────────────────────────────────────────────────────
    const sessionKey = `session:${claims.tenantId}:${claims.sub}:${claims.sessionId}`;
    const sessionExists = await dependency(request, "session store", () =>
      getRedisClient().exists(sessionKey)
    );
    if (!sessionExists) {
      throw buildError(401, "Session expired or revoked.");
    }

    // From here on the prisma proxy routes to this tenant's database.
    request.tenantSlug = tenant.slug;
    updateRequestContext({ tenantSlug: tenant.slug, tenantDbUrl: tenant.databaseUrl });

    request.user = {
      sub: claims.sub,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantCode: tenant.tenantCode,
      sessionId: claims.sessionId
    };

    // ── Entity ──────────────────────────────────────────────────────────
    // Recorded, not authorised: whether the caller may act on it is decided
    // by the route guard, which also answers 400 when a route needs one.
    const entityId = getSingleHeader(request.headers["x-entity-id"])?.trim();
    if (entityId) {
      request.entityId = entityId;
      request.chainId = await dependency(request, "tenant database", () =>
        resolveChainEntityId(entityId)
      );
    }
  });
});
