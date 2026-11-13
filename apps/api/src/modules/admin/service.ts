/**
 * Admin service — users, roles and who holds which role where.
 *
 * Authority comes from the caller's resolved access, never from role names:
 *
 *  - Reach. The entities at which the caller holds the permission that
 *    admitted them to the route, or everything when it is held tenant-wide.
 *    An administrator can only see and change users and grants inside it.
 *  - Ceiling. A caller can grant a role at a target only if they hold every
 *    permission of that role at that target themselves. System roles and
 *    tenant-wide grants additionally need tenant-wide reach.
 *
 * Grants live in role_assignments and are written only through
 * modules/access/grants.ts. The router invalidates the access cache around
 * every change (modules/access/invalidation.ts).
 */

import type { Prisma, PrismaClient } from "../../db/client.js";
import crypto from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import { sendWelcomeEmail } from "../../shared/email.js";
import {
  grantRole,
  grantsReachingEntity,
  listGrants,
  revokeGrants,
  type GrantTarget
} from "../access/grants.js";
import { getAccessService } from "../access/runtime.js";
import {
  normalizePermission,
  permittedEntityIds,
  type ResolvedAccess
} from "../access/resolver.js";

const db = prisma as unknown as PrismaClient;

type Tx = Prisma.TransactionClient;

function bypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withBypassRLS(db, fn);
}

/** A refusal. Routers test for it with `"error" in result`. */
function fail<E extends string>(error: E): { error: E } {
  return { error };
}

// ── The caller ───────────────────────────────────────────────────────────────

/** The caller of an admin operation. Built by the router from the request. */
export type AdminActorContext = {
  userId?: string;
  access: ResolvedAccess;
  /** Permission codes of the guard that admitted the request. */
  admittedBy: readonly string[];
  /** The entity selected for the request (X-Entity-ID), if any. */
  entityId?: string;
};

export type Reach = readonly string[] | "all";

export function actorReach(actor: AdminActorContext): Reach {
  return permittedEntityIds(actor.access, actor.admittedBy);
}

function reaches(reach: Reach, entityId: string): boolean {
  return reach === "all" || reach.includes(entityId);
}

/**
 * Privilege ceiling: may the caller grant `role` at `target`?
 *
 * The role's permissions must all be held by the caller at the target, so
 * nobody can hand out — to another account or their own — more than they have
 * there. A permission the caller holds at some other entity does not count.
 */
export function checkPrivilegeCeiling(
  actor: AdminActorContext,
  role: { isSystem: boolean; permissions: ReadonlyArray<{ permission: { code: string } }> },
  target: GrantTarget
): boolean {
  const tenantWide = actorReach(actor) === "all";
  if ((role.isSystem || target.scope === "TENANT") && !tenantWide) return false;

  const held =
    target.scope === "TENANT"
      ? actor.access.tenantPermissions
      : // An inactive entity has no entry; tenant-wide permissions still apply there.
        (actor.access.entityPermissions[target.entityId] ?? actor.access.tenantPermissions);
  const heldCodes = new Set(held.map(normalizePermission));
  return role.permissions.every((rp) => heldCodes.has(normalizePermission(rp.permission.code)));
}

// ── Shared lookups (inside a bypass transaction) ─────────────────────────────

/** The entity and everything below it, to any depth. */
async function subtreeIds(tx: Tx, rootId: string): Promise<string[]> {
  const entities = await tx.entity.findMany({ select: { id: true, parentId: true } });
  const children = new Map<string, string[]>();
  for (const entity of entities) {
    if (entity.parentId === null) continue;
    const siblings = children.get(entity.parentId);
    if (siblings) siblings.push(entity.id);
    else children.set(entity.parentId, [entity.id]);
  }
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return [...seen];
}

type UserStanding =
  | { exists: false }
  | {
      exists: true;
      /** The user holds a grant at an entity within reach. */
      withinReach: boolean;
      /** Every grant the user holds is within reach. */
      whollyWithinReach: boolean;
    };

/** Where a user stands relative to the caller's reach. */
async function userStanding(tx: Tx, reach: Reach, userId: string): Promise<UserStanding> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { exists: false };
  if (reach === "all") return { exists: true, withinReach: true, whollyWithinReach: true };

  const grants = await listGrants(tx, { userId, at: "all" });
  const entityIds = grants.flatMap((grant) => (grant.entityId === null ? [] : [grant.entityId]));
  const holdsTenantGrant = grants.some((grant) => grant.scopeType === "TENANT");
  return {
    exists: true,
    withinReach: entityIds.some((id) => reach.includes(id)),
    whollyWithinReach:
      !holdsTenantGrant && entityIds.length > 0 && entityIds.every((id) => reach.includes(id))
  };
}

type UserAccessError = "USER_NOT_FOUND" | "FORBIDDEN";

function standingError(standing: UserStanding): UserAccessError | null {
  if (!standing.exists) return "USER_NOT_FOUND";
  return standing.withinReach ? null : "FORBIDDEN";
}

// ── Roles ───────────────────────────────────────────────────────────────────

/** Narrows a grant query to the caller's reach. */
function grantsWithin(reach: Reach): Prisma.RoleAssignmentWhereInput {
  return reach === "all" ? {} : { scopeType: "ENTITY", entityId: { in: [...reach] } };
}

export async function listRoles(actor: AdminActorContext) {
  const reach = actorReach(actor);
  const roles = await bypass((tx) =>
    tx.role.findMany({
      include: {
        _count: {
          select: { permissions: true, assignments: { where: grantsWithin(reach) } }
        }
      },
      orderBy: { code: "asc" }
    })
  );
  // `users` is the number of grants of the role the caller can see.
  return roles.map(({ _count, ...role }) => ({
    ...role,
    _count: { permissions: _count.permissions, users: _count.assignments }
  }));
}

export async function getRoleById(id: string, actor: AdminActorContext) {
  const reach = actorReach(actor);
  const role = await bypass((tx) =>
    tx.role.findUnique({
      where: { id },
      include: {
        permissions: { include: { permission: true } },
        assignments: {
          where: grantsWithin(reach),
          select: {
            scopeType: true,
            entityId: true,
            user: { select: { id: true, name: true, email: true } }
          }
        }
      }
    })
  );
  if (!role) return null;
  const { assignments, ...rest } = role;
  return { ...rest, users: assignments };
}

export async function createRole(data: { code: string; name: string; description?: string }) {
  return db.role.create({ data });
}

export async function updateRole(
  id: string,
  payload: { code?: string; name?: string; description?: string }
) {
  const existing = await db.role.findUnique({ where: { id } });
  if (!existing) return fail("NOT_FOUND");

  // Guard: system roles cannot have their code changed
  const updateData = { ...payload };
  if ((existing as any).isSystem && updateData.code && updateData.code !== existing.code) {
    delete updateData.code;
  }

  const data = await db.role.update({ where: { id }, data: updateData });
  return { data };
}

export async function deleteRole(id: string) {
  return bypass(async (tx) => {
    const role = await tx.role.findUnique({ where: { id } });
    if (!role) return fail("NOT_FOUND");
    if (role.isSystem) return fail("SYSTEM_ROLE");

    const userCount = await tx.roleAssignment.count({ where: { roleId: id } });
    if (userCount > 0) return { ...fail("ROLE_IN_USE"), userCount };

    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    await tx.role.delete({ where: { id } });
    return { data: true as const };
  });
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

// ── Users of an entity ──────────────────────────────────────────────────────

/**
 * The users who can open the entity, each with the grants that give them
 * access there: at the entity, at an entity above it, or tenant-wide.
 */
export async function listEntityUsers(entityId: string) {
  const grants = await bypass((tx) => grantsReachingEntity(tx, entityId));
  const users = new Map<
    string,
    {
      userId: string;
      user: { id: string; name: string | null; email: string; isActive: boolean };
      createdAt: Date;
      roles: Array<{
        roleId: string;
        code: string;
        name: string;
        scopeType: "TENANT" | "ENTITY";
        entityId: string | null;
      }>;
    }
  >();
  for (const grant of grants) {
    const row = users.get(grant.userId) ?? {
      userId: grant.userId,
      user: grant.user,
      createdAt: grant.createdAt,
      roles: []
    };
    row.roles.push({
      roleId: grant.role.id,
      code: grant.role.code,
      name: grant.role.name,
      scopeType: grant.scopeType,
      entityId: grant.entityId
    });
    users.set(grant.userId, row);
  }
  return [...users.values()].sort((a, b) =>
    (a.user.name ?? a.user.email).localeCompare(b.user.name ?? b.user.email)
  );
}

/**
 * Takes away the roles the user holds at this entity. Access through a role
 * on a group above it, or a tenant-wide role, is not affected.
 */
export async function removeEntityUser(entityId: string, userId: string) {
  await bypass((tx) => revokeGrants(tx, { userId, at: [entityId] }));
}

// ── User Roles ──────────────────────────────────────────────────────────────

export type GrantRequest = {
  /** Grant at this entity. Defaults to the entity selected for the request. */
  entityId?: string;
  /** "TENANT" grants tenant-wide; needs tenant-wide reach. */
  scope?: "TENANT";
};

type AssignError = UserAccessError | "ROLE_NOT_FOUND" | "ENTITY_NOT_FOUND" | "ENTITY_REQUIRED";

function resolveTarget(request: GrantRequest, actor: AdminActorContext): GrantTarget | null {
  if (request.scope === "TENANT") return { scope: "TENANT" };
  const entityId = request.entityId ?? actor.entityId;
  return entityId ? { scope: "ENTITY", entityId } : null;
}

/** Checks that the caller may make a grant at `target`, apart from the ceiling. */
async function targetError(
  tx: Tx,
  reach: Reach,
  target: GrantTarget
): Promise<"FORBIDDEN" | "ENTITY_NOT_FOUND" | null> {
  if (target.scope === "TENANT") return reach === "all" ? null : "FORBIDDEN";
  // Reach first: an entity outside it is refused whether or not it exists.
  if (!reaches(reach, target.entityId)) return "FORBIDDEN";
  const entity = await tx.entity.findUnique({
    where: { id: target.entityId },
    select: { id: true }
  });
  return entity ? null : "ENTITY_NOT_FOUND";
}

export async function assignRoleToUser(
  userId: string,
  roleId: string,
  request: GrantRequest,
  actor: AdminActorContext
): Promise<
  | { error: AssignError }
  | { data: { userId: string; roleId: string; scopeType: string; entityId: string | null } }
> {
  const reach = actorReach(actor);
  const target = resolveTarget(request, actor);
  if (!target) return fail("ENTITY_REQUIRED");

  return bypass(async (tx) => {
    const forbiddenTarget = await targetError(tx, reach, target);
    if (forbiddenTarget) return fail(forbiddenTarget);

    const userError = standingError(await userStanding(tx, reach, userId));
    if (userError) return fail(userError);

    const role = await tx.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } }
    });
    if (!role) return fail("ROLE_NOT_FOUND");
    if (!checkPrivilegeCeiling(actor, role, target)) return fail("FORBIDDEN");

    await grantRole(tx, userId, roleId, target);
    return {
      data: {
        userId,
        roleId,
        scopeType: target.scope,
        entityId: target.scope === "ENTITY" ? target.entityId : null
      }
    };
  });
}

/**
 * Removes the user's grants of the role within the caller's reach — at one
 * entity when `entityId` is given, the tenant-wide grant only when `scope` is
 * "TENANT". Grants outside the reach are left alone.
 */
export async function revokeRoleFromUser(
  userId: string,
  roleId: string,
  request: { entityId?: string; scope?: "TENANT" },
  actor: AdminActorContext
): Promise<{ error: UserAccessError } | { data: true }> {
  const reach = actorReach(actor);
  if (request.entityId && !reaches(reach, request.entityId)) return fail("FORBIDDEN");
  if (request.scope === "TENANT" && reach !== "all") return fail("FORBIDDEN");

  return bypass(async (tx) => {
    const userError = standingError(await userStanding(tx, reach, userId));
    if (userError) return fail(userError);

    await revokeGrants(tx, {
      userId,
      roleId,
      at: request.entityId ? [request.entityId] : request.scope === "TENANT" ? "tenant" : reach
    });
    return { data: true as const };
  });
}

/** The user's grants within the caller's reach, each with the role it gives. */
export async function getUserRoles(userId: string, actor: AdminActorContext) {
  const reach = actorReach(actor);
  return bypass(async (tx) => {
    const userError = standingError(await userStanding(tx, reach, userId));
    if (userError) return fail(userError);

    const grants = await tx.roleAssignment.findMany({
      where: { userId, ...grantsWithin(reach) },
      select: { scopeType: true, entityId: true, role: true },
      orderBy: { createdAt: "asc" }
    });
    return {
      data: grants.map((grant) => ({
        ...grant.role,
        scopeType: grant.scopeType,
        entityId: grant.entityId
      }))
    };
  });
}

// ── User Invite ─────────────────────────────────────────────────────────────

type InviteError = "FORBIDDEN" | "ENTITY_NOT_FOUND" | "ENTITY_REQUIRED" | "ROLE_NOT_FOUND";

/** The id of the user with this email, if there is one. */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const user = await bypass((tx) => tx.user.findUnique({ where: { email }, select: { id: true } }));
  return user?.id ?? null;
}

export async function inviteUser(
  payload: { email: string; name: string; roleId: string; entityIds?: string[] },
  currentEntityId: string | undefined,
  tenantContext: { tenantSlug?: string; tenantCode?: string; tenantName?: string } | undefined,
  actor: AdminActorContext
) {
  const reach = actorReach(actor);
  // The selected properties, or the current entity as the fallback.
  const targetEntityIds = [
    ...new Set(
      payload.entityIds?.length ? payload.entityIds : currentEntityId ? [currentEntityId] : []
    )
  ];
  // Without an entity the invitation is tenant-wide, which needs tenant-wide reach.
  const targets: GrantTarget[] =
    targetEntityIds.length > 0
      ? targetEntityIds.map((entityId) => ({ scope: "ENTITY" as const, entityId }))
      : [{ scope: "TENANT" as const }];
  if (targetEntityIds.length === 0 && reach !== "all") {
    return fail("ENTITY_REQUIRED");
  }

  const bcrypt = await import("bcrypt");
  const tempPassword = crypto.randomBytes(24).toString("base64url");
  const passwordHash = await bcrypt.default.hash(tempPassword, 12);

  // Every check, then every write, in one transaction: a refused invitation
  // leaves no user or grant behind.
  const outcome = await bypass(async (tx) => {
    for (const target of targets) {
      const forbiddenTarget = await targetError(tx, reach, target);
      if (forbiddenTarget) return fail(forbiddenTarget);
    }

    // A user always arrives with a role: without one they could open nothing,
    // and nobody but a tenant-wide administrator could see them (AUT-03).
    const role = await tx.role.findUnique({
      where: { id: payload.roleId },
      include: { permissions: { include: { permission: true } } }
    });
    if (!role) return fail("ROLE_NOT_FOUND");
    for (const target of targets) {
      if (!checkPrivilegeCeiling(actor, role, target)) {
        return fail("FORBIDDEN");
      }
    }

    const user = await tx.user.upsert({
      where: { email: payload.email },
      create: {
        email: payload.email,
        name: payload.name,
        passwordHash,
        mustChangePassword: true
      },
      update: { name: payload.name }
    });

    for (const target of targets) await grantRole(tx, user.id, payload.roleId, target);
    return { user };
  });
  if ("error" in outcome) return fail(outcome.error);
  const { user } = outcome;

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

// ── All users within the caller's reach ─────────────────────────────────────

/** Narrows a user query to users who hold a grant at an entity within reach. */
function usersWithin(reach: Reach): Prisma.UserWhereInput {
  if (reach === "all") return {};
  return {
    roleAssignments: { some: { scopeType: "ENTITY", entityId: { in: [...reach] } } }
  };
}

export async function listAllUsers(actor: AdminActorContext) {
  const reach = actorReach(actor);
  return bypass((tx) =>
    tx.user.findMany({
      where: usersWithin(reach),
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { name: "asc" }
    })
  );
}

// ── Entity Tree ─────────────────────────────────────────────────────────────

/** The entities within the caller's reach, flat and as a tree. */
export async function getEntityTree(actor: AdminActorContext) {
  const reach = actorReach(actor);
  const allEntities = await bypass((tx) =>
    tx.entity.findMany({
      where: reach === "all" ? {} : { id: { in: [...reach] } },
      select: {
        id: true,
        name: true,
        code: true,
        type: true,
        parentId: true,
        isActive: true,
        functionalCurrency: true,
        roleAssignments: { select: { userId: true } },
        _count: { select: { children: true } }
      },
      orderBy: [{ type: "asc" }, { name: "asc" }]
    })
  ).then((rows) =>
    // `users`: distinct users holding a role directly at the entity.
    rows.map(({ roleAssignments, _count, ...entity }) => ({
      ...entity,
      _count: { ..._count, users: new Set(roleAssignments.map((a) => a.userId)).size }
    }))
  );

  type Node = (typeof allEntities)[number] & { children: Node[] };
  const nodes = new Map<string, Node>(
    allEntities.map((entity) => [entity.id, { ...entity, children: [] }])
  );
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    // An entity whose parent is outside the caller's reach is shown as a root.
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return { flat: allEntities, tree: roots };
}

// ── Revoking access below an entity ─────────────────────────────────────────

type ScopeError = "ENTITY_NOT_FOUND" | "FORBIDDEN";

/**
 * Takes away every role the user holds at the entity (and, with `cascade`, at
 * every entity below it). Roles held on a group above it, or tenant-wide,
 * remain.
 */
export async function revokeScope(
  userId: string,
  entityId: string,
  cascade: boolean,
  actor: AdminActorContext
): Promise<{ error: ScopeError } | { data: { entities: number; cascade: boolean } }> {
  const reach = actorReach(actor);
  if (!reaches(reach, entityId)) return fail("FORBIDDEN");

  return bypass(async (tx) => {
    const targetEntity = await tx.entity.findUnique({
      where: { id: entityId },
      select: { id: true }
    });
    if (!targetEntity) return fail("ENTITY_NOT_FOUND");

    const entityIds = cascade ? await subtreeIds(tx, entityId) : [entityId];
    // Within reach only: a cascade never reaches past the caller's own scope.
    const allowed = entityIds.filter((id) => reaches(reach, id));
    await revokeGrants(tx, { userId, at: allowed });
    return { data: { entities: allowed.length, cascade } };
  });
}

// ── A user's access, as an administrator sees it ────────────────────────────

export type UserAccessView = {
  /** The user's grants within the caller's reach. */
  assignments: Array<{
    roleId: string;
    roleCode: string;
    roleName: string;
    scopeType: "TENANT" | "ENTITY";
    entity: { id: string; name: string; code: string | null; type: string } | null;
  }>;
  /** Permissions held through tenant-wide grants. */
  tenantPermissions: string[];
  /** What the user can do at each entity within the caller's reach, from the resolver. */
  effective: Array<{
    entity: {
      id: string;
      name: string;
      code: string | null;
      type: string;
      parentId: string | null;
    };
    permissions: string[];
  }>;
};

/**
 * The user's grants and their effective permissions per entity, limited to
 * what the caller can manage. The permissions come from the access resolver,
 * so they are exactly what the API will allow.
 */
export async function getUserAccess(
  userId: string,
  tenantId: string,
  actor: AdminActorContext
): Promise<{ error: UserAccessError } | { data: UserAccessView }> {
  const reach = actorReach(actor);
  const loaded = await bypass(async (tx) => {
    const userError = standingError(await userStanding(tx, reach, userId));
    if (userError) return fail(userError);
    const grants = await tx.roleAssignment.findMany({
      where: { userId, ...grantsWithin(reach) },
      select: {
        scopeType: true,
        role: { select: { id: true, code: true, name: true } },
        entity: { select: { id: true, name: true, code: true, type: true } }
      },
      orderBy: { createdAt: "asc" }
    });
    const entities = await tx.entity.findMany({
      select: { id: true, name: true, code: true, type: true, parentId: true },
      orderBy: [{ type: "asc" }, { name: "asc" }]
    });
    return { grants, entities };
  });
  if ("error" in loaded) return loaded;

  const access = await getAccessService().resolve({ tenantId, userId });
  const effective = loaded.entities
    .filter((entity) => reaches(reach, entity.id) && access.entityPermissions[entity.id])
    .map((entity) => ({ entity, permissions: access.entityPermissions[entity.id] }));

  return {
    data: {
      assignments: loaded.grants.map((grant) => ({
        roleId: grant.role.id,
        roleCode: grant.role.code,
        roleName: grant.role.name,
        scopeType: grant.scopeType,
        entity: grant.entity
      })),
      tenantPermissions: access.tenantPermissions,
      effective
    }
  };
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
      createdAt: true
    }
  });
}

/** The caller's own role assignments, for their profile page. */
export async function getOwnAssignments(userId: string) {
  return bypass((tx) =>
    tx.roleAssignment.findMany({
      where: { userId },
      select: {
        scopeType: true,
        role: { select: { code: true, name: true } },
        entity: { select: { id: true, name: true, type: true } }
      },
      orderBy: { createdAt: "asc" }
    })
  );
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
  actor: AdminActorContext
) {
  const reach = actorReach(actor);
  if (reach !== "all") {
    if (!body.entityId) return fail("ENTITY_REQUIRED");
    if (!reaches(reach, body.entityId)) return fail("FORBIDDEN");
  }

  const data = await db.loginAudit.create({
    data: {
      userId: body.userId,
      email: body.email,
      action: body.action,
      ipAddress: body.ipAddress,
      userAgent: body.userAgent,
      entityId: body.entityId,
      metadata: body.metadata as Prisma.InputJsonValue | undefined
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
  filters: { userId?: string; email?: string; limit?: number; entityId?: string },
  actor: AdminActorContext
) {
  const reach = actorReach(actor);
  if (filters.entityId && !reaches(reach, filters.entityId)) {
    return fail("FORBIDDEN");
  }

  return db.loginAudit.findMany({
    where: {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.email ? { email: filters.email } : {}),
      ...(filters.entityId
        ? { entityId: filters.entityId }
        : reach !== "all"
          ? { entityId: { in: [...reach] } }
          : {})
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.limit ?? 50, 200)
  });
}

// ── User Status / Detail ────────────────────────────────────────────────────

/**
 * Activates or deactivates a user. Deactivation ends the user's access
 * everywhere, so the caller's reach must cover everything the user belongs to
 * or holds; sharing one entity with the user is not enough.
 */
export async function updateUserStatus(
  userId: string,
  isActive: boolean,
  actor: AdminActorContext
) {
  const reach = actorReach(actor);
  return bypass(async (tx) => {
    const standing = await userStanding(tx, reach, userId);
    if (!standing.exists) return fail("USER_NOT_FOUND");
    if (!standing.whollyWithinReach) return fail("FORBIDDEN");

    const data = await tx.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, email: true, name: true, isActive: true }
    });
    return { data };
  });
}

export async function getUserDetail(userId: string, actor: AdminActorContext) {
  const reach = actorReach(actor);
  const withinReach = reach === "all" ? {} : { where: { entityId: { in: [...reach] } } };
  const grantsInReach = { where: grantsWithin(reach) };
  return bypass(async (tx) => {
    const userError = standingError(await userStanding(tx, reach, userId));
    if (userError === "USER_NOT_FOUND") return null;
    if (userError) return fail(userError);

    return tx.user.findUnique({
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
        roleAssignments: {
          ...grantsInReach,
          select: {
            scopeType: true,
            role: { select: { code: true, name: true } },
            entity: { select: { id: true, name: true, type: true } }
          }
        },
        loginAudits: {
          ...withinReach,
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { id: true, action: true, ipAddress: true, createdAt: true }
        }
      }
    });
  });
}
