/**
 * The tenant's upload limit (HC-35, WP-2 item 8).
 *
 * File imports arrive as request bodies. The body is read before the tenant is
 * known, so the platform setting UPLOAD_MAX_MB is enforced while reading
 * (bodyLimit, app.ts) as the hard ceiling. Once the route has authenticated the
 * caller, this check refuses a body larger than the tenant's own limit (its
 * plan or entitlement, modules/tenant/entitlements.ts) with 413.
 *
 * It is appended after each route's own pre-handlers, so it runs after
 * authentication, on every route that takes a body. Requests without a tenant
 * (sign-in, platform administration) are not checked. A body sent without a
 * Content-Length (chunked) is held to the platform ceiling only.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { tenantEntitlements } from "./entitlements.js";

const WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

async function checkTenantUploadLimit(request: FastifyRequest, reply: FastifyReply) {
  const tenantId = request.user?.tenantId;
  if (!tenantId) return;
  const size = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(size) || size <= 0) return;
  const limits = await tenantEntitlements(tenantId);
  if (size <= limits.uploadMaxBytes) return;
  return reply.code(413).send({
    data: null,
    errors: [
      {
        code: "UPLOAD_TOO_LARGE",
        message: `This upload is larger than your plan allows (${limits.uploadMaxMb} MB).`
      }
    ]
  });
}

/** Adds the check to every route registered after this call. */
export function enforceTenantUploadLimits(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.some((method) => WITH_BODY.has(method))) return;
    const own: preHandlerHookHandler[] = route.preHandler
      ? Array.isArray(route.preHandler)
        ? [...route.preHandler]
        : [route.preHandler]
      : [];
    route.preHandler = [...own, checkTenantUploadLimit as preHandlerHookHandler];
  });
}
