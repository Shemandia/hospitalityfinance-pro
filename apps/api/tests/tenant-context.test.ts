import { describe, expect, it } from "vitest";

describe("Tenant context safety", () => {
  it("prisma.ts does not use global mutable tenant state", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("../src/db/prisma.ts", import.meta.url), "utf-8");
    expect(source).not.toContain("let _activeTenantSlug");
    expect(source).not.toContain("let _activeTenantDbUrl");
  });

  it("requestContext exports runWithContext using storage.run", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/db/requestContext.ts", import.meta.url),
      "utf-8"
    );
    expect(source).toContain("storage.run(");
    expect(source).toContain("export function runWithContext");
  });
});
