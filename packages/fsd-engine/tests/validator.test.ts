import { describe, it, expect } from "vitest";
import { validateField } from "../src/validator.js";
import type { FsdField } from "../src/types.js";

const baseLine = { line: 1, recordIndex: 0 };

function field(overrides: Partial<FsdField> = {}): FsdField {
  return { name: "test", ...overrides };
}

describe("validateField — required + defaults", () => {
  it("returns null for an optional empty field", () => {
    const result = validateField({ field: field(), rawValue: "", ...baseLine });
    expect(result.errors).toEqual([]);
    expect(result.value).toBeNull();
  });

  it("emits REQUIRED for a required empty field", () => {
    const result = validateField({
      field: field({ required: true }),
      rawValue: "",
      ...baseLine
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("REQUIRED");
    expect(result.errors[0]?.field).toBe("test");
    expect(result.value).toBeUndefined();
  });

  it("uses defaultValue when raw is empty", () => {
    const result = validateField({
      field: field({ defaultValue: "FALLBACK" }),
      rawValue: "",
      ...baseLine
    });
    expect(result.errors).toEqual([]);
    expect(result.value).toBe("FALLBACK");
  });
});

describe("validateField — length checks", () => {
  it("emits MIN_LENGTH when below minimum", () => {
    const result = validateField({
      field: field({ minLength: 5 }),
      rawValue: "abc",
      ...baseLine
    });
    expect(result.errors[0]?.code).toBe("MIN_LENGTH");
  });

  it("emits MAX_LENGTH when above maximum and truncate is false", () => {
    const result = validateField({
      field: field({ maxLength: 3 }),
      rawValue: "abcdef",
      ...baseLine
    });
    expect(result.errors[0]?.code).toBe("MAX_LENGTH");
    // Value still passes through (untruncated) so caller can inspect
    expect(result.value).toBe("abcdef");
  });

  it("truncates silently when truncate=true", () => {
    const result = validateField({
      field: field({ maxLength: 3, truncate: true }),
      rawValue: "abcdef",
      ...baseLine
    });
    expect(result.errors).toEqual([]);
    expect(result.value).toBe("abc");
  });
});

describe("validateField — validValue allow-list", () => {
  it("accepts a value that's in the list", () => {
    const result = validateField({
      field: field({ validValue: ["A", "B", "C"] }),
      rawValue: "B",
      ...baseLine
    });
    expect(result.errors).toEqual([]);
    expect(result.value).toBe("B");
  });

  it("rejects a value not in the list", () => {
    const result = validateField({
      field: field({ validValue: ["A", "B", "C"] }),
      rawValue: "X",
      ...baseLine
    });
    expect(result.errors[0]?.code).toBe("INVALID_VALUE");
  });
});

describe("validateField — pattern", () => {
  it("accepts a value matching the regex", () => {
    const result = validateField({
      field: field({ pattern: "^[A-Z]{3}\\d{4}$" }),
      rawValue: "ABC1234",
      ...baseLine
    });
    expect(result.errors).toEqual([]);
  });

  it("emits PATTERN_MISMATCH when the value doesn't match", () => {
    const result = validateField({
      field: field({ pattern: "^[A-Z]{3}\\d{4}$" }),
      rawValue: "abc1234",
      ...baseLine
    });
    expect(result.errors[0]?.code).toBe("PATTERN_MISMATCH");
  });

  it("emits INVALID_PATTERN_REGEX when the schema regex itself is broken", () => {
    const result = validateField({
      field: field({ pattern: "[" }),
      rawValue: "anything",
      ...baseLine
    });
    expect(result.errors[0]?.code).toBe("INVALID_PATTERN_REGEX");
  });
});

describe("validateField — type coercion", () => {
  it("coerces integer values", () => {
    const result = validateField({
      field: field({ type: "integer" }),
      rawValue: "  42  ",
      ...baseLine
    });
    expect(result.errors).toEqual([]);
    expect(result.value).toBe(42);
  });

  it("rejects non-integer for type=integer", () => {
    const result = validateField({
      field: field({ type: "integer" }),
      rawValue: "42.5",
      ...baseLine
    });
    expect(result.errors[0]?.code).toBe("TYPE_INTEGER");
  });

  it("coerces decimal numbers for type=number", () => {
    const result = validateField({
      field: field({ type: "number" }),
      rawValue: "385000.00",
      ...baseLine
    });
    expect(result.errors).toEqual([]);
    expect(result.value).toBe(385000);
  });

  it("rejects non-numeric strings for type=number", () => {
    const result = validateField({
      field: field({ type: "number" }),
      rawValue: "not-a-number",
      ...baseLine
    });
    expect(result.errors[0]?.code).toBe("TYPE_NUMBER");
  });

  it("coerces booleans (true/false/1/0/yes/no)", () => {
    for (const v of ["true", "True", "TRUE", "1", "yes", "Y"]) {
      const result = validateField({
        field: field({ type: "boolean" }),
        rawValue: v,
        ...baseLine
      });
      expect(result.value, `value for ${v}`).toBe(true);
    }
    for (const v of ["false", "0", "no", "n"]) {
      const result = validateField({
        field: field({ type: "boolean" }),
        rawValue: v,
        ...baseLine
      });
      expect(result.value, `value for ${v}`).toBe(false);
    }
  });

  it("coerces ISO 8601 dates", () => {
    const result = validateField({
      field: field({ type: "date" }),
      rawValue: "2026-04-07",
      ...baseLine
    });
    expect(result.errors).toEqual([]);
    expect(result.value).toBeInstanceOf(Date);
  });

  it("rejects garbage for type=date", () => {
    const result = validateField({
      field: field({ type: "date" }),
      rawValue: "not-a-date",
      ...baseLine
    });
    expect(result.errors[0]?.code).toBe("TYPE_DATE");
  });
});

describe("validateField — combined rules", () => {
  it("runs MIN_LENGTH then INVALID_VALUE then PATTERN in order", () => {
    // A required field with all 3 rules; this value violates length and pattern
    const result = validateField({
      field: field({
        required: true,
        minLength: 4,
        validValue: ["AB", "CD"],
        pattern: "^[A-Z]+$"
      }),
      rawValue: "ab",
      ...baseLine
    });
    // 3 errors: MIN_LENGTH (length 2 < 4), INVALID_VALUE (not in allow-list),
    // PATTERN_MISMATCH (lowercase doesn't match [A-Z]+)
    expect(result.errors.map((e) => e.code)).toEqual([
      "MIN_LENGTH",
      "INVALID_VALUE",
      "PATTERN_MISMATCH"
    ]);
  });
});
