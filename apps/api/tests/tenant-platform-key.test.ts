import { afterEach, describe, expect, it, vi } from "vitest";
import { reloadConfig } from "../src/config.js";

describe("Platform API key security", () => {
  const saved = process.env.PLATFORM_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.PLATFORM_API_KEY;
    else process.env.PLATFORM_API_KEY = saved;
    reloadConfig();
  });

  it("does not use a hardcoded default key", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/tenant/router.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toContain("hfp-platform-dev-key");
  });

  it("refuses to load the tenant routes without PLATFORM_API_KEY, naming it", async () => {
    // Empty, not deleted: the Prisma client loads apps/api/.env on import but
    // never overwrites a variable that is set. The config treats empty as unset.
    process.env.PLATFORM_API_KEY = "";
    reloadConfig();
    vi.resetModules();
    const loading = import("../src/modules/tenant/router.js");
    // A fresh module graph has its own ConfigError class, so compare by name.
    await expect(loading).rejects.toMatchObject({ name: "ConfigError" });
    await expect(loading).rejects.toThrow(/PLATFORM_API_KEY is required by the tenant routes/);
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
