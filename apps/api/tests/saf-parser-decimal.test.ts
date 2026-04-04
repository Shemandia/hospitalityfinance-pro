import { describe, expect, it } from "vitest";

describe("SAF parser uses Decimal for amounts", () => {
  it("SAFTransactionLine.amount is typed as string (not number)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/saf/saf-parser.ts", import.meta.url),
      "utf-8"
    );
    const interfaceBlock = source.slice(
      source.indexOf("export interface SAFTransactionLine"),
      source.indexOf("rawLine: string")
    );
    expect(interfaceBlock).toContain("amount: string");
    expect(interfaceBlock).not.toContain("amount: number");
  });

  it("SAFParseResult totals are string (not number)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/saf/saf-parser.ts", import.meta.url),
      "utf-8"
    );
    const resultBlock = source.slice(
      source.indexOf("export interface SAFParseResult"),
      source.indexOf("export interface SAFParseError")
    );
    expect(resultBlock).toContain("totalDebits: string");
    expect(resultBlock).toContain("totalCredits: string");
  });

  it("does not use float addition for totals", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/saf/saf-parser.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toMatch(/\.reduce\(\(s,\s*l\)\s*=>\s*s\s*\+\s*l\.amount/);
  });

  it("import service does not wrap float in Decimal constructor", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/saf/saf-import-service.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toMatch(
      /new Prisma\.Decimal\(safLine\.dcMarker\s*===\s*"D"\s*\?\s*safLine\.amount\s*:\s*0\)/
    );
  });
});
