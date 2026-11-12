/**
 * Route access registry (AUT-04).
 *
 * Every route must say how it is protected, in one of two ways:
 *
 *   - a requirePermission(...) guard in its preHandler list, or
 *   - `config: { access: "public" }`   — no session needed (login, health),
 *     `config: { access: "session" }`  — any signed-in user of the tenant,
 *     `config: { access: "platform" }` — operator routes behind X-Platform-Key;
 *                                        the tenant router's own hook checks the key.
 *
 * A route with neither, or with both, makes the application fail to start.
 * The registry also records the classification of every route; the table in
 * tests/route-access.table.json is generated from it and reviewed in diffs.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import type { GuardAccess, PermissionGuard } from "../../middleware/requirePermission.js";

export type DeclaredAccess = "public" | "session" | "platform";

export type RouteAccess = { scope: DeclaredAccess } | GuardAccess;

declare module "fastify" {
  interface FastifyContextConfig {
    access?: DeclaredAccess;
  }
}

function isPermissionGuard(handler: unknown): handler is PermissionGuard {
  return (
    typeof handler === "function" &&
    typeof (handler as { access?: unknown }).access === "object" &&
    (handler as { access?: unknown }).access !== null
  );
}

function handlersOf(route: RouteOptions): unknown[] {
  const { preHandler } = route;
  if (preHandler === undefined) return [];
  return Array.isArray(preHandler) ? preHandler : [preHandler];
}

async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (typeof request.user?.sub === "string" && request.user.sub !== "") return;
  reply.code(401).send({
    data: null,
    errors: [{ code: "AUTHENTICATION_FAILED", message: "Authentication is required." }]
  });
}

function routeKeys(route: RouteOptions): string[] {
  const methods = Array.isArray(route.method) ? route.method : [route.method];
  return methods.map((method) => `${method} ${route.url}`);
}

/**
 * Must be registered before any route. Returns the live table of
 * "METHOD /url" -> classification.
 */
export function registerRouteAccessRegistry(app: FastifyInstance): Map<string, RouteAccess> {
  const table = new Map<string, RouteAccess>();

  app.addHook("onRoute", (route) => {
    const guards = handlersOf(route).filter(isPermissionGuard);
    const declared = route.config?.access;
    const label = routeKeys(route).join(", ");

    let access: RouteAccess;
    if (routeKeys(route).every((key) => key.startsWith("OPTIONS "))) {
      // CORS preflight, registered by @fastify/cors. It carries no credentials.
      access = { scope: "public" };
    } else if (declared !== undefined && guards.length > 0) {
      throw new Error(`Route ${label} is declared "${declared}" but also has a permission guard.`);
    } else if (declared === "public" || declared === "platform") {
      access = { scope: declared };
    } else if (declared === "session") {
      access = { scope: "session" };
      // Router-level requireAuth hooks run before this; it only verifies that one did.
      route.preHandler = [...handlersOf(route), requireSession] as RouteOptions["preHandler"];
    } else if (guards.length === 1 && guards[0]) {
      access = guards[0].access;
    } else if (guards.length > 1) {
      throw new Error(`Route ${label} has more than one permission guard.`);
    } else {
      throw new Error(
        `Route ${label} has no access classification. Add a requirePermission(...) guard, ` +
          `or config: { access: "public" | "session" | "platform" }.`
      );
    }

    for (const key of routeKeys(route)) {
      // Fastify adds a HEAD route for every GET; it shares the GET's entry.
      if (key.startsWith("HEAD ") && table.has(`GET ${route.url}`)) continue;
      table.set(key, access);
    }
  });

  return table;
}
