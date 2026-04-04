import { describe, expect, it } from "vitest";

describe("AR postInvoice uses row locking", () => {
  it("source code contains SELECT FOR UPDATE in postInvoice", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/ar/service.ts", import.meta.url),
      "utf-8"
    );
    const postInvoiceSection = source.slice(
      source.indexOf("async postInvoice"),
      source.indexOf("async updateInvoice")
    );
    expect(postInvoiceSection).toContain("FOR UPDATE");
  });
});
