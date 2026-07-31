import { describe, expect, it } from "vitest";

describe("FX revaluation transaction safety", () => {
  it("reads AP/AR invoices inside the $transaction block", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/fx/service.ts", import.meta.url),
      "utf-8"
    );

    const methodStart = source.indexOf("async runRevaluation");
    const nextMethod = source.indexOf("\n  async ", methodStart + "async runRevaluation".length);
    const revalSection = source.slice(methodStart, nextMethod === -1 ? undefined : nextMethod);

    const txStart = revalSection.indexOf("$transaction");
    const apRead = revalSection.indexOf("getOpenAPInvoices");
    const arRead = revalSection.indexOf("getOpenARInvoices");

    // Both reads must come AFTER $transaction starts
    expect(txStart).toBeGreaterThan(-1);
    expect(apRead).toBeGreaterThan(txStart);
    expect(arRead).toBeGreaterThan(txStart);
  });
});
