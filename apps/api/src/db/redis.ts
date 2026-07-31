/**
 * Shared Redis Client
 *
 * Provides a singleton ioredis client for session management, refresh token
 * storage, and other auth-related operations. Reuses the same REDIS_URL /
 * REDIS_HOST / REDIS_PORT / REDIS_PASSWORD env vars used by BullMQ.
 */

import RedisModule from "ioredis";

// ioredis CJS default export workaround for ESM
const RedisConstructor = (RedisModule as any).default ?? RedisModule;
type RedisClient = InstanceType<typeof RedisConstructor>;

let client: RedisClient | null = null;

export function getRedisClient(): RedisClient {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (url) {
    client = new RedisConstructor(url, { maxRetriesPerRequest: null, lazyConnect: true });
  } else {
    if (process.env.NODE_ENV === "production" && !process.env.REDIS_HOST) {
      throw new Error(
        "FATAL: REDIS_URL or REDIS_HOST must be set in production. Native auth sessions require Redis."
      );
    }
    const host = process.env.REDIS_HOST ?? "127.0.0.1";
    const port = parseInt(process.env.REDIS_PORT ?? "6379", 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    client = new RedisConstructor({
      host,
      port,
      password,
      maxRetriesPerRequest: null,
      lazyConnect: true
    });
  }

  return client!;
}

export async function connectRedis(): Promise<void> {
  const redis = getRedisClient();
  if (redis.status === "ready") return;
  await redis.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
