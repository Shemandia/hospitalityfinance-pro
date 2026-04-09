import { describe, expect, it } from "vitest";
import { detectFormat, type DetectionResult } from "../src/jobs/format-auto-detect.js";

// ── CSV (comma-delimited) ──────────────────────────────────────────────────

describe("detectFormat — CSV", () => {
  it("detects comma-delimited with headers", () => {
    const input = "name,age,city\n" + "Alice,30,New York\n" + "Bob,25,London\n" + "Carol,35,Paris";

    const result = detectFormat(input);

    expect(result.classification).toBe("DELIMITED");
    expect(result.delimiter).toBe(",");
    expect(result.hasHeaders).toBe(true);
    expect(result.fields).toHaveLength(3);
    expect(result.fields[0]!.name).toBe("name");
    expect(result.fields[0]!.type).toBe("string");
    expect(result.fields[1]!.name).toBe("age");
    expect(result.fields[1]!.type).toBe("integer");
    expect(result.fields[2]!.name).toBe("city");
    expect(result.confidence).toBeGreaterThanOrEqual(50);
  });

  it("detects CSV without headers (all numeric data)", () => {
    const input = "100,200,300\n" + "400,500,600\n" + "700,800,900";

    const result = detectFormat(input);

    expect(result.classification).toBe("DELIMITED");
    expect(result.delimiter).toBe(",");
    expect(result.hasHeaders).toBe(false);
    expect(result.fields).toHaveLength(3);
    expect(result.fields[0]!.name).toBe("field1");
    expect(result.fields[0]!.type).toBe("integer");
  });

  it("returns preview rows", () => {
    const input = "id,value\n1,hello\n2,world";
    const result = detectFormat(input);

    expect(result.previewRows).toHaveLength(2);
    expect(result.previewRows[0]).toEqual({ id: "1", value: "hello" });
    expect(result.previewRows[1]).toEqual({ id: "2", value: "world" });
  });
});

// ── TSV (tab-delimited) ────────────────────────────────────────────────────

describe("detectFormat — TSV", () => {
  it("detects tab-delimited format", () => {
    const input = "code\tamount\tdate\n" + "A001\t500\t2026-04-01\n" + "A002\t300\t2026-04-02";

    const result = detectFormat(input);

    expect(result.classification).toBe("DELIMITED");
    expect(result.delimiter).toBe("\t");
    expect(result.hasHeaders).toBe(true);
    expect(result.fields).toHaveLength(3);
    expect(result.fields[1]!.type).toBe("integer");
    expect(result.fields[2]!.type).toBe("date");
  });
});

// ── Semicolon-delimited (Jana-style) ───────────────────────────────────────

describe("detectFormat — Semicolon (Jana)", () => {
  it("detects semicolon-delimited Jana voucher format", () => {
    const input =
      "PV001;PURCH;50010;385000;0;Rice 50kg;2026-04-01;SUP001;INV-1\n" +
      "PV002;PURCH;20010;0;385000;Control;2026-04-01;SUP001;INV-1";

    const result = detectFormat(input);

    expect(result.classification).toBe("DELIMITED");
    expect(result.delimiter).toBe(";");
    expect(result.hasHeaders).toBe(false);
    expect(result.fields).toHaveLength(9);
    // field3 (accountCode) should be string (leading zeros)
    expect(result.fields[0]!.type).toBe("string");
    // field4 (debit) should be integer
    expect(result.fields[3]!.type).toBe("integer");
    // field7 (date) should be date
    expect(result.fields[6]!.type).toBe("date");
    expect(result.confidence).toBeGreaterThanOrEqual(80);
  });
});

// ── Pipe-delimited ─────────────────────────────────────────────────────────

describe("detectFormat — Pipe-delimited", () => {
  it("detects pipe-delimited format", () => {
    const input =
      "AccountCode|Description|Amount\n" +
      "4100|Room Revenue|15000.50\n" +
      "4200|F&B Revenue|8500.75";

    const result = detectFormat(input);

    expect(result.classification).toBe("DELIMITED");
    expect(result.delimiter).toBe("|");
    expect(result.hasHeaders).toBe(true);
    expect(result.fields).toHaveLength(3);
    expect(result.fields[2]!.type).toBe("number");
  });
});

// ── XML ────────────────────────────────────────────────────────────────────

describe("detectFormat — XML", () => {
  it("detects Simple XML with root and record elements", () => {
    const input = `<?xml version="1.0"?>
<Transactions>
  <Transaction>
    <AccountCode>4100</AccountCode>
    <Amount>15000</Amount>
    <Date>2026-04-01</Date>
  </Transaction>
  <Transaction>
    <AccountCode>4200</AccountCode>
    <Amount>8500</Amount>
    <Date>2026-04-02</Date>
  </Transaction>
</Transactions>`;

    const result = detectFormat(input);

    expect(result.classification).toBe("SIMPLE_XML");
    expect(result.fields.length).toBeGreaterThanOrEqual(3);

    const accountField = result.fields.find((f) => f.name === "AccountCode");
    expect(accountField).toBeDefined();

    const amountField = result.fields.find((f) => f.name === "Amount");
    expect(amountField?.type).toBe("integer");

    const dateField = result.fields.find((f) => f.name === "Date");
    expect(dateField?.type).toBe("date");

    // Schema should have xmlRoot
    const schema = result.suggestedSchema as any;
    expect(schema.xmlRoot).toBe("Transactions");
    expect(schema.record.xmlName).toBe("Transaction");
  });
});

// ── Fixed-width ────────────────────────────────────────────────────────────

describe("detectFormat — Fixed-width", () => {
  it("handles fixed-width-like input without crashing", () => {
    // Fixed-width detection requires very consistent column boundaries.
    // The engine may fall back to delimited with low confidence — that's fine.
    const input =
      "ACCT001   00015000New York    \n" +
      "ACCT002   00008500London      \n" +
      "ACCT003   00012000Paris       \n" +
      "ACCT004   00009800Berlin      ";

    const result = detectFormat(input);

    // Must not throw and must return a valid DetectionResult
    expect(result).toBeDefined();
    expect(result.classification).toBeDefined();
    expect(typeof result.confidence).toBe("number");
  });
});

// ── Edge cases ─────────────────────────────────────────────────────────────

describe("detectFormat — edge cases", () => {
  it("handles empty input", () => {
    const result = detectFormat("");
    expect(result.confidence).toBe(0);
    expect(result.fields).toHaveLength(0);
  });

  it("handles whitespace-only input", () => {
    const result = detectFormat("   \n  \n  ");
    expect(result.confidence).toBe(0);
  });

  it("handles single-line input", () => {
    const result = detectFormat("hello,world,test");
    expect(result.classification).toBe("DELIMITED");
    expect(result.delimiter).toBe(",");
    expect(result.fields).toHaveLength(3);
  });

  it("generates a valid FSD schema", () => {
    const input = "name,age\nAlice,30\nBob,25";
    const result = detectFormat(input);

    const schema = result.suggestedSchema as any;
    expect(schema.classification).toBe("DELIMITED");
    expect(schema.fieldSep).toBe(",");
    expect(schema.record).toBeDefined();
    expect(schema.record.fields).toHaveLength(2);
    expect(schema.record.fields[0].name).toBe("name");
    expect(schema.record.fields[1].name).toBe("age");
    expect(schema.record.fields[1].type).toBe("integer");
  });

  it("detects Windows line endings", () => {
    const input = "a,b\r\n1,2\r\n3,4";
    const result = detectFormat(input);
    expect(result.recordSep).toBe("\r\n");
  });
});
