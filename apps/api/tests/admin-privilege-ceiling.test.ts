import { describe, expect, it } from "vitest";
import { checkPrivilegeCeiling, type AdminActorContext } from "../src/modules/admin/service.js";

const perm = (code: string) => ({ permission: { code } });

function actor(overrides: Partial<AdminActorContext> = {}): AdminActorContext {
  return {
    userId: "actor-1",
    tenantWide: false,
    permissions: ["ADMIN_USERS", "ADMIN_ROLES_MANAGE", "GL_READ", "GL_POST"],
    entityIds: ["entity-a"],
    entityId: "entity-a",
    ...overrides
  };
}

describe("checkPrivilegeCeiling (NS2 — no self-escalation)", () => {
  it("blocks an entity-level admin from granting a system role, even an empty one", () => {
    expect(checkPrivilegeCeiling(actor(), { isSystem: true, permissions: [] })).toBe(false);
  });

  it("compares permission codes case-insensitively", () => {
    expect(
      checkPrivilegeCeiling(actor(), { isSystem: false, permissions: [perm("gl_read")] })
    ).toBe(true);
  });

  it("blocks granting a role whose permissions exceed the actor's own", () => {
    expect(
      checkPrivilegeCeiling(actor(), {
        isSystem: false,
        permissions: [perm("GL_READ"), perm("PERIOD_REOPEN")]
      })
    ).toBe(false);
  });

  it("allows granting a role whose permissions are a subset of the actor's", () => {
    expect(
      checkPrivilegeCeiling(actor(), {
        isSystem: false,
        permissions: [perm("GL_READ"), perm("GL_POST")]
      })
    ).toBe(true);
  });

  it("lets an admin with tenant-wide reach grant anything", () => {
    expect(
      checkPrivilegeCeiling(actor({ tenantWide: true }), {
        isSystem: true,
        permissions: [perm("ANYTHING")]
      })
    ).toBe(true);
  });
});
