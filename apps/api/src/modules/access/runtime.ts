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

const DEFAULT_CACHE_TTL_SECONDS = 300;

function cacheTtlSeconds(): number {
  const raw = process.env.ACCESS_CACHE_TTL_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_CACHE_TTL_SECONDS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("ACCESS_CACHE_TTL_SECONDS must be a positive integer");
  }
  return parsed;
}

let service: AccessService | null = null;

export function getAccessService(): AccessService {
  if (!service) {
    service = new AccessService(
      new PrismaAccessDataSource(prisma as unknown as PrismaClient),
      new RedisAccessCache(getRedisClient() as AccessRedis, { ttlSeconds: cacheTtlSeconds() })
    );
  }
  return service;
}

/** Tests replace the service; passing null restores the default. */
export function setAccessService(replacement: AccessService | null): void {
  service = replacement;
}
