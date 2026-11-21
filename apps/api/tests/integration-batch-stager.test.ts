import { describe, expect, it } from "vitest";
import { resolveReviewMode } from "../src/jobs/integration-batch-stager.js";

// What a held batch may hold is checked by the posting service now (dry run
// per document): tests/integration/import-pipeline.test.ts.

describe("resolveReviewMode", () => {
  it("forces AUTO_COMMIT for automation executions", () => {
    expect(resolveReviewMode("HOLD", { automationId: "a1", triggeredBy: "u1" })).toBe(
      "AUTO_COMMIT"
    );
  });
  it("forces AUTO_COMMIT when triggered by the scheduler", () => {
    expect(resolveReviewMode("HOLD", { automationId: null, triggeredBy: "scheduler" })).toBe(
      "AUTO_COMMIT"
    );
  });
  it("honors HOLD for interactive runs", () => {
    expect(resolveReviewMode("HOLD", { automationId: null, triggeredBy: "u1" })).toBe("HOLD");
  });
  it("honors AUTO_COMMIT profile setting for interactive runs", () => {
    expect(resolveReviewMode("AUTO_COMMIT", { automationId: null, triggeredBy: "u1" })).toBe(
      "AUTO_COMMIT"
    );
  });
  it("defaults missing profile mode to HOLD for interactive runs", () => {
    expect(resolveReviewMode(null, { automationId: null, triggeredBy: "u1" })).toBe("HOLD");
  });
});
