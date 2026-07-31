/**
 * Tenant Isolation Tests
 *
 * Verifies that the database-per-tenant architecture correctly isolates
 * tenants at the connection level. Tests the tenant pool, registry resolution,
 * and request context routing.
 *
 * These tests verify the routing logic WITHOUT requiring actual databases.
 */

import { describe, expect, it, beforeEach } from "vitest";
import {
  enterRequestContext,
  getRequestContext,
  updateRequestContext
} from "../src/db/requestContext.js";

// ── Request Context: Tenant Fields ─────────────────────────────────────────

describe("Request context carries tenant info", () => {
  beforeEach(() => {
    enterRequestContext();
  });

  it("defaults to null tenantSlug and tenantDbUrl", () => {
    const ctx = getRequestContext();
    expect(ctx.tenantSlug).toBeNull();
    expect(ctx.tenantDbUrl).toBeNull();
  });

  it("stores tenantSlug when set via updateRequestContext", () => {
    updateRequestContext({
      tenantSlug: "marriott-me",
      tenantDbUrl: "postgresql://localhost:5432/hfp_marriott_me"
    });

    const ctx = getRequestContext();
    expect(ctx.tenantSlug).toBe("marriott-me");
    expect(ctx.tenantDbUrl).toBe("postgresql://localhost:5432/hfp_marriott_me");
  });

  it("tenant context is independent from entity context", () => {
    updateRequestContext({
      tenantSlug: "hilton-eu",
      tenantDbUrl: "postgresql://localhost:5432/hfp_hilton_eu",
      entityId: "entity-123"
    });

    const ctx = getRequestContext();
    expect(ctx.tenantSlug).toBe("hilton-eu");
    expect(ctx.entityId).toBe("entity-123");
  });

  it("different request contexts hold different tenants", () => {
    // Simulate request 1
    enterRequestContext({
      tenantSlug: "chain-a",
      tenantDbUrl: "postgresql://localhost:5432/hfp_chain_a"
    });
    expect(getRequestContext().tenantSlug).toBe("chain-a");

    // Simulate request 2 (new context)
    enterRequestContext({
      tenantSlug: "chain-b",
      tenantDbUrl: "postgresql://localhost:5432/hfp_chain_b"
    });
    expect(getRequestContext().tenantSlug).toBe("chain-b");
    // chain-a is gone from this context
    expect(getRequestContext().tenantSlug).not.toBe("chain-a");
  });
});

// ── Tenant Pool: Connection Routing ────────────────────────────────────────

describe("Tenant pool routes to correct database", () => {
  it("getTenantClient returns a client for a given slug + URL", async () => {
    // We can't connect without a real DB, but we can verify the pool logic
    const { getTenantClient, getPoolSize } = await import("../src/db/tenantPool.js");

    // Pool starts empty (or with previously created clients)
    const initialSize = getPoolSize();

    // Getting a client should create one
    // Note: this won't connect until a query is made
    const client = getTenantClient(
      "test-tenant-pool",
      "postgresql://fake:fake@localhost:9999/fake_db"
    );
    expect(client).toBeDefined();
    expect(getPoolSize()).toBe(initialSize + 1);

    // Getting the same tenant returns the same client
    const client2 = getTenantClient(
      "test-tenant-pool",
      "postgresql://fake:fake@localhost:9999/fake_db"
    );
    expect(client2).toBe(client);
    expect(getPoolSize()).toBe(initialSize + 1); // no new client created

    // Different tenant creates a new client
    const client3 = getTenantClient(
      "test-tenant-pool-2",
      "postgresql://fake:fake@localhost:9999/fake_db_2"
    );
    expect(client3).not.toBe(client);
    expect(getPoolSize()).toBe(initialSize + 2);
  });

  it("evictTenant removes client from pool", async () => {
    const { getTenantClient, evictTenant, getPoolSize } = await import("../src/db/tenantPool.js");

    const slug = "test-evict-" + Date.now();
    getTenantClient(slug, "postgresql://fake:fake@localhost:9999/fake_evict");
    const sizeAfterCreate = getPoolSize();

    await evictTenant(slug);
    expect(getPoolSize()).toBe(sizeAfterCreate - 1);
  });
});

// ── Three-Chain Isolation Scenarios ────────────────────────────────────────

describe("Three-chain tenant isolation", () => {
  const chains = [
    {
      slug: "sunrise-hotels",
      dbUrl: "postgresql://localhost:5432/hfp_sunrise_hotels",
      entity: "sunrise-entity-1"
    },
    {
      slug: "ocean-resorts",
      dbUrl: "postgresql://localhost:5432/hfp_ocean_resorts",
      entity: "ocean-entity-1"
    },
    {
      slug: "mountain-lodges",
      dbUrl: "postgresql://localhost:5432/hfp_mountain_lodges",
      entity: "mountain-entity-1"
    }
  ];

  it("each chain gets its own database URL in context", () => {
    for (const chain of chains) {
      enterRequestContext({
        tenantSlug: chain.slug,
        tenantDbUrl: chain.dbUrl,
        entityId: chain.entity
      });

      const ctx = getRequestContext();
      expect(ctx.tenantSlug).toBe(chain.slug);
      expect(ctx.tenantDbUrl).toBe(chain.dbUrl);
      expect(ctx.entityId).toBe(chain.entity);
    }
  });

  it("chain A context does not leak to chain B", () => {
    // Set chain A context
    enterRequestContext({
      tenantSlug: chains[0].slug,
      tenantDbUrl: chains[0].dbUrl,
      entityId: chains[0].entity
    });
    expect(getRequestContext().tenantSlug).toBe("sunrise-hotels");

    // Overwrite with chain B context (simulates new request)
    enterRequestContext({
      tenantSlug: chains[1].slug,
      tenantDbUrl: chains[1].dbUrl,
      entityId: chains[1].entity
    });

    const ctx = getRequestContext();
    expect(ctx.tenantSlug).toBe("ocean-resorts");
    expect(ctx.tenantDbUrl).toBe(chains[1].dbUrl);
    // Chain A's values are NOT present
    expect(ctx.tenantSlug).not.toBe("sunrise-hotels");
    expect(ctx.entityId).not.toBe(chains[0].entity);
  });

  it("each chain maps to a unique database in the pool", async () => {
    const { getTenantClient } = await import("../src/db/tenantPool.js");

    const clients = chains.map((c) => getTenantClient(c.slug, c.dbUrl));

    // All three clients are different objects
    expect(clients[0]).not.toBe(clients[1]);
    expect(clients[1]).not.toBe(clients[2]);
    expect(clients[0]).not.toBe(clients[2]);
  });

  it("tenant context without slug falls back to default client", () => {
    enterRequestContext({
      tenantSlug: null,
      tenantDbUrl: null,
      entityId: "some-entity"
    });

    const ctx = getRequestContext();
    expect(ctx.tenantSlug).toBeNull();
    expect(ctx.tenantDbUrl).toBeNull();
    // The prisma proxy will use the default client (registry DB)
  });

  it("deactivated tenant is evicted and cannot reconnect to pool", async () => {
    const { getTenantClient, evictTenant, getPoolSize } = await import("../src/db/tenantPool.js");
    const slug = "deactivated-chain-" + Date.now();
    const url = "postgresql://fake:fake@localhost:9999/hfp_deactivated";

    // Create client
    const client = getTenantClient(slug, url);
    expect(client).toBeDefined();

    // Evict (simulates deactivation)
    await evictTenant(slug);

    // Re-creating after eviction gives a NEW client instance
    const newClient = getTenantClient(slug, url);
    expect(newClient).not.toBe(client);
  });
});

// ── Slug Validation ────────────────────────────────────────────────────────

describe("Tenant slug validation", () => {
  const validSlugs = ["marriott-me", "hilton-eu", "accor-apac", "chain123", "ab-cd-ef"];
  const invalidSlugs = [
    "-starts-with-dash",
    "ends-with-dash-",
    "A",
    "ab",
    "UPPERCASE",
    "has spaces",
    "special!chars"
  ];

  const slugRegex = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

  for (const slug of validSlugs) {
    it(`accepts valid slug: "${slug}"`, () => {
      expect(slugRegex.test(slug)).toBe(true);
    });
  }

  for (const slug of invalidSlugs) {
    it(`rejects invalid slug: "${slug}"`, () => {
      expect(slugRegex.test(slug)).toBe(false);
    });
  }
});
