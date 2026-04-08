import { describe, expect, it } from "vitest";
import { parseDelimited, writeDelimited } from "../src/parsers/delimited.js";
import type { FsdSchema } from "../src/types.js";

/**
 * Jana purchasing voucher format — 9 fields, whole-integer amounts.
 * The engine knows nothing about what a voucher is; this is purely
 * a format-parsing test using semicolons.
 */
const janaVoucherSchema: FsdSchema = {
  classification: "DELIMITED",
  fieldSep: ";",
  recordSep: "\n",
  record: {
    name: "voucher",
    fields: [
      { name: "voucherNo", type: "string", required: true, maxLength: 20 },
      { name: "journalType", type: "string", required: true, maxLength: 10 },
      { name: "accountCode", type: "string", required: true, maxLength: 20 },
      { name: "debit", type: "integer", required: true, maxLength: 15 },
      { name: "credit", type: "integer", required: true, maxLength: 15 },
      { name: "description", type: "string", maxLength: 200 },
      { name: "entryDate", type: "date", required: true, maxLength: 10 },
      { name: "supplierCode", type: "string", maxLength: 20 },
      { name: "reference", type: "string", maxLength: 50 }
    ]
  }
};

describe("parseDelimited — semicolon Jana voucher format", () => {
  it("parses a 2-line voucher file into typed records", () => {
    const input =
      "PV001;PURCH;50010;385000;0;Rice 50kg;2026-04-01;SUP001;INV-1\n" +
      "PV002;PURCH;20010;0;385000;Control;2026-04-01;SUP001;INV-1";
    const result = parseDelimited(janaVoucherSchema, input);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      voucherNo: "PV001",
      journalType: "PURCH",
      accountCode: "50010",
      debit: 385000,
      credit: 0,
      description: "Rice 50kg",
      supplierCode: "SUP001",
      reference: "INV-1"
    });
    expect(result.records[0]!.entryDate).toBeInstanceOf(Date);
    expect(result.records[1]!.debit).toBe(0);
    expect(result.records[1]!.credit).toBe(385000);
  });

  it("reports validation errors with line + field information", () => {
    // Line 2 has a non-integer debit and a missing voucherNo
    const input =
      "PV001;PURCH;50010;385000;0;desc;2026-04-01;SUP001;REF\n" +
      ";PURCH;50010;not-a-number;0;desc;2026-04-01;SUP001;REF";
    const result = parseDelimited(janaVoucherSchema, input);
    // Expect at least: REQUIRED on voucherNo line 2, TYPE_INTEGER on debit line 2
    const codes = result.errors.map((e) => ({ code: e.code, field: e.field, line: e.line }));
    expect(codes).toContainEqual({ code: "REQUIRED", field: "voucherNo", line: 2 });
    expect(codes).toContainEqual({ code: "TYPE_INTEGER", field: "debit", line: 2 });
    // First record still parsed successfully
    expect(result.records).toHaveLength(2);
    expect(result.records[0]!.voucherNo).toBe("PV001");
  });

  it("reports FIELD_COUNT_MISMATCH when a line has the wrong number of fields", () => {
    const input = "PV001;PURCH;50010;385000"; // only 4 of 9 fields
    const result = parseDelimited(janaVoucherSchema, input);
    const mismatch = result.errors.find((e) => e.code === "FIELD_COUNT_MISMATCH");
    expect(mismatch).toBeDefined();
    expect(mismatch?.line).toBe(1);
  });
});

// ── CSV with quoted fields ──────────────────────────────────────────────────

const csvSchema: FsdSchema = {
  classification: "DELIMITED",
  fieldSep: ",",
  recordSep: "\n",
  record: {
    name: "row",
    fields: [
      { name: "name", type: "string", maxLength: 100 },
      { name: "note", type: "string", maxLength: 500 },
      { name: "amount", type: "number", maxLength: 20 }
    ]
  }
};

describe("parseDelimited — CSV with quoted fields", () => {
  it("unquotes simple quoted fields", () => {
    const input = '"Alice","hello world",100.50';
    const result = parseDelimited(csvSchema, input);
    expect(result.errors).toEqual([]);
    expect(result.records[0]).toEqual({
      name: "Alice",
      note: "hello world",
      amount: 100.5
    });
  });

  it("preserves embedded commas inside quoted fields", () => {
    const input = '"Alice","hello, world",100.50';
    const result = parseDelimited(csvSchema, input);
    expect(result.errors).toEqual([]);
    expect(result.records[0]!.note).toBe("hello, world");
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    // Doubled quotes in the middle of the field (surrounded by normal text so
    // the adjacent-triple-quote ambiguity at field boundaries doesn't apply).
    const input = '"Alice","she said ""hi"" loudly",100.50';
    const result = parseDelimited(csvSchema, input);
    expect(result.errors).toEqual([]);
    expect(result.records[0]!.note).toBe('she said "hi" loudly');
  });

  it("normalises Excel triple-quote sequences before parsing", () => {
    // Excel writes a literal " as """ instead of the correct "". Here Excel
    // wrote `"""what"""` where a well-behaved exporter would write `""what""`.
    // After unconditional normalisation the sequence becomes valid CSV and
    // parses as `what` surrounded by literal quotes.
    const input = '"Alice","say """what""" now",100.50';
    const result = parseDelimited(csvSchema, input);
    expect(result.errors).toEqual([]);
    expect(result.records[0]!.note).toBe('say "what" now');
  });
});

// ── Round-trip ──────────────────────────────────────────────────────────────

describe("writeDelimited + round-trip", () => {
  it("writes Jana voucher records back to semicolon-delimited form", () => {
    const records = [
      {
        voucherNo: "PV001",
        journalType: "PURCH",
        accountCode: "50010",
        debit: 385000,
        credit: 0,
        description: "Rice 50kg",
        entryDate: new Date("2026-04-01T00:00:00.000Z"),
        supplierCode: "SUP001",
        reference: "INV-1"
      }
    ];
    const written = writeDelimited(janaVoucherSchema, records);
    expect(written.errors).toEqual([]);
    // Semicolons present, no quoting needed (no embedded sep), integers printed plain
    expect(written.output).toContain("PV001;PURCH;50010;385000;0;Rice 50kg;");
  });

  it("quotes CSV values that contain the separator or a quote", () => {
    const records = [{ name: "Alice", note: 'she said "hi", loud', amount: 100.5 }];
    const written = writeDelimited(csvSchema, records);
    expect(written.errors).toEqual([]);
    expect(written.output).toBe('Alice,"she said ""hi"", loud",100.5');
  });

  it("round-trip: parse -> write -> parse yields identical records", () => {
    const input =
      "PV001;PURCH;50010;385000;0;Rice 50kg;2026-04-01;SUP001;INV-1\n" +
      "PV002;PURCH;20010;0;385000;Control;2026-04-01;SUP001;INV-1";
    const first = parseDelimited(janaVoucherSchema, input);
    expect(first.errors).toEqual([]);
    const written = writeDelimited(janaVoucherSchema, first.records);
    expect(written.errors).toEqual([]);
    const second = parseDelimited(janaVoucherSchema, written.output);
    expect(second.errors).toEqual([]);
    expect(second.records).toEqual(first.records);
  });
});
