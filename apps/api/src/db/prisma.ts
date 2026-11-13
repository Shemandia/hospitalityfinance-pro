/**
 * Prisma clients.
 *
 * `prisma` is the tenant-aware client every service imports. It has no
 * database of its own: each property access resolves to the client of the
 * tenant bound to the current async context (requestContext), and throws
 * TenantNotBoundError when none is bound (AUT-05). A lost or missing tenant
 * therefore fails the operation instead of reading or writing whichever
 * database DATABASE_URL happens to name.
 *
 * Requests are bound by the auth plugin; jobs, workers and scripts bind a
 * tenant with runForTenant (tenantScope.ts).
 *
 * `registryPrisma` is the registry database client (tenant management).
 */

import { PrismaClient as RegistryPrismaClient } from "./generated/registry/index.js";
import { getRequestContext } from "./requestContext.js";
import { TenantNotBoundError } from "./tenantScope.js";
import { getTenantClient } from "./tenantPool.js";

type TenantClient = ReturnType<typeof getTenantClient>;

function boundTenantClient(): TenantClient {
  const { tenantSlug, tenantDbUrl } = getRequestContext();
  if (!tenantSlug || !tenantDbUrl) throw new TenantNotBoundError();
  return getTenantClient(tenantSlug, tenantDbUrl);
}

export const prisma: TenantClient = new Proxy({} as TenantClient, {
  get(_target, prop) {
    // Promise resolution probes `then` on anything awaited; the proxy is not a promise.
    if (prop === "then") return undefined;
    const client = boundTenantClient();
    return Reflect.get(client, prop, client);
  },
  has(_target, prop) {
    return prop in boundTenantClient();
  }
});

export const registryPrisma = new RegistryPrismaClient({
  datasourceUrl: process.env.REGISTRY_DATABASE_URL ?? process.env.DATABASE_URL
});
