import { describe, expect, it } from "vitest";

describe("Platform API key security", () => {
  it("does not use a hardcoded default key", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/tenant/router.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toContain("hfp-platform-dev-key");
    expect(source).toContain("throw new Error");
    expect(source).toContain("PLATFORM_API_KEY");
  });

  it("frontend route does not use a hardcoded default key", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const webRoutePath = path.resolve(
      thisDir,
      "..",
      "..",
      "web",
      "app",
      "api",
      "tenants",
      "route.ts"
    );
    const source = await fs.readFile(webRoutePath, "utf-8");
    expect(source).not.toContain("hfp-platform-dev-key");
  });
});
