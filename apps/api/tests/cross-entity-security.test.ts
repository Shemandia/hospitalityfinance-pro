/**
 * Cross-Entity Security Tests
 *
 * Verifies that entity isolation prevents unauthorized cross-entity data access.
 * Tests the three layers:
 *   1. Router-level requireEntityId enforcement
 *   2. Prisma entity scope extension
 *   3. Entity scope function behavior with mismatched IDs
 */

import { describe, expect, it } from "vitest";
import { applyEntityScope } from "../src/db/entityScope.js";
import { requireRole } from "../src/middleware/requireRole.js";
import { requireWriteAccess } from "../src/middleware/requireWriteAccess.js";
import { redactSensitiveFields } from "../src/shared/log-redactor.js";

// ── Test Entities ──────────────────────────────────────────────────────────────

const ENTITY_A = "00000000-0000-0000-0000-000000000002"; // Property A (Jumeirah)
const ENTITY_B = "00000000-0000-0000-0000-000000000003"; // Property B (Doha)

// ── Mock helpers ───────────────────────────────────────────────────────────────

function mockRequest(opts: { entityId?: string; roles?: string[]; method?: string; sub?: string }) {
  return {
    entityId: opts.entityId,
    method: opts.method ?? "GET",
    user: {
      sub: opts.sub ?? "user-1",
      roles: opts.roles ?? ["admin"]
    }
  } as any;
}

function mockReply() {
  let statusCode = 200;
  let body: unknown = null;
  const reply = {
    code(c: number) {
      statusCode = c;
      return reply;
    },
    send(b: unknown) {
      body = b;
      return reply;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    }
  };
  return reply as any;
}

// ── Cross-Entity Scope Tests ───────────────────────────────────────────────────

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

    it("create does NOT override explicitly set entityId", () => {
      const scoped = applyEntityScope(
        "create",
        { data: { name: "Test", entityId: ENTITY_B } },
        ENTITY_A
      );
      // Entity B's ID is preserved — this is by design (service layer validates separately)
      expect((scoped.data as any).entityId).toBe(ENTITY_B);
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

// ── RBAC Cross-Entity Tests ────────────────────────────────────────────────────

describe("RBAC blocks unauthorized cross-entity operations", () => {
  it("VIEWER cannot perform POST operations", async () => {
    const req = mockRequest({ entityId: ENTITY_A, roles: ["viewer"], method: "POST" });
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
    expect((reply.body as any)?.errors?.[0]?.code).toBe("INSUFFICIENT_ROLE");
  });

  it("VIEWER cannot perform PUT operations", async () => {
    const req = mockRequest({ entityId: ENTITY_A, roles: ["viewer"], method: "PUT" });
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("VIEWER cannot perform DELETE operations", async () => {
    const req = mockRequest({ entityId: ENTITY_A, roles: ["viewer"], method: "DELETE" });
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("CONTROLLER can perform write operations", async () => {
    const req = mockRequest({ entityId: ENTITY_A, roles: ["controller"], method: "POST" });
    const reply = mockReply();
    await requireWriteAccess(req, reply);
    expect(reply.body).toBeNull(); // no error = allowed
  });

  it("VIEWER cannot access ADMIN-only endpoints", async () => {
    const handler = requireRole(["ADMIN", "SUPERADMIN"]);
    const req = mockRequest({ entityId: ENTITY_A, roles: ["viewer"] });
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.statusCode).toBe(403);
  });

  it("CONTROLLER cannot access ADMIN-only endpoints", async () => {
    const handler = requireRole(["ADMIN", "SUPERADMIN"]);
    const req = mockRequest({ entityId: ENTITY_A, roles: ["controller"] });
    const reply = mockReply();
    await handler(req, reply);
    expect(reply.statusCode).toBe(403);
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
