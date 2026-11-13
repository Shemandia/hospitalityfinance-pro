import { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { accountTypeCreateSchema, accountTypeUpdateSchema } from "./types.js";

function requireEntityId(entityId: string | undefined): string {
  if (!entityId) throw Object.assign(new Error("Entity context required"), { statusCode: 400 });
  return entityId;
}

export function isAccountTypeVisibleToEntity(
  accountType: { entityId: string | null; isSystem: boolean },
  entityId: string
): boolean {
  return (
    accountType.entityId === entityId || (accountType.entityId === null && accountType.isSystem)
  );
}

function assertAccountTypeVisibleToEntity(
  accountType: { entityId: string | null; isSystem: boolean },
  entityId: string
): void {
  if (!isAccountTypeVisibleToEntity(accountType, entityId)) {
    throw Object.assign(new Error("Account type not found in current entity scope."), {
      statusCode: 404
    });
  }
}

export function registerAccountTypeRouter(app: FastifyInstance): void {
  // ── List account types ─────────────────────────────────────────────────
  // Returns system (global) types + entity-specific types, ordered by sortOrder
  app.get(
    "/api/v1/account-types",
    { preHandler: [requireAuth, requirePermission(["COA_READ", "GL_READ"])] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);

        const types = await prisma.accountTypeDefinition.findMany({
          where: {
            OR: [
              { entityId: null }, // system/global types
              { entityId } // entity-specific types
            ],
            isActive: true
          },
          orderBy: { sortOrder: "asc" }
        });

        return reply.send({ data: types, errors: [] });
      } catch (error: any) {
        return reply.status(error.statusCode ?? 500).send({
          data: null,
          errors: [{ code: "FETCH_ERROR", message: error.message }]
        });
      }
    }
  );

  // ── List all (including inactive) — for admin ──────────────────────────
  app.get(
    "/api/v1/account-types/all",
    { preHandler: [requireAuth, requirePermission("ADMIN_SETTINGS")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);

        const types = await prisma.accountTypeDefinition.findMany({
          where: {
            OR: [{ entityId: null }, { entityId }]
          },
          orderBy: { sortOrder: "asc" }
        });

        return reply.send({ data: types, errors: [] });
      } catch (error: any) {
        return reply.status(error.statusCode ?? 500).send({
          data: null,
          errors: [{ code: "FETCH_ERROR", message: error.message }]
        });
      }
    }
  );

  // ── Create custom account type ─────────────────────────────────────────
  app.post(
    "/api/v1/account-types",
    { preHandler: [requireAuth, requirePermission("ADMIN_SETTINGS")] },
    async (request, reply) => {
      try {
        const entityId = requireEntityId(request.entityId);
        const input = accountTypeCreateSchema.parse(request.body);

        // Check code uniqueness within entity scope + global scope
        const existing = await prisma.accountTypeDefinition.findFirst({
          where: {
            code: input.code,
            OR: [{ entityId: null }, { entityId }]
          }
        });
        if (existing) {
          return reply.status(409).send({
            data: null,
            errors: [
              {
                code: "DUPLICATE_CODE",
                message: `Account type code '${input.code}' already exists.`
              }
            ]
          });
        }

        const created = await prisma.accountTypeDefinition.create({
          data: {
            ...input,
            entityId,
            isSystem: false
          }
        });

        return reply.status(201).send({ data: created, errors: [] });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            data: null,
            errors: error.issues.map((i) => ({ code: "VALIDATION_ERROR", message: i.message }))
          });
        }
        return reply.status(error.statusCode ?? 500).send({
          data: null,
          errors: [{ code: "CREATE_ERROR", message: error.message }]
        });
      }
    }
  );

  // ── Update account type ────────────────────────────────────────────────
  app.put(
    "/api/v1/account-types/:id",
    { preHandler: [requireAuth, requirePermission("ADMIN_SETTINGS")] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const entityId = requireEntityId(request.entityId);
        const input = accountTypeUpdateSchema.parse(request.body);

        const existing = await prisma.accountTypeDefinition.findUnique({ where: { id } });
        if (!existing) {
          return reply.status(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Account type not found." }]
          });
        }
        assertAccountTypeVisibleToEntity(existing, entityId);

        // System types: only allow renaming and sortOrder changes
        if (existing.isSystem) {
          const allowed: Record<string, unknown> = {};
          if (input.name !== undefined) allowed.name = input.name;
          if (input.sortOrder !== undefined) allowed.sortOrder = input.sortOrder;

          const updated = await prisma.accountTypeDefinition.update({
            where: { id },
            data: allowed
          });
          return reply.send({ data: updated, errors: [] });
        }

        const updated = await prisma.accountTypeDefinition.update({
          where: { id },
          data: input
        });
        return reply.send({ data: updated, errors: [] });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            data: null,
            errors: error.issues.map((i) => ({ code: "VALIDATION_ERROR", message: i.message }))
          });
        }
        return reply.status(error.statusCode ?? 500).send({
          data: null,
          errors: [{ code: "UPDATE_ERROR", message: error.message }]
        });
      }
    }
  );

  // ── Delete (deactivate) account type ───────────────────────────────────
  app.delete(
    "/api/v1/account-types/:id",
    { preHandler: [requireAuth, requirePermission("ADMIN_SETTINGS")] },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const entityId = requireEntityId(request.entityId);

        const existing = await prisma.accountTypeDefinition.findUnique({ where: { id } });
        if (!existing) {
          return reply.status(404).send({
            data: null,
            errors: [{ code: "NOT_FOUND", message: "Account type not found." }]
          });
        }
        assertAccountTypeVisibleToEntity(existing, entityId);

        if (existing.isSystem) {
          return reply.status(403).send({
            data: null,
            errors: [{ code: "SYSTEM_TYPE", message: "System account types cannot be deleted." }]
          });
        }

        // Check if any accounts reference this type
        const accountCount = await prisma.account.count({
          where: { entityId, accountTypeDefId: id }
        });
        if (accountCount > 0) {
          return reply.status(409).send({
            data: null,
            errors: [
              {
                code: "IN_USE",
                message: `Cannot delete: ${accountCount} account(s) use this type. Deactivate it instead.`
              }
            ]
          });
        }

        await prisma.accountTypeDefinition.delete({ where: { id } });
        return reply.send({ data: { deleted: true }, errors: [] });
      } catch (error: any) {
        return reply.status(error.statusCode ?? 500).send({
          data: null,
          errors: [{ code: "DELETE_ERROR", message: error.message }]
        });
      }
    }
  );
}
