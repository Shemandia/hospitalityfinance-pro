import { describe, expect, it } from "vitest";

describe("Mews client decimal handling", () => {
  it("does not use String(value) for amount conversion", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/mews/mews-client.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toMatch(/String\(item\.Amount\?\.Value/);
    expect(source).not.toMatch(/String\(item\.UnitAmount\?\.Value/);
    expect(source).toContain("Prisma.Decimal");
  });
});
