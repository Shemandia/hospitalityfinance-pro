/**
 * Admin Router — Role, Permission & User Management
 *
 * Endpoints:
 *   /api/v1/admin/roles               — CRUD for roles
 *   /api/v1/admin/permissions          — CRUD for permissions
 *   /api/v1/admin/roles/:id/permissions — Bind/unbind permissions to roles
 *   /api/v1/admin/users                — List/create entity users
 *   /api/v1/admin/users/:userId/role   — Update user's entity role
 *   /api/v1/admin/user-roles           — Assign/revoke UserRole records
 *
 * Role and permission definitions are tenant-wide (ADMIN_ROLES_MANAGE held
 * through a tenant-wide assignment). User management is open to anyone holding
 * ADMIN_USERS at some entity; the service limits them to the entities and
 * privileges within their reach.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { requireAuth } from "../../middleware/requireAuth.js";
import { permittedEntityIds, requirePermission } from "../../middleware/requirePermission.js";
import { getAccessService } from "../access/runtime.js";
import {
  roleCreateSchema,
  roleUpdateSchema,
  permissionCreateSchema,
  rolePermissionSchema,
  entityUserCreateSchema,
  userCreateSchema
} from "./types.js";
import * as svc from "./service.js";

const assignScopeSchema = z.object({
  userId: z.string().uuid(),
  entityId: z.string().uuid(),
  cascade: z.boolean().default(false)
});

const revokeScopeSchema = z.object({
  userId: z.string().uuid(),
  entityId: z.string().uuid(),
  cascade: z.boolean().default(false)
});

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  const code = (error as any)?.code === "P2002" ? "DUPLICATE" : "INTERNAL_SERVER_ERROR";
  const status = code === "DUPLICATE" ? 409 : 500;
  return reply.code(status).send({ data: null, errors: [{ code, message }] });
}

function requireEntityId(entityId: string | undefined): string {
  if (!entityId) throw new Error("X-Entity-ID header is required.");
  return entityId;
}

function mapScopeError(
  reply: FastifyReply,
  error: "USER_NOT_FOUND" | "FORBIDDEN" | "ROLE_NOT_FOUND"
) {
  if (error === "USER_NOT_FOUND" || error === "ROLE_NOT_FOUND") {
    const message = error === "USER_NOT_FOUND" ? "User not found." : "Role not found.";
    return reply.code(404).send({ data: null, errors: [{ code: error, message }] });
  }
  return reply.code(403).send({
    data: null,
    errors: [
      {
        code: error,
        message:
          "You cannot manage users outside your assigned entity scope or grant privileges exceeding your own."
      }
    ]
  });
}

/**
 * Describes the caller to the admin service, from resolved access.
 *
 * The caller's reach is the set of entities at which they hold the permission
 * that admitted them to the route. The permissions used for the privilege
 * ceiling are those held tenant-wide, or at the selected entity, or — with no
 * entity selected — only those held at every entity within reach.
 */
function getActorContext(request: FastifyRequest): svc.AdminActorContext {
  const userId = typeof request.user?.sub === "string" ? request.user.sub : undefined;
  const access = request.access;
  const admittedBy = request.admittedBy;
  if (!access || !admittedBy) {
    return {
      userId,
      tenantWide: false,
      permissions: [],
      entityIds: [],
      entityId: request.entityId
    };
  }

  const reach = permittedEntityIds(access, admittedBy);
  if (reach === "all") {
    return {
      userId,
      tenantWide: true,
      permissions: access.tenantPermissions,
      entityIds: [],
      entityId: request.entityId
    };
  }

  const selected = request.entityId;
  const permissionSets =
    selected && reach.includes(selected)
      ? [access.entityPermissions[selected] ?? []]
      : reach.map((entityId) => access.entityPermissions[entityId] ?? []);
  const [first = [], ...rest] = permissionSets;
  const permissions = first.filter((code) => rest.every((held) => held.includes(code)));

  return { userId, tenantWide: false, permissions, entityIds: reach, entityId: selected };
}

/** Role definitions changed: every user holding the role is affected. */
async function invalidateTenantAccess(request: FastifyRequest): Promise<void> {
  const tenantId = request.user?.tenantId;
  if (tenantId) await getAccessService().invalidateTenant(tenantId);
}

export async function registerAdminRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);

      // ── Roles ─────────────────────────────────────────────────────────────

      router.get(
        "/roles",
        {
          preHandler: [
            requirePermission(["ADMIN_USERS", "ADMIN_ROLES_MANAGE"], { scope: "any-entity" })
          ]
        },
        async (_request, reply) => {
          try {
            const data = await svc.listRoles();
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { id: string } }>(
        "/roles/:id",
        {
          preHandler: [
            requirePermission(["ADMIN_USERS", "ADMIN_ROLES_MANAGE"], { scope: "any-entity" })
          ]
        },
        async (request, reply) => {
          try {
            const data = await svc.getRoleById(request.params.id);
            if (!data)
              return reply
                .code(404)
                .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Role not found." }] });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/roles",
        { preHandler: [requirePermission("ADMIN_ROLES_MANAGE", { scope: "tenant" })] },
        async (request, reply) => {
          try {
            const payload = roleCreateSchema.parse(request.body);
            const data = await svc.createRole(payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.put<{ Params: { id: string } }>(
        "/roles/:id",
        { preHandler: [requirePermission("ADMIN_ROLES_MANAGE", { scope: "tenant" })] },
        async (request, reply) => {
          try {
            const payload = roleUpdateSchema.parse(request.body);
            const result = await svc.updateRole(request.params.id, payload);
            if ("error" in result)
              return reply
                .code(404)
                .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Role not found." }] });
            return reply.send({ data: result.data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/roles/:id",
        { preHandler: [requirePermission("ADMIN_ROLES_MANAGE", { scope: "tenant" })] },
        async (request, reply) => {
          try {
            const result = await svc.deleteRole(request.params.id);
            if ("error" in result) {
              if (result.error === "NOT_FOUND")
                return reply.code(404).send({
                  data: null,
                  errors: [{ code: "NOT_FOUND", message: "Role not found." }]
                });
              if (result.error === "SYSTEM_ROLE")
                return reply.code(403).send({
                  data: null,
                  errors: [{ code: "SYSTEM_ROLE", message: "Cannot delete system role." }]
                });
              if (result.error === "ROLE_IN_USE")
                return reply.code(409).send({
                  data: null,
                  errors: [
                    {
                      code: "ROLE_IN_USE",
                      message: `Cannot delete role with ${result.userCount} assigned user(s). Reassign users first.`
                    }
                  ]
                });
            }
            await invalidateTenantAccess(request);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Permissions ───────────────────────────────────────────────────────

      router.get(
        "/permissions",
        {
          preHandler: [
            requirePermission(["ADMIN_USERS", "ADMIN_ROLES_MANAGE"], { scope: "any-entity" })
          ]
        },
        async (_request, reply) => {
          try {
            const data = await svc.listPermissions();
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/permissions",
        { preHandler: [requirePermission("ADMIN_ROLES_MANAGE", { scope: "tenant" })] },
        async (request, reply) => {
          try {
            const payload = permissionCreateSchema.parse(request.body);
            const data = await svc.createPermission(payload);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string } }>(
        "/permissions/:id",
        { preHandler: [requirePermission("ADMIN_ROLES_MANAGE", { scope: "tenant" })] },
        async (request, reply) => {
          try {
            await svc.deletePermission(request.params.id);
            await invalidateTenantAccess(request);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Role-Permission bindings ──────────────────────────────────────────

      router.post<{ Params: { id: string } }>(
        "/roles/:id/permissions",
        { preHandler: [requirePermission("ADMIN_ROLES_MANAGE", { scope: "tenant" })] },
        async (request, reply) => {
          try {
            const { permissionId } = rolePermissionSchema
              .omit({ roleId: true })
              .extend({
                permissionId: rolePermissionSchema.shape.permissionId
              })
              .parse(request.body);
            const data = await svc.bindPermissionToRole(request.params.id, permissionId);
            await invalidateTenantAccess(request);
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { id: string; permissionId: string } }>(
        "/roles/:id/permissions/:permissionId",
        { preHandler: [requirePermission("ADMIN_ROLES_MANAGE", { scope: "tenant" })] },
        async (request, reply) => {
          try {
            await svc.unbindPermissionFromRole(request.params.id, request.params.permissionId);
            await invalidateTenantAccess(request);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Entity Users (per-entity role management) ─────────────────────────

      router.get(
        "/users",
        { preHandler: [requirePermission(["ADMIN_USERS", "ADMIN_USERS_READ"])] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const data = await svc.listEntityUsers(entityId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/users",
        { preHandler: [requirePermission("ADMIN_USERS")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            const payload = entityUserCreateSchema.parse(request.body);
            const result = await svc.addEntityUser(entityId, payload.userId);
            if ("error" in result)
              return reply.code(404).send({
                data: null,
                errors: [{ code: "USER_NOT_FOUND", message: "User not found." }]
              });
            return reply.code(201).send({ data: result.data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Assign role to user ──────────────────────────────────────────────
      router.post<{ Params: { userId: string } }>(
        "/users/:userId/roles",
        { preHandler: [requirePermission("ADMIN_USERS", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const { roleId } = z.object({ roleId: z.string().uuid() }).parse(request.body);
            const result = await svc.assignRoleToUser(
              request.params.userId,
              roleId,
              getActorContext(request)
            );
            if ("error" in result && result.error) return mapScopeError(reply, result.error);
            return reply.code(201).send({ data: result.data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Revoke role from user ─────────────────────────────────────────────
      router.delete<{ Params: { userId: string; roleId: string } }>(
        "/users/:userId/roles/:roleId",
        { preHandler: [requirePermission("ADMIN_USERS", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const result = await svc.revokeRoleFromUser(
              request.params.userId,
              request.params.roleId,
              getActorContext(request)
            );
            if ("error" in result && result.error) return mapScopeError(reply, result.error);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Get user's roles ──────────────────────────────────────────────────
      router.get<{ Params: { userId: string } }>(
        "/users/:userId/roles",
        {
          preHandler: [
            requirePermission(["ADMIN_USERS", "ADMIN_USERS_READ"], { scope: "any-entity" })
          ]
        },
        async (request, reply) => {
          try {
            const result = await svc.getUserRoles(request.params.userId, getActorContext(request));
            if ("error" in result && result.error) return mapScopeError(reply, result.error);
            return reply.send({ data: result.data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.delete<{ Params: { userId: string } }>(
        "/users/:userId",
        { preHandler: [requirePermission("ADMIN_USERS")] },
        async (request, reply) => {
          try {
            const entityId = requireEntityId(request.entityId);
            await svc.removeEntityUser(entityId, request.params.userId);
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Create user + assign to entity + assign role ───────────────────

      router.post(
        "/users/invite",
        { preHandler: [requirePermission("ADMIN_USERS", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const payload = userCreateSchema.parse(request.body);
            const data = await svc.inviteUser(
              payload,
              request.entityId,
              {
                tenantSlug: request.tenantSlug,
                tenantCode: (request.user as any)?.tenantCode,
                tenantName: request.tenantSlug
                  ?.replace(/-/g, " ")
                  .replace(/\b\w/g, (c: string) => c.toUpperCase())
              },
              getActorContext(request)
            );
            if ("error" in data) {
              const status = data.error === "FORBIDDEN" ? 403 : 404;
              const msg =
                data.error === "FORBIDDEN"
                  ? "You cannot invite users into entities outside your assigned entity scope."
                  : "Entity not found.";
              return reply.code(status).send({
                data: null,
                errors: [{ code: data.error, message: msg }]
              });
            }
            return reply.code(201).send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── All users within the caller's reach ────────────────────────────────

      router.get(
        "/all-users",
        { preHandler: [requirePermission("ADMIN_ENTITIES", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const data = await svc.listAllUsers(getActorContext(request));
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Entity Hierarchy (scope levels) ─────────────────────────────────────

      router.get(
        "/entity-tree",
        {
          preHandler: [
            requirePermission(["ADMIN_USERS", "ADMIN_ENTITIES"], { scope: "any-entity" })
          ]
        },
        async (_request, reply) => {
          try {
            const data = await svc.getEntityTree();
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Scope-aware user assignment ───────────────────────────────────────

      router.post(
        "/users/assign-scope",
        { preHandler: [requirePermission("ADMIN_ENTITIES", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const body = assignScopeSchema.parse(request.body);
            const result = await svc.assignScope(
              body.userId,
              body.entityId,
              body.cascade,
              getActorContext(request)
            );
            if ("error" in result) {
              const status = result.error === "FORBIDDEN" ? 403 : 404;
              const msg =
                result.error === "USER_NOT_FOUND"
                  ? "User not found."
                  : result.error === "FORBIDDEN"
                    ? "You cannot manage access outside your assigned entity scope."
                    : "Entity not found.";
              return reply.code(status).send({
                data: null,
                errors: [{ code: result.error, message: msg }]
              });
            }
            return reply.code(201).send({ data: result.data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post(
        "/users/revoke-scope",
        { preHandler: [requirePermission("ADMIN_ENTITIES", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const body = revokeScopeSchema.parse(request.body);
            const result = await svc.revokeScope(
              body.userId,
              body.entityId,
              body.cascade,
              getActorContext(request)
            );
            if ("error" in result) {
              const status = result.error === "FORBIDDEN" ? 403 : 404;
              const msg =
                result.error === "FORBIDDEN"
                  ? "You cannot manage access outside your assigned entity scope."
                  : "Entity not found.";
              return reply.code(status).send({
                data: null,
                errors: [{ code: result.error, message: msg }]
              });
            }
            return reply.send({ data: result.data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get<{ Params: { userId: string } }>(
        "/users/:userId/entities",
        {
          preHandler: [
            requirePermission(["ADMIN_USERS", "ADMIN_USERS_READ"], { scope: "any-entity" })
          ]
        },
        async (request, reply) => {
          try {
            const data = await svc.getUserEntities(request.params.userId, getActorContext(request));
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── User Profile (own profile, any role) ──────────────────────────────

      router.get("/profile", { config: { access: "session" } }, async (request, reply) => {
        try {
          const userId = typeof request.user?.sub === "string" ? request.user.sub : null;
          if (!userId)
            return reply
              .code(401)
              .send({ data: null, errors: [{ code: "NO_USER", message: "Not authenticated." }] });
          const data = await svc.getUserProfile(userId);
          if (!data)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "USER_NOT_FOUND", message: "User not found." }]
            });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put("/profile", { config: { access: "session" } }, async (request, reply) => {
        try {
          const userId = typeof request.user?.sub === "string" ? request.user.sub : null;
          if (!userId)
            return reply
              .code(401)
              .send({ data: null, errors: [{ code: "NO_USER", message: "Not authenticated." }] });
          const body = request.body as {
            name?: string;
            phone?: string;
            jobTitle?: string;
            department?: string;
          };
          const data = await svc.updateUserProfile(userId, body);
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Login Audit ─────────────────────────────────────────────────────────

      router.post(
        "/login-audit",
        { preHandler: [requirePermission("ADMIN_USERS", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const body = request.body as {
              userId: string;
              email: string;
              action: string;
              ipAddress?: string;
              userAgent?: string;
              entityId?: string;
              metadata?: Record<string, unknown>;
            };
            const result = await svc.createLoginAudit(
              {
                ...body,
                entityId: body.entityId ?? request.entityId
              },
              getActorContext(request)
            );
            if ("error" in result) {
              const status = result.error === "FORBIDDEN" ? 403 : 400;
              const msg =
                result.error === "ENTITY_REQUIRED"
                  ? "Entity context is required for login audit writes."
                  : result.error === "FORBIDDEN"
                    ? "You cannot create login audit rows outside your assigned entity scope."
                    : "Entity not found.";
              return reply.code(status).send({
                data: null,
                errors: [{ code: result.error, message: msg }]
              });
            }
            return reply.code(201).send({ data: result.data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.get(
        "/login-audit",
        {
          preHandler: [
            requirePermission(["ADMIN_AUDIT_LOG", "ADMIN_USERS"], { scope: "any-entity" })
          ]
        },
        async (request, reply) => {
          try {
            const { userId, email, limit, entityId } = request.query as {
              userId?: string;
              email?: string;
              limit?: string;
              entityId?: string;
            };
            const result = await svc.listLoginAudits(
              {
                userId,
                email,
                entityId,
                limit: limit ? parseInt(limit, 10) : undefined
              },
              getActorContext(request)
            );
            if ("error" in result) {
              return reply.code(403).send({
                data: null,
                errors: [
                  {
                    code: result.error,
                    message: "You cannot list login audit rows outside your assigned entity scope."
                  }
                ]
              });
            }
            return reply.send({ data: result, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── User Deactivation ───────────────────────────────────────────────────

      router.put<{ Params: { userId: string } }>(
        "/users/:userId/status",
        { preHandler: [requirePermission("ADMIN_USERS", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const body = request.body as { isActive: boolean };
            const result = await svc.updateUserStatus(
              request.params.userId,
              body.isActive,
              getActorContext(request)
            );
            if ("error" in result && result.error) return mapScopeError(reply, result.error);
            // An inactive user holds no access; the change must apply at once.
            const tenantId = request.user?.tenantId;
            if (tenantId) {
              await getAccessService().invalidateUser({ tenantId, userId: request.params.userId });
            }
            return reply.send({ data: result.data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── User Detail (admin view) ────────────────────────────────────────────

      router.get<{ Params: { userId: string } }>(
        "/users/:userId/detail",
        {
          preHandler: [
            requirePermission(["ADMIN_USERS", "ADMIN_USERS_READ"], { scope: "any-entity" })
          ]
        },
        async (request, reply) => {
          try {
            const data = await svc.getUserDetail(request.params.userId, getActorContext(request));
            if (data && "error" in data) {
              return reply.code(403).send({
                data: null,
                errors: [
                  {
                    code: data.error,
                    message: "You cannot view user detail outside your assigned entity scope."
                  }
                ]
              });
            }
            if (!data)
              return reply
                .code(404)
                .send({ data: null, errors: [{ code: "NOT_FOUND", message: "User not found." }] });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1/admin" }
  );
}
