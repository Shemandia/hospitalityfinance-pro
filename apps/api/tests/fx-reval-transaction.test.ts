import { describe, expect, it } from "vitest";

describe("FX revaluation transaction safety", () => {
  it("reads AP/AR invoices inside the $transaction block", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/fx/service.ts", import.meta.url),
      "utf-8"
    );

    // Find the revaluation method
    const methodStart = source.indexOf("async runRevaluation");
    const revalSection = source.slice(methodStart, methodStart + 5000);

    const txStart = revalSection.indexOf("$transaction");
    const apRead = revalSection.indexOf("getOpenAPInvoices");
    const arRead = revalSection.indexOf("getOpenARInvoices");

    // Both reads must come AFTER $transaction starts
    expect(txStart).toBeGreaterThan(-1);
    expect(apRead).toBeGreaterThan(txStart);
    expect(arRead).toBeGreaterThan(txStart);
  });
});
