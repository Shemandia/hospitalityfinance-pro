import { describe, expect, it } from "vitest";
import { RedisAccessCache, type AccessRedis } from "../src/modules/access/redis-cache.js";
import type { AccessAssignment } from "../src/modules/access/resolver.js";
import {
  AccessInfrastructureError,
  AccessService,
  type AccessDataSource,
  type AccessSnapshot
} from "../src/modules/access/service.js";

// ── Fakes ────────────────────────────────────────────────────────────────────

/** In-memory stand-in for the Redis commands the cache uses. */
class FakeRedis implements AccessRedis {
  readonly store = new Map<string, string>();
  failing = false;

  private check(): void {
    if (this.failing) throw new Error("ECONNREFUSED 127.0.0.1:6379");
  }
  async get(key: string) {
    this.check();
    return this.store.get(key) ?? null;
  }
  async mget(...keys: string[]) {
    this.check();
    return keys.map((k) => this.store.get(k) ?? null);
  }
  async set(key: string, value: string) {
    this.check();
    this.store.set(key, value);
    return "OK";
  }
  async incr(key: string) {
    this.check();
    const next = Number(this.store.get(key) ?? "0") + 1;
    this.store.set(key, String(next));
    return next;
  }
}

/** A tenant's access data, editable between calls to simulate admin changes. */
class FakeSource implements AccessDataSource {
  loads = 0;
  failing = false;
  userIsActive = true;
  assignments: AccessAssignment[] = [];
  rolePermissions = new Map<string, string[]>([
    ["accountant", ["GL_READ", "GL_POST"]],
    ["viewer", ["GL_READ"]],
    ["admin", ["ADMIN_USERS"]]
  ]);
  entities = [
    { id: "group", parentId: null, isActive: true },
    { id: "propA", parentId: "group", isActive: true },
    { id: "propB", parentId: "group", isActive: true },
    { id: "propC", parentId: "group", isActive: true }
  ];
  /** Runs while a load is in flight, after the data has been read. */
  afterRead: (() => Promise<void>) | null = null;

  async loadSnapshot(): Promise<AccessSnapshot> {
    this.loads += 1;
    if (this.failing) throw new Error("connection terminated unexpectedly");
    const snapshot: AccessSnapshot = {
      userIsActive: this.userIsActive,
      entities: this.entities.map((e) => ({ ...e })),
      assignments: this.assignments.map((a) => ({ ...a })),
      rolePermissions: new Map(this.rolePermissions)
    };
    if (this.afterRead) {
      const hook = this.afterRead;
      this.afterRead = null;
      await hook();
    }
    return snapshot;
  }
}

function setup() {
  const redis = new FakeRedis();
  const source = new FakeSource();
  const service = new AccessService(source, new RedisAccessCache(redis, { ttlSeconds: 300 }));
  return { redis, source, service };
}

const ALICE = { tenantId: "tenant-1", userId: "alice" };

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AccessService", () => {
  it("answers per entity: allowed on A, read-only on B, closed on C (acceptance 1)", async () => {
    const { source, service } = setup();
    source.assignments = [
      { scopeType: "ENTITY", roleId: "accountant", entityId: "propA" },
      { scopeType: "ENTITY", roleId: "viewer", entityId: "propB" }
    ];
    expect(await service.can(ALICE, "GL_POST", "propA")).toBe(true);
    expect(await service.can(ALICE, "GL_POST", "propB")).toBe(false);
    expect(await service.can(ALICE, "GL_READ", "propB")).toBe(true);
    expect(await service.canOpen(ALICE, "propC")).toBe(false);
    expect(await service.can(ALICE, "GL_READ", "propC")).toBe(false);
  });

  it("gives a group assignment the same permissions on every property (acceptance 2)", async () => {
    const { source, service } = setup();
    source.assignments = [{ scopeType: "ENTITY", roleId: "accountant", entityId: "group" }];
    for (const id of ["propA", "propB", "propC"]) {
      expect(await service.can(ALICE, "GL_POST", id)).toBe(true);
    }
  });

  it("checks tenant-level permissions against tenant-wide assignments only", async () => {
    const { source, service } = setup();
    source.rolePermissions.set("entityAdmin", ["ADMIN_USERS"]);
    source.assignments = [{ scopeType: "ENTITY", roleId: "entityAdmin", entityId: "group" }];
    expect(await service.canAtTenant(ALICE, "ADMIN_USERS")).toBe(false);
    expect(await service.can(ALICE, "ADMIN_USERS", "propA")).toBe(true);

    source.assignments = [{ scopeType: "TENANT", roleId: "admin" }];
    await service.invalidateUser(ALICE);
    expect(await service.canAtTenant(ALICE, "ADMIN_USERS")).toBe(true);
  });

  it("gives a deactivated or unknown user no access", async () => {
    const { source, service } = setup();
    source.assignments = [{ scopeType: "TENANT", roleId: "admin" }];
    source.userIsActive = false;
    expect(await service.canAtTenant(ALICE, "ADMIN_USERS")).toBe(false);
    expect(await service.canOpen(ALICE, "propA")).toBe(false);
  });

  describe("caching", () => {
    it("loads once and serves later checks from the cache", async () => {
      const { source, service } = setup();
      source.assignments = [{ scopeType: "ENTITY", roleId: "viewer", entityId: "propA" }];
      await service.can(ALICE, "GL_READ", "propA");
      await service.can(ALICE, "GL_POST", "propA");
      await service.canOpen(ALICE, "propB");
      expect(source.loads).toBe(1);
    });

    it("caches a user with no access too", async () => {
      const { source, service } = setup();
      await service.canOpen(ALICE, "propA");
      await service.canOpen(ALICE, "propA");
      expect(source.loads).toBe(1);
    });

    it("keeps tenants and users apart", async () => {
      const { source, service } = setup();
      source.assignments = [{ scopeType: "ENTITY", roleId: "viewer", entityId: "propA" }];
      await service.resolve(ALICE);
      await service.resolve({ tenantId: "tenant-2", userId: "alice" });
      await service.resolve({ tenantId: "tenant-1", userId: "bob" });
      expect(source.loads).toBe(3);
    });

    it("prefixes every key with the tenant", async () => {
      const { redis, source, service } = setup();
      source.assignments = [{ scopeType: "ENTITY", roleId: "viewer", entityId: "propA" }];
      await service.resolve(ALICE);
      await service.invalidateUser(ALICE);
      await service.invalidateTenant(ALICE.tenantId);
      expect([...redis.store.keys()].every((k) => k.startsWith("access:tenant-1:"))).toBe(true);
    });

    it("recomputes when a cached entry is corrupt", async () => {
      const { redis, source, service } = setup();
      source.assignments = [{ scopeType: "ENTITY", roleId: "viewer", entityId: "propA" }];
      await service.resolve(ALICE);
      for (const key of redis.store.keys()) redis.store.set(key, "{not json");
      expect(await service.can(ALICE, "GL_READ", "propA")).toBe(true);
      expect(source.loads).toBe(2);
    });
  });

  describe("revocation and invalidation (acceptance 3)", () => {
    it("drops a removed role on the next check after the user is invalidated", async () => {
      const { source, service } = setup();
      source.assignments = [{ scopeType: "ENTITY", roleId: "accountant", entityId: "propA" }];
      expect(await service.can(ALICE, "GL_POST", "propA")).toBe(true);

      source.assignments = [];
      await service.invalidateUser(ALICE);

      expect(await service.can(ALICE, "GL_POST", "propA")).toBe(false);
      expect(await service.canOpen(ALICE, "propA")).toBe(false);
    });

    it("does not disturb other users when one user is invalidated", async () => {
      const { source, service } = setup();
      const bob = { tenantId: "tenant-1", userId: "bob" };
      await service.resolve(ALICE);
      await service.resolve(bob);
      await service.invalidateUser(ALICE);
      await service.resolve(bob);
      expect(source.loads).toBe(2);
    });

    it("applies a change to a role's permissions to every user after a tenant invalidation", async () => {
      const { source, service } = setup();
      const bob = { tenantId: "tenant-1", userId: "bob" };
      source.assignments = [{ scopeType: "ENTITY", roleId: "viewer", entityId: "propA" }];
      expect(await service.can(ALICE, "GL_POST", "propA")).toBe(false);
      expect(await service.can(bob, "GL_POST", "propA")).toBe(false);

      source.rolePermissions.set("viewer", ["GL_READ", "GL_POST"]);
      await service.invalidateTenant("tenant-1");

      expect(await service.can(ALICE, "GL_POST", "propA")).toBe(true);
      expect(await service.can(bob, "GL_POST", "propA")).toBe(true);
    });

    it("applies a change to the entity tree after a tenant invalidation", async () => {
      const { source, service } = setup();
      source.assignments = [{ scopeType: "ENTITY", roleId: "viewer", entityId: "group" }];
      expect(await service.canOpen(ALICE, "propD")).toBe(false);

      source.entities.push({ id: "propD", parentId: "group", isActive: true });
      await service.invalidateTenant("tenant-1");

      expect(await service.canOpen(ALICE, "propD")).toBe(true);
    });

    it("does not invalidate another tenant", async () => {
      const { source, service } = setup();
      const other = { tenantId: "tenant-2", userId: "alice" };
      await service.resolve(other);
      await service.invalidateTenant("tenant-1");
      await service.resolve(other);
      expect(source.loads).toBe(1);
    });

    it("never serves a result computed from data read before the revocation", async () => {
      const { source, service } = setup();
      source.assignments = [{ scopeType: "ENTITY", roleId: "accountant", entityId: "propA" }];
      // While the first request is still loading (it has read the old
      // assignments), an admin removes the role and invalidates the user.
      source.afterRead = async () => {
        source.assignments = [];
        await service.invalidateUser(ALICE);
      };
      await service.resolve(ALICE); // in-flight request: may see the old data once

      expect(await service.can(ALICE, "GL_POST", "propA")).toBe(false);
    });
  });

  describe("infrastructure faults (acceptance 6, AUT-10)", () => {
    it("raises AccessInfrastructureError when the cache is down, not a denial", async () => {
      const { redis, source, service } = setup();
      source.assignments = [{ scopeType: "TENANT", roleId: "admin" }];
      redis.failing = true;
      const attempt = service.canAtTenant(ALICE, "ADMIN_USERS");
      await expect(attempt).rejects.toBeInstanceOf(AccessInfrastructureError);
      await expect(attempt).rejects.toMatchObject({ dependency: "cache" });
      expect(source.loads).toBe(0);
    });

    it("raises AccessInfrastructureError when the database is down and caches nothing", async () => {
      const { redis, source, service } = setup();
      source.failing = true;
      const attempt = service.can(ALICE, "GL_READ", "propA");
      await expect(attempt).rejects.toBeInstanceOf(AccessInfrastructureError);
      await expect(attempt).rejects.toMatchObject({ dependency: "database" });
      expect(redis.store.size).toBe(0);

      source.failing = false;
      source.assignments = [{ scopeType: "ENTITY", roleId: "viewer", entityId: "propA" }];
      expect(await service.can(ALICE, "GL_READ", "propA")).toBe(true);
    });

    it("keeps the original error as the cause", async () => {
      const { source, service } = setup();
      source.failing = true;
      const error = await service.resolve(ALICE).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AccessInfrastructureError);
      expect((error as AccessInfrastructureError).cause).toBeInstanceOf(Error);
    });

    it("raises when an invalidation cannot be recorded", async () => {
      const { redis, service } = setup();
      redis.failing = true;
      await expect(service.invalidateUser(ALICE)).rejects.toBeInstanceOf(AccessInfrastructureError);
      await expect(service.invalidateTenant("tenant-1")).rejects.toBeInstanceOf(
        AccessInfrastructureError
      );
    });
  });

  it("rejects a non-positive cache lifetime", () => {
    expect(() => new RedisAccessCache(new FakeRedis(), { ttlSeconds: 0 })).toThrow(/ttlSeconds/);
  });
});
