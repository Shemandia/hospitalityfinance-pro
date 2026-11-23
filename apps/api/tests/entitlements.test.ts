import { describe, expect, it } from "vitest";
import { effectiveEntitlements, exceptionsFrom } from "../src/modules/tenant/entitlements.js";

const plan = {
  code: "STANDARD",
  maxProperties: 10,
  maxUsers: 50,
  maxConcurrentSessions: 10,
  enabledModules: ["GL", "AP"],
  uploadMaxMb: null as number | null,
  importConcurrency: null as number | null
};
const none = {
  maxProperties: null,
  maxUsers: null,
  maxConcurrentSessions: null,
  enabledModules: [] as string[],
  uploadMaxMb: null,
  importConcurrency: null
};
const platform = { uploadMaxMb: 10, importConcurrency: 4 };

describe("effective entitlements", () => {
  it("takes the plan's limits, and the platform's where the plan sets none", () => {
    expect(effectiveEntitlements(plan, none, platform)).toEqual({
      plan: "STANDARD",
      maxProperties: 10,
      maxUsers: 50,
      maxConcurrentSessions: 10,
      enabledModules: ["GL", "AP"],
      uploadMaxMb: 10,
      uploadMaxBytes: 10 * 1024 * 1024,
      importConcurrency: 4
    });
  });

  it("lets the tenant's exceptions win over the plan", () => {
    const e = effectiveEntitlements(
      { ...plan, uploadMaxMb: 5, importConcurrency: 2 },
      { ...none, maxUsers: 7, enabledModules: ["GL"], uploadMaxMb: 3, importConcurrency: 1 },
      platform
    );
    expect([e.maxUsers, e.enabledModules, e.uploadMaxMb, e.importConcurrency]).toEqual([
      7,
      ["GL"],
      3,
      1
    ]);
    expect(e.maxProperties).toBe(10);
  });

  it("never goes above the platform settings", () => {
    const e = effectiveEntitlements(
      { ...plan, uploadMaxMb: 50 },
      { ...none, importConcurrency: 9 },
      platform
    );
    expect([e.uploadMaxMb, e.importConcurrency]).toEqual([10, 4]);
  });
});

describe("exceptions stored for a new tenant", () => {
  it("stores only what differs from the plan", () => {
    expect(
      exceptionsFrom(plan, {
        maxProperties: 10,
        maxUsers: 20,
        enabledModules: ["AP", "GL"],
        uploadMaxMb: 5
      })
    ).toEqual({ ...none, maxUsers: 20, uploadMaxMb: 5 });
  });

  it("stores nothing when nothing is asked for", () => {
    expect(exceptionsFrom(plan, {})).toEqual(none);
  });

  it("stores a different module list", () => {
    expect(exceptionsFrom(plan, { enabledModules: ["GL"] }).enabledModules).toEqual(["GL"]);
  });
});
