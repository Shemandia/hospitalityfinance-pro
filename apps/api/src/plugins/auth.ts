import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { prisma, setActiveTenant } from "../db/prisma.js";
import { resolveTenant } from "../db/tenantRegistry.js";
import { updateRequestContext } from "../db/requestContext.js";

type ErrorWithStatus = Error & { statusCode: number };

declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload & {
      roles: string[];
      entityIds: string[];
      tenantSlug?: string;
    };
    entityId?: string;
    chainId?: string;
    tenantSlug?: string;
  }

  interface FastifyInstance {
    verifyAccessToken(request: FastifyRequest): Promise<void>;
  }
}

function buildError(statusCode: number, message: string): ErrorWithStatus {
  const error = new Error(message) as ErrorWithStatus;
  error.statusCode = statusCode;
  return error;
}

function extractBearerToken(header?: string): string {
  if (!header || !header.startsWith("Bearer ")) {
    throw buildError(401, "Missing or invalid Authorization bearer token.");
  }
  return header.slice("Bearer ".length);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

async function readEntity(id: string): Promise<{ id: string; parentId: string | null } | null> {
  return prisma.entity.findUnique({
    where: { id },
    select: { id: true, parentId: true }
  });
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
  const issuerUrl = process.env.KEYCLOAK_ISSUER_URL ?? "http://localhost:8080/realms/hfp";
  const audience = process.env.KEYCLOAK_CLIENT_ID ?? "hfp-api";
  const jwksUrl = process.env.KEYCLOAK_JWKS_URL ?? `${issuerUrl}/protocol/openid-connect/certs`;
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  fastify.decorate("verifyAccessToken", async (request: FastifyRequest): Promise<void> => {
    try {
      const token = extractBearerToken(request.headers.authorization);

      // ── Dev-mode bypass ─────────────────────────────────────────────────
      const devAuthEnabled =
        process.env.NODE_ENV !== "production" && process.env.ENABLE_DEV_AUTH === "true";
      if (devAuthEnabled && token.startsWith("dev-")) {
        // Resolve tenant from header (required in multi-tenant mode, optional in single-tenant dev)
        const tenantHeader = request.headers["x-tenant-slug"];
        if (typeof tenantHeader === "string" && tenantHeader.length > 0) {
          await resolveTenantContext(request, tenantHeader);
        }

        const headerEntityId = request.headers["x-entity-id"];

        request.user = {
          sub: "a15c0667-e920-4e66-8b15-e1a561b965c4",
          roles: ["admin", "superadmin"],
          entityIds: [],
          tenantSlug: request.tenantSlug
        };

        if (typeof headerEntityId === "string" && headerEntityId.length > 0) {
          request.entityId = headerEntityId;
          try {
            request.chainId = await resolveChainEntityId(headerEntityId);
          } catch {
            request.chainId = headerEntityId;
          }
        }
        // entityId may be undefined — individual routes that need it call requireEntityId()
        return;
      }

      // ── Production: Keycloak JWT ────────────────────────────────────────
      const { payload } = await jwtVerify(token, jwks, {
        issuer: issuerUrl,
        audience
      });

      const realmAccess = (payload.realm_access ?? {}) as { roles?: unknown };
      const roles = toStringArray(realmAccess.roles);
      const entityIds = toStringArray(payload.entity_ids);

      // Resolve tenant from JWT claim or request header
      const tenantSlug =
        (typeof payload.tenant_slug === "string" ? payload.tenant_slug : null) ??
        (typeof request.headers["x-tenant-slug"] === "string"
          ? request.headers["x-tenant-slug"]
          : null);

      if (tenantSlug) {
        await resolveTenantContext(request, tenantSlug);
      }

      request.user = {
        ...payload,
        roles,
        entityIds,
        tenantSlug: request.tenantSlug
      };

      const headerEntityId = request.headers["x-entity-id"];
      if (typeof headerEntityId === "string" && headerEntityId.length > 0) {
        request.entityId = headerEntityId;
      } else if (entityIds.length === 1) {
        request.entityId = entityIds[0];
      }

      if (!request.entityId) {
        throw buildError(400, "X-Entity-ID header is required.");
      }

      const allowed = await isEntityAllowedByClaims(request.entityId, entityIds);
      if (!allowed) {
        throw buildError(403, "Entity access is not allowed for this token.");
      }

      request.chainId = await resolveChainEntityId(request.entityId);
    } catch (error) {
      if (typeof error === "object" && error !== null && "statusCode" in error) {
        throw error;
      }
      throw buildError(401, "Token verification failed.");
    }
  });
});
