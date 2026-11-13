/**
 * Redis-backed AccessCache.
 *
 * Keys (all prefixed with the tenant, per the Redis rule in section 4):
 *   access:{tenantId}:epoch                      counter, bumped by invalidateTenant
 *   access:{tenantId}:user:{userId}:version      counter, bumped by invalidateUser
 *   access:{tenantId}:{epoch}:{userId}:{version} resolved access for one user, JSON
 *
 * Invalidation never deletes an entry; it bumps a counter, which changes the
 * key every later read uses. That orphans the old entries in O(1), and it also
 * closes the race where a request that loaded data before the invalidation
 * writes its result afterwards: that write lands on the old key, which nobody
 * reads again. Orphans expire through their TTL. The TTL is only a backstop
 * and a way to reclaim memory: correctness comes from the explicit
 * invalidation calls.
 *
 * Errors are not caught here. AccessService turns them into
 * AccessInfrastructureError so that a Redis fault is reported as 503.
 */

import type { ResolvedAccess } from "./resolver.js";
import type { AccessCache, AccessCacheSlot } from "./service.js";

/** The subset of the ioredis client this cache uses. */
export interface AccessRedis {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<Array<string | null>>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  incr(key: string): Promise<number>;
}

export type RedisAccessCacheOptions = {
  /** Lifetime of a cached entry. Platform setting; supplied by the caller. */
  ttlSeconds: number;
};

function isResolvedAccess(value: unknown): value is ResolvedAccess {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { tenantPermissions?: unknown; entityPermissions?: unknown };
  if (!Array.isArray(candidate.tenantPermissions)) return false;
  if (!candidate.tenantPermissions.every((p) => typeof p === "string")) return false;
  const entities = candidate.entityPermissions;
  if (typeof entities !== "object" || entities === null || Array.isArray(entities)) return false;
  return Object.values(entities).every(
    (codes) => Array.isArray(codes) && codes.every((p) => typeof p === "string")
  );
}

export class RedisAccessCache implements AccessCache {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: AccessRedis,
    options: RedisAccessCacheOptions
  ) {
    if (!Number.isInteger(options.ttlSeconds) || options.ttlSeconds <= 0) {
      throw new Error("RedisAccessCache: ttlSeconds must be a positive integer");
    }
    this.ttlSeconds = options.ttlSeconds;
  }

  private epochKey(tenantId: string): string {
    return `access:${tenantId}:epoch`;
  }

  private versionKey(tenantId: string, userId: string): string {
    return `access:${tenantId}:user:${userId}:version`;
  }

  private async slot(tenantId: string, userId: string): Promise<AccessCacheSlot> {
    const [epoch, version] = await this.redis.mget(
      this.epochKey(tenantId),
      this.versionKey(tenantId, userId)
    );
    return { key: `access:${tenantId}:${epoch ?? "0"}:${userId}:${version ?? "0"}` };
  }

  async read(
    tenantId: string,
    userId: string
  ): Promise<{ access: ResolvedAccess | null; slot: AccessCacheSlot }> {
    const slot = await this.slot(tenantId, userId);
    const raw = await this.redis.get(slot.key);
    if (raw === null) return { access: null, slot };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt entry is treated as a miss; the caller recomputes and overwrites it.
      return { access: null, slot };
    }
    return { access: isResolvedAccess(parsed) ? parsed : null, slot };
  }

  async write(slot: AccessCacheSlot, access: ResolvedAccess): Promise<void> {
    await this.redis.set(slot.key, JSON.stringify(access), "EX", this.ttlSeconds);
  }

  async invalidateUser(tenantId: string, userId: string): Promise<void> {
    await this.redis.incr(this.versionKey(tenantId, userId));
  }

  async invalidateTenant(tenantId: string): Promise<void> {
    await this.redis.incr(this.epochKey(tenantId));
  }
}
