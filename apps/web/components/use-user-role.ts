/**
 * useUserRole — Frontend role-gating hook
 *
 * Reads user roles from NextAuth session and provides
 * permission-checking helpers for UI gating.
 *
 * Role hierarchy:
 *   VIEWER       → Read-only
 *   CONTROLLER   → Can post/approve journals, close periods
 *   ADMIN        → Full module access, imports, payment runs
 *   SUPERADMIN   → Cross-entity, system config
 */

"use client";

import { useSession } from "next-auth/react";

export type RoleLevel = "VIEWER" | "CONTROLLER" | "ADMIN" | "SUPERADMIN";

const ROLE_HIERARCHY: Record<string, number> = {
  VIEWER: 0,
  CONTROLLER: 1,
  ADMIN: 2,
  SUPERADMIN: 3
};

function getHighestRole(roles: string[]): RoleLevel {
  let highest: RoleLevel = "VIEWER";
  let highestLevel = -1;

  for (const role of roles) {
    const upper = role.toUpperCase();
    const level = ROLE_HIERARCHY[upper] ?? -1;
    if (level > highestLevel) {
      highestLevel = level;
      highest = upper as RoleLevel;
    }
  }

  return highest;
}

export function useUserRole() {
  const { data: session } = useSession();
  const roles = session?.user?.roles ?? [];
  const highestRole = getHighestRole(roles);
  const roleLevel = ROLE_HIERARCHY[highestRole] ?? 0;

  return {
    /** Raw roles array from JWT */
    roles,

    /** Highest role in the hierarchy */
    role: highestRole,

    /** Numeric role level (0=VIEWER, 1=CONTROLLER, 2=ADMIN, 3=SUPERADMIN) */
    roleLevel,

    /** Can user perform write operations (create, edit, delete)? */
    canWrite: roleLevel >= ROLE_HIERARCHY.CONTROLLER,

    /** Can user post/approve journals and invoices? */
    canApprove: roleLevel >= ROLE_HIERARCHY.CONTROLLER,

    /** Can user run imports, manage settings, confirm payments? */
    canAdmin: roleLevel >= ROLE_HIERARCHY.ADMIN,

    /** Can user perform cross-entity operations (reopen periods, system config)? */
    isSuperAdmin: roleLevel >= ROLE_HIERARCHY.SUPERADMIN,

    /** Check if user has at least the given role level */
    hasRole: (minRole: RoleLevel) => roleLevel >= (ROLE_HIERARCHY[minRole] ?? 0),

    /** Check if user has any of the given roles */
    hasAnyRole: (requiredRoles: string[]) =>
      requiredRoles.some((r) => roles.map((x: string) => x.toUpperCase()).includes(r.toUpperCase()))
  };
}
