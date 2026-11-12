/**
 * Setting up access in a tenant database: the table, the catalogue and the
 * first administrator. Used by tenant provisioning, the provisioning script
 * and the seed, so that all three produce the same starting point.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Prisma, PrismaClient } from "../../db/client.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import { splitSqlStatements } from "../../db/sqlRunner.js";
import { grantRole } from "./grants.js";
import {
  SYSTEM_PERMISSIONS,
  SYSTEM_ROLES,
  TENANT_ADMIN_ROLE_CODE,
  type SystemRole
} from "./system-catalog.js";

type Db = PrismaClient | Prisma.TransactionClient;

const ACCESS_MIGRATION = fileURLToPath(
  new URL("../../db/migrations/20261111000000_role_assignments/migration.sql", import.meta.url)
);

/**
 * Applies the role_assignments migration. `prisma db push` creates the table
 * from the schema but not its CHECK constraint, its NULL-safe unique index or
 * its row-level security; this adds them. Safe to re-run. Every statement
 * runs in one transaction and any failure stops it: a tenant must not come up
 * with the table unprotected.
 */
export async function applyAccessMigration(client: PrismaClient): Promise<void> {
  const statements = splitSqlStatements(await readFile(ACCESS_MIGRATION, "utf-8"));
  await client.$transaction(
    async (tx) => {
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
    },
    { timeout: 60_000 }
  );
}

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
    await tx.entityUser.upsert({
      where: { entityId_userId: { entityId, userId } },
      create: { entityId, userId },
      update: {}
    });
  });
}
