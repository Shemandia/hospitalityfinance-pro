import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma } from "../../db/client.js";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { loadRequestAccess, requirePermission } from "../../middleware/requirePermission.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import {
  hasEntityPermission,
  hasTenantPermission,
  openableEntityIds,
  type ResolvedAccess
} from "../access/resolver.js";
import { getAccessService } from "../access/runtime.js";

const MANAGE_ENTITIES = "ADMIN_ENTITIES";

type EntityRef = { id: string; parentId: string | null };

/** Reads the entity table across the tenant, whatever entity the request has selected. */
function readAcrossEntities<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return withBypassRLS(prisma, fn);
}

/**
 * True when the caller may manage this entity: ADMIN_ENTITIES tenant-wide, at
 * the entity, or at its parent. The parent clause only matters for an inactive
 * entity, which nobody can open but its administrators must be able to restore.
 */
export function canManageEntity(access: ResolvedAccess, entity: EntityRef): boolean {
  return (
    hasTenantPermission(access, MANAGE_ENTITIES) ||
    hasEntityPermission(access, entity.id, MANAGE_ENTITIES) ||
    (entity.parentId !== null && hasEntityPermission(access, entity.parentId, MANAGE_ENTITIES))
  );
}

/** A new or moved entity needs ADMIN_ENTITIES at the parent; a root needs it tenant-wide. */
export function canPlaceEntityUnder(access: ResolvedAccess, parentId: string | null): boolean {
  if (hasTenantPermission(access, MANAGE_ENTITIES)) return true;
  return parentId !== null && hasEntityPermission(access, parentId, MANAGE_ENTITIES);
}

function forbidden(reply: FastifyReply, message: string) {
  return reply.code(403).send({ data: null, errors: [{ code: "FORBIDDEN", message }] });
}

function notFound(reply: FastifyReply) {
  return reply
    .code(404)
    .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Entity not found." }] });
}

/** The entity tree changed, which can change any user's access. */
async function invalidateAccess(request: FastifyRequest): Promise<void> {
  const tenantId = request.user?.tenantId;
  if (tenantId) await getAccessService().invalidateTenant(tenantId);
}

export async function registerEntityRouter(app: FastifyInstance): Promise<void> {
  // ── List entities ──────────────────────────────────────────────────────────

  app.get(
    "/api/v1/entities",
    { preHandler: [requireAuth], config: { access: "session" } },
    async (request, reply) => {
      const access = await loadRequestAccess(request, reply);
      if (!access) return reply;

      // Entity administrators also see inactive entities, so they can restore them.
      const where = hasTenantPermission(access, MANAGE_ENTITIES)
        ? {}
        : { id: { in: openableEntityIds(access) } };

      const data = await readAcrossEntities((tx) =>
        tx.entity.findMany({
          where,
          include: {
            parent: { select: { id: true, name: true } },
            _count: { select: { children: true, users: true } }
          },
          orderBy: { name: "asc" }
        })
      );
      return { data, errors: [] };
    }
  );

  // ── Get entity by ID ───────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/api/v1/entities/:id",
    { preHandler: [requireAuth], config: { access: "session" } },
    async (request, reply) => {
      const access = await loadRequestAccess(request, reply);
      if (!access) return reply;
      const requestedId = request.params.id;

      const entity = await readAcrossEntities((tx) =>
        tx.entity.findFirst({
          where: { id: requestedId },
          include: {
            parent: { select: { id: true, name: true } },
            children: {
              select: { id: true, name: true, type: true, isActive: true, functionalCurrency: true }
            },
            _count: { select: { children: true, users: true, accounts: true, journals: true } }
          }
        })
      );
      const canSee =
        openableEntityIds(access).includes(requestedId) ||
        (entity !== null && canManageEntity(access, entity));
      // Checked before the 404 so the response does not reveal which ids exist.
      if (!canSee) return forbidden(reply, "You do not have access to this entity.");
      if (!entity) return notFound(reply);

      // Children the caller cannot open are left out.
      const visibleChildren = hasTenantPermission(access, MANAGE_ENTITIES)
        ? entity.children
        : entity.children.filter((child: { id: string }) =>
            openableEntityIds(access).includes(child.id)
          );
      return { data: { ...entity, children: visibleChildren }, errors: [] };
    }
  );

  // ── Create entity ──────────────────────────────────────────────────────────

  app.post<{
    Body: {
      name: string;
      code?: string;
      type: "GROUP" | "PROPERTY";
      parentId?: string | null;
      functionalCurrency?: string;
      reportingCurrency?: string;
      timezone?: string;
      countryCode: string;
      address?: string;
      city?: string;
      postalCode?: string;
      maxProperties?: number;
    };
  }>(
    "/api/v1/entities",
    {
      // The entity acted on is in the body or the path, not the header, so
      // the handler checks ADMIN_ENTITIES at that entity.
      preHandler: [requireAuth, requirePermission(MANAGE_ENTITIES, { scope: "any-entity" })]
    },
    async (request, reply) => {
      const b = request.body;
      const access = await loadRequestAccess(request, reply);
      if (!access) return reply;

      if (!canPlaceEntityUnder(access, b.parentId ?? null)) {
        return forbidden(reply, "You do not have access to this entity tree.");
      }
      if (b.parentId) {
        const parentId = b.parentId;
        const parent = await readAcrossEntities((tx) =>
          tx.entity.findFirst({ where: { id: parentId }, select: { id: true } })
        );
        if (!parent) return notFound(reply);
      }

      if (b.type === "PROPERTY" && b.parentId) {
        const parentGroup = await (prisma.entity as any).findFirst({
          where: { id: b.parentId, type: "GROUP" },
          select: { id: true, maxProperties: true }
        });

        if (parentGroup && (parentGroup as any).maxProperties > 0) {
          const currentCount = await prisma.entity.count({
            where: { parentId: b.parentId, type: "PROPERTY", isActive: true }
          });
          if (currentCount >= (parentGroup as any).maxProperties) {
            reply.code(403);
            return {
              data: null,
              errors: [
                {
                  code: "PROPERTY_LIMIT_REACHED",
                  message: `This group is licensed for ${(parentGroup as any).maxProperties} properties. Current: ${currentCount}. Contact support to upgrade your license.`
                }
              ]
            };
          }
        }
      }

      const entity = await (prisma.entity as any).create({
        data: {
          name: b.name,
          code: b.code ?? null,
          type: b.type,
          parentId: b.parentId ?? null,
          functionalCurrency: b.functionalCurrency ?? "USD",
          reportingCurrency: b.reportingCurrency ?? "USD",
          timezone: b.timezone ?? "UTC",
          countryCode: b.countryCode,
          address: b.address,
          city: b.city,
          postalCode: b.postalCode,
          maxProperties: b.type === "GROUP" ? (b.maxProperties ?? 0) : 0
        }
      });

      const userId =
        typeof (request.user as any)?.sub === "string"
          ? ((request.user as any).sub as string)
          : null;
      if (userId) {
        try {
          const userRow = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true }
          });
          if (userRow) {
            await prisma.entityUser.upsert({
              where: { entityId_userId: { entityId: entity.id, userId: userRow.id } },
              create: { entityId: entity.id, userId: userRow.id },
              update: {}
            });
          } else {
            request.log.warn(
              { userId, entityId: entity.id },
              "Entity created but no User row matches the JWT sub — entity_users link skipped"
            );
          }
        } catch (err) {
          request.log.error(
            { err, entityId: entity.id },
            "Failed to auto-link requesting user to new entity"
          );
        }
      }
      await invalidateAccess(request);
      reply.code(201);
      return { data: entity, errors: [] };
    }
  );

  // ── Update entity ──────────────────────────────────────────────────────────

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      code?: string;
      parentId?: string | null;
      functionalCurrency?: string;
      maxProperties?: number;
      reportingCurrency?: string;
      timezone?: string;
      countryCode?: string;
      address?: string | null;
      city?: string | null;
      postalCode?: string | null;
      isActive?: boolean;
    };
  }>(
    "/api/v1/entities/:id",
    {
      // The entity acted on is in the body or the path, not the header, so
      // the handler checks ADMIN_ENTITIES at that entity.
      preHandler: [requireAuth, requirePermission(MANAGE_ENTITIES, { scope: "any-entity" })]
    },
    async (request, reply) => {
      const access = await loadRequestAccess(request, reply);
      if (!access) return reply;
      const existing = await readAcrossEntities((tx) =>
        tx.entity.findFirst({ where: { id: request.params.id } })
      );
      if (!existing) return notFound(reply);
      if (!canManageEntity(access, existing)) {
        return forbidden(reply, "You do not have access to this entity tree.");
      }
      const b = request.body;

      if (b.parentId !== undefined && b.parentId !== existing.parentId) {
        if (!canPlaceEntityUnder(access, b.parentId)) {
          return forbidden(reply, "You do not have access to this entity tree.");
        }
        if (b.parentId) {
          const parentId = b.parentId;
          const parent = await readAcrossEntities((tx) =>
            tx.entity.findFirst({ where: { id: parentId }, select: { id: true } })
          );
          if (!parent) return notFound(reply);
        }
      }

      const entity = await (prisma.entity as any).update({
        where: { id: request.params.id },
        data: {
          ...(b.name !== undefined && { name: b.name }),
          ...(b.code !== undefined && { code: b.code }),
          ...(b.parentId !== undefined && { parentId: b.parentId }),
          ...(b.functionalCurrency !== undefined && { functionalCurrency: b.functionalCurrency }),
          ...(b.reportingCurrency !== undefined && { reportingCurrency: b.reportingCurrency }),
          ...(b.timezone !== undefined && { timezone: b.timezone }),
          ...(b.countryCode !== undefined && { countryCode: b.countryCode }),
          ...(b.address !== undefined && { address: b.address }),
          ...(b.city !== undefined && { city: b.city }),
          ...(b.postalCode !== undefined && { postalCode: b.postalCode }),
          ...(b.isActive !== undefined && { isActive: b.isActive }),
          ...(b.maxProperties !== undefined &&
            existing.type === "GROUP" && { maxProperties: b.maxProperties })
        }
      });
      await invalidateAccess(request);
      return { data: entity, errors: [] };
    }
  );

  // ── Delete entity ──────────────────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>(
    "/api/v1/entities/:id",
    {
      // The entity acted on is in the body or the path, not the header, so
      // the handler checks ADMIN_ENTITIES at that entity.
      preHandler: [requireAuth, requirePermission(MANAGE_ENTITIES, { scope: "any-entity" })]
    },
    async (request, reply) => {
      const access = await loadRequestAccess(request, reply);
      if (!access) return reply;
      const existing = await readAcrossEntities((tx) =>
        tx.entity.findFirst({
          where: { id: request.params.id },
          include: { _count: { select: { children: true, journals: true, accounts: true } } }
        })
      );
      if (!existing) return notFound(reply);
      if (!canManageEntity(access, existing)) {
        return forbidden(reply, "You do not have access to this entity tree.");
      }

      if (
        existing._count.children > 0 ||
        existing._count.journals > 0 ||
        existing._count.accounts > 0
      ) {
        reply.code(409);
        return {
          data: null,
          errors: [
            {
              code: "HAS_DEPENDENTS",
              message: "Cannot delete entity with children, journals or accounts."
            }
          ]
        };
      }
      await prisma.entityUser.deleteMany({ where: { entityId: request.params.id } });
      await prisma.entity.delete({ where: { id: request.params.id } });
      await invalidateAccess(request);
      reply.code(204);
      return;
    }
  );

  // ── License info ───────────────────────────────────────────────────────────

  app.get(
    "/api/v1/license",
    { preHandler: [requireAuth], config: { access: "session" } },
    async (request, reply) => {
      const access = await loadRequestAccess(request, reply);
      if (!access) return reply;

      const groups: Array<{ id: string; name: string; maxProperties: number | null }> =
        await readAcrossEntities((tx) =>
          tx.entity.findMany({
            where: {
              type: "GROUP",
              ...(hasTenantPermission(access, MANAGE_ENTITIES)
                ? {}
                : { id: { in: openableEntityIds(access) } })
            },
            select: { id: true, name: true, maxProperties: true }
          })
        );

      const result = [];
      for (const group of groups) {
        const propertyCount: number = await readAcrossEntities((tx) =>
          tx.entity.count({ where: { parentId: group.id, type: "PROPERTY", isActive: true } })
        );
        const maxProperties = group.maxProperties ?? 0;
        result.push({
          groupId: group.id,
          groupName: group.name,
          maxProperties: maxProperties === 0 ? "unlimited" : maxProperties,
          currentProperties: propertyCount,
          remaining: maxProperties === 0 ? "unlimited" : Math.max(0, maxProperties - propertyCount)
        });
      }
      return { data: result, errors: [] };
    }
  );
}
