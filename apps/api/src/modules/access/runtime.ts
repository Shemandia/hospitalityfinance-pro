/**
 * The process-wide AccessService used by the route guard.
 *
 * The data source reads through the tenant-aware `prisma` proxy, so each load
 * goes to the database of the tenant bound to the current request. The cache
 * is the shared Redis client.
 */

import type { PrismaClient } from "../../db/client.js";
import { prisma } from "../../db/prisma.js";
import { getRedisClient } from "../../db/redis.js";
import { PrismaAccessDataSource } from "./prisma-source.js";
import { RedisAccessCache, type AccessRedis } from "./redis-cache.js";
import { AccessService } from "./service.js";
import { config } from "../../config.js";

let service: AccessService | null = null;

export function getAccessService(): AccessService {
  if (!service) {
    service = new AccessService(
      new PrismaAccessDataSource(prisma as unknown as PrismaClient),
      new RedisAccessCache(getRedisClient() as AccessRedis, {
        ttlSeconds: config().ACCESS_CACHE_TTL_SECONDS
      })
    );
  }
  return service;
}

/** Tests replace the service; passing null restores the default. */
export function setAccessService(replacement: AccessService | null): void {
  service = replacement;
}
