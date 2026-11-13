/**
 * The access context (WP-A step 6): everything the web app needs to draw
 * menus, buttons and the property switcher, from the same resolved access
 * the route guard decides with.
 *
 *   GET /api/v1/context
 *
 * Returns the tenant, the user, the permissions held tenant-wide, and the
 * entities the user can open with the permissions held at each. The web app
 * reads nothing else for these decisions, so what it shows and what the API
 * allows cannot drift apart (AUT-02, AUT-07).
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "../../db/prisma.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import { resolveTenantById } from "../../db/tenantRegistry.js";
import type { EntityType, Prisma } from "../../db/client.js";
import { loadRequestAccess } from "../../middleware/requirePermission.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { openableEntityIds, type ResolvedAccess } from "./resolver.js";

export type ContextEntity = {
  id: string;
  code: string | null;
  name: string;
  type: EntityType;
  /** The parent, when the user can open it too; otherwise null, so the entity is a root of the user's tree. */
  parentId: string | null;
  functionalCurrency: string;
  reportingCurrency: string;
  timezone: string;
  countryCode: string;
  isActive: boolean;
  /** Permission codes held at this entity, sorted. Includes tenant-wide permissions. */
  permissions: string[];
};

export type AccessContext = {
  tenant: { id: string; slug: string; code: string; name: string };
  user: { id: string; email: string; name: string | null; mustChangePassword: boolean };
  /** Permission codes held through tenant-wide assignments, sorted. */
  tenantPermissions: string[];
  /** Higher levels of the tree first (corporate and group, cluster, property), each by name. */
  entities: ContextEntity[];
};

type EntityRow = Omit<ContextEntity, "permissions">;

const TYPE_ORDER: Record<EntityType, number> = { CORPORATE: 0, GROUP: 0, CLUSTER: 1, PROPERTY: 2 };

/** Pure: shapes the payload from the resolved access and the rows read. */
export function buildAccessContext(input: {
  access: ResolvedAccess;
  tenant: AccessContext["tenant"];
  user: AccessContext["user"];
  entities: EntityRow[];
}): AccessContext {
  const { access } = input;
  const openable = new Set(openableEntityIds(access));
  const entities = input.entities
    .filter((entity) => openable.has(entity.id))
    .map((entity) => ({
      ...entity,
      parentId: entity.parentId && openable.has(entity.parentId) ? entity.parentId : null,
      permissions: [...(access.entityPermissions[entity.id] ?? [])].sort()
    }))
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name));
  return {
    tenant: input.tenant,
    user: input.user,
    tenantPermissions: [...access.tenantPermissions].sort(),
    entities
  };
}

export async function registerContextRouter(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/v1/context",
    { preHandler: [requireAuth], config: { access: "session" } },
    async (request, reply) => {
      const access = await loadRequestAccess(request, reply);
      if (!access) return reply;
      const caller = request.user!;

      const tenant = await resolveTenantById(caller.tenantId);
      if (!tenant) {
        return reply.code(401).send({
          data: null,
          errors: [
            { code: "AUTHENTICATION_FAILED", message: "The session's tenant was not found." }
          ]
        });
      }

      const openable = openableEntityIds(access);
      const { user, entities } = await withBypassRLS(
        prisma,
        async (tx: Prisma.TransactionClient) => ({
          user: await tx.user.findUnique({
            where: { id: caller.sub },
            select: { id: true, email: true, name: true, mustChangePassword: true }
          }),
          entities: await tx.entity.findMany({
            where: { id: { in: openable } },
            select: {
              id: true,
              code: true,
              name: true,
              type: true,
              parentId: true,
              functionalCurrency: true,
              reportingCurrency: true,
              timezone: true,
              countryCode: true,
              isActive: true
            }
          })
        })
      );
      if (!user) {
        return reply.code(401).send({
          data: null,
          errors: [{ code: "AUTHENTICATION_FAILED", message: "The session's user was not found." }]
        });
      }

      const context = buildAccessContext({
        access,
        tenant: { id: tenant.id, slug: tenant.slug, code: tenant.tenantCode, name: tenant.name },
        user,
        entities
      });
      return reply.send({ data: context, errors: [] });
    }
  );
}
