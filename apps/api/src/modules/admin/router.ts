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
 * All endpoints require ADMIN or SUPERADMIN role.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z, ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  roleCreateSchema,
  roleUpdateSchema,
  permissionCreateSchema,
  rolePermissionSchema,
  userRoleAssignSchema,
  entityUserUpdateSchema,
  entityUserCreateSchema,
  userCreateSchema
} from "./types.js";

const assignScopeSchema = z.object({
  userId: z.string().uuid(),
  entityId: z.string().uuid(),
  role: z.enum(["VIEWER", "CONTROLLER", "ADMIN", "SUPERADMIN"]),
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

const db = prisma as unknown as PrismaClient;

/** Recursively get all descendant entity IDs (children, grandchildren, etc.) */
async function getDescendants(prismaClient: PrismaClient, parentId: string): Promise<string[]> {
  const children = await prismaClient.entity.findMany({
    where: { parentId },
    select: { id: true }
  });
  const ids: string[] = [];
  for (const child of children) {
    ids.push(child.id);
    const grandchildren = await getDescendants(prismaClient, child.id);
    ids.push(...grandchildren);
  }
  return ids;
}

export async function registerAdminRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requireRole(["ADMIN", "SUPERADMIN"]));

      // ── Roles ─────────────────────────────────────────────────────────────

      router.get("/roles", async (_request, reply) => {
        try {
          const data = await db.role.findMany({
            include: { _count: { select: { permissions: true, users: true } } },
            orderBy: { code: "asc" }
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>("/roles/:id", async (request, reply) => {
        try {
          const data = await db.role.findUnique({
            where: { id: request.params.id },
            include: {
              permissions: { include: { permission: true } },
              users: { include: { user: { select: { id: true, name: true, email: true } } } }
            }
          });
          if (!data)
            return reply
              .code(404)
              .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Role not found." }] });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/roles", async (request, reply) => {
        try {
          const payload = roleCreateSchema.parse(request.body);
          const data = await db.role.create({ data: payload });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { id: string } }>("/roles/:id", async (request, reply) => {
        try {
          const payload = roleUpdateSchema.parse(request.body);
          const data = await db.role.update({
            where: { id: request.params.id },
            data: payload
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { id: string } }>("/roles/:id", async (request, reply) => {
        try {
          // Check no users assigned
          const userCount = await db.userRole.count({ where: { roleId: request.params.id } });
          if (userCount > 0) {
            return reply.code(409).send({
              data: null,
              errors: [
                {
                  code: "ROLE_IN_USE",
                  message: `Cannot delete role with ${userCount} assigned user(s). Reassign users first.`
                }
              ]
            });
          }
          await db.rolePermission.deleteMany({ where: { roleId: request.params.id } });
          await db.role.delete({ where: { id: request.params.id } });
          return reply.code(204).send();
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Permissions ───────────────────────────────────────────────────────

      router.get("/permissions", async (_request, reply) => {
        try {
          const data = await db.permission.findMany({
            include: { _count: { select: { roles: true } } },
            orderBy: { code: "asc" }
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/permissions", async (request, reply) => {
        try {
          const payload = permissionCreateSchema.parse(request.body);
          const data = await db.permission.create({ data: payload });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { id: string } }>("/permissions/:id", async (request, reply) => {
        try {
          await db.rolePermission.deleteMany({ where: { permissionId: request.params.id } });
          await db.permission.delete({ where: { id: request.params.id } });
          return reply.code(204).send();
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Role-Permission bindings ──────────────────────────────────────────

      router.post<{ Params: { id: string } }>("/roles/:id/permissions", async (request, reply) => {
        try {
          const { permissionId } = rolePermissionSchema
            .omit({ roleId: true })
            .extend({
              permissionId: rolePermissionSchema.shape.permissionId
            })
            .parse(request.body);
          const data = await db.rolePermission.create({
            data: { roleId: request.params.id, permissionId }
          });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { id: string; permissionId: string } }>(
        "/roles/:id/permissions/:permissionId",
        async (request, reply) => {
          try {
            await db.rolePermission.delete({
              where: {
                roleId_permissionId: {
                  roleId: request.params.id,
                  permissionId: request.params.permissionId
                }
              }
            });
            return reply.code(204).send();
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── Entity Users (per-entity role management) ─────────────────────────

      router.get("/users", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const data = await db.entityUser.findMany({
            where: { entityId },
            include: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { createdAt: "asc" }
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.post("/users", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = entityUserCreateSchema.parse(request.body);

          // Verify user exists
          const user = await db.user.findUnique({ where: { id: payload.userId } });
          if (!user)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "USER_NOT_FOUND", message: "User not found." }]
            });

          const data = await db.entityUser.create({
            data: { entityId, userId: payload.userId, role: payload.role as any },
            include: { user: { select: { id: true, name: true, email: true } } }
          });
          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put<{ Params: { userId: string } }>("/users/:userId/role", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = entityUserUpdateSchema.parse(request.body);
          const data = await db.entityUser.update({
            where: { entityId_userId: { entityId, userId: request.params.userId } },
            data: { role: payload.role as any },
            include: { user: { select: { id: true, name: true, email: true } } }
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.delete<{ Params: { userId: string } }>("/users/:userId", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          await db.entityUser.delete({
            where: { entityId_userId: { entityId, userId: request.params.userId } }
          });
          return reply.code(204).send();
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── User invite (create user + assign to entity) ──────────────────────

      router.post("/users/invite", async (request, reply) => {
        try {
          const entityId = requireEntityId(request.entityId);
          const payload = userCreateSchema.parse(request.body);

          // Upsert user (may already exist in another entity)
          // keycloakId placeholder — will be updated when user registers in Keycloak
          const user = await db.user.upsert({
            where: { email: payload.email },
            create: {
              email: payload.email,
              name: payload.name,
              keycloakId: `pending-${Date.now()}`
            },
            update: { name: payload.name }
          });

          // Assign to entity
          const entityUser = await db.entityUser.upsert({
            where: { entityId_userId: { entityId, userId: user.id } },
            create: { entityId, userId: user.id, role: payload.role as any },
            update: { role: payload.role as any },
            include: { user: { select: { id: true, name: true, email: true } } }
          });

          return reply.code(201).send({ data: entityUser, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── All system users (SUPERADMIN only) ────────────────────────────────

      router.get(
        "/all-users",
        {
          preHandler: [requireRole(["SUPERADMIN"])]
        },
        async (_request, reply) => {
          try {
            const data = await db.user.findMany({
              select: { id: true, name: true, email: true, createdAt: true },
              orderBy: { name: "asc" }
            });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
      // ── Entity Hierarchy (scope levels) ─────────────────────────────────────

      router.get("/entity-tree", async (request, reply) => {
        try {
          // Return full entity hierarchy tree for assignment UI
          const allEntities = await db.entity.findMany({
            select: {
              id: true,
              name: true,
              code: true,
              type: true,
              parentId: true,
              isActive: true,
              functionalCurrency: true,
              _count: { select: { children: true, users: true } }
            },
            orderBy: [{ type: "asc" }, { name: "asc" }]
          });

          // Build tree structure
          const entityMap = new Map(
            allEntities.map((e) => [e.id, { ...e, children: [] as typeof allEntities }])
          );
          const roots: typeof allEntities = [];
          for (const entity of allEntities) {
            if (entity.parentId && entityMap.has(entity.parentId)) {
              (entityMap.get(entity.parentId) as any).children.push(entityMap.get(entity.id));
            } else {
              roots.push(entityMap.get(entity.id) as any);
            }
          }

          return reply.send({ data: { flat: allEntities, tree: roots }, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Scope-aware user assignment ───────────────────────────────────────

      /**
       * Assign a user to an entity AND all its descendants.
       * - Assigning at CORPORATE → user gets access to all CLUSTERs + PROPERTYs
       * - Assigning at CLUSTER → user gets access to all PROPERTYs in cluster
       * - Assigning at PROPERTY → user gets access to that property only
       */
      router.post(
        "/users/assign-scope",
        {
          preHandler: [requireRole(["SUPERADMIN"])]
        },
        async (request, reply) => {
          try {
            const body = assignScopeSchema.parse(request.body);

            const user = await db.user.findUnique({ where: { id: body.userId } });
            if (!user)
              return reply.code(404).send({
                data: null,
                errors: [{ code: "USER_NOT_FOUND", message: "User not found." }]
              });

            const targetEntity = await db.entity.findUnique({
              where: { id: body.entityId },
              select: { id: true, name: true, type: true }
            });
            if (!targetEntity)
              return reply.code(404).send({
                data: null,
                errors: [{ code: "ENTITY_NOT_FOUND", message: "Entity not found." }]
              });

            // Collect all entity IDs to assign
            const entityIds: string[] = [body.entityId];

            if (body.cascade) {
              // Get all descendants recursively
              const descendants = await getDescendants(db, body.entityId);
              entityIds.push(...descendants);
            }

            // Upsert EntityUser for each entity
            let assigned = 0;
            for (const eid of entityIds) {
              await db.entityUser.upsert({
                where: { entityId_userId: { entityId: eid, userId: body.userId } },
                create: { entityId: eid, userId: body.userId, role: body.role as any },
                update: { role: body.role as any }
              });
              assigned++;
            }

            return reply.code(201).send({
              data: {
                userId: body.userId,
                role: body.role,
                assignedEntities: assigned,
                scope: targetEntity.type,
                cascade: body.cascade
              },
              errors: []
            });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      /**
       * Remove a user from an entity AND optionally all its descendants.
       */
      router.post(
        "/users/revoke-scope",
        {
          preHandler: [requireRole(["SUPERADMIN"])]
        },
        async (request, reply) => {
          try {
            const body = revokeScopeSchema.parse(request.body);

            const entityIds: string[] = [body.entityId];
            if (body.cascade) {
              const descendants = await getDescendants(db, body.entityId);
              entityIds.push(...descendants);
            }

            const result = await db.entityUser.deleteMany({
              where: { userId: body.userId, entityId: { in: entityIds } }
            });

            return reply.send({
              data: { removedFrom: result.count, cascade: body.cascade },
              errors: []
            });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      /**
       * Get all entity assignments for a specific user (across all entities).
       */
      router.get<{ Params: { userId: string } }>(
        "/users/:userId/entities",
        async (request, reply) => {
          try {
            const data = await db.entityUser.findMany({
              where: { userId: request.params.userId },
              include: {
                entity: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    type: true,
                    parentId: true,
                    isActive: true
                  }
                }
              },
              orderBy: { createdAt: "asc" }
            });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── User Profile (own profile, any role) ──────────────────────────────

      router.get("/profile", async (request, reply) => {
        try {
          const userId = typeof request.user?.sub === "string" ? request.user.sub : null;
          if (!userId)
            return reply
              .code(401)
              .send({ data: null, errors: [{ code: "NO_USER", message: "Not authenticated." }] });

          const user = await db.user.findUnique({
            where: { id: userId },
            select: {
              id: true,
              email: true,
              name: true,
              phone: true,
              jobTitle: true,
              department: true,
              avatarUrl: true,
              isActive: true,
              lastLoginAt: true,
              loginCount: true,
              createdAt: true,
              entities: {
                include: { entity: { select: { id: true, name: true, type: true } } }
              }
            }
          });
          if (!user)
            return reply.code(404).send({
              data: null,
              errors: [{ code: "USER_NOT_FOUND", message: "User not found." }]
            });
          return reply.send({ data: user, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.put("/profile", async (request, reply) => {
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

          const data = await db.user.update({
            where: { id: userId },
            data: {
              ...(body.name !== undefined && { name: body.name }),
              ...(body.phone !== undefined && { phone: body.phone }),
              ...(body.jobTitle !== undefined && { jobTitle: body.jobTitle }),
              ...(body.department !== undefined && { department: body.department })
            },
            select: {
              id: true,
              email: true,
              name: true,
              phone: true,
              jobTitle: true,
              department: true
            }
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── Login Audit ─────────────────────────────────────────────────────────

      router.post("/login-audit", async (request, reply) => {
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

          const data = await db.loginAudit.create({
            data: {
              userId: body.userId,
              email: body.email,
              action: body.action,
              ipAddress: body.ipAddress,
              userAgent: body.userAgent,
              entityId: body.entityId,
              metadata: body.metadata as any
            }
          });

          // Update user's lastLoginAt and loginCount on successful login
          if (body.action === "LOGIN_SUCCESS") {
            await db.user
              .update({
                where: { id: body.userId },
                data: { lastLoginAt: new Date(), loginCount: { increment: 1 } }
              })
              .catch(() => {}); // non-critical
          }

          return reply.code(201).send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get("/login-audit", async (request, reply) => {
        try {
          const { userId, email, limit } = request.query as {
            userId?: string;
            email?: string;
            limit?: string;
          };

          const data = await db.loginAudit.findMany({
            where: {
              ...(userId ? { userId } : {}),
              ...(email ? { email } : {})
            },
            orderBy: { createdAt: "desc" },
            take: Math.min(parseInt(limit ?? "50", 10), 200)
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      // ── User Deactivation ───────────────────────────────────────────────────

      router.put<{ Params: { userId: string } }>(
        "/users/:userId/status",
        async (request, reply) => {
          try {
            const body = request.body as { isActive: boolean };
            const data = await db.user.update({
              where: { id: request.params.userId },
              data: { isActive: body.isActive },
              select: { id: true, email: true, name: true, isActive: true }
            });
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      // ── User Detail (admin view) ────────────────────────────────────────────

      router.get<{ Params: { userId: string } }>(
        "/users/:userId/detail",
        async (request, reply) => {
          try {
            const data = await db.user.findUnique({
              where: { id: request.params.userId },
              select: {
                id: true,
                email: true,
                name: true,
                phone: true,
                jobTitle: true,
                department: true,
                isActive: true,
                lastLoginAt: true,
                loginCount: true,
                createdAt: true,
                entities: {
                  include: { entity: { select: { id: true, name: true, type: true } } }
                },
                loginAudits: {
                  orderBy: { createdAt: "desc" },
                  take: 10,
                  select: { id: true, action: true, ipAddress: true, createdAt: true }
                }
              }
            });
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
