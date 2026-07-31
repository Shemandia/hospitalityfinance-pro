/**
 * useUserRole — Frontend permission-gating hook
 *
 * Reads user permissions and roles from the auth context and provides
 * permission-checking helpers for UI gating.
 *
 * Authorization is now permission-based. Role names are kept for
 * backward compatibility but the gate checks use granular permission codes.
 */

"use client";

import { useAuth } from "./auth-provider";

export type RoleLevel = "VIEWER" | "CONTROLLER" | "ADMIN" | "TENANT_ADMIN";

/**
 * Role priority for deriving the "highest" role label.
 * TENANT_ADMIN is the top-level role (replaces former SUPERADMIN).
 */
const ROLE_PRIORITY: Record<string, number> = {
  VIEWER: 0,
  CONTROLLER: 1,
  ADMIN: 2,
  TENANT_ADMIN: 3,
  // Legacy alias — treat any lingering SUPERADMIN token as TENANT_ADMIN
  SUPERADMIN: 3
};

function getHighestRole(roles: string[]): string {
  let highest = "VIEWER";
  let highestLevel = -1;

  for (const role of roles) {
    const upper = role.toUpperCase();
    const level = ROLE_PRIORITY[upper] ?? -1;
    if (level > highestLevel) {
      highestLevel = level;
      highest = upper === "SUPERADMIN" ? "TENANT_ADMIN" : upper;
    }
  }

  return highest;
}

// ── Permission-check helpers (pure functions) ────────────────────────────────

function _hasPermission(permissions: string[], code: string): boolean {
  return permissions.includes(code);
}

function _hasAnyPermission(permissions: string[], codes: string[]): boolean {
  return codes.some((c) => permissions.includes(c));
}

// ── Approval permission codes ────────────────────────────────────────────────
const APPROVE_PERMISSIONS = ["GL_POST", "GL_APPROVE", "AP_APPROVE", "BUDGET_APPROVE"];

export function useUserRole() {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const permissions = user?.permissions ?? [];
  const highestRole = getHighestRole(roles);

  /** Check if user has a specific permission code */
  const hasPermission = (code: string): boolean => _hasPermission(permissions, code);

  /** Check if user has any of the given permission codes */
  const hasAnyPermission = (codes: string[]): boolean => _hasAnyPermission(permissions, codes);

  return {
    /** Raw roles array from JWT */
    roles,

    /** Highest role in the hierarchy (for display / backward compat) */
    role: highestRole,

    /** Permission-based check helpers */
    hasPermission,
    hasAnyPermission,

    /** Can user perform write operations? (has any non-_READ permission) */
    canWrite: permissions.some((p) => !p.endsWith("_READ")),

    /** Can user post/approve journals and invoices? */
    canApprove: _hasAnyPermission(permissions, APPROVE_PERMISSIONS),

    /** Can user manage users / admin settings? */
    canAdmin: _hasPermission(permissions, "ADMIN_USERS"),

    /** Is user a tenant-level admin? (TENANT_ADMIN role) */
    isSuperAdmin: roles.some(
      (r) => r.toUpperCase() === "TENANT_ADMIN" || r.toUpperCase() === "SUPERADMIN"
    ),

    /** Alias — same as isSuperAdmin */
    isTenantAdmin: roles.some(
      (r) => r.toUpperCase() === "TENANT_ADMIN" || r.toUpperCase() === "SUPERADMIN"
    ),

    // ── Transfer Desk RBAC helpers ───────────────────────────────────────────

    /** Transfer Desk: view profiles, browse history, browse files */
    canTransferDeskUser: _hasPermission(permissions, "TRANSFER_DESK_READ"),

    /** Transfer Desk: run profiles with parameter overrides + cancel running executions */
    canTransferDeskPowerUser: _hasPermission(permissions, "TRANSFER_DESK_EXECUTE"),

    /** Transfer Desk: create/edit/delete profiles, formats, transformations, lookups, filters */
    canTransferDeskDesigner: _hasPermission(permissions, "TRANSFER_DESK_CONFIG"),

    /** Transfer Desk: config export/import/cleardown, folder permissions, all designer rights */
    canTransferDeskAdmin: _hasPermission(permissions, "TRANSFER_DESK_CONFIG"),

    /** Backward compat: check if user has at least the given role level */
    hasRole: (minRole: string) => {
      const minLevel = ROLE_PRIORITY[minRole.toUpperCase()] ?? 0;
      const userLevel = ROLE_PRIORITY[highestRole] ?? 0;
      return userLevel >= minLevel;
    },

    /** Backward compat: check if user has any of the given roles */
    hasAnyRole: (requiredRoles: string[]) =>
      requiredRoles.some((r) => roles.map((x: string) => x.toUpperCase()).includes(r.toUpperCase()))
  };
}
