import { describe, expect, it } from "vitest";

describe("Consolidation IC elimination key consistency", () => {
  it("looks up IC eliminations using account_code, not accountId (UUID)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/consolidation/service.ts", import.meta.url),
      "utf-8"
    );
    const icSection = source.slice(
      source.indexOf("for (const [accountId, icBalance] of icGrouped"),
      source.indexOf("// Persist the run")
    );
    expect(icSection).not.toContain("consolidatedMap.get(accountId)");
  });
});
