/**
 * Loads the access snapshot for one user from a tenant database.
 *
 * role_assignments is readable only with the RLS bypass set (see migration
 * 20261111000000_role_assignments), and the entity tree must be read whole
 * regardless of the entity selected for the request, so the snapshot is read
 * in one withBypassRLS transaction. Nothing else in the API should read
 * role_assignments.
 */

import type { Prisma, PrismaClient } from "../../db/client.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import type { AccessAssignment } from "./resolver.js";
import type { AccessDataSource, AccessSnapshot } from "./service.js";

/** The tenant client must be the one bound to the tenant the user belongs to. */
export class PrismaAccessDataSource implements AccessDataSource {
  constructor(private readonly tenantClient: Pick<PrismaClient, "$transaction">) {}

  async loadSnapshot(userId: string): Promise<AccessSnapshot> {
    return withBypassRLS(this.tenantClient, async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { isActive: true }
      });
      if (!user || !user.isActive) {
        return { userIsActive: false, entities: [], assignments: [], rolePermissions: new Map() };
      }

      const rows = await tx.roleAssignment.findMany({
        where: { userId },
        select: {
          scopeType: true,
          entityId: true,
          roleId: true,
          role: {
            select: { permissions: { select: { permission: { select: { code: true } } } } }
          }
        }
      });
      const entities = await tx.entity.findMany({
        select: { id: true, parentId: true, isActive: true }
      });

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
