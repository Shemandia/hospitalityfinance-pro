import { describe, expect, it } from "vitest";

describe("Recurring journal auto-post updates balances", () => {
  it("calls balance update when autoPost is true", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/gl/recurring-service.ts", import.meta.url),
      "utf-8"
    );
    const generateSection = source.slice(
      source.indexOf("async generateDueJournals"),
      source.indexOf("private isDue")
    );
    expect(generateSection).toContain("autoPost");
    expect(generateSection).toMatch(/account_period_balances|updateAccountBalance/);
  });
});
