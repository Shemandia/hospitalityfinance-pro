import { describe, expect, it } from "vitest";
import { checkPrivilegeCeiling, type AdminActorContext } from "../src/modules/admin/service.js";
import type { ResolvedAccess } from "../src/modules/access/resolver.js";

const perm = (code: string) => ({ permission: { code } });
const role = (codes: string[], isSystem = false) => ({ isSystem, permissions: codes.map(perm) });

const AT_A = { scope: "ENTITY", entityId: "entity-a" } as const;
const AT_B = { scope: "ENTITY", entityId: "entity-b" } as const;
const TENANT = { scope: "TENANT" } as const;

function actor(access: ResolvedAccess): AdminActorContext {
  return { userId: "actor-1", access, admittedBy: ["ADMIN_USERS"], entityId: "entity-a" };
}

// User administrator on A; holds GL_POST only on B, where they are not an administrator.
const propertyAdmin = actor({
  tenantPermissions: [],
  entityPermissions: {
    "entity-a": ["ADMIN_USERS", "GL_READ"],
    "entity-b": ["GL_POST", "GL_READ"]
  }
});

const tenantAdmin = actor({
  tenantPermissions: ["ADMIN_USERS", "GL_POST", "GL_READ"],
  entityPermissions: { "entity-a": ["ADMIN_USERS", "GL_POST", "GL_READ"] }
});

// Reaches every entity for user administration, but holds nothing else.
const tenantUserAdmin = actor({
  tenantPermissions: ["ADMIN_USERS"],
  entityPermissions: { "entity-a": ["ADMIN_USERS"] }
});

describe("checkPrivilegeCeiling — no escalation", () => {
  it("allows a role whose permissions the caller holds at the target", () => {
    expect(checkPrivilegeCeiling(propertyAdmin, role(["GL_READ"]), AT_A)).toBe(true);
    expect(checkPrivilegeCeiling(propertyAdmin, role([]), AT_A)).toBe(true);
  });

  it("blocks a role with a permission the caller does not hold at the target", () => {
    expect(checkPrivilegeCeiling(propertyAdmin, role(["GL_READ", "PERIOD_REOPEN"]), AT_A)).toBe(
      false
    );
  });

  it("does not count a permission the caller holds at another entity", () => {
    expect(checkPrivilegeCeiling(propertyAdmin, role(["GL_POST"]), AT_A)).toBe(false);
  });

  it("measures the ceiling at the target entity, not at the caller's selected entity", () => {
    // Reach is checked separately; the ceiling alone looks at what is held at B.
    expect(checkPrivilegeCeiling(propertyAdmin, role(["ADMIN_USERS"]), AT_B)).toBe(false);
  });

  it("blocks a system role for a caller without tenant-wide reach, even an empty one", () => {
    expect(checkPrivilegeCeiling(propertyAdmin, role([], true), AT_A)).toBe(false);
  });

  it("blocks a tenant-wide grant for a caller without tenant-wide reach", () => {
    expect(checkPrivilegeCeiling(propertyAdmin, role(["GL_READ"]), TENANT)).toBe(false);
  });

  it("compares permission codes case-insensitively", () => {
    expect(checkPrivilegeCeiling(propertyAdmin, role(["gl_read"]), AT_A)).toBe(true);
  });

  it("lets a tenant administrator grant system roles and tenant-wide grants they cover", () => {
    expect(checkPrivilegeCeiling(tenantAdmin, role(["GL_POST"], true), TENANT)).toBe(true);
    expect(checkPrivilegeCeiling(tenantAdmin, role(["GL_POST"]), AT_A)).toBe(true);
  });

  it("holds a tenant-wide caller to the same ceiling: reach is not privilege", () => {
    expect(checkPrivilegeCeiling(tenantUserAdmin, role(["GL_POST"]), AT_A)).toBe(false);
    expect(checkPrivilegeCeiling(tenantUserAdmin, role(["GL_POST"], true), TENANT)).toBe(false);
    expect(checkPrivilegeCeiling(tenantUserAdmin, role(["ADMIN_USERS"]), TENANT)).toBe(true);
  });

  it("applies tenant-wide permissions at an inactive entity, which has no entry of its own", () => {
    const inactive = { scope: "ENTITY", entityId: "entity-closed" } as const;
    expect(checkPrivilegeCeiling(tenantAdmin, role(["GL_POST"]), inactive)).toBe(true);
  });
});
