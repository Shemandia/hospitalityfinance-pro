/**
 * Cross-Entity Security Tests
 *
 * Verifies that entity isolation prevents unauthorized cross-entity data access.
 * Tests the three layers:
 *   1. Router-level requireEntityId enforcement
 *   2. Prisma entity scope extension
 *   3. Entity scope function behavior with mismatched IDs
 */

import { describe, expect, it, vi } from "vitest";
import { applyEntityScope } from "../src/db/entityScope.js";
import { redactSensitiveFields } from "../src/shared/log-redactor.js";

// The entity router imports the database client; nothing here uses it.
vi.mock("../src/db/prisma.js", () => ({ prisma: {} }));

import { canManageEntity, canPlaceEntityUnder } from "../src/modules/entity/router.js";
import type { ResolvedAccess } from "../src/modules/access/resolver.js";

// ── Test Entities ──────────────────────────────────────────────────────────────

const ENTITY_A = "00000000-0000-0000-0000-000000000002"; // Property A (Jumeirah)
const ENTITY_B = "00000000-0000-0000-0000-000000000003"; // Property B (Doha)

describe("Cross-Entity Data Isolation", () => {
  describe("Entity scope prevents cross-entity reads", () => {
    it("findMany scoped to Entity A cannot see Entity B data", () => {
      const scoped = applyEntityScope("findMany", { where: { status: "OPEN" } }, ENTITY_A);
      expect(scoped.where).toEqual({
        AND: [{ entityId: ENTITY_A }, { status: "OPEN" }]
      });
      // Verify Entity B's ID is NOT in the scope
      expect(JSON.stringify(scoped.where)).not.toContain(ENTITY_B);
    });

    it("findFirst scoped to Entity A includes entity filter", () => {
      const scoped = applyEntityScope("findFirst", { where: { id: "some-id" } }, ENTITY_A);
      expect(scoped.where).toEqual({
        AND: [{ entityId: ENTITY_A }, { id: "some-id" }]
      });
    });

    it("findUnique is not wrapped — protected by RLS instead", () => {
      const scoped = applyEntityScope("findUnique", { where: { id: "some-id" } }, ENTITY_A);
      // Single-record ops (findUnique, update, delete) rely on PostgreSQL RLS
      // rather than Prisma where-clause wrapping to avoid breaking unique constraints
      expect(scoped.where).toEqual({ id: "some-id" });
    });

    it("count scoped to Entity A includes entity filter", () => {
      const scoped = applyEntityScope("count", {}, ENTITY_A);
      expect(scoped.where).toEqual({ entityId: ENTITY_A });
    });
  });

  describe("Entity scope prevents cross-entity writes", () => {
    it("create auto-injects entityId when missing", () => {
      const scoped = applyEntityScope("create", { data: { name: "Test" } }, ENTITY_A);
      expect((scoped.data as any).entityId).toBe(ENTITY_A);
    });

    it("create rejects an explicitly mismatched entityId", () => {
      expect(() =>
        applyEntityScope("create", { data: { name: "Test", entityId: ENTITY_B } }, ENTITY_A)
      ).toThrow("Entity context mismatch");
    });

    it("update is not wrapped — protected by RLS instead", () => {
      const scoped = applyEntityScope(
        "update",
        { where: { id: "invoice-1" }, data: { status: "PAID" } },
        ENTITY_A
      );
      // Single-record update relies on PostgreSQL RLS, not where-clause wrapping
      expect(scoped.where).toEqual({ id: "invoice-1" });
    });

    it("delete is not wrapped — protected by RLS instead", () => {
      const scoped = applyEntityScope("delete", { where: { id: "record-1" } }, ENTITY_A);
      // Single-record delete relies on PostgreSQL RLS, not where-clause wrapping
      expect(scoped.where).toEqual({ id: "record-1" });
    });

    it("createMany injects entityId into each row", () => {
      const scoped = applyEntityScope(
        "createMany",
        { data: [{ name: "A" }, { name: "B" }] },
        ENTITY_A
      );
      expect(scoped.data).toEqual([
        { name: "A", entityId: ENTITY_A },
        { name: "B", entityId: ENTITY_A }
      ]);
    });
  });

  describe("Entity scope with ID manipulation (IDOR prevention)", () => {
    it("attacker Entity B ID in where clause is overridden by scope", () => {
      // Simulate: attacker sends entityId=ENTITY_B in query, but scope enforces ENTITY_A
      const scoped = applyEntityScope(
        "findMany",
        { where: { entityId: ENTITY_B, status: "OPEN" } },
        ENTITY_A
      );
      // The AND clause ensures ENTITY_A is required, making ENTITY_B filter ineffective
      expect(scoped.where).toEqual({
        AND: [{ entityId: ENTITY_A }, { entityId: ENTITY_B, status: "OPEN" }]
      });
      // Both conditions must match — since a record can only belong to one entity,
      // this returns no results (effectively blocking the cross-entity access)
    });

    it("attacker cannot bypass scope via nested OR clause", () => {
      const scoped = applyEntityScope(
        "findMany",
        { where: { OR: [{ entityId: ENTITY_A }, { entityId: ENTITY_B }] } },
        ENTITY_A
      );
      // Scope wraps the attacker's OR in an AND with the real entity
      expect(scoped.where).toEqual({
        AND: [{ entityId: ENTITY_A }, { OR: [{ entityId: ENTITY_A }, { entityId: ENTITY_B }] }]
      });
      // PostgreSQL evaluates: entityId=A AND (entityId=A OR entityId=B) → only A
    });
  });
});

// Who may see and change which users and grants is tested against a real
// database in tests/integration/admin-scope.test.ts.

describe("Entity management checks", () => {
  const entityAdminAtA: ResolvedAccess = {
    tenantPermissions: [],
    entityPermissions: { [ENTITY_A]: ["ADMIN_ENTITIES"] }
  };
  const OTHER_PARENT = "00000000-0000-0000-0000-000000000009";

  it("blocks entity admins creating entities under a parent they do not administer", () => {
    expect(canPlaceEntityUnder(entityAdminAtA, ENTITY_B)).toBe(false);
    expect(canPlaceEntityUnder(entityAdminAtA, ENTITY_A)).toBe(true);
  });

  it("blocks entity admins creating or moving an entity to the root", () => {
    expect(canPlaceEntityUnder(entityAdminAtA, null)).toBe(false);
  });

  it("blocks entity admins moving entities to a parent they do not administer", () => {
    expect(canPlaceEntityUnder(entityAdminAtA, OTHER_PARENT)).toBe(false);
  });

  it("blocks entity admins changing or deleting entities outside their tree", () => {
    expect(canManageEntity(entityAdminAtA, { id: ENTITY_B, parentId: null })).toBe(false);
    expect(canManageEntity(entityAdminAtA, { id: ENTITY_B, parentId: OTHER_PARENT })).toBe(false);
  });

  it("lets entity admins restore an inactive child of an entity they administer", () => {
    // An inactive entity is absent from entityPermissions; the parent grant covers it.
    expect(canManageEntity(entityAdminAtA, { id: ENTITY_B, parentId: ENTITY_A })).toBe(true);
  });

  it("does not treat ADMIN_USERS as permission to manage entities", () => {
    const userAdmin: ResolvedAccess = {
      tenantPermissions: [],
      entityPermissions: { [ENTITY_A]: ["ADMIN_USERS"] }
    };
    expect(canManageEntity(userAdmin, { id: ENTITY_A, parentId: null })).toBe(false);
  });

  it("lets a tenant-wide entity administrator manage any entity and the root", () => {
    const tenantAdmin: ResolvedAccess = {
      tenantPermissions: ["ADMIN_ENTITIES"],
      entityPermissions: {}
    };
    expect(canManageEntity(tenantAdmin, { id: ENTITY_B, parentId: null })).toBe(true);
    expect(canPlaceEntityUnder(tenantAdmin, null)).toBe(true);
  });
});

// ── Sensitive Data Masking Tests ───────────────────────────────────────────────

describe("Sensitive data masking in logs", () => {
  it("redacts bank details from log payloads", () => {
    const payload = {
      supplierId: "sup-1",
      name: "Test Supplier",
      bankDetails: { iban: "GB82WEST12345698765432", swift: "WESTGB2L" },
      amount: "1500.00"
    };
    const redacted = redactSensitiveFields(payload) as any;
    expect(redacted.bankDetails).toBe("[REDACTED]");
    expect(redacted.supplierId).toBe("sup-1");
    expect(redacted.amount).toBe("1500.00");
  });

  it("redacts nested passwords and tokens", () => {
    const payload = {
      user: { name: "admin", password: "secret123", token: "jwt-token-value" },
      entityId: "entity-1"
    };
    const redacted = redactSensitiveFields(payload) as any;
    expect(redacted.user.password).toBe("[REDACTED]");
    expect(redacted.user.token).toBe("[REDACTED]");
    expect(redacted.user.name).toBe("admin");
    expect(redacted.entityId).toBe("entity-1");
  });

  it("redacts tax IDs and API keys", () => {
    const payload = {
      taxId: "123-45-6789",
      apiKey: "sk-123abc",
      companyName: "HFP Corp"
    };
    const redacted = redactSensitiveFields(payload) as any;
    expect(redacted.taxId).toBe("[REDACTED]");
    expect(redacted.apiKey).toBe("[REDACTED]");
    expect(redacted.companyName).toBe("HFP Corp");
  });

  it("handles arrays with sensitive objects", () => {
    const payload = [
      { name: "Item 1", secret: "abc" },
      { name: "Item 2", password: "def" }
    ];
    const redacted = redactSensitiveFields(payload) as any[];
    expect(redacted[0].secret).toBe("[REDACTED]");
    expect(redacted[1].password).toBe("[REDACTED]");
    expect(redacted[0].name).toBe("Item 1");
  });

  it("limits recursion depth to prevent stack overflow", () => {
    // Create deeply nested object
    let obj: any = { value: "deep" };
    for (let i = 0; i < 15; i++) {
      obj = { nested: obj };
    }
    // Should not throw, and deep values should be redacted at depth limit
    expect(() => redactSensitiveFields(obj)).not.toThrow();
  });

  it("handles null and undefined gracefully", () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
    expect(redactSensitiveFields("plain string")).toBe("plain string");
  });
});
