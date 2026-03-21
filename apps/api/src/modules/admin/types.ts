import { z } from "zod";

// ── Role ────────────────────────────────────────────────────────────────────

export const roleCreateSchema = z.object({
  code: z.string().min(1).max(50).toUpperCase(),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional()
});

export const roleUpdateSchema = roleCreateSchema.partial();

// ── Permission ──────────────────────────────────────────────────────────────

export const permissionCreateSchema = z.object({
  code: z.string().min(1).max(100).toUpperCase(),
  description: z.string().max(500).optional()
});

// ── Role-Permission binding ─────────────────────────────────────────────────

export const rolePermissionSchema = z.object({
  roleId: z.string().uuid(),
  permissionId: z.string().uuid()
});

// ── User-Role assignment ────────────────────────────────────────────────────

export const userRoleAssignSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  entityId: z.string().uuid().optional()
});

// ── Entity User update ──────────────────────────────────────────────────────

export const entityUserUpdateSchema = z.object({
  role: z.enum(["VIEWER", "CONTROLLER", "ADMIN", "SUPERADMIN"])
});

export const entityUserCreateSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["VIEWER", "CONTROLLER", "ADMIN", "SUPERADMIN"]).default("VIEWER")
});

// ── User create (for entity admin) ──────────────────────────────────────────

export const userCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  role: z.enum(["VIEWER", "CONTROLLER", "ADMIN", "SUPERADMIN"]).default("VIEWER")
});

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;
export type PermissionCreateInput = z.infer<typeof permissionCreateSchema>;
export type UserRoleAssignInput = z.infer<typeof userRoleAssignSchema>;
export type EntityUserUpdateInput = z.infer<typeof entityUserUpdateSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
