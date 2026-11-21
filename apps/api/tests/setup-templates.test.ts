/** Setup wizard data served by the API, and step 6's role check. */
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const db = vi.hoisted(() => ({
  roles: ["ADMIN", "CONTROLLER", "NIGHT_AUDITOR", "VIEWER"],
  saved: null as unknown
}));

vi.mock("../src/db/prisma.js", () => ({
  prisma: {
    role: {
      findMany: async ({ where }: { where: { code: { in: string[] } } }) =>
        db.roles.filter((c) => where.code.in.includes(c)).map((code) => ({ code }))
    },
    tenantSetupProgress: {
      findFirst: async () => ({ id: "p1", currentStep: 6, completedSteps: [], stepData: {} }),
      create: async () => ({}),
      update: async ({ data }: { data: unknown }) => {
        db.saved = data;
        return {};
      }
    }
  },
  registryPrisma: { tenant: { findFirst: async () => null } }
}));

import { setupTemplates } from "../src/modules/setup/templates.js";
import { SetupService } from "../src/modules/setup/service.js";

describe("setup templates", () => {
  it("serves the 12 USALI departments and 33 currencies", () => {
    const t = setupTemplates();
    expect(t.departments).toHaveLength(12);
    expect(t.departments.map((d) => d.code)).toContain("F_AND_B");
    expect(t.currencies).toHaveLength(33);
    expect(t.currencies.find((c) => c.code === "TZS")?.name).toBe("Tanzanian Shilling");
  });
});

describe("setup step 6 (invitations)", () => {
  const invite = (role: string) => ({
    invitations: [{ email: "a@b.test", name: "A", role, entityIds: [] }]
  });

  it("accepts any role the tenant has, not only three fixed names", async () => {
    await expect(
      new SetupService().saveStep("acme", 6, invite("NIGHT_AUDITOR"), false)
    ).resolves.toEqual({
      step: 6,
      status: "saved"
    });
  });

  it("refuses a role the tenant does not have, and saves nothing", async () => {
    db.saved = null;
    const error = await new SetupService()
      .saveStep("acme", 6, invite("ACCOUNTANT"), false)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ZodError);
    expect((error as ZodError).errors[0]?.message).toBe("Unknown role: ACCOUNTANT");
    expect(db.saved).toBeNull();
  });
});
