/**
 * Loads the access snapshot for one user from a tenant database.
 *
 * role_assignments is readable only inside a transaction that sets
 * app.bypass_rls (see migration 20261111000000_role_assignments), and the
 * entity tree must be read whole regardless of the entity selected for the
 * request, so the snapshot is read in one bypass transaction. Nothing else in
 * the API should read role_assignments.
 */

import type { PrismaClient } from "../../db/client.js";
import type { AccessAssignment } from "./resolver.js";
import type { AccessDataSource, AccessSnapshot } from "./service.js";

/** The tenant client must be the one bound to the tenant the user belongs to. */
export class PrismaAccessDataSource implements AccessDataSource {
  constructor(private readonly tenantClient: PrismaClient) {}

  async loadSnapshot(userId: string): Promise<AccessSnapshot> {
    return this.tenantClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { isActive: true }
      });
      if (!user || !user.isActive) {
        return { userIsActive: false, entities: [], assignments: [], rolePermissions: new Map() };
      }

      const [rows, entities] = await Promise.all([
        tx.roleAssignment.findMany({
          where: { userId },
          select: {
            scopeType: true,
            entityId: true,
            roleId: true,
            role: {
              select: { permissions: { select: { permission: { select: { code: true } } } } }
            }
          }
        }),
        tx.entity.findMany({ select: { id: true, parentId: true, isActive: true } })
      ]);

      const assignments: AccessAssignment[] = [];
      const rolePermissions = new Map<string, string[]>();
      for (const row of rows) {
        rolePermissions.set(
          row.roleId,
          row.role.permissions.map((rp) => rp.permission.code)
        );
        if (row.scopeType === "TENANT") {
          assignments.push({ scopeType: "TENANT", roleId: row.roleId });
        } else if (row.entityId !== null) {
          assignments.push({ scopeType: "ENTITY", roleId: row.roleId, entityId: row.entityId });
        }
        // An ENTITY row without an entity cannot exist (CHECK constraint); if
        // one ever did, it is skipped and grants nothing.
      }

      return { userIsActive: true, entities, assignments, rolePermissions };
    });
  }
}
