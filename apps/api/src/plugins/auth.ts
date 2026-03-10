import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { prisma } from "../db/prisma.js";

type ErrorWithStatus = Error & { statusCode: number };

declare module "fastify" {
  interface FastifyRequest {
    user?: JWTPayload & {
      roles: string[];
      entityIds: string[];
    };
    entityId?: string;
    chainId?: string;
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
    select: {
      id: true,
      parentId: true
    }
  });
}

async function resolveEntityLineage(entityId: string): Promise<string[]> {
  const lineage: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = entityId;

  while (currentId) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);

    const entity = await readEntity(currentId);
    if (!entity) {
      break;
    }

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
  if (claimedEntityIds.length === 0) {
    return true;
  }

  const granted = new Set(claimedEntityIds);
  const lineage = await resolveEntityLineage(requestedEntityId);
  return lineage.some((entityId) => granted.has(entityId));
}

export default fp(async (fastify: FastifyInstance) => {
  const issuerUrl =
    process.env.KEYCLOAK_ISSUER_URL ?? "http://localhost:8080/realms/hfp";
  const audience = process.env.KEYCLOAK_CLIENT_ID ?? "hfp-api";
  const jwksUrl =
    process.env.KEYCLOAK_JWKS_URL ??
    `${issuerUrl}/protocol/openid-connect/certs`;
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  fastify.decorate(
    "verifyAccessToken",
    async (request: FastifyRequest): Promise<void> => {
      try {
        const token = extractBearerToken(request.headers.authorization);

        // Dev-mode bypass: accept "dev-token" without Keycloak verification
        if (process.env.NODE_ENV !== "production" && token === "dev-token") {
          const headerEntityId = request.headers["x-entity-id"];
          if (typeof headerEntityId !== "string" || headerEntityId.length === 0) {
            throw buildError(400, "X-Entity-ID header is required.");
          }
          // Use actual admin user ID so FK constraints (e.g. approvedById) work
          request.user = { sub: "a15c0667-e920-4e66-8b15-e1a561b965c4", roles: ["admin", "superadmin"], entityIds: [] };
          request.entityId = headerEntityId;
          // Best-effort chain resolution — skip on DB error in dev
          try {
            request.chainId = await resolveChainEntityId(headerEntityId);
          } catch {
            request.chainId = headerEntityId;
          }
          return;
        }
        const { payload } = await jwtVerify(token, jwks, {
          issuer: issuerUrl,
          audience
        });

        const realmAccess = (payload.realm_access ?? {}) as {
          roles?: unknown;
        };

        const roles = toStringArray(realmAccess.roles);
        const entityIds = toStringArray(payload.entity_ids);

        request.user = {
          ...payload,
          roles,
          entityIds
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
    }
  );
});
