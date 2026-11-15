/**
 * Setting up access in a tenant database: the catalogue and the first
 * administrator. Used by tenant provisioning, the provisioning scripts and
 * the seed, so that all of them produce the same starting point. The
 * role_assignments table, its constraints and its row-level security come
 * with the tenant migrations.
 */

import type { Prisma, PrismaClient } from "../../db/client.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import { grantRole } from "./grants.js";
import {
  SYSTEM_PERMISSIONS,
  SYSTEM_ROLES,
  TENANT_ADMIN_ROLE_CODE,
  type SystemRole
} from "./system-catalog.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Writes the permission catalogue and the starting roles. Existing roles keep
 * any permissions an administrator has added; catalogue permissions are added
 * to them, never removed. Returns role code -> role id.
 */
export async function ensureSystemCatalog(
  db: Db,
  roles: ReadonlyArray<SystemRole> = SYSTEM_ROLES
): Promise<Map<string, string>> {
  const permissionIds = new Map<string, string>();
  for (const permission of SYSTEM_PERMISSIONS) {
    const row = await db.permission.upsert({
      where: { code: permission.code },
      update: { description: permission.description, category: permission.category },
      create: { ...permission }
    });
    permissionIds.set(row.code, row.id);
  }

  const roleIds = new Map<string, string>();
  for (const definition of roles) {
    const { permissions, ...fields } = definition;
    const role = await db.role.upsert({
      where: { code: definition.code },
      update: {
        name: fields.name,
        description: fields.description,
        isSystem: fields.isSystem
      },
      create: fields
    });
    roleIds.set(role.code, role.id);

    for (const code of permissions) {
      const permissionId = permissionIds.get(code);
      if (!permissionId) {
        throw new Error(`Role ${definition.code} names ${code}, which is not in the catalogue.`);
      }
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId }
      });
    }
  }
  return roleIds;
}

/** Gives the user the tenant administrator role across the whole tenant. */
export async function grantTenantAdministrator(
  client: PrismaClient,
  userId: string
): Promise<void> {
  await withBypassRLS(client, async (tx: Prisma.TransactionClient) => {
    const role = await tx.role.findUnique({
      where: { code: TENANT_ADMIN_ROLE_CODE },
      select: { id: true }
    });
    if (!role) {
      throw new Error(`Role ${TENANT_ADMIN_ROLE_CODE} is missing; run ensureSystemCatalog first.`);
    }
    await grantRole(tx, userId, role.id, { scope: "TENANT" });
  });
}

/** Gives the user a starting role at one entity (and everything below it). */
export async function grantRoleAtEntity(
  client: PrismaClient,
  userId: string,
  roleCode: string,
  entityId: string
): Promise<void> {
  await withBypassRLS(client, async (tx: Prisma.TransactionClient) => {
    const role = await tx.role.findUnique({ where: { code: roleCode }, select: { id: true } });
    if (!role) throw new Error(`Role ${roleCode} is missing; run ensureSystemCatalog first.`);
    await grantRole(tx, userId, role.id, { scope: "ENTITY", entityId });
  });
}
