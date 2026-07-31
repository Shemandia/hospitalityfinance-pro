/**
 * Tenant Management Router
 *
 * Platform-level endpoints for managing tenants (hotel chains).
 * Protected by PLATFORM_API_KEY — these are NOT user-facing endpoints.
 * They are used by the platform admin (HFP operations team) to onboard,
 * manage, and deactivate customer tenants.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { registryPrisma } from "../../db/prisma.js";
import { generateTenantCode } from "../../db/generateTenantCode.js";
import { invalidateTenantCache, listTenants } from "../../db/tenantRegistry.js";
import { evictTenant } from "../../db/tenantPool.js";
import { provisionTenantSchema } from "./types.js";
import { ProvisioningService } from "./provisioning-service.js";

// ── Platform API key auth ─────────────────────────────────────────────────────

const PLATFORM_API_KEY = process.env.PLATFORM_API_KEY;
if (!PLATFORM_API_KEY) {
  throw new Error(
    "FATAL: PLATFORM_API_KEY environment variable must be set. " +
      "Generate a cryptographically random key (min 32 chars) for production."
  );
}

async function requirePlatformKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key = request.headers["x-platform-key"];
  if (key !== PLATFORM_API_KEY) {
    reply.code(401).send({
      data: null,
      errors: [{ code: "PLATFORM_AUTH_REQUIRED", message: "Valid X-Platform-Key header required." }]
    });
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function registerTenantRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requirePlatformKey);

      // List all tenants
      router.get("/tenants", async (_request, reply) => {
        const tenants = await registryPrisma.tenant.findMany({
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            slug: true,
            name: true,
            domain: true,
            adminEmail: true,
            plan: true,
            maxProperties: true,
            isActive: true,
            provisioningStatus: true,
            provisionedAt: true,
            createdAt: true
          }
        });
        return reply.send({ data: tenants, errors: [] });
      });

      // Get tenant by slug
      router.get<{ Params: { slug: string } }>("/tenants/:slug", async (request, reply) => {
        const tenant = await registryPrisma.tenant.findUnique({
          where: { slug: request.params.slug }
        });
        if (!tenant) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "TENANT_NOT_FOUND", message: "Tenant not found." }]
          });
        }
        // Never expose databaseUrl in API response
        const { databaseUrl, ...safe } = tenant;
        return reply.send({ data: safe, errors: [] });
      });

      // Register a new tenant (pre-provisioned — DB must already exist)
      router.post<{
        Body: {
          name: string;
          slug: string;
          databaseUrl: string;
          adminEmail: string;
          domain?: string;
          plan?: string;
          maxProperties?: number;
        };
      }>("/tenants", async (request, reply) => {
        const body = request.body;

        if (!body.name || !body.slug || !body.databaseUrl || !body.adminEmail) {
          return reply.code(400).send({
            data: null,
            errors: [
              { code: "VALIDATION_ERROR", message: "name, slug, databaseUrl, adminEmail required." }
            ]
          });
        }

        // Validate slug format
        if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(body.slug)) {
          return reply.code(400).send({
            data: null,
            errors: [
              {
                code: "INVALID_SLUG",
                message: "Slug must be 3-50 chars, lowercase alphanumeric with hyphens."
              }
            ]
          });
        }

        const existing = await registryPrisma.tenant.findUnique({ where: { slug: body.slug } });
        if (existing) {
          return reply.code(409).send({
            data: null,
            errors: [{ code: "TENANT_EXISTS", message: `Tenant '${body.slug}' already exists.` }]
          });
        }

        const tenantCode = await generateTenantCode(body.slug);
        const tenant = await registryPrisma.tenant.create({
          data: {
            name: body.name,
            slug: body.slug,
            tenantCode,
            databaseUrl: body.databaseUrl,
            adminEmail: body.adminEmail,
            domain: body.domain ?? null,
            plan: body.plan ?? "standard",
            maxProperties: body.maxProperties ?? 10,
            isActive: true,
            provisionedAt: new Date()
          }
        });

        await invalidateTenantCache();

        const { databaseUrl, ...safe } = tenant;
        return reply.code(201).send({ data: safe, errors: [] });
      });

      // Update tenant
      router.put<{
        Params: { slug: string };
        Body: {
          name?: string;
          domain?: string | null;
          adminEmail?: string;
          plan?: string;
          maxProperties?: number;
          isActive?: boolean;
        };
      }>("/tenants/:slug", async (request, reply) => {
        const existing = await registryPrisma.tenant.findUnique({
          where: { slug: request.params.slug }
        });
        if (!existing) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "TENANT_NOT_FOUND", message: "Tenant not found." }]
          });
        }

        const body = request.body;
        const tenant = await registryPrisma.tenant.update({
          where: { slug: request.params.slug },
          data: {
            ...(body.name !== undefined && { name: body.name }),
            ...(body.domain !== undefined && { domain: body.domain }),
            ...(body.adminEmail !== undefined && { adminEmail: body.adminEmail }),
            ...(body.plan !== undefined && { plan: body.plan }),
            ...(body.maxProperties !== undefined && { maxProperties: body.maxProperties }),
            ...(body.isActive !== undefined && { isActive: body.isActive })
          }
        });

        // If deactivated, evict from connection pool
        if (body.isActive === false) {
          await evictTenant(tenant.slug);
        }

        await invalidateTenantCache();

        const { databaseUrl, ...safe } = tenant;
        return reply.send({ data: safe, errors: [] });
      });

      // Deactivate tenant (soft delete)
      router.delete<{ Params: { slug: string } }>("/tenants/:slug", async (request, reply) => {
        const existing = await registryPrisma.tenant.findUnique({
          where: { slug: request.params.slug }
        });
        if (!existing) {
          return reply.code(404).send({
            data: null,
            errors: [{ code: "TENANT_NOT_FOUND", message: "Tenant not found." }]
          });
        }

        await registryPrisma.tenant.update({
          where: { slug: request.params.slug },
          data: { isActive: false }
        });

        await evictTenant(request.params.slug);
        await invalidateTenantCache();

        return reply.send({ data: { deactivated: true }, errors: [] });
      });

      // List active tenants (cached view)
      router.get("/tenants/active/cached", async (_request, reply) => {
        const tenants = await listTenants();
        return reply.send({
          data: tenants.map((t) => ({
            id: t.id,
            slug: t.slug,
            name: t.name,
            isActive: t.isActive
          })),
          errors: []
        });
      });

      // ── Provisioning endpoints ──────────────────────────────────────────

      const provisioningService = new ProvisioningService();

      // Start provisioning (SSE stream)
      router.post("/tenants/provision", async (request, reply) => {
        let input;
        try {
          input = provisionTenantSchema.parse(request.body);
        } catch (err) {
          if (err instanceof ZodError) {
            return reply.code(400).send({
              data: null,
              errors: err.errors.map((e) => ({
                code: "VALIDATION_ERROR",
                message: e.message,
                path: e.path
              }))
            });
          }
          throw err;
        }

        const origin = request.headers.origin ?? "*";
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true"
        });
        reply.raw.flushHeaders();

        const sse = (event: string, data: Record<string, unknown>) => {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        try {
          await provisioningService.provision(input, sse);
        } catch (err) {
          // Emit error via SSE if not already emitted
          const msg = err instanceof Error ? err.message : "Unknown error";
          sse("error", { step: "unknown", order: 0, status: "FAILED", error: msg });
        } finally {
          reply.raw.end();
        }
      });

      // Get provisioning status
      router.get<{ Params: { slug: string } }>(
        "/tenants/:slug/provision-status",
        async (request, reply) => {
          const status = await provisioningService.getStatus(request.params.slug);
          if (!status) {
            return reply.code(404).send({
              data: null,
              errors: [{ code: "TENANT_NOT_FOUND", message: "Tenant not found." }]
            });
          }
          return reply.send({ data: status, errors: [] });
        }
      );

      // Retry provisioning from failed step (SSE stream)
      router.post<{ Params: { slug: string } }>(
        "/tenants/:slug/provision-retry",
        async (request, reply) => {
          const retryOrigin = request.headers.origin ?? "*";
          reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "Access-Control-Allow-Origin": retryOrigin,
            "Access-Control-Allow-Credentials": "true"
          });
          reply.raw.flushHeaders();

          const sse = (event: string, data: Record<string, unknown>) => {
            reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          };

          try {
            await provisioningService.retry(request.params.slug, sse);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            sse("error", { step: "unknown", order: 0, status: "FAILED", error: msg });
          } finally {
            reply.raw.end();
          }
        }
      );
    },
    { prefix: "/api/v1/platform" }
  );
}
