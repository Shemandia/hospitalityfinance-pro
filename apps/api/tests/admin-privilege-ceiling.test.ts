import { describe, expect, it } from "vitest";
import { checkPrivilegeCeiling, type AdminActorContext } from "../src/modules/admin/service.js";

const perm = (code: string) => ({ permission: { code } });

function actor(overrides: Partial<AdminActorContext> = {}): AdminActorContext {
  return {
    userId: "actor-1",
    roles: ["PROPERTY_ADMIN"],
    permissions: ["ADMIN_USERS", "ADMIN_ROLES_MANAGE", "GL_READ", "GL_POST"],
    entityIds: ["entity-a"],
    entityId: "entity-a",
    ...overrides
  };
}

describe("checkPrivilegeCeiling (NS2 — no self-escalation)", () => {
  it("blocks a non-cross-entity admin from granting SUPERADMIN", () => {
    expect(checkPrivilegeCeiling(actor(), { code: "SUPERADMIN", permissions: [] })).toBe(false);
  });

  it("blocks granting PLATFORM_ADMIN (case-insensitive)", () => {
    expect(checkPrivilegeCeiling(actor(), { code: "platform_admin", permissions: [] })).toBe(false);
  });

  it("blocks granting a role whose permissions exceed the actor's own", () => {
    expect(
      checkPrivilegeCeiling(actor(), {
        code: "CONTROLLER",
        permissions: [perm("GL_READ"), perm("PERIOD_REOPEN")]
      })
    ).toBe(false);
  });

  it("allows granting a role whose permissions are a subset of the actor's", () => {
    expect(
      checkPrivilegeCeiling(actor(), {
        code: "CLERK",
        permissions: [perm("GL_READ"), perm("GL_POST")]
      })
    ).toBe(true);
  });

  it("lets SUPERADMIN grant anything", () => {
    expect(
      checkPrivilegeCeiling(actor({ roles: ["SUPERADMIN"] }), {
        code: "SUPERADMIN",
        permissions: [perm("ANYTHING")]
      })
    ).toBe(true);
  });
});
