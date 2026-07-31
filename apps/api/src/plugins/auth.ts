import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import jwt from "jsonwebtoken";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma, setActiveTenant } from "../db/prisma.js";
import { resolveTenant, resolveTenantByCode } from "../db/tenantRegistry.js";
import { updateRequestContext } from "../db/requestContext.js";
import { getRedisClient } from "../db/redis.js";

type ErrorWithStatus = Error & { statusCode: number };
type EntityContextDecision = {
  entityId?: string;
  error?: { statusCode: number; message: string };
};

// ── JWT payload shape from native auth ───────────────────────────────────────

interface NativeJwtPayload {
  sub: string; // user.id
  email: string;
  tenantId: string;
  tenantCode: string;
  tenantSlug: string;
  entityIds: string[];
  roles: string[];
  permissions: string[];
  sessionId: string;
  type: "access";
  iat: number;
  exp: number;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: NativeJwtPayload & {
      entityIds: string[];
      tenantSlug?: string;
      tenantCode?: string;
      tenantId?: string;
    };
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

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function getSingleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.length === 1 ? value[0] : undefined;
  }
  return value;
}

const CROSS_ENTITY_ADMIN_ROLES = new Set(["SUPERADMIN", "PLATFORM_ADMIN"]);

export function hasExplicitCrossEntityAccess(roles: string[]): boolean {
  return roles.some((role) => CROSS_ENTITY_ADMIN_ROLES.has(role.toUpperCase()));
}

const ENTITY_CONTEXT_EXEMPT_PREFIXES = [
  "/api/v1/me",
  "/api/v1/entities",
  "/api/v1/license",
  "/api/v1/admin",
  "/api/v1/setup",
  "/api/v1/platform"
];

function requestPath(url: string): string {
  return url.split("?")[0] ?? url;
}

export function requiresExplicitEntityHeader(url: string): boolean {
  const path = requestPath(url);
  if (!path.startsWith("/api/v1/")) return false;
  return !ENTITY_CONTEXT_EXEMPT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

export function evaluateEntityContext(input: {
  url: string;
  headerEntityId?: string;
  entityIds: string[];
  roles: string[];
}): EntityContextDecision {
  const isApiRoute = requestPath(input.url).startsWith("/api/v1/");
  const isExplicitCrossEntityAdmin = hasExplicitCrossEntityAccess(input.roles);
  const requiresExplicitHeader = requiresExplicitEntityHeader(input.url);
  const headerEntityId = input.headerEntityId?.trim();

  if (input.entityIds.length === 0 && !isExplicitCrossEntityAdmin && isApiRoute) {
    return {
      error: {
        statusCode: 403,
        message: "User has no entity assignments. Cross-entity access requires SUPERADMIN."
      }
    };
  }

  if (headerEntityId) {
    return { entityId: headerEntityId };
  }

  if (requiresExplicitHeader && !isExplicitCrossEntityAdmin) {
    return {
      error: {
        statusCode: 400,
        message: "X-Entity-ID header is required."
      }
    };
  }

  if (!requiresExplicitHeader && input.entityIds.length === 1) {
    return { entityId: input.entityIds[0] };
  }

  return {};
}

export function validateTenantHeaders(input: {
  headerTenantSlug?: string;
  headerTenantCode?: string;
  tenantSlug?: string;
  tenantCode?: string;
}): EntityContextDecision {
  // A tenant header exists to catch cross-tenant confusion, so any value that
  // identifies the AUTHENTICATED tenant — its slug or its code — is valid in
  // either header. The web's /t/[code] routes send the tenant code in the
  // slug header; a strict slug-only comparison 403'd every /api/v1 request.
  const tokenIdentifiers = new Set(
    [input.tenantSlug, input.tenantCode].filter((v): v is string => !!v)
  );
  const mismatch = (header?: string) =>
    !!header && tokenIdentifiers.size > 0 && !tokenIdentifiers.has(header);

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

// ── Entity lineage resolution (unchanged) ────────────────────────────────────

async function readEntity(id: string): Promise<{ id: string; parentId: string | null } | null> {
  // Use raw SQL to bypass RLS — entity lineage checks run during auth
  // before entity context is fully established.
  const rows = await (prisma as any).$queryRawUnsafe(
    `SELECT id, parent_id as "parentId" FROM entities WHERE id = $1 LIMIT 1`,
    id
  );
  return rows[0] ?? null;
}

async function resolveEntityLineage(entityId: string): Promise<string[]> {
  const lineage: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = entityId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const entity = await readEntity(currentId);
    if (!entity) break;
    lineage.push(entity.id);
    currentId = entity.parentId;
  }

  return lineage;
}

async function resolveChainEntityId(entityId: string): Promise<string | undefined> {
  const lineage = await resolveEntityLineage(entityId);
  return lineage.length > 0 ? lineage[lineage.length - 1] : undefined;
}

async function isEntityAllowedByClaims(
  requestedEntityId: string,
  claimedEntityIds: string[]
): Promise<boolean> {
  if (claimedEntityIds.length === 0) return true;
  const granted = new Set(claimedEntityIds);
  // Direct match — no need for lineage traversal
  if (granted.has(requestedEntityId)) return true;
  // Check lineage (child entity of a granted parent)
  const lineage = await resolveEntityLineage(requestedEntityId);
  return lineage.some((entityId) => granted.has(entityId));
}

// ── Tenant resolution ─────────────────────────────────────────────────────────

async function resolveTenantContext(request: FastifyRequest, tenantSlug: string): Promise<void> {
  const tenant = await resolveTenant(tenantSlug);
  if (!tenant) {
    throw buildError(403, `Tenant '${tenantSlug}' not found or inactive.`);
  }
  if (!tenant.isActive) {
    throw buildError(403, `Tenant '${tenantSlug}' is deactivated.`);
  }

  request.tenantSlug = tenant.slug;

  // Set tenant in request context so the prisma proxy routes to the right DB
  updateRequestContext({
    tenantSlug: tenant.slug,
    tenantDbUrl: tenant.databaseUrl
  });
  // Also set the global fallback (AsyncLocalStorage can lose context across Fastify hooks)
  setActiveTenant(tenant.slug, tenant.databaseUrl);
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export default fp(async (fastify: FastifyInstance) => {
  // Register @fastify/cookie for httpOnly cookie support
  await fastify.register(cookie);

  fastify.decorate("verifyAccessToken", async (request: FastifyRequest): Promise<void> => {
    try {
      // ── Extract token from cookie or Authorization header ──────────────
      const token =
        request.cookies?.hfp_access_token ??
        (request.headers.authorization?.startsWith("Bearer ")
          ? request.headers.authorization.slice("Bearer ".length)
          : undefined);

      // ── Dev-mode bypass ─────────────────────────────────────────────────
      const devAuthEnabled =
        process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_AUTH === "true";

      if (devAuthEnabled && token?.startsWith("dev-")) {
        // Validate dev token format: must be "dev-<valid-uuid>" to prevent arbitrary tokens
        const devUserId = token.slice(4);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(devUserId)) {
          throw buildError(401, "Invalid dev token format. Expected dev-<uuid>.");
        }
        // Resolve tenant from header (required in multi-tenant mode, optional in single-tenant dev)
        const tenantHeader = request.headers["x-tenant-code"] ?? request.headers["x-tenant-slug"];
        if (typeof tenantHeader === "string" && tenantHeader.length > 0) {
          // Support both tenant code and slug in dev mode
          if (/^[a-z0-9]{8}$/.test(tenantHeader)) {
            const tenant = await resolveTenantByCode(tenantHeader);
            if (tenant) {
              await resolveTenantContext(request, tenant.slug);
            }
          } else {
            await resolveTenantContext(request, tenantHeader);
          }
        }

        const headerEntityId = getSingleHeader(request.headers["x-entity-id"]);

        request.user = {
          sub: "a15c0667-e920-4e66-8b15-e1a561b965c4",
          email: "dev@hfp.local",
          tenantId: "",
          tenantCode: "",
          tenantSlug: request.tenantSlug ?? "",
          roles: ["TENANT_ADMIN"],
          permissions: [
            "GL_READ",
            "GL_WRITE",
            "GL_POST",
            "GL_REVERSE",
            "GL_APPROVE",
            "COA_READ",
            "COA_CREATE",
            "COA_EDIT",
            "AP_READ",
            "AP_WRITE",
            "AP_APPROVE",
            "AP_PAYMENT_CONFIRM",
            "PAYMENT_RUN_READ",
            "PAYMENT_RUN_CREATE",
            "PAYMENT_RUN_APPROVE",
            "AR_READ",
            "AR_WRITE",
            "AR_DUNNING",
            "BUDGET_READ",
            "BUDGET_WRITE",
            "BUDGET_APPROVE",
            "FX_READ",
            "FX_WRITE",
            "REPORT_READ",
            "REPORT_WRITE",
            "REPORT_EXPORT",
            "REPORT_CREATE_CUSTOM",
            "PERIOD_READ",
            "PERIOD_MANAGE",
            "PERIOD_REOPEN",
            "TRANSFER_DESK_READ",
            "TRANSFER_DESK_EXECUTE",
            "TRANSFER_DESK_CONFIG",
            "INTEGRATION_READ",
            "INTEGRATION_IMPORT",
            "INTEGRATION_CONFIG",
            "CONSOLIDATION_RUN",
            "STATS_READ",
            "STATS_IMPORT",
            "AUDIT_READ",
            "ADMIN_USERS_READ",
            "ADMIN_USERS",
            "ADMIN_ROLES_MANAGE",
            "ADMIN_SETTINGS",
            "ADMIN_ENTITIES",
            "ADMIN_AUDIT_LOG"
          ],
          entityIds:
            typeof headerEntityId === "string" && headerEntityId.length > 0 ? [headerEntityId] : [],
          sessionId: "dev-session",
          type: "access",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 86400
        };

        const devEntityDecision = evaluateEntityContext({
          url: request.url,
          headerEntityId,
          entityIds: request.user.entityIds,
          roles: request.user.roles
        });
        if (devEntityDecision.error) {
          throw buildError(devEntityDecision.error.statusCode, devEntityDecision.error.message);
        }

        if (devEntityDecision.entityId) {
          request.entityId = devEntityDecision.entityId;
          try {
            request.chainId = await resolveChainEntityId(devEntityDecision.entityId);
          } catch {
            request.chainId = devEntityDecision.entityId;
          }
        }
        return;
      }

      // ── No token ────────────────────────────────────────────────────────
      if (!token) {
        throw buildError(401, "Missing or invalid authentication token.");
      }

      // ── Native JWT verification (HS256) ─────────────────────────────────
      let payload: NativeJwtPayload;
      try {
        payload = jwt.verify(token, JWT_SECRET, {
          algorithms: [JWT_ALGORITHM]
        }) as NativeJwtPayload;
      } catch (err: any) {
        if (err.name === "TokenExpiredError") {
          throw buildError(401, "Token expired");
        }
        throw buildError(401, "Token verification failed.");
      }

      // ── Resolve tenant context from JWT claims ──────────────────────────
      const tenantSlug = payload.tenantSlug;
      if (tenantSlug) {
        await resolveTenantContext(request, tenantSlug);
      }

      const tenantHeaderCheck = validateTenantHeaders({
        headerTenantSlug: getSingleHeader(request.headers["x-tenant-slug"]),
        headerTenantCode: getSingleHeader(request.headers["x-tenant-code"]),
        tenantSlug: payload.tenantSlug,
        tenantCode: payload.tenantCode
      });
      if (tenantHeaderCheck.error) {
        throw buildError(tenantHeaderCheck.error.statusCode, tenantHeaderCheck.error.message);
      }

      const entityIds = toStringArray(payload.entityIds);
      if (typeof payload.sessionId !== "string" || payload.sessionId.length === 0) {
        throw buildError(401, "Session claim is missing.");
      }

      const sessionKey = `session:${payload.tenantId}:${payload.sub}:${payload.sessionId}`;
      const sessionExists = await getRedisClient().exists(sessionKey);
      if (!sessionExists) {
        throw buildError(401, "Session expired or revoked.");
      }

      request.user = {
        ...payload,
        entityIds,
        tenantSlug: request.tenantSlug ?? payload.tenantSlug
      };

      // ── Entity resolution ─────────────────────────────────────────────
      const entityDecision = evaluateEntityContext({
        url: request.url,
        headerEntityId: getSingleHeader(request.headers["x-entity-id"]),
        entityIds,
        roles: toStringArray(payload.roles)
      });
      if (entityDecision.error) {
        throw buildError(entityDecision.error.statusCode, entityDecision.error.message);
      }
      if (entityDecision.entityId) {
        request.entityId = entityDecision.entityId;
      }

      if (request.entityId && entityIds.length > 0) {
        const allowed = await isEntityAllowedByClaims(request.entityId, entityIds);
        if (!allowed) {
          throw buildError(403, "Entity access is not allowed for this token.");
        }
      }

      if (request.entityId) {
        request.chainId = await resolveChainEntityId(request.entityId);
      }
    } catch (error) {
      if (typeof error === "object" && error !== null && "statusCode" in error) {
        throw error;
      }
      throw buildError(401, "Token verification failed.");
    }
  });
});
