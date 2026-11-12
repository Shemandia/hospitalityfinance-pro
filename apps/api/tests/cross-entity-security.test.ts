/**
 * Cross-Entity Security Tests
 *
 * Verifies that entity isolation prevents unauthorized cross-entity data access.
 * Tests the three layers:
 *   1. Router-level requireEntityId enforcement
 *   2. Prisma entity scope extension
 *   3. Entity scope function behavior with mismatched IDs
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyEntityScope } from "../src/db/entityScope.js";
import { redactSensitiveFields } from "../src/shared/log-redactor.js";

const dbMocks = vi.hoisted(() => {
  const tx = {
    $executeRawUnsafe: vi.fn(),
    entity: {
      findMany: vi.fn(),
      findUnique: vi.fn()
    },
    entityUser: {
      findMany: vi.fn(),
      upsert: vi.fn()
    },
    loginAudit: {
      create: vi.fn(),
      findMany: vi.fn()
    },
    role: {
      findUnique: vi.fn()
    },
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn()
    },
    userRole: {
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn()
    }
  };

  return {
    prisma: {
      $transaction: vi.fn(),
      entity: tx.entity,
      entityUser: tx.entityUser,
      loginAudit: tx.loginAudit,
      role: tx.role,
      user: tx.user,
      userRole: tx.userRole
    },
    tx
  };
});

vi.mock("../src/db/prisma.js", () => ({ prisma: dbMocks.prisma }));
vi.mock("../src/shared/email.js", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined)
}));

import {
  assignRoleToUser,
  createLoginAudit,
  getUserRoles,
  hasCrossEntityAdminAccess,
  isEntityInActorLineage,
  filterRowsToManagedEntities,
  inviteUser,
  listAllUsers,
  listLoginAudits,
  revokeRoleFromUser,
  updateUserStatus
} from "../src/modules/admin/service.js";
import { canManageEntity, canPlaceEntityUnder } from "../src/modules/entity/router.js";
import type { ResolvedAccess } from "../src/modules/access/resolver.js";

// ── Test Entities ──────────────────────────────────────────────────────────────

const ENTITY_A = "00000000-0000-0000-0000-000000000002"; // Property A (Jumeirah)
const ENTITY_B = "00000000-0000-0000-0000-000000000003"; // Property B (Doha)
const ENTITY_A_CHILD = "00000000-0000-0000-0000-000000000004";
const ROLE_ID = "10000000-0000-0000-0000-000000000001";
const USER_INSIDE = "20000000-0000-0000-0000-000000000001";
const USER_OUTSIDE = "20000000-0000-0000-0000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.prisma.$transaction.mockImplementation(async (fn: any) => fn(dbMocks.tx));
  dbMocks.tx.$executeRawUnsafe.mockResolvedValue(undefined);
  dbMocks.tx.entity.findMany.mockImplementation(async ({ where }: any) => {
    if (where?.parentId === ENTITY_A) return [{ id: ENTITY_A_CHILD }];
    return [];
  });
  dbMocks.tx.entity.findUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === ENTITY_A) return { id: ENTITY_A, parentId: null };
    if (where?.id === ENTITY_A_CHILD) return { id: ENTITY_A_CHILD, parentId: ENTITY_A };
    if (where?.id === ENTITY_B) return { id: ENTITY_B, parentId: null };
    return null;
  });
  dbMocks.tx.user.findUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === USER_INSIDE || where?.id === USER_OUTSIDE) return { id: where.id };
    return null;
  });
  dbMocks.tx.user.upsert.mockResolvedValue({
    id: USER_INSIDE,
    email: "inside@test.local",
    name: "Inside User",
    mustChangePassword: true
  });
  dbMocks.tx.user.update.mockResolvedValue({});
  dbMocks.tx.entityUser.upsert.mockResolvedValue({});
  dbMocks.tx.role.findUnique.mockResolvedValue({
    id: ROLE_ID,
    code: "ADMIN_USERS",
    permissions: []
  });
});

// ── Mock helpers ───────────────────────────────────────────────────────────────

function mockRequest(opts: {
  entityId?: string;
  roles?: string[];
  permissions?: string[];
  method?: string;
  sub?: string;
}) {
  return {
    entityId: opts.entityId,
    method: opts.method ?? "GET",
    user: {
      sub: opts.sub ?? "user-1",
      roles: opts.roles ?? ["admin"],
      permissions: opts.permissions ?? []
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

// ── RBAC Cross-Entity Tests ────────────────────────────────────────────────────

describe("Admin entity-scope actor checks", () => {
  it("allows platform/super admins to manage any entity lineage", () => {
    expect(
      isEntityInActorLineage([{ id: ENTITY_B, parentId: null }], {
        permissions: [],
        tenantWide: true,
        entityIds: []
      })
    ).toBe(true);
    expect(hasCrossEntityAdminAccess({ permissions: [], tenantWide: true, entityIds: [] })).toBe(
      true
    );
  });

  it("allows tenant admins to manage descendants of assigned entities", () => {
    expect(
      isEntityInActorLineage(
        [
          { id: ENTITY_B, parentId: ENTITY_A },
          { id: ENTITY_A, parentId: null }
        ],
        { permissions: [], tenantWide: false, entityIds: [ENTITY_A] }
      )
    ).toBe(true);
  });

  it("blocks tenant admins from assigning or revoking unassigned entity lineage", () => {
    expect(
      isEntityInActorLineage(
        [
          { id: ENTITY_B, parentId: "00000000-0000-0000-0000-000000000009" },
          { id: "00000000-0000-0000-0000-000000000009", parentId: null }
        ],
        { permissions: [], tenantWide: false, entityIds: [ENTITY_A] }
      )
    ).toBe(false);
  });

  it("filters inspected user entity assignments to the tenant admin managed tree", () => {
    const rows = filterRowsToManagedEntities(
      [
        { entityId: ENTITY_A, userId: "user-2" },
        { entityId: ENTITY_B, userId: "user-2" }
      ],
      [ENTITY_A]
    );

    expect(rows).toEqual([{ entityId: ENTITY_A, userId: "user-2" }]);
  });

  it("allows superadmins to inspect all user entity assignments", () => {
    const rows = [
      { entityId: ENTITY_A, userId: "user-2" },
      { entityId: ENTITY_B, userId: "user-2" }
    ];

    expect(filterRowsToManagedEntities(rows, null)).toEqual(rows);
  });

  it("filters all-users listing to the tenant admin managed tree", async () => {
    dbMocks.tx.user.findMany.mockResolvedValue([{ id: USER_INSIDE, email: "inside@test.local" }]);

    const users = await listAllUsers({
      permissions: [],
      tenantWide: false,
      entityIds: [ENTITY_A],
      entityId: ENTITY_A
    });

    expect(users).toEqual([{ id: USER_INSIDE, email: "inside@test.local" }]);
    expect(dbMocks.tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entities: {
            some: {
              entityId: { in: [ENTITY_A, ENTITY_A_CHILD] }
            }
          }
        }
      })
    );
  });

  it("allows platform admins to list users across entities", async () => {
    dbMocks.tx.user.findMany.mockResolvedValue([
      { id: USER_INSIDE, email: "inside@test.local" },
      { id: USER_OUTSIDE, email: "outside@test.local" }
    ]);

    const users = await listAllUsers({
      permissions: [],
      tenantWide: true,
      entityIds: [],
      entityId: undefined
    });

    expect(users).toHaveLength(2);
    expect(dbMocks.tx.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {}
      })
    );
  });

  it("allows tenant admins to assign scoped roles to users inside the managed tree", async () => {
    dbMocks.tx.entityUser.findMany.mockResolvedValue([{ entityId: ENTITY_A_CHILD }]);
    dbMocks.tx.userRole.findFirst.mockResolvedValue(null);

    const result = await assignRoleToUser(USER_INSIDE, ROLE_ID, {
      permissions: [],
      tenantWide: false,
      entityIds: [ENTITY_A],
      entityId: ENTITY_A
    });

    expect(result).toEqual({
      data: { userId: USER_INSIDE, roleId: ROLE_ID, entityId: ENTITY_A_CHILD }
    });
    expect(dbMocks.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_roles"),
      USER_INSIDE,
      ROLE_ID,
      ENTITY_A_CHILD
    );
  });

  it("assigns invite roles as entity-scoped for tenant admins", async () => {
    dbMocks.tx.userRole.findFirst.mockResolvedValue(null);

    const result = await inviteUser(
      {
        email: "inside@test.local",
        name: "Inside User",
        roleId: ROLE_ID,
        entityIds: [ENTITY_A_CHILD]
      },
      ENTITY_A,
      { tenantSlug: "test-tenant", tenantCode: "tenant01", tenantName: "Test Tenant" },
      {
        permissions: [],
        tenantWide: false,
        entityIds: [ENTITY_A],
        entityId: ENTITY_A
      }
    );

    expect("error" in result).toBe(false);
    expect(dbMocks.tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_roles"),
      USER_INSIDE,
      ROLE_ID,
      ENTITY_A_CHILD
    );
  });

  it("denies tenant admins assigning roles to users outside the managed tree", async () => {
    dbMocks.tx.entityUser.findMany.mockResolvedValue([]);

    const result = await assignRoleToUser(USER_OUTSIDE, ROLE_ID, {
      permissions: [],
      tenantWide: false,
      entityIds: [ENTITY_A],
      entityId: ENTITY_A
    });

    expect(result).toEqual({ error: "FORBIDDEN" });
    expect(dbMocks.tx.userRole.findFirst).not.toHaveBeenCalled();
    expect(dbMocks.tx.$executeRawUnsafe).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_roles"),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("denies tenant admins revoking roles for users outside the managed tree", async () => {
    dbMocks.tx.entityUser.findMany.mockResolvedValue([]);

    const result = await revokeRoleFromUser(USER_OUTSIDE, ROLE_ID, {
      permissions: [],
      tenantWide: false,
      entityIds: [ENTITY_A],
      entityId: ENTITY_A
    });

    expect(result).toEqual({ error: "FORBIDDEN" });
    expect(dbMocks.tx.userRole.deleteMany).not.toHaveBeenCalled();
  });

  it("denies tenant admins inspecting roles for users outside the managed tree", async () => {
    dbMocks.tx.entityUser.findMany.mockResolvedValue([]);

    const result = await getUserRoles(USER_OUTSIDE, {
      permissions: [],
      tenantWide: false,
      entityIds: [ENTITY_A],
      entityId: ENTITY_A
    });

    expect(result).toEqual({ error: "FORBIDDEN" });
    expect(dbMocks.tx.userRole.findMany).not.toHaveBeenCalled();
  });

  it("denies tenant admins updating status for users outside the managed tree", async () => {
    dbMocks.tx.entityUser.findMany.mockResolvedValue([]);

    const result = await updateUserStatus(USER_OUTSIDE, false, {
      permissions: [],
      tenantWide: false,
      entityIds: [ENTITY_A],
      entityId: ENTITY_A
    });

    expect(result).toEqual({ error: "FORBIDDEN" });
    expect(dbMocks.tx.user.update).not.toHaveBeenCalled();
  });

  it("allows superadmins to manage and inspect cross-entity user roles", async () => {
    dbMocks.tx.userRole.findFirst.mockResolvedValue(null);
    dbMocks.tx.userRole.findMany.mockResolvedValue([
      { role: { id: ROLE_ID, code: "ADMIN_USERS" } }
    ]);

    const assignResult = await assignRoleToUser(USER_OUTSIDE, ROLE_ID, {
      permissions: [],
      tenantWide: true,
      entityIds: []
    });
    const rolesResult = await getUserRoles(USER_OUTSIDE, {
      permissions: [],
      tenantWide: true,
      entityIds: []
    });

    expect(assignResult).toEqual({
      data: { userId: USER_OUTSIDE, roleId: ROLE_ID, entityId: null }
    });
    expect(rolesResult).toEqual({ data: [{ id: ROLE_ID, code: "ADMIN_USERS" }] });
    expect(dbMocks.tx.userRole.findMany).toHaveBeenCalledWith({
      where: { userId: USER_OUTSIDE },
      include: { role: true }
    });
  });

  it("prevents exposed login audit list/create paths from crossing entity scope", async () => {
    const actor = {
      permissions: [],
      tenantWide: false,
      entityIds: [ENTITY_A],
      entityId: ENTITY_A
    };

    await expect(listLoginAudits({ entityId: ENTITY_B }, actor)).resolves.toEqual({
      error: "FORBIDDEN"
    });
    await expect(
      createLoginAudit(
        {
          userId: USER_OUTSIDE,
          email: "outside@test.local",
          action: "LOGIN_SUCCESS",
          entityId: ENTITY_B
        },
        actor
      )
    ).resolves.toEqual({ error: "FORBIDDEN" });
    expect(dbMocks.tx.loginAudit.findMany).not.toHaveBeenCalled();
    expect(dbMocks.tx.loginAudit.create).not.toHaveBeenCalled();
  });

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
