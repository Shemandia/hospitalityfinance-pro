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

    // ── Transfer Desk RBAC helpers (Self-Service Designer spec §15) ──────────
    //
    // The spec defines 4 Transfer-Desk-specific roles as a Keycloak realm role
    // namespace (transfer:user / power-user / designer / admin). Until those
    // realm roles are provisioned in Keycloak, we map them onto the existing
    // 4-level financial hierarchy:
    //
    //   transfer:user        ← VIEWER+      view profiles, browse history, browse files
    //   transfer:power-user  ← CONTROLLER+  + run profiles (with parameter overrides), cancel runs
    //   transfer:designer    ← ADMIN+       + create/edit/delete profiles, formats, transformations, lookups, filters
    //   transfer:admin       ← ADMIN+       + config export/import/cleardown, folder permissions
    //
    // (designer and admin both map to ADMIN today because Transfer Desk admin
    //  operations are tenant-scoped, not cross-entity. SUPERADMIN remains
    //  reserved for cross-entity ops like reopening locked periods.)
    //
    // When the Keycloak realm roles ship, replace the right-hand side with
    // hasAnyRole(["transfer:user", ...]) etc. and keep the helper names stable.

    /** Transfer Desk: view profiles, browse history, browse files */
    canTransferDeskUser: roleLevel >= ROLE_HIERARCHY.VIEWER,

    /** Transfer Desk: run profiles with parameter overrides + cancel running executions */
    canTransferDeskPowerUser: roleLevel >= ROLE_HIERARCHY.CONTROLLER,

    /** Transfer Desk: create/edit/delete profiles, formats, transformations, lookups, filters */
    canTransferDeskDesigner: roleLevel >= ROLE_HIERARCHY.ADMIN,

    /** Transfer Desk: config export/import/cleardown, folder permissions, all designer rights */
    canTransferDeskAdmin: roleLevel >= ROLE_HIERARCHY.ADMIN,

    /** Check if user has at least the given role level */
    hasRole: (minRole: RoleLevel) => roleLevel >= (ROLE_HIERARCHY[minRole] ?? 0),

    /** Check if user has any of the given roles */
    hasAnyRole: (requiredRoles: string[]) =>
      requiredRoles.some((r) => roles.map((x: string) => x.toUpperCase()).includes(r.toUpperCase()))
  };
}
