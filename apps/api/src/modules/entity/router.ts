import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { requireRole } from "../../middleware/requireRole.js";
import { withBypassRLS } from "../../db/rls-bypass.js";

type EntityActorContext = {
  roles: string[];
  entityIds: string[];
};

const CROSS_ENTITY_ADMIN_ROLES = new Set(["SUPERADMIN", "PLATFORM_ADMIN"]);

function getActorContext(request: FastifyRequest): EntityActorContext {
  const user = request.user as any;
  return {
    roles: Array.isArray(user?.roles) ? user.roles : [],
    entityIds: Array.isArray(user?.entityIds) ? user.entityIds : []
  };
}

function hasCrossEntityAccess(actor: EntityActorContext): boolean {
  return actor.roles.some((role) => CROSS_ENTITY_ADMIN_ROLES.has(role.toUpperCase()));
}

export function isEntityManageableByActor(
  lineage: Array<{ id: string; parentId: string | null }>,
  actor: EntityActorContext
): boolean {
  if (hasCrossEntityAccess(actor)) return true;
  if (actor.entityIds.length === 0) return false;
  const granted = new Set(actor.entityIds);
  return lineage.some((entity) => granted.has(entity.id));
}

async function getEntityLineage(
  entityId: string
): Promise<Array<{ id: string; parentId: string | null }>> {
  return withBypassRLS(prisma, async (tx: any) => {
    const lineage: Array<{ id: string; parentId: string | null }> = [];
    const visited = new Set<string>();
    let currentId: string | null = entityId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const entity: { id: string; parentId: string | null } | null = await tx.entity.findUnique({
        where: { id: currentId },
        select: { id: true, parentId: true }
      });
      if (!entity) break;
      lineage.push(entity);
      currentId = entity.parentId;
    }

    return lineage;
  });
}

async function assertCanManageEntity(
  actor: EntityActorContext,
  entityId: string
): Promise<{ allowed: true } | { allowed: false; error: "ENTITY_NOT_FOUND" | "FORBIDDEN" }> {
  const lineage = await getEntityLineage(entityId);
  if (lineage.length === 0) return { allowed: false, error: "ENTITY_NOT_FOUND" };
  return isEntityManageableByActor(lineage, actor)
    ? { allowed: true }
    : { allowed: false, error: "FORBIDDEN" };
}

function mapEntityScopeError(
  reply: FastifyReply,
  result: { allowed: false; error: "ENTITY_NOT_FOUND" | "FORBIDDEN" }
) {
  if (result.error === "ENTITY_NOT_FOUND") {
    return reply
      .code(404)
      .send({ data: null, errors: [{ code: result.error, message: "Entity not found." }] });
  }
  return reply.code(403).send({
    data: null,
    errors: [{ code: result.error, message: "You do not have access to this entity tree." }]
  });
}

export async function registerEntityRouter(app: FastifyInstance): Promise<void> {
  // ── List entities ──────────────────────────────────────────────────────────

  app.get("/api/v1/entities", { preHandler: [requireAuth] }, async (request) => {
    const userEntityIds = (request.user as any)?.entityIds as string[] | undefined;
    const isSuperAdmin = !userEntityIds || userEntityIds.length === 0;
    const where = isSuperAdmin ? {} : { id: { in: userEntityIds } };

    const fetchEntities = async (db: any) => {
      const entities = await db.entity.findMany({
        where,
        include: {
          parent: { select: { id: true, name: true } },
          _count: { select: { children: true, users: true } }
        },
        orderBy: { name: "asc" }
      });

      const grantedIds = new Set(entities.map((e: any) => e.id));
      const childEntities = !isSuperAdmin
        ? await db.entity.findMany({
            where: { parentId: { in: userEntityIds! }, id: { notIn: [...grantedIds] } },
            include: {
              parent: { select: { id: true, name: true } },
              _count: { select: { children: true, users: true } }
            },
            orderBy: { name: "asc" }
          })
        : [];

      return [...entities, ...childEntities];
    };

    const allEntities = isSuperAdmin
      ? await withBypassRLS(prisma, fetchEntities)
      : await fetchEntities(prisma);

    return { data: allEntities, errors: [] };
  });

  // ── Get entity by ID ───────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/api/v1/entities/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userEntityIds = (request.user as any)?.entityIds as string[] | undefined;
      const requestedId = request.params.id;

      if (userEntityIds && userEntityIds.length > 0) {
        const entity = await prisma.entity.findFirst({
          where: { id: requestedId },
          select: { id: true, parentId: true }
        });
        if (!entity)
          return reply
            .code(404)
            .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Entity not found." }] });

        const hasAccess =
          userEntityIds.includes(entity.id) ||
          (entity.parentId && userEntityIds.includes(entity.parentId));
        if (!hasAccess) {
          return reply.code(403).send({
            data: null,
            errors: [{ code: "FORBIDDEN", message: "You do not have access to this entity." }]
          });
        }
      }

      const entity = await prisma.entity.findFirst({
        where: { id: requestedId },
        include: {
          parent: { select: { id: true, name: true } },
          children: {
            select: { id: true, name: true, type: true, isActive: true, functionalCurrency: true }
          },
          _count: { select: { children: true, users: true, accounts: true, journals: true } }
        }
      });
      if (!entity)
        return reply
          .code(404)
          .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Entity not found." }] });
      return { data: entity, errors: [] };
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
      preHandler: [
        requireAuth,
        requireRole(["ADMIN", "SUPERADMIN", "PLATFORM_ADMIN"]),
        requirePermission("ADMIN_ENTITIES")
      ]
    },
    async (request, reply) => {
      const b = request.body;
      const actor = getActorContext(request);

      if (!hasCrossEntityAccess(actor) && !b.parentId) {
        return reply.code(403).send({
          data: null,
          errors: [{ code: "FORBIDDEN", message: "You do not have access to this entity tree." }]
        });
      }

      if (b.parentId) {
        const parentAccess = await assertCanManageEntity(actor, b.parentId);
        if (!parentAccess.allowed) return mapEntityScopeError(reply, parentAccess);
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
              create: { entityId: entity.id, userId: userRow.id, role: "ADMIN" },
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
      preHandler: [
        requireAuth,
        requireRole(["ADMIN", "SUPERADMIN", "PLATFORM_ADMIN"]),
        requirePermission("ADMIN_ENTITIES")
      ]
    },
    async (request, reply) => {
      const existing = await withBypassRLS(prisma, async (tx: any) => {
        return tx.entity.findFirst({ where: { id: request.params.id } });
      });
      if (!existing)
        return reply
          .code(404)
          .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Entity not found." }] });

      const actor = getActorContext(request);
      const currentAccess = await assertCanManageEntity(actor, existing.id);
      if (!currentAccess.allowed) return mapEntityScopeError(reply, currentAccess);
      const b = request.body;

      if (b.parentId !== undefined) {
        if (!hasCrossEntityAccess(actor) && !b.parentId) {
          return reply.code(403).send({
            data: null,
            errors: [{ code: "FORBIDDEN", message: "You do not have access to this entity tree." }]
          });
        }
        if (b.parentId) {
          const parentAccess = await assertCanManageEntity(actor, b.parentId);
          if (!parentAccess.allowed) return mapEntityScopeError(reply, parentAccess);
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
      return { data: entity, errors: [] };
    }
  );

  // ── Delete entity ──────────────────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>(
    "/api/v1/entities/:id",
    {
      preHandler: [
        requireAuth,
        requireRole(["ADMIN", "SUPERADMIN", "PLATFORM_ADMIN"]),
        requirePermission("ADMIN_ENTITIES")
      ]
    },
    async (request, reply) => {
      const existing = await withBypassRLS(prisma, async (tx: any) => {
        return tx.entity.findFirst({
          where: { id: request.params.id },
          include: { _count: { select: { children: true, journals: true, accounts: true } } }
        });
      });
      if (!existing)
        return { data: null, errors: [{ code: "NOT_FOUND", message: "Entity not found." }] };

      const actor = getActorContext(request);
      const entityAccess = await assertCanManageEntity(actor, existing.id);
      if (!entityAccess.allowed) return mapEntityScopeError(reply, entityAccess);

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
      reply.code(204);
      return;
    }
  );

  // ── License info ───────────────────────────────────────────────────────────

  app.get("/api/v1/license", { preHandler: [requireAuth] }, async (request) => {
    const userEntityIds = (request.user as any)?.entityIds as string[] | undefined;

    const groups = await (prisma.entity as any).findMany({
      where: {
        type: "GROUP",
        ...(userEntityIds && userEntityIds.length > 0 ? { id: { in: userEntityIds } } : {})
      },
      select: { id: true, name: true, maxProperties: true }
    });

    const result = [];
    for (const group of groups) {
      const propertyCount = await prisma.entity.count({
        where: { parentId: group.id, type: "PROPERTY", isActive: true }
      });
      const maxProperties = (group as any).maxProperties ?? 0;
      result.push({
        groupId: group.id,
        groupName: group.name,
        maxProperties: maxProperties === 0 ? "unlimited" : maxProperties,
        currentProperties: propertyCount,
        remaining: maxProperties === 0 ? "unlimited" : Math.max(0, maxProperties - propertyCount)
      });
    }
    return { data: result, errors: [] };
  });

  // ── Admin check ────────────────────────────────────────────────────────────

  app.get(
    "/api/v1/admin",
    { preHandler: [requireAuth, requireRole(["ADMIN", "SUPERADMIN"])] },
    async () => ({
      data: { message: "Role-gated endpoint is accessible." },
      errors: []
    })
  );
}
