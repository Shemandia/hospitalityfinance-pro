import { describe, expect, it } from "vitest";
import { parseFixedWidth, writeFixedWidth } from "../src/parsers/fixed-width.js";
import type { FsdSchema } from "../src/types.js";

/**
 * Bank statement line format — 5 fields, all explicit widths.
 * Account number left-padded with zeros; description right-padded with spaces.
 */
const bankSchema: FsdSchema = {
  classification: "SINGLE_FIXED",
  recordSep: "\n",
  record: {
    name: "bank-line",
    fields: [
      {
        name: "accountNo",
        type: "string",
        required: true,
        maxLength: 10,
        leadingChars: "0"
      },
      { name: "txnDate", type: "date", required: true, maxLength: 10 },
      {
        name: "description",
        type: "string",
        maxLength: 20,
        trailingChars: " "
      },
      { name: "debit", type: "integer", maxLength: 12, leadingChars: "0" },
      { name: "credit", type: "integer", maxLength: 12, leadingChars: "0" }
    ]
  }
};

describe("parseFixedWidth", () => {
  it("slices a single line into typed fields", () => {
    // 10 + 10 + 20 + 12 + 12 = 64 chars
    const line =
      "0000012345" + "2026-04-01" + "Opening balance     " + "000000000000" + "000000385000";
    expect(line.length).toBe(64);
    const result = parseFixedWidth(bankSchema, line);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      accountNo: "12345",
      description: "Opening balance",
      debit: 0,
      credit: 385000
    });
  });

  it("handles multiple lines", () => {
    const lines = [
      "0000012345" + "2026-04-01" + "Row one             " + "000000000000" + "000000100000",
      "0000012345" + "2026-04-02" + "Row two             " + "000000050000" + "000000000000"
    ].join("\n");
    const result = parseFixedWidth(bankSchema, lines);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[1]!.debit).toBe(50000);
  });

  it("reports LINE_TOO_SHORT when a row is missing characters", () => {
    const shortLine = "0000012345" + "2026-04-01" + "Too short"; // only 29 chars
    const result = parseFixedWidth(bankSchema, shortLine);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("LINE_TOO_SHORT");
    expect(result.errors.find((e) => e.code === "LINE_TOO_SHORT")!.line).toBe(1);
  });

  it("reports field-level validation errors with line + field", () => {
    // debit slot filled with alpha — TYPE_INTEGER should fire on field 'debit'
    const line =
      "0000012345" + "2026-04-01" + "Bad debit           " + "00000000abcd" + "000000100000";
    const result = parseFixedWidth(bankSchema, line);
    const typeErr = result.errors.find((e) => e.field === "debit");
    expect(typeErr?.code).toBe("TYPE_INTEGER");
    expect(typeErr?.line).toBe(1);
  });

  it("rejects a schema that omits maxLength on a field", () => {
    const bad: FsdSchema = {
      classification: "SINGLE_FIXED",
      record: {
        name: "bad",
        fields: [{ name: "x", type: "string" }]
      }
    };
    const result = parseFixedWidth(bad, "anything");
    expect(result.errors[0]?.code).toBe("SCHEMA_MISSING_FIELD_LENGTH");
  });
});

describe("writeFixedWidth", () => {
  it("pads values to the full field width on write", () => {
    const records = [
      {
        accountNo: "12345",
        txnDate: new Date("2026-04-01T00:00:00.000Z"),
        description: "Opening balance",
        debit: 0,
        credit: 385000
      }
    ];
    const result = writeFixedWidth(bankSchema, records);
    expect(result.errors).toEqual([]);
    // 10 + 10 + 20 + 12 + 12 = 64
    expect(result.output.length).toBe(64);
    expect(result.output.slice(0, 10)).toBe("0000012345");
    expect(result.output.slice(10, 20)).toBe("2026-04-01");
    expect(result.output.slice(20, 40)).toBe("Opening balance     ");
    expect(result.output.slice(40, 52)).toBe("000000000000");
    expect(result.output.slice(52, 64)).toBe("000000385000");
  });

  it("round-trip: parse -> write -> parse yields identical records", () => {
    const input = [
      "0000012345" + "2026-04-01" + "Row one             " + "000000000000" + "000000100000",
      "0000067890" + "2026-04-02" + "Row two             " + "000000050000" + "000000000000"
    ].join("\n");
    const first = parseFixedWidth(bankSchema, input);
    expect(first.errors).toEqual([]);
    const written = writeFixedWidth(bankSchema, first.records);
    expect(written.errors).toEqual([]);
    const second = parseFixedWidth(bankSchema, written.output);
    expect(second.errors).toEqual([]);
    expect(second.records).toEqual(first.records);
  });

  it("truncates on write only when field.truncate is set", () => {
    const schema: FsdSchema = {
      classification: "SINGLE_FIXED",
      record: {
        name: "r",
        fields: [{ name: "short", type: "string", maxLength: 5, truncate: true }]
      }
    };
    const result = writeFixedWidth(schema, [{ short: "hello world" }]);
    expect(result.output).toBe("hello");
  });
});
