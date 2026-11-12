import type { PrismaClient } from "../../db/client.js";
import crypto from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import { sendWelcomeEmail } from "../../shared/email.js";

const db = prisma as unknown as PrismaClient;

/** The caller of an admin operation, derived from resolved access by the router. */
export type AdminActorContext = {
  userId?: string;
  /** Holds the admitting permission through a tenant-wide assignment. */
  tenantWide: boolean;
  /** Permissions the caller may pass on (see the router's getActorContext). */
  permissions: string[];
  /** Entities at which the caller holds the admitting permission. */
  entityIds: string[];
  entityId?: string;
};

export function hasCrossEntityAdminAccess(actor: AdminActorContext): boolean {
  return actor.tenantWide;
}

/**
 * Privilege ceiling: an actor may only grant roles that do not exceed their
 * own privileges. System roles can only be granted by an actor with
 * tenant-wide reach; any other role requires its permission set to be a
 * subset of the actor's.
 */
export function checkPrivilegeCeiling(
  actor: AdminActorContext,
  role: { isSystem: boolean; permissions: Array<{ permission: { code: string } }> }
): boolean {
  if (hasCrossEntityAdminAccess(actor)) return true;
  if (role.isSystem) return false;
  const actorPermissions = new Set(actor.permissions.map((code) => code.toUpperCase()));
  return role.permissions.every((rp) => actorPermissions.has(rp.permission.code.toUpperCase()));
}

export function isEntityInActorLineage(
  targetLineage: Array<{ id: string; parentId: string | null }>,
  actor: AdminActorContext
): boolean {
  if (hasCrossEntityAdminAccess(actor)) return true;
  if (actor.entityIds.length === 0) return false;
  const granted = new Set(actor.entityIds);
  return targetLineage.some((entity) => granted.has(entity.id));
}

async function getEntityLineage(
  entityId: string
): Promise<Array<{ id: string; parentId: string | null }>> {
  return withBypassRLS(db, async (tx: any) => {
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

async function assertActorCanManageEntity(
  actor: AdminActorContext,
  entityId: string
): Promise<{ allowed: true } | { allowed: false; error: "ENTITY_NOT_FOUND" | "FORBIDDEN" }> {
  if (hasCrossEntityAdminAccess(actor)) {
    const exists = await withBypassRLS(db, async (tx: any) => {
      return tx.entity.findUnique({ where: { id: entityId }, select: { id: true } });
    });
    return exists ? { allowed: true } : { allowed: false, error: "ENTITY_NOT_FOUND" };
  }

  const lineage = await getEntityLineage(entityId);
  if (lineage.length === 0) return { allowed: false, error: "ENTITY_NOT_FOUND" };
  return isEntityInActorLineage(lineage, actor)
    ? { allowed: true }
    : { allowed: false, error: "FORBIDDEN" };
}

async function getActorManagedEntityIds(actor: AdminActorContext): Promise<string[] | null> {
  if (hasCrossEntityAdminAccess(actor)) return null;
  if (actor.entityIds.length === 0) return [];
  const descendants = await Promise.all(
    actor.entityIds.map((entityId) => getDescendants(entityId))
  );
  return [...new Set([...actor.entityIds, ...descendants.flat()])];
}

export function filterRowsToManagedEntities<T extends { entityId: string | null }>(
  rows: T[],
  managedEntityIds: string[] | null
): T[] {
  if (managedEntityIds === null) return rows;
  const allowed = new Set(managedEntityIds);
  return rows.filter((row) => row.entityId !== null && allowed.has(row.entityId));
}

async function assertActorCanManageEntities(
  actor: AdminActorContext,
  entityIds: string[]
): Promise<{ allowed: true } | { allowed: false; error: "ENTITY_NOT_FOUND" | "FORBIDDEN" }> {
  for (const entityId of [...new Set(entityIds)]) {
    const actorAccess = await assertActorCanManageEntity(actor, entityId);
    if (!actorAccess.allowed) return actorAccess;
  }
  return { allowed: true };
}

async function assertActorCanManageUser(
  actor: AdminActorContext,
  userId: string
): Promise<
  | { allowed: true; managedEntityIds: string[] | null; sharedEntityIds: string[] | null }
  | { allowed: false; error: "USER_NOT_FOUND" | "FORBIDDEN" }
> {
  if (hasCrossEntityAdminAccess(actor)) {
    const exists = await withBypassRLS(db, async (tx: any) => {
      return tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    });
    return exists
      ? { allowed: true, managedEntityIds: null, sharedEntityIds: null }
      : { allowed: false, error: "USER_NOT_FOUND" };
  }

  const managedEntityIds = await getActorManagedEntityIds(actor);
  if (!managedEntityIds || managedEntityIds.length === 0) {
    return { allowed: false, error: "FORBIDDEN" };
  }

  const sharedEntityIds = await withBypassRLS(db, async (tx: any) => {
    const rows = await tx.entityUser.findMany({
      where: { userId, entityId: { in: managedEntityIds } },
      select: { entityId: true }
    });
    return rows.map((row: { entityId: string }) => row.entityId);
  });

  if (sharedEntityIds.length > 0) {
    return { allowed: true, managedEntityIds, sharedEntityIds };
  }

  const exists = await withBypassRLS(db, async (tx: any) => {
    return tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  });

  return exists
    ? { allowed: false, error: "FORBIDDEN" }
    : { allowed: false, error: "USER_NOT_FOUND" };
}

function chooseScopedRoleEntityId(
  actor: AdminActorContext,
  sharedEntityIds: string[] | null
): string | null {
  if (hasCrossEntityAdminAccess(actor)) return null;
  if (!sharedEntityIds || sharedEntityIds.length === 0) return null;
  if (actor.entityId && sharedEntityIds.includes(actor.entityId)) return actor.entityId;
  return sharedEntityIds[0] ?? null;
}

// ── Roles ───────────────────────────────────────────────────────────────────

export async function listRoles() {
  return db.role.findMany({
    include: { _count: { select: { permissions: true, users: true } } },
    orderBy: { code: "asc" }
  });
}

export async function getRoleById(id: string) {
  return db.role.findUnique({
    where: { id },
    include: {
      permissions: { include: { permission: true } },
      users: { include: { user: { select: { id: true, name: true, email: true } } } }
    }
  });
}

export async function createRole(data: { code: string; name: string; description?: string }) {
  return db.role.create({ data });
}

export async function updateRole(
  id: string,
  payload: { code?: string; name?: string; description?: string }
) {
  const existing = await db.role.findUnique({ where: { id } });
  if (!existing) return { error: "NOT_FOUND" as const };

  // Guard: system roles cannot have their code changed
  const updateData = { ...payload };
  if ((existing as any).isSystem && updateData.code && updateData.code !== existing.code) {
    delete updateData.code;
  }

  const data = await db.role.update({ where: { id }, data: updateData });
  return { data };
}

export async function deleteRole(id: string) {
  const role = await db.role.findUnique({ where: { id } });
  if (!role) return { error: "NOT_FOUND" as const };
  if ((role as any).isSystem) return { error: "SYSTEM_ROLE" as const };

  const userCount = await db.userRole.count({ where: { roleId: id } });
  if (userCount > 0) return { error: "ROLE_IN_USE" as const, userCount };

  await db.rolePermission.deleteMany({ where: { roleId: id } });
  await db.role.delete({ where: { id } });
  return { data: true };
}

// ── Permissions ─────────────────────────────────────────────────────────────

export async function listPermissions() {
  return db.permission.findMany({
    include: { _count: { select: { roles: true } } },
    orderBy: { code: "asc" }
  });
}

export async function createPermission(data: { code: string; description?: string }) {
  return db.permission.create({ data });
}

export async function deletePermission(id: string) {
  await db.rolePermission.deleteMany({ where: { permissionId: id } });
  await db.permission.delete({ where: { id } });
}

// ── Role-Permission bindings ────────────────────────────────────────────────

export async function bindPermissionToRole(roleId: string, permissionId: string) {
  return db.rolePermission.create({ data: { roleId, permissionId } });
}

export async function unbindPermissionFromRole(roleId: string, permissionId: string) {
  await db.rolePermission.delete({
    where: { roleId_permissionId: { roleId, permissionId } }
  });
}

// ── Entity Users ────────────────────────────────────────────────────────────

export async function listEntityUsers(entityId: string) {
  return db.entityUser.findMany({
    where: { entityId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" }
  });
}

export async function addEntityUser(entityId: string, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "USER_NOT_FOUND" as const };

  const data = await db.entityUser.create({
    data: { entityId, userId },
    include: { user: { select: { id: true, name: true, email: true } } }
  });
  return { data };
}

export async function removeEntityUser(entityId: string, userId: string) {
  await db.entityUser.delete({
    where: { entityId_userId: { entityId, userId } }
  });
}

// ── User Roles ──────────────────────────────────────────────────────────────

export async function assignRoleToUser(userId: string, roleId: string, actor: AdminActorContext) {
  const actorAccess = await assertActorCanManageUser(actor, userId);
  if (!actorAccess.allowed) return { error: actorAccess.error };

  const role = await withBypassRLS(db, async (tx: any) =>
    tx.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } }
    })
  );
  if (!role) return { error: "ROLE_NOT_FOUND" as const };
  if (!checkPrivilegeCeiling(actor, role)) return { error: "FORBIDDEN" as const };

  const scopedEntityId = chooseScopedRoleEntityId(actor, actorAccess.sharedEntityIds);
  if (!hasCrossEntityAdminAccess(actor) && !scopedEntityId) {
    return { error: "FORBIDDEN" as const };
  }

  await withBypassRLS(db, async (tx: any) => {
    const existing = await tx.userRole.findFirst({
      where: { userId, roleId, entityId: scopedEntityId },
      select: { id: true }
    });
    if (!existing) {
      await tx.$executeRawUnsafe(
        `INSERT INTO user_roles (id, user_id, role_id, entity_id, created_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`,
        userId,
        roleId,
        scopedEntityId
      );
    }
  });

  return { data: { userId, roleId, entityId: scopedEntityId } };
}

export async function revokeRoleFromUser(userId: string, roleId: string, actor: AdminActorContext) {
  const actorAccess = await assertActorCanManageUser(actor, userId);
  if (!actorAccess.allowed) return { error: actorAccess.error };

  await withBypassRLS(db, async (tx: any) => {
    if (hasCrossEntityAdminAccess(actor)) {
      await tx.$executeRawUnsafe(
        `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
        userId,
        roleId
      );
      return;
    }

    await tx.userRole.deleteMany({
      where: {
        userId,
        roleId,
        entityId: { in: actorAccess.sharedEntityIds ?? [] }
      }
    });
  });

  return { data: true };
}

export async function getUserRoles(userId: string, actor: AdminActorContext) {
  const actorAccess = await assertActorCanManageUser(actor, userId);
  if (!actorAccess.allowed) return { error: actorAccess.error };

  const roles = await withBypassRLS(db, async (tx: any) => {
    return tx.userRole.findMany({
      where: {
        userId,
        ...(hasCrossEntityAdminAccess(actor)
          ? {}
          : { entityId: { in: actorAccess.sharedEntityIds ?? [] } })
      },
      include: { role: true }
    });
  });
  return { data: roles.map((ur: any) => ur.role) };
}

// ── User Invite ─────────────────────────────────────────────────────────────

export async function inviteUser(
  payload: { email: string; name: string; roleId?: string; entityIds?: string[] },
  currentEntityId?: string,
  tenantContext?: { tenantSlug?: string; tenantCode?: string; tenantName?: string },
  actor?: AdminActorContext
) {
  // Assign to selected properties (or current entity as fallback)
  const targetEntityIds = payload.entityIds?.length
    ? payload.entityIds
    : currentEntityId
      ? [currentEntityId]
      : [];

  if (actor) {
    const actorAccess = await assertActorCanManageEntities(actor, targetEntityIds);
    if (!actorAccess.allowed) return { error: actorAccess.error };
  }

  const bcrypt = await import("bcrypt");
  const tempPassword = crypto.randomBytes(24).toString("base64url");
  const passwordHash = await bcrypt.default.hash(tempPassword, 12);

  const user = await db.user.upsert({
    where: { email: payload.email },
    create: {
      email: payload.email,
      name: payload.name,
      passwordHash,
      mustChangePassword: true
    },
    update: { name: payload.name }
  });

  for (const eid of targetEntityIds) {
    await db.entityUser.upsert({
      where: { entityId_userId: { entityId: eid, userId: user.id } },
      create: { entityId: eid, userId: user.id },
      update: {}
    });
  }

  // Assign role if provided
  if (payload.roleId) {
    const role = await db.role.findUnique({ where: { id: payload.roleId } });
    if (role) {
      await withBypassRLS(db, async (tx: any) => {
        const roleEntityIds =
          actor && !hasCrossEntityAdminAccess(actor)
            ? targetEntityIds
            : ([null] as Array<string | null>);

        for (const roleEntityId of roleEntityIds) {
          const existing = await tx.userRole.findFirst({
            where: { userId: user.id, roleId: role.id, entityId: roleEntityId },
            select: { id: true }
          });
          if (existing) continue;

          await tx.$executeRawUnsafe(
            `INSERT INTO user_roles (id, user_id, role_id, entity_id, created_at) VALUES (gen_random_uuid(), $1, $2, $3, now())`,
            user.id,
            role.id,
            roleEntityId
          );
        }
      });
    }
  }

  // Send welcome email with credentials
  const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:3001";
  const tenantCode = tenantContext?.tenantCode ?? "";
  const tenantName = tenantContext?.tenantName ?? "HospitalityFinance Pro";
  const loginUrl = tenantCode ? `${appBaseUrl}/t/${tenantCode}/login` : appBaseUrl;

  sendWelcomeEmail({
    to: payload.email,
    userName: payload.name,
    tenantName,
    loginUrl,
    temporaryPassword: tempPassword
  }).catch((err) => {
    console.error(`Failed to send welcome email to ${payload.email}:`, err);
  });

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    mustChangePassword: true,
    tempPassword
  };
}

// ── All users within the actor's reach ──────────────────────────────────────────────────

export async function listAllUsers(actor?: AdminActorContext) {
  const managedEntityIds = actor ? await getActorManagedEntityIds(actor) : null;
  return withBypassRLS(db, async (tx: any) => {
    return tx.user.findMany({
      where:
        managedEntityIds !== null
          ? { entities: { some: { entityId: { in: managedEntityIds } } } }
          : {},
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { name: "asc" }
    });
  });
}

// ── Entity Tree ─────────────────────────────────────────────────────────────

export async function getEntityTree() {
  const allEntities = await db.entity.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      type: true,
      parentId: true,
      isActive: true,
      functionalCurrency: true,
      _count: { select: { children: true, users: true } }
    },
    orderBy: [{ type: "asc" }, { name: "asc" }]
  });

  const entityMap = new Map(
    allEntities.map((e) => [e.id, { ...e, children: [] as typeof allEntities }])
  );
  const roots: typeof allEntities = [];
  for (const entity of allEntities) {
    if (entity.parentId && entityMap.has(entity.parentId)) {
      (entityMap.get(entity.parentId) as any).children.push(entityMap.get(entity.id));
    } else {
      roots.push(entityMap.get(entity.id) as any);
    }
  }

  return { flat: allEntities, tree: roots };
}

// ── Scope Assignment ────────────────────────────────────────────────────────

async function getDescendants(parentId: string): Promise<string[]> {
  return withBypassRLS(db, async (tx: any) => {
    const children = await tx.entity.findMany({
      where: { parentId },
      select: { id: true }
    });
    const ids: string[] = [];
    for (const child of children) {
      ids.push(child.id);
      const grandchildren = await tx.entity.findMany({
        where: { parentId: child.id },
        select: { id: true }
      });
      for (const gc of grandchildren) {
        ids.push(gc.id);
      }
    }
    return ids;
  });
}

export async function assignScope(
  userId: string,
  entityId: string,
  cascade: boolean,
  actor: AdminActorContext
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "USER_NOT_FOUND" as const };

  const actorAccess = await assertActorCanManageEntity(actor, entityId);
  if (!actorAccess.allowed) return { error: actorAccess.error };

  const targetEntity = await withBypassRLS(db, async (tx: any) => {
    return tx.entity.findUnique({
      where: { id: entityId },
      select: { id: true, name: true, type: true }
    });
  });
  if (!targetEntity) return { error: "ENTITY_NOT_FOUND" as const };

  const entityIds: string[] = [entityId];
  if (cascade) {
    const descendants = await getDescendants(entityId);
    entityIds.push(...descendants);
  }

  const assigned = await withBypassRLS(db, async (tx: any) => {
    let count = 0;
    for (const eid of entityIds) {
      await tx.entityUser.upsert({
        where: { entityId_userId: { entityId: eid, userId } },
        create: { entityId: eid, userId },
        update: {}
      });
      count++;
    }
    return count;
  });

  return {
    data: {
      userId,
      assignedEntities: assigned,
      scope: targetEntity.type,
      cascade
    }
  };
}

export async function revokeScope(
  userId: string,
  entityId: string,
  cascade: boolean,
  actor: AdminActorContext
) {
  const actorAccess = await assertActorCanManageEntity(actor, entityId);
  if (!actorAccess.allowed) return { error: actorAccess.error };

  const entityIds: string[] = [entityId];
  if (cascade) {
    const descendants = await getDescendants(entityId);
    entityIds.push(...descendants);
  }

  const result = await withBypassRLS(db, async (tx: any) => {
    return tx.entityUser.deleteMany({
      where: { userId, entityId: { in: entityIds } }
    });
  });

  return { data: { removedFrom: result.count, cascade } };
}

export async function getUserEntities(userId: string, actor?: AdminActorContext) {
  const managedEntityIds = actor ? await getActorManagedEntityIds(actor) : null;
  return withBypassRLS(db, async (tx: any) => {
    return tx.entityUser.findMany({
      where: {
        userId,
        ...(managedEntityIds !== null ? { entityId: { in: managedEntityIds } } : {})
      },
      include: {
        entity: {
          select: {
            id: true,
            name: true,
            code: true,
            type: true,
            parentId: true,
            isActive: true
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });
  });
}

// ── User Profile ────────────────────────────────────────────────────────────

export async function getUserProfile(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      jobTitle: true,
      department: true,
      avatarUrl: true,
      isActive: true,
      lastLoginAt: true,
      loginCount: true,
      createdAt: true,
      entities: {
        include: { entity: { select: { id: true, name: true, type: true } } }
      }
    }
  });
}

export async function updateUserProfile(
  userId: string,
  data: { name?: string; phone?: string; jobTitle?: string; department?: string }
) {
  return db.user.update({
    where: { id: userId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.phone !== undefined && { phone: data.phone }),
      ...(data.jobTitle !== undefined && { jobTitle: data.jobTitle }),
      ...(data.department !== undefined && { department: data.department })
    },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      jobTitle: true,
      department: true
    }
  });
}

// ── Login Audit ─────────────────────────────────────────────────────────────

export async function createLoginAudit(
  body: {
    userId: string;
    email: string;
    action: string;
    ipAddress?: string;
    userAgent?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
  actor?: AdminActorContext
) {
  if (actor && !hasCrossEntityAdminAccess(actor)) {
    if (!body.entityId) {
      return { error: "ENTITY_REQUIRED" as const };
    }
    const actorAccess = await assertActorCanManageEntity(actor, body.entityId);
    if (!actorAccess.allowed) return { error: actorAccess.error };
  }

  const data = await db.loginAudit.create({
    data: {
      userId: body.userId,
      email: body.email,
      action: body.action,
      ipAddress: body.ipAddress,
      userAgent: body.userAgent,
      entityId: body.entityId,
      metadata: body.metadata as any
    }
  });

  if (body.action === "LOGIN_SUCCESS") {
    await db.user
      .update({
        where: { id: body.userId },
        data: { lastLoginAt: new Date(), loginCount: { increment: 1 } }
      })
      .catch(() => {}); // non-critical
  }

  return { data };
}

export async function listLoginAudits(
  filters: {
    userId?: string;
    email?: string;
    limit?: number;
    entityId?: string;
  },
  actor?: AdminActorContext
) {
  const scopedEntityIds = actor ? await getActorManagedEntityIds(actor) : null;
  if (
    actor &&
    scopedEntityIds !== null &&
    filters.entityId &&
    !scopedEntityIds.includes(filters.entityId)
  ) {
    return { error: "FORBIDDEN" as const };
  }

  return db.loginAudit.findMany({
    where: {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.email ? { email: filters.email } : {}),
      ...(filters.entityId
        ? { entityId: filters.entityId }
        : scopedEntityIds !== null
          ? { entityId: { in: scopedEntityIds } }
          : {})
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.limit ?? 50, 200)
  });
}

// ── User Status / Detail ────────────────────────────────────────────────────

export async function updateUserStatus(
  userId: string,
  isActive: boolean,
  actor: AdminActorContext
) {
  const actorAccess = await assertActorCanManageUser(actor, userId);
  if (!actorAccess.allowed) return { error: actorAccess.error };

  const data = await db.user.update({
    where: { id: userId },
    data: { isActive },
    select: { id: true, email: true, name: true, isActive: true }
  });
  return { data };
}

export async function getUserDetail(userId: string, actor?: AdminActorContext) {
  const managedEntityIds = actor ? await getActorManagedEntityIds(actor) : null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      jobTitle: true,
      department: true,
      isActive: true,
      lastLoginAt: true,
      loginCount: true,
      createdAt: true,
      entities: {
        ...(managedEntityIds !== null ? { where: { entityId: { in: managedEntityIds } } } : {}),
        include: { entity: { select: { id: true, name: true, type: true } } }
      },
      loginAudits: {
        ...(managedEntityIds !== null ? { where: { entityId: { in: managedEntityIds } } } : {}),
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, action: true, ipAddress: true, createdAt: true }
      }
    }
  });
  if (!user) return null;
  if (managedEntityIds !== null && user.entities.length === 0) {
    return { error: "FORBIDDEN" as const };
  }
  return user;
}
