/**
 * Redis: the one place connections are made (HC-32).
 *
 *   getRedisClient()          the shared ioredis client: sessions, the access cache
 *   redisConnectionOptions()  connection options for BullMQ queues and workers
 *                             (jobs/queues.ts builds every queue and worker with them)
 *
 * Both come from REDIS_URL, which the API and the workers require at startup.
 * There is no fallback host: a missing REDIS_URL is an error, not a silent
 * connection to some local Redis.
 */

import RedisModule from "ioredis";
import type { RedisOptions } from "ioredis";
import { requireConfig } from "../config.js";

// ioredis CJS default export workaround for ESM
const RedisConstructor = (RedisModule as any).default ?? RedisModule;
type RedisClient = InstanceType<typeof RedisConstructor>;

let client: RedisClient | null = null;

function redisUrl(): URL {
  return new URL(requireConfig(["REDIS_URL"], "Redis").REDIS_URL);
}

/**
 * REDIS_URL as ioredis options: host, port, user, password, database number
 * (the path, e.g. redis://host:6379/2) and TLS for rediss://.
 */
export function redisConnectionOptions(): RedisOptions {
  const url = redisUrl();
  const db = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isInteger(db) || db < 0) {
    throw new Error(`REDIS_URL names database "${url.pathname.slice(1)}"; use a number.`);
  }
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    // BullMQ requires this for workers; harmless elsewhere.
    maxRetriesPerRequest: null
  };
}

export function getRedisClient(): RedisClient {
  client ??= new RedisConstructor({ ...redisConnectionOptions(), lazyConnect: true });
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
