/**
 * Loads the access snapshot for one user from a tenant database.
 *
 * role_assignments is readable only inside a transaction that sets
 * app.bypass_rls (see migration 20261111000000_role_assignments), and the
 * entity tree must be read whole regardless of the entity selected for the
 * request, so the snapshot is read in one bypass transaction. Nothing else in
 * the API should read role_assignments.
 *
 * The reads are raw SQL on purpose. The API's tenant clients carry a
 * middleware that re-runs model queries on RLS tables in a second transaction
 * scoped to the request's entity, and an extension that adds an entity filter.
 * Either would silently narrow the entity tree to the selected entity. Raw
 * queries pass through both untouched and stay on this transaction.
 */

import type { PrismaClient } from "../../db/client.js";
import type { AccessAssignment, AccessEntityNode } from "./resolver.js";
import type { AccessDataSource, AccessSnapshot } from "./service.js";

type UserRow = { isActive: boolean };
type AssignmentRow = { scopeType: string; entityId: string | null; roleId: string };
type RolePermissionRow = { roleId: string; code: string };

/** The tenant client must be the one bound to the tenant the user belongs to. */
export class PrismaAccessDataSource implements AccessDataSource {
  constructor(private readonly tenantClient: Pick<PrismaClient, "$transaction">) {}

  async loadSnapshot(userId: string): Promise<AccessSnapshot> {
    return this.tenantClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;

      const users = await tx.$queryRaw<UserRow[]>`
        SELECT is_active AS "isActive" FROM users WHERE id = ${userId}`;
      if (users.length === 0 || !users[0]?.isActive) {
        return { userIsActive: false, entities: [], assignments: [], rolePermissions: new Map() };
      }

      const rows = await tx.$queryRaw<AssignmentRow[]>`
        SELECT scope_type::text AS "scopeType", entity_id AS "entityId", role_id AS "roleId"
          FROM role_assignments
         WHERE user_id = ${userId}`;
      const permissionRows = await tx.$queryRaw<RolePermissionRow[]>`
        SELECT rp.role_id AS "roleId", p.code
          FROM role_permissions rp
          JOIN permissions p ON p.id = rp.permission_id
         WHERE rp.role_id IN (SELECT role_id FROM role_assignments WHERE user_id = ${userId})`;
      const entities = await tx.$queryRaw<AccessEntityNode[]>`
        SELECT id, parent_id AS "parentId", is_active AS "isActive" FROM entities`;

      const assignments: AccessAssignment[] = [];
      const rolePermissions = new Map<string, string[]>();
      for (const row of rows) {
        // A role with no permissions still lets the user open the entity.
        if (!rolePermissions.has(row.roleId)) rolePermissions.set(row.roleId, []);
        if (row.scopeType === "TENANT") {
          assignments.push({ scopeType: "TENANT", roleId: row.roleId });
        } else if (row.entityId !== null) {
          assignments.push({ scopeType: "ENTITY", roleId: row.roleId, entityId: row.entityId });
        }
        // An ENTITY row without an entity cannot exist (CHECK constraint); if
        // one ever did, it is skipped and grants nothing.
      }
      for (const row of permissionRows) {
        rolePermissions.get(row.roleId)?.push(row.code);
      }

      return { userIsActive: true, entities, assignments, rolePermissions };
    });
  }
}
