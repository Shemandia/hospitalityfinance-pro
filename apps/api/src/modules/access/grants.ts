/**
 * Role grants — the only code that writes role_assignments (WP-A).
 *
 * A grant gives a user a role either tenant-wide or at one entity, from where
 * it reaches every entity below. Every function here must be called with a
 * transaction opened by withBypassRLS: the table is readable and writable only
 * with the bypass set, so a caller that forgets it gets an error or no rows,
 * never a silent success.
 *
 * Callers decide whether the administrator may make the change; this module
 * only records it. After the transaction commits the caller must invalidate
 * the access cache — see changeAccess in ./invalidation.ts.
 */

import type { Prisma } from "../../db/client.js";

type Tx = Prisma.TransactionClient;

export type GrantTarget = { scope: "TENANT" } | { scope: "ENTITY"; entityId: string };

export type Grant = {
  id: string;
  userId: string;
  roleId: string;
  scopeType: "TENANT" | "ENTITY";
  entityId: string | null;
};

const GRANT_FIELDS = {
  id: true,
  userId: true,
  roleId: true,
  scopeType: true,
  entityId: true
} as const;

/** Records the grant. Granting what is already granted changes nothing. */
export async function grantRole(
  tx: Tx,
  userId: string,
  roleId: string,
  target: GrantTarget
): Promise<void> {
  const entityId = target.scope === "ENTITY" ? target.entityId : null;
  // Raw so that a duplicate is absorbed by the unique index (which also treats
  // two tenant-wide rows as equal) instead of being checked first and raced.
  await tx.$executeRaw`
    INSERT INTO role_assignments (id, user_id, role_id, scope_type, entity_id, created_at)
    VALUES (gen_random_uuid()::text, ${userId}, ${roleId},
            ${target.scope}::"AssignmentScope", ${entityId}, now())
    ON CONFLICT DO NOTHING`;
}

export type GrantFilter = {
  userId?: string;
  roleId?: string;
  /**
   * "all": every grant, tenant-wide ones included.
   * "tenant": tenant-wide grants only.
   * a list: grants at exactly these entities.
   */
  at: "all" | "tenant" | readonly string[];
};

function whereOf(filter: GrantFilter): Prisma.RoleAssignmentWhereInput {
  return {
    ...(filter.userId !== undefined ? { userId: filter.userId } : {}),
    ...(filter.roleId !== undefined ? { roleId: filter.roleId } : {}),
    ...(filter.at === "all"
      ? {}
      : filter.at === "tenant"
        ? { scopeType: "TENANT" as const }
        : { scopeType: "ENTITY" as const, entityId: { in: [...filter.at] } })
  };
}

export async function listGrants(tx: Tx, filter: GrantFilter): Promise<Grant[]> {
  return tx.roleAssignment.findMany({
    where: whereOf(filter),
    select: GRANT_FIELDS,
    orderBy: { createdAt: "asc" }
  });
}

/** Removes the matching grants and returns the users who lost one. */
export async function revokeGrants(tx: Tx, filter: GrantFilter): Promise<string[]> {
  const doomed = await tx.roleAssignment.findMany({
    where: whereOf(filter),
    select: { id: true, userId: true }
  });
  if (doomed.length === 0) return [];
  await tx.roleAssignment.deleteMany({ where: { id: { in: doomed.map((row) => row.id) } } });
  return [...new Set(doomed.map((row) => row.userId))];
}
