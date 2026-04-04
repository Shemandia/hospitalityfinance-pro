import { describe, expect, it } from "vitest";

describe("Dev auth bypass gating", () => {
  it("requires ENABLE_DEV_AUTH=true, not just NODE_ENV!=production", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("../src/plugins/auth.ts", import.meta.url), "utf-8");
    expect(source).toContain("ENABLE_DEV_AUTH");
    expect(source).not.toMatch(/NODE_ENV\s*!==\s*["']production["']\s*&&\s*token\.startsWith/);
  });
});
