/**
 * Admin Router — Role, Permission & User Management
 *
 * Endpoints:
 *   /api/v1/admin/roles               — CRUD for roles
 *   /api/v1/admin/permissions          — CRUD for permissions
 *   /api/v1/admin/roles/:id/permissions — Bind/unbind permissions to roles
 *   /api/v1/admin/users                — The users who can open the selected entity
 *   /api/v1/admin/users/:userId/roles  — Grant / revoke a role (tenant, group or property)
 *   /api/v1/admin/users/:userId/access — A user's grants and effective permissions
 *
 * Role and permission definitions are tenant-wide (ADMIN_ROLES_MANAGE held
 * through a tenant-wide assignment). User management is open to anyone holding
 * ADMIN_USERS at some entity; the service limits them to the entities and
 * privileges within their reach.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { changeAccess } from "../access/invalidation.js";
import { AccessInfrastructureError } from "../access/service.js";
import { NO_ACCESS } from "../access/resolver.js";
import {
  roleCreateSchema,
  roleUpdateSchema,
  permissionCreateSchema,
  rolePermissionSchema,
  userCreateSchema
} from "./types.js";
import * as svc from "./service.js";

const assignRoleSchema = z.object({
  roleId: z.string().uuid(),
  /** Grant at this entity; defaults to the entity selected for the request. */
  entityId: z.string().uuid().optional(),
  /** "TENANT" grants tenant-wide. */
  scope: z.literal("TENANT").optional()
});

const revokeRoleQuerySchema = z.object({ entityId: z.string().uuid().optional() });

const userStatusSchema = z.object({ isActive: z.boolean() });

const revokeScopeSchema = z.object({
  userId: z.string().uuid(),
  entityId: z.string().uuid(),
  cascade: z.boolean().default(false)
});

function mapError(reply: FastifyReply, error: unknown) {
  // Answered with 503 by the application's error handler, not with a 500 here.
  if (error instanceof AccessInfrastructureError) throw error;
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

type ScopeError =
  | "USER_NOT_FOUND"
  | "ROLE_NOT_FOUND"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_REQUIRED"
  | "FORBIDDEN";

const SCOPE_ERRORS: Record<ScopeError, { status: number; message: string }> = {
  USER_NOT_FOUND: { status: 404, message: "User not found." },
  ROLE_NOT_FOUND: { status: 404, message: "Role not found." },
  ENTITY_NOT_FOUND: { status: 404, message: "Entity not found." },
  ENTITY_REQUIRED: {
    status: 400,
    message: "Name the entity: send entityId, select an entity, or use scope TENANT."
  },
  FORBIDDEN: {
    status: 403,
    message:
      "You cannot manage users or entities outside your own scope, or grant privileges exceeding your own."
  }
};

function mapScopeError(reply: FastifyReply, error: ScopeError) {
  const { status, message } = SCOPE_ERRORS[error];
  return reply.code(status).send({ data: null, errors: [{ code: error, message }] });
}

/** Describes the caller to the admin service: resolved access, not token claims. */
function getActorContext(request: FastifyRequest): svc.AdminActorContext {
  return {
    userId: typeof request.user?.sub === "string" ? request.user.sub : undefined,
    // Without resolved access or an admitting guard the caller reaches nothing.
    access: request.access ?? NO_ACCESS,
    admittedBy: request.admittedBy ?? [],
    entityId: request.entityId
  };
}

/** The guard has already refused a request whose session has no tenant. */
function tenantIdOf(request: FastifyRequest): string {
  const tenantId = request.user?.tenantId;
  if (!tenantId) throw new Error("Admin route reached without a tenant.");
  return tenantId;
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
        async (request, reply) => {
          try {
            const data = await svc.listRoles(getActorContext(request));
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
            const data = await svc.getRoleById(request.params.id, getActorContext(request));
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
            const result = await changeAccess(tenantIdOf(request), "tenant", () =>
              svc.deleteRole(request.params.id)
            );
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
            await changeAccess(tenantIdOf(request), "tenant", () =>
              svc.deletePermission(request.params.id)
            );
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
            const data = await changeAccess(tenantIdOf(request), "tenant", () =>
              svc.bindPermissionToRole(request.params.id, permissionId)
            );
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
            await changeAccess(tenantIdOf(request), "tenant", () =>
              svc.unbindPermissionFromRole(request.params.id, request.params.permissionId)
            );
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Users who can open the selected entity ────────────────────────────

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

      // ── Assign role to user ──────────────────────────────────────────────
      router.post<{ Params: { userId: string } }>(
        "/users/:userId/roles",
        { preHandler: [requirePermission("ADMIN_USERS", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const { roleId, entityId, scope } = assignRoleSchema.parse(request.body);
            const userId = request.params.userId;
            const result = await changeAccess(tenantIdOf(request), { users: [userId] }, () =>
              svc.assignRoleToUser(userId, roleId, { entityId, scope }, getActorContext(request))
            );
            if ("error" in result) return mapScopeError(reply, result.error);
            return reply.code(201).send({ data: result.data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Revoke role from user ─────────────────────────────────────────────
      router.delete<{
        Params: { userId: string; roleId: string };
        Querystring: { entityId?: string };
      }>(
        "/users/:userId/roles/:roleId",
        { preHandler: [requirePermission("ADMIN_USERS", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const { entityId } = revokeRoleQuerySchema.parse(request.query);
            const { userId, roleId } = request.params;
            const result = await changeAccess(tenantIdOf(request), { users: [userId] }, () =>
              svc.revokeRoleFromUser(userId, roleId, { entityId }, getActorContext(request))
            );
            if ("error" in result) return mapScopeError(reply, result.error);
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
            if ("error" in result) return mapScopeError(reply, result.error);
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
            const userId = request.params.userId;
            await changeAccess(tenantIdOf(request), { users: [userId] }, () =>
              svc.removeEntityUser(entityId, userId)
            );
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
            // An invitation to an existing user changes that user's access.
            const existingUserId = await svc.findUserIdByEmail(payload.email);
            const data = await changeAccess(
              tenantIdOf(request),
              { users: existingUserId ? [existingUserId] : [] },
              () =>
                svc.inviteUser(
                  payload,
                  request.entityId,
                  {
                    tenantSlug: request.tenantSlug,
                    tenantCode: request.user?.tenantCode,
                    tenantName: request.tenantSlug
                      ?.replace(/-/g, " ")
                      .replace(/\b\w/g, (c: string) => c.toUpperCase())
                  },
                  getActorContext(request)
                )
            );
            if ("error" in data) return mapScopeError(reply, data.error);
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
        async (request, reply) => {
          try {
            const data = await svc.getEntityTree(getActorContext(request));
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Revoke every role at an entity (and below) ───────────────────────

      router.post(
        "/users/revoke-scope",
        { preHandler: [requirePermission("ADMIN_ENTITIES", { scope: "any-entity" })] },
        async (request, reply) => {
          try {
            const body = revokeScopeSchema.parse(request.body);
            const result = await changeAccess(tenantIdOf(request), { users: [body.userId] }, () =>
              svc.revokeScope(body.userId, body.entityId, body.cascade, getActorContext(request))
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
        "/users/:userId/access",
        {
          preHandler: [
            requirePermission(["ADMIN_USERS", "ADMIN_USERS_READ"], { scope: "any-entity" })
          ]
        },
        async (request, reply) => {
          try {
            const result = await svc.getUserAccess(
              request.params.userId,
              tenantIdOf(request),
              getActorContext(request)
            );
            if ("error" in result) return mapScopeError(reply, result.error);
            return reply.send({ data: result.data, errors: [] });
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
          const profile = await svc.getUserProfile(userId);
          if (!profile)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "USER_NOT_FOUND", message: "User not found." }]
            });
          const assignments = await svc.getOwnAssignments(userId);
          return reply.send({ data: { ...profile, assignments }, errors: [] });
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
            const { isActive } = userStatusSchema.parse(request.body);
            const userId = request.params.userId;
            // An inactive user holds no access; the change must apply at once.
            const result = await changeAccess(tenantIdOf(request), { users: [userId] }, () =>
              svc.updateUserStatus(userId, isActive, getActorContext(request))
            );
            if ("error" in result) return mapScopeError(reply, result.error);
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
