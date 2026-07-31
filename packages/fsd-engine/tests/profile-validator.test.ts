import { describe, it, expect } from "vitest";
import { validateRows } from "../src/profile/validator.js";
import type { ProfileFsdSchema, ProfileFsdRawRow } from "../src/profile/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRow(rowIndex: number, fields: Record<string, string>): ProfileFsdRawRow {
  const row: ProfileFsdRawRow = { rowIndex, fields: {} };
  for (const [name, rawValue] of Object.entries(fields)) {
    row.fields[name] = {
      rawValue,
      parsedValue: rawValue,
      mappedPath: `x.${name}`,
      errors: []
    };
  }
  return row;
}

function schema(
  fields: ProfileFsdSchema["fields"],
  options?: ProfileFsdSchema["options"]
): ProfileFsdSchema {
  return {
    version: "1.0",
    format: { type: "csv" },
    fields,
    options
  };
}

// ── REQUIRED_MISSING ──────────────────────────────────────────────────────

describe("REQUIRED_MISSING", () => {
  it("reports error for empty required field", () => {
    const s = schema([{ name: "code", target: "x.code", type: "string", required: true }]);
    const rows = [makeRow(0, { code: "" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("REQUIRED_MISSING");
    expect(result.errors[0]!.fieldName).toBe("code");
    expect(result.errors[0]!.rowIndex).toBe(0);
  });

  it("passes for non-empty required field", () => {
    const s = schema([{ name: "code", target: "x.code", type: "string", required: true }]);
    const rows = [makeRow(0, { code: "ABC" })];

    const result = validateRows(rows, s);
    expect(result.errors).toHaveLength(0);
  });
});

// ── TYPE_MISMATCH ─────────────────────────────────────────────────────────

describe("TYPE_MISMATCH", () => {
  it("reports error for non-integer in integer field", () => {
    const s = schema([{ name: "count", target: "x.count", type: "integer" }]);
    const rows = [makeRow(0, { count: "not_a_number" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });

  it("reports error for non-numeric in decimal field", () => {
    const s = schema([{ name: "amount", target: "x.amount", type: "decimal" }]);
    const rows = [makeRow(0, { amount: "abc" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });

  it("reports error for invalid boolean value", () => {
    const s = schema([{ name: "active", target: "x.active", type: "boolean" }]);
    const rows = [makeRow(0, { active: "maybe" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });
});

// ── PATTERN_MISMATCH ──────────────────────────────────────────────────────

describe("PATTERN_MISMATCH", () => {
  it("reports error when value does not match pattern", () => {
    const s = schema([{ name: "code", target: "x.code", type: "string", pattern: "^[A-Z]{3}$" }]);
    const rows = [makeRow(0, { code: "ab1" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("PATTERN_MISMATCH");
  });

  it("passes when value matches pattern", () => {
    const s = schema([{ name: "code", target: "x.code", type: "string", pattern: "^[A-Z]{3}$" }]);
    const rows = [makeRow(0, { code: "ABC" })];

    const result = validateRows(rows, s);
    expect(result.errors).toHaveLength(0);
  });
});

// ── VALUE_NOT_IN_ALLOWED ──────────────────────────────────────────────────

describe("VALUE_NOT_IN_ALLOWED", () => {
  it("reports error for enum value not in allowedValues", () => {
    const s = schema([
      { name: "status", target: "x.status", type: "enum", allowedValues: ["OPEN", "CLOSED"] }
    ]);
    const rows = [makeRow(0, { status: "PENDING" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("VALUE_NOT_IN_ALLOWED");
  });

  it("passes for enum value in allowedValues", () => {
    const s = schema([
      { name: "status", target: "x.status", type: "enum", allowedValues: ["OPEN", "CLOSED"] }
    ]);
    const rows = [makeRow(0, { status: "OPEN" })];

    const result = validateRows(rows, s);
    expect(result.errors).toHaveLength(0);
  });
});

// ── INVALID_DATE_FORMAT ───────────────────────────────────────────────────

describe("INVALID_DATE_FORMAT", () => {
  it("reports error for unparseable date", () => {
    const s = schema([{ name: "dt", target: "x.date", type: "date", dateFormat: "YYYY-MM-DD" }]);
    const rows = [makeRow(0, { dt: "not-a-date" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("INVALID_DATE_FORMAT");
  });

  it("passes for valid date with matching format", () => {
    const s = schema([{ name: "dt", target: "x.date", type: "date", dateFormat: "YYYY-MM-DD" }]);
    const rows = [makeRow(0, { dt: "2026-03-15" })];

    const result = validateRows(rows, s);
    expect(result.errors).toHaveLength(0);
  });
});

// ── MAX_LENGTH_EXCEEDED / MIN_LENGTH_VIOLATED ─────────────────────────────

describe("Length validation", () => {
  it("reports MAX_LENGTH_EXCEEDED when value too long", () => {
    const s = schema([{ name: "code", target: "x.code", type: "string", maxLength: 3 }]);
    const rows = [makeRow(0, { code: "ABCDE" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("MAX_LENGTH_EXCEEDED");
  });

  it("reports MIN_LENGTH_VIOLATED when value too short", () => {
    const s = schema([{ name: "code", target: "x.code", type: "string", minLength: 5 }]);
    const rows = [makeRow(0, { code: "AB" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("MIN_LENGTH_VIOLATED");
  });
});

// ── DECIMAL_PRECISION_ERROR ───────────────────────────────────────────────

describe("DECIMAL_PRECISION_ERROR", () => {
  it("reports error when decimal places exceed precision", () => {
    const s = schema([{ name: "amount", target: "x.amount", type: "decimal", precision: 2 }]);
    const rows = [makeRow(0, { amount: "123.456" })];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("DECIMAL_PRECISION_ERROR");
  });

  it("passes when decimal places within precision", () => {
    const s = schema([{ name: "amount", target: "x.amount", type: "decimal", precision: 2 }]);
    const rows = [makeRow(0, { amount: "123.45" })];

    const result = validateRows(rows, s);
    expect(result.errors).toHaveLength(0);
  });
});

// ── UNKNOWN_COLUMN (strictMode) ───────────────────────────────────────────

describe("UNKNOWN_COLUMN (strictMode)", () => {
  it("reports error for unknown column in strictMode", () => {
    const s = schema([{ name: "code", target: "x.code", type: "string" }], { strictMode: true });
    // Row has an extra field not in the schema
    const row = makeRow(0, { code: "ABC", extra_col: "surprise" });

    const result = validateRows([row], s);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("UNKNOWN_COLUMN");
    expect(result.errors[0]!.fieldName).toBe("extra_col");
  });

  it("does NOT report unknown column when strictMode is off", () => {
    const s = schema([{ name: "code", target: "x.code", type: "string" }]);
    const row = makeRow(0, { code: "ABC", extra_col: "surprise" });

    const result = validateRows([row], s);
    expect(result.errors).toHaveLength(0);
  });
});

// ── Fail-fast per field ───────────────────────────────────────────────────

describe("Fail-fast per field", () => {
  it("produces at most one error per field per row", () => {
    // This field would fail TYPE_MISMATCH and then can't check precision
    const s = schema([{ name: "num", target: "x.num", type: "integer" }]);
    const rows = [makeRow(0, { num: "abc" })];

    const result = validateRows(rows, s);

    // Only one error for this field (fail-fast)
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });
});

// ── maxErrors abort ──────────────────────────────────────────────────────

describe("maxErrors abort", () => {
  it("aborts when errors reach maxErrors", () => {
    const s = schema([{ name: "num", target: "x.num", type: "integer" }], { maxErrors: 2 });
    const rows = [
      makeRow(0, { num: "abc" }),
      makeRow(1, { num: "def" }),
      makeRow(2, { num: "ghi" }),
      makeRow(3, { num: "jkl" })
    ];

    const result = validateRows(rows, s);

    expect(result.aborted).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.rowsValidated).toBeLessThan(4);
  });

  it("does not abort when errors below maxErrors", () => {
    const s = schema([{ name: "num", target: "x.num", type: "integer" }], { maxErrors: 10 });
    const rows = [
      makeRow(0, { num: "abc" }),
      makeRow(1, { num: "100" }),
      makeRow(2, { num: "def" })
    ];

    const result = validateRows(rows, s);

    expect(result.aborted).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.rowsValidated).toBe(3);
  });
});

// ── Multiple rows ────────────────────────────────────────────────────────

describe("Multiple rows", () => {
  it("validates all rows and collects errors", () => {
    const s = schema([
      { name: "code", target: "x.code", type: "string", required: true },
      { name: "num", target: "x.num", type: "integer" }
    ]);
    const rows = [
      makeRow(0, { code: "ABC", num: "100" }),
      makeRow(1, { code: "", num: "200" }), // REQUIRED_MISSING
      makeRow(2, { code: "DEF", num: "abc" }) // TYPE_MISMATCH
    ];

    const result = validateRows(rows, s);

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.errorCode).toBe("REQUIRED_MISSING");
    expect(result.errors[0]!.rowIndex).toBe(1);
    expect(result.errors[1]!.errorCode).toBe("TYPE_MISMATCH");
    expect(result.errors[1]!.rowIndex).toBe(2);
    expect(result.rowsValidated).toBe(3);
  });
});
