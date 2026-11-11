/**
 * AccessService — the only code that reads role assignments (WP-A).
 *
 * It answers one question for the rest of the API: does this user hold this
 * permission at this entity? The answer is computed by the pure resolver from
 * data loaded through an AccessDataSource, and cached per tenant and user
 * through an AccessCache.
 *
 * Failure handling (AUT-10): a fault in the database or the cache is raised as
 * AccessInfrastructureError and never turned into "no access" or "signed out".
 * Callers map it to 503. A decision is only ever made from data that was read
 * successfully, so the service fails closed.
 */

import {
  NO_ACCESS,
  canOpenEntity,
  hasEntityPermission,
  hasTenantPermission,
  resolveAccess,
  type AccessAssignment,
  type AccessEntityNode,
  type ResolvedAccess
} from "./resolver.js";

// ── Ports ────────────────────────────────────────────────────────────────────

export type AccessSnapshot = {
  /** False when the user does not exist or is deactivated. */
  userIsActive: boolean;
  entities: AccessEntityNode[];
  assignments: AccessAssignment[];
  rolePermissions: Map<string, string[]>;
};

/** Loads everything the resolver needs for one user of the bound tenant. */
export interface AccessDataSource {
  loadSnapshot(userId: string): Promise<AccessSnapshot>;
}

/**
 * Where a cached result lives. Obtained from `read` before the data is loaded
 * and handed back to `write`, so that a result computed from data read before
 * an invalidation can never be stored where later requests will find it.
 */
export type AccessCacheSlot = { readonly key: string };

/**
 * Per-tenant, per-user cache of resolved access.
 *
 * `invalidateUser` is called when a user's assignments or active flag change.
 * `invalidateTenant` is called when a role, a role's permissions or the entity
 * tree changes, because those can alter the result for any user.
 * After either call, `read` must miss until a fresh result is written.
 */
export interface AccessCache {
  read(
    tenantId: string,
    userId: string
  ): Promise<{ access: ResolvedAccess | null; slot: AccessCacheSlot }>;
  write(slot: AccessCacheSlot, access: ResolvedAccess): Promise<void>;
  invalidateUser(tenantId: string, userId: string): Promise<void>;
  invalidateTenant(tenantId: string): Promise<void>;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** The access decision could not be made because a dependency failed. Maps to 503. */
export class AccessInfrastructureError extends Error {
  readonly dependency: "database" | "cache";

  constructor(dependency: "database" | "cache", operation: string, cause: unknown) {
    super(`Access check unavailable: ${dependency} failed during ${operation}`, { cause });
    this.name = "AccessInfrastructureError";
    this.dependency = dependency;
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export type AccessSubject = {
  tenantId: string;
  userId: string;
};

export class AccessService {
  constructor(
    private readonly source: AccessDataSource,
    private readonly cache: AccessCache
  ) {}

  /** The entities the user can open and the permissions held at each. */
  async resolve(subject: AccessSubject): Promise<ResolvedAccess> {
    const { tenantId, userId } = subject;

    let cached: Awaited<ReturnType<AccessCache["read"]>>;
    try {
      cached = await this.cache.read(tenantId, userId);
    } catch (error) {
      throw new AccessInfrastructureError("cache", "read", error);
    }
    if (cached.access) return cached.access;

    let snapshot: AccessSnapshot;
    try {
      snapshot = await this.source.loadSnapshot(userId);
    } catch (error) {
      throw new AccessInfrastructureError("database", "load", error);
    }

    const access = snapshot.userIsActive
      ? resolveAccess({
          entities: snapshot.entities,
          assignments: snapshot.assignments,
          rolePermissions: snapshot.rolePermissions
        })
      : NO_ACCESS;

    try {
      await this.cache.write(cached.slot, access);
    } catch (error) {
      throw new AccessInfrastructureError("cache", "write", error);
    }
    return access;
  }

  /** True when the user holds `permission` at `entityId`. */
  async can(subject: AccessSubject, permission: string, entityId: string): Promise<boolean> {
    return hasEntityPermission(await this.resolve(subject), entityId, permission);
  }

  /** True when the user holds `permission` through a tenant-wide assignment. */
  async canAtTenant(subject: AccessSubject, permission: string): Promise<boolean> {
    return hasTenantPermission(await this.resolve(subject), permission);
  }

  /** True when at least one of the user's assignments covers `entityId`. */
  async canOpen(subject: AccessSubject, entityId: string): Promise<boolean> {
    return canOpenEntity(await this.resolve(subject), entityId);
  }

  /** Call after any change to this user's assignments or active flag. */
  async invalidateUser(subject: AccessSubject): Promise<void> {
    try {
      await this.cache.invalidateUser(subject.tenantId, subject.userId);
    } catch (error) {
      throw new AccessInfrastructureError("cache", "invalidate user", error);
    }
  }

  /** Call after any change to roles, role permissions or the entity tree. */
  async invalidateTenant(tenantId: string): Promise<void> {
    try {
      await this.cache.invalidateTenant(tenantId);
    } catch (error) {
      throw new AccessInfrastructureError("cache", "invalidate tenant", error);
    }
  }
}
