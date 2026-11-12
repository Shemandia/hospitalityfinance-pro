import { describe, expect, it } from "vitest";

describe("Development auth bypass (AUT-12)", () => {
  it("is gone: no dev token and no switch that could be left on in production", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("../src/plugins/auth.ts", import.meta.url), "utf-8");
    expect(source).not.toContain("ENABLE_DEV_AUTH");
    expect(source).not.toMatch(/startsWith\(["']dev-/);
    expect(source).not.toContain("NODE_ENV");
  });
});
