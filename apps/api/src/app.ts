import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { runWithContext, enterRequestContext, updateRequestContext } from "./db/requestContext.js";
import { prisma, setActiveTenant } from "./db/prisma.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { requireRole } from "./middleware/requireRole.js";
import { logSerializers } from "./shared/log-redactor.js";
import { registerGLRouter } from "./modules/gl/router.js";
import { registerPeriodRouter } from "./modules/period/router.js";
import { registerAuditRouter } from "./modules/audit/router.js";
import { registerReportingRouter } from "./modules/reporting/router.js";
import { registerAPRouter } from "./modules/ap/router.js";
import { registerARRouter } from "./modules/ar/router.js";
import { registerFXRouter } from "./modules/fx/router.js";
import { registerBudgetRouter } from "./modules/budget/router.js";
import { registerConsolidationRouter } from "./modules/consolidation/router.js";
import { registerIntegrationRouter } from "./modules/integration/router.js";
import { registerKPIRouter } from "./modules/kpi/router.js";
import { registerProcessLockRouter } from "./modules/process-lock/router.js";
import { registerAllocationRouter } from "./modules/allocation/router.js";
import { registerFixedAssetRouter } from "./modules/fixed-asset/router.js";
import { registerAuthorizationRouter } from "./modules/authorization/router.js";
import { registerAdminRouter } from "./modules/admin/router.js";
import { registerTenantRouter } from "./modules/tenant/router.js";
import { registerAccountTypeRouter } from "./modules/account-type/router.js";
import { registerSetupRouter } from "./modules/setup/router.js";
import authPlugin from "./plugins/auth.js";

export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      serializers: logSerializers
    },
    bodyLimit: 10 * 1024 * 1024 // 10 MB for file imports
  });

  const allowedOrigins = (
    process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://localhost:3001"
  )
    .split(",")
    .map((o) => o.trim());

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true
  });

  // CSRF protection: validate Origin header on state-mutating requests
  app.addHook("onRequest", async (request, reply) => {
    const method = request.method.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) {
        reply.code(403);
        throw new Error(`Origin ${origin} not allowed`);
      }
    }
  });

  // Global rate limit: 200 req/min per IP
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute"
  });

  await app.register(authPlugin);

  app.addHook("onRequest", async (request, reply) => {
    // Generate or accept request ID for end-to-end tracing
    const requestId = (request.headers["x-request-id"] as string) || randomUUID();
    reply.header("x-request-id", requestId);

    // Initialize request context with ID, IP, UA. Tenant context set later by auth.
    enterRequestContext({
      requestId,
      ipAddress: request.ip ?? null,
      userAgent: request.headers["user-agent"] ?? null
    });

    // Attach to Fastify logger for structured log correlation
    (request as any).requestId = requestId;
  });

  // ── Health, Readiness & Version ───────────────────────────────────────────

  const startTime = Date.now();

  app.get("/health", async () => {
    let dbOk = false;
    let redisOk = false;

    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      /* database unreachable */
    }

    try {
      // Redis check — only if BullMQ/Redis is configured
      if (process.env.REDIS_URL || process.env.REDIS_HOST) {
        const { createClient } = await import("redis");
        const url =
          process.env.REDIS_URL ??
          `redis://${process.env.REDIS_HOST ?? "127.0.0.1"}:${process.env.REDIS_PORT ?? 6379}`;
        const client = createClient({ url, socket: { connectTimeout: 3000 } });
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Redis ping timeout")), 3000)
        );
        await client.connect();
        await Promise.race([client.ping(), timeout]);
        await client.disconnect();
        redisOk = true;
      } else {
        redisOk = true; // no Redis configured — skip
      }
    } catch {
      /* redis unreachable */
    }

    const status = dbOk ? (redisOk ? "ok" : "degraded") : "down";
    return {
      status,
      version: process.env.APP_VERSION ?? "1.0.0",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      checks: {
        database: dbOk ? "ok" : "down",
        redis: redisOk ? "ok" : "down"
      }
    };
  });

  app.get("/ready", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ ready: true });
    } catch {
      return reply.code(503).send({ ready: false, reason: "database unreachable" });
    }
  });

  app.get("/api/v1/version", async () => ({
    version: process.env.APP_VERSION ?? "1.0.0",
    buildDate: process.env.BUILD_DATE ?? new Date().toISOString().split("T")[0],
    nodeVersion: process.version,
    environment: process.env.NODE_ENV ?? "development"
  }));

  app.get("/api/v1/me", { preHandler: [requireAuth] }, async (request) => {
    return {
      data: {
        user: request.user,
        entityId: request.entityId,
        chainId: request.chainId
      },
      errors: []
    };
  });

  // ── Entity CRUD ──────────────────────────────────────────────────────────────

  app.get("/api/v1/entities", { preHandler: [requireAuth] }, async (request) => {
    // Filter entities by user's JWT claim — only return entities the user has access to
    const userEntityIds = (request.user as any)?.entityIds as string[] | undefined;
    const isSuperAdmin = !userEntityIds || userEntityIds.length === 0;
    const where = isSuperAdmin ? {} : { id: { in: userEntityIds } };

    // Superadmin with no entity context: temporarily disable RLS to list all entities
    // (RLS requires app.current_entity_id which doesn't exist for superadmin users)
    if (isSuperAdmin) {
      await (prisma as any).$executeRawUnsafe("ALTER TABLE entities DISABLE ROW LEVEL SECURITY");
    }

    try {
      const entities = await prisma.entity.findMany({
        where,
        include: {
          parent: { select: { id: true, name: true } },
          _count: { select: { children: true, users: true } }
        },
        orderBy: { name: "asc" }
      });

      // Also include child entities of granted parents (for GROUP → PROPERTY hierarchy)
      const grantedIds = new Set(entities.map((e) => e.id));
      const childEntities = !isSuperAdmin
        ? await prisma.entity.findMany({
            where: { parentId: { in: userEntityIds! }, id: { notIn: [...grantedIds] } },
            include: {
              parent: { select: { id: true, name: true } },
              _count: { select: { children: true, users: true } }
            },
            orderBy: { name: "asc" }
          })
        : [];

      return { data: [...entities, ...childEntities], errors: [] };
    } finally {
      if (isSuperAdmin) {
        await (prisma as any)
          .$executeRawUnsafe("ALTER TABLE entities ENABLE ROW LEVEL SECURITY")
          .catch(() => {});
      }
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/v1/entities/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      // Verify the user has access to this entity
      const userEntityIds = (request.user as any)?.entityIds as string[] | undefined;
      const requestedId = request.params.id;

      if (userEntityIds && userEntityIds.length > 0) {
        // Check direct access or parent-child lineage
        const entity = await prisma.entity.findFirst({
          where: { id: requestedId },
          select: { id: true, parentId: true }
        });
        if (!entity)
          return reply
            .code(404)
            .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Entity not found." }] });

        const hasAccess =
          userEntityIds.includes(entity.id) ||
          (entity.parentId && userEntityIds.includes(entity.parentId));
        if (!hasAccess) {
          return reply.code(403).send({
            data: null,
            errors: [{ code: "FORBIDDEN", message: "You do not have access to this entity." }]
          });
        }
      }

      const entity = await prisma.entity.findFirst({
        where: { id: requestedId },
        include: {
          parent: { select: { id: true, name: true } },
          children: {
            select: { id: true, name: true, type: true, isActive: true, functionalCurrency: true }
          },
          _count: { select: { children: true, users: true, accounts: true, journals: true } }
        }
      });
      if (!entity)
        return reply
          .code(404)
          .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Entity not found." }] });
      return { data: entity, errors: [] };
    }
  );

  app.post<{
    Body: {
      name: string;
      code?: string;
      type: "GROUP" | "PROPERTY";
      parentId?: string | null;
      functionalCurrency?: string;
      reportingCurrency?: string;
      timezone?: string;
      countryCode: string;
      address?: string;
      city?: string;
      postalCode?: string;
      maxProperties?: number;
    };
  }>(
    "/api/v1/entities",
    { preHandler: [requireAuth, requireRole(["ADMIN", "SUPERADMIN"])] },
    async (request, reply) => {
      const b = request.body;

      // Enforce property license limit when adding a PROPERTY to a GROUP
      if (b.type === "PROPERTY" && b.parentId) {
        const parentGroup = await (prisma.entity as any).findFirst({
          where: { id: b.parentId, type: "GROUP" },
          select: { id: true, maxProperties: true }
        });

        if (parentGroup && (parentGroup as any).maxProperties > 0) {
          const currentCount = await prisma.entity.count({
            where: { parentId: b.parentId, type: "PROPERTY", isActive: true }
          });
          if (currentCount >= (parentGroup as any).maxProperties) {
            reply.code(403);
            return {
              data: null,
              errors: [
                {
                  code: "PROPERTY_LIMIT_REACHED",
                  message: `This group is licensed for ${(parentGroup as any).maxProperties} properties. Current: ${currentCount}. Contact support to upgrade your license.`
                }
              ]
            };
          }
        }
      }

      const entity = await (prisma.entity as any).create({
        data: {
          name: b.name,
          code: b.code ?? null,
          type: b.type,
          parentId: b.parentId ?? null,
          functionalCurrency: b.functionalCurrency ?? "USD",
          reportingCurrency: b.reportingCurrency ?? "USD",
          timezone: b.timezone ?? "UTC",
          countryCode: b.countryCode,
          address: b.address,
          city: b.city,
          postalCode: b.postalCode,
          maxProperties: b.type === "GROUP" ? (b.maxProperties ?? 0) : 0
        }
      });
      // Auto-assign the requesting user to the new entity. The JWT payload
      // exposes the Keycloak user via `sub`, but the EntityUser FK points at
      // User.id (the tenant DB primary key), so we have to look up the User
      // row by keycloakId first. Without this link, downstream services
      // (SAF import, payroll import, etc.) fail with "No entity user found".
      const keycloakSub =
        typeof (request.user as any)?.sub === "string"
          ? ((request.user as any).sub as string)
          : null;
      if (keycloakSub) {
        try {
          const userRow = await prisma.user.findUnique({
            where: { keycloakId: keycloakSub },
            select: { id: true }
          });
          if (userRow) {
            await prisma.entityUser.upsert({
              where: { entityId_userId: { entityId: entity.id, userId: userRow.id } },
              create: { entityId: entity.id, userId: userRow.id, role: "ADMIN" },
              update: {}
            });
          } else {
            request.log.warn(
              { keycloakSub, entityId: entity.id },
              "Entity created but no User row matches the JWT sub — entity_users link skipped"
            );
          }
        } catch (err) {
          request.log.error(
            { err, entityId: entity.id },
            "Failed to auto-link requesting user to new entity"
          );
        }
      }
      reply.code(201);
      return { data: entity, errors: [] };
    }
  );

  app.put<{
    Params: { id: string };
    Body: {
      name?: string;
      code?: string;
      parentId?: string | null;
      functionalCurrency?: string;
      maxProperties?: number;
      reportingCurrency?: string;
      timezone?: string;
      countryCode?: string;
      address?: string | null;
      city?: string | null;
      postalCode?: string | null;
      isActive?: boolean;
    };
  }>(
    "/api/v1/entities/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN", "SUPERADMIN"])] },
    async (request, reply) => {
      const existing = await prisma.entity.findFirst({ where: { id: request.params.id } });
      if (!existing)
        return reply
          .code(404)
          .send({ data: null, errors: [{ code: "NOT_FOUND", message: "Entity not found." }] });

      // Verify user has access to this entity
      const userEntityIds = (request.user as any)?.entityIds as string[] | undefined;
      if (userEntityIds && userEntityIds.length > 0) {
        const hasAccess =
          userEntityIds.includes(existing.id) ||
          (existing.parentId && userEntityIds.includes(existing.parentId));
        if (!hasAccess) {
          return reply.code(403).send({
            data: null,
            errors: [{ code: "FORBIDDEN", message: "You do not have access to this entity." }]
          });
        }
      }

      const b = request.body;
      const entity = await (prisma.entity as any).update({
        where: { id: request.params.id },
        data: {
          ...(b.name !== undefined && { name: b.name }),
          ...(b.code !== undefined && { code: b.code }),
          ...(b.parentId !== undefined && { parentId: b.parentId }),
          ...(b.functionalCurrency !== undefined && { functionalCurrency: b.functionalCurrency }),
          ...(b.reportingCurrency !== undefined && { reportingCurrency: b.reportingCurrency }),
          ...(b.timezone !== undefined && { timezone: b.timezone }),
          ...(b.countryCode !== undefined && { countryCode: b.countryCode }),
          ...(b.address !== undefined && { address: b.address }),
          ...(b.city !== undefined && { city: b.city }),
          ...(b.postalCode !== undefined && { postalCode: b.postalCode }),
          ...(b.isActive !== undefined && { isActive: b.isActive }),
          ...(b.maxProperties !== undefined &&
            existing.type === "GROUP" && { maxProperties: b.maxProperties })
        }
      });
      return { data: entity, errors: [] };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/entities/:id",
    { preHandler: [requireAuth, requireRole(["ADMIN", "SUPERADMIN"])] },
    async (request, reply) => {
      const existing = await prisma.entity.findFirst({
        where: { id: request.params.id },
        include: { _count: { select: { children: true, journals: true, accounts: true } } }
      });
      if (!existing)
        return { data: null, errors: [{ code: "NOT_FOUND", message: "Entity not found." }] };
      if (
        existing._count.children > 0 ||
        existing._count.journals > 0 ||
        existing._count.accounts > 0
      ) {
        reply.code(409);
        return {
          data: null,
          errors: [
            {
              code: "HAS_DEPENDENTS",
              message: "Cannot delete entity with children, journals or accounts."
            }
          ]
        };
      }
      await prisma.entityUser.deleteMany({ where: { entityId: request.params.id } });
      await prisma.entity.delete({ where: { id: request.params.id } });
      reply.code(204);
      return;
    }
  );

  // ── License Info ────────────────────────────────────────────────────────────

  app.get("/api/v1/license", { preHandler: [requireAuth] }, async (request) => {
    const userEntityIds = (request.user as any)?.entityIds as string[] | undefined;

    // Find the user's GROUP entity (root of their hierarchy)
    const groups = await (prisma.entity as any).findMany({
      where: {
        type: "GROUP",
        ...(userEntityIds && userEntityIds.length > 0 ? { id: { in: userEntityIds } } : {})
      },
      select: { id: true, name: true, maxProperties: true }
    });

    const result = [];
    for (const group of groups) {
      const propertyCount = await prisma.entity.count({
        where: { parentId: group.id, type: "PROPERTY", isActive: true }
      });
      const maxProperties = (group as any).maxProperties ?? 0;
      result.push({
        groupId: group.id,
        groupName: group.name,
        maxProperties: maxProperties === 0 ? "unlimited" : maxProperties,
        currentProperties: propertyCount,
        remaining: maxProperties === 0 ? "unlimited" : Math.max(0, maxProperties - propertyCount)
      });
    }
    return { data: result, errors: [] };
  });

  app.get(
    "/api/v1/admin",
    { preHandler: [requireAuth, requireRole(["ADMIN", "SUPERADMIN"])] },
    async () => ({
      data: { message: "Role-gated endpoint is accessible." },
      errors: []
    })
  );

  await registerGLRouter(app);
  await registerPeriodRouter(app);
  await registerAuditRouter(app);
  await registerReportingRouter(app);
  await registerAPRouter(app);
  await registerARRouter(app);
  await registerFXRouter(app);
  await registerBudgetRouter(app);
  await registerConsolidationRouter(app);
  await registerIntegrationRouter(app);
  await registerKPIRouter(app);
  await registerProcessLockRouter(app);
  await registerAllocationRouter(app);
  await registerFixedAssetRouter(app);
  await registerAuthorizationRouter(app);
  await registerAdminRouter(app);
  await registerTenantRouter(app);
  registerAccountTypeRouter(app);
  await registerSetupRouter(app);

  return app;
}
