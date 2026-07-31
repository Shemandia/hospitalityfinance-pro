import { describe, it, expect } from "vitest";
import { parseFixed } from "../../src/parsers/fixed.js";
import type { ProfileFsdSchema } from "../../src/profile/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Standard fixed-width schema: account (10), amount (12), date (10) = 32 chars per record */
function fixedSchema(overrides: Partial<ProfileFsdSchema> = {}): ProfileFsdSchema {
  return {
    version: "1.0",
    format: { type: "fixed", fixedRecordLength: 32 },
    fields: [
      {
        name: "account",
        target: "journal.lines[].account",
        type: "string",
        fixedStart: 0,
        fixedLength: 10
      },
      {
        name: "amount",
        target: "journal.lines[].debit",
        type: "decimal",
        fixedStart: 10,
        fixedLength: 12
      },
      {
        name: "date",
        target: "journal.date",
        type: "date",
        fixedStart: 22,
        fixedLength: 10,
        dateFormat: "YYYY-MM-DD"
      }
    ],
    ...overrides
  };
}

/** Pad a string to exactly `len` chars, right-padded with spaces. */
function pad(value: string, len: number): string {
  return value.padEnd(len, " ");
}

/** Build a fixed-width record from field values. */
function record(account: string, amount: string, date: string): string {
  return pad(account, 10) + pad(amount, 12) + pad(date, 10);
}

// ── 1. Parse fixed-width with known record length ─────────────────────────

describe("Fixed-width with known record length", () => {
  it("parses records split by fixedRecordLength", () => {
    // Two 32-char records concatenated (no newlines)
    const input = record("1000", "250.50", "2026-03-15") + record("2000", "100.00", "2026-03-16");

    const result = parseFixed(fixedSchema(), input);

    expect(result.errors).toHaveLength(0);
    expect(result.aborted).toBe(false);
    expect(result.rowCount).toBe(2);

    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(250.5);
    expect(result.rows[0]!.fields.date!.parsedValue).toBeInstanceOf(Date);
    expect((result.rows[0]!.fields.date!.parsedValue as Date).toISOString().slice(0, 10)).toBe(
      "2026-03-15"
    );

    expect(result.rows[1]!.fields.account!.parsedValue).toBe("2000");
    expect(result.rows[1]!.fields.amount!.parsedValue).toBe(100.0);
  });

  it("also works when records are separated by newlines (no fixedRecordLength)", () => {
    const schema = fixedSchema({
      format: { type: "fixed" } // no fixedRecordLength — split by newline
    });

    const input = [
      record("1000", "250.50", "2026-03-15"),
      record("2000", "100.00", "2026-03-16")
    ].join("\n");

    const result = parseFixed(schema, input);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[1]!.fields.account!.parsedValue).toBe("2000");
  });
});

// ── 2. Field extraction by fixedStart + fixedLength ───────────────────────

describe("Field extraction by fixedStart + fixedLength", () => {
  it("extracts each field at the correct char positions", () => {
    // account: chars 0–9, amount: chars 10–21, date: chars 22–31
    const line = "ACCT001   000000250.502026-03-15";

    const schema = fixedSchema({
      format: { type: "fixed" } // newline mode
    });

    const result = parseFixed(schema, line);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.fields.account!.rawValue).toBe("ACCT001");
    expect(result.rows[0]!.fields.amount!.rawValue).toBe("000000250.50");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(250.5);
    expect(result.rows[0]!.fields.date!.rawValue).toBe("2026-03-15");
  });

  it("preserves raw value before trimming", () => {
    const line = "ACCT001   000000250.502026-03-15";
    const schema = fixedSchema({ format: { type: "fixed" } });

    // With trimWhitespace=false on account field
    const schemaNoTrim: ProfileFsdSchema = {
      ...schema,
      fields: [
        {
          name: "account",
          target: "journal.lines[].account",
          type: "string",
          fixedStart: 0,
          fixedLength: 10,
          trimWhitespace: false
        }
      ]
    };

    const result = parseFixed(schemaNoTrim, line);
    // Raw value includes trailing spaces
    expect(result.rows[0]!.fields.account!.rawValue).toBe("ACCT001   ");
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("ACCT001   ");
  });

  it("handles non-contiguous field positions", () => {
    // Fields don't need to be adjacent — there can be gaps or overlaps
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "code",
          target: "x.code",
          type: "string",
          fixedStart: 0,
          fixedLength: 3
        },
        // chars 3–9 are filler (skipped)
        {
          name: "value",
          target: "x.value",
          type: "integer",
          fixedStart: 10,
          fixedLength: 5
        }
      ]
    };

    const line = "ABC       00042";
    const result = parseFixed(schema, line);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.code!.parsedValue).toBe("ABC");
    expect(result.rows[0]!.fields.value!.parsedValue).toBe(42);
  });
});

// ── 3. Round-trip (serialise back to exact same bytes) ────────────────────

describe("Round-trip serialisation", () => {
  it.todo("serialise parsed records back to exact same bytes (serialiser not yet built)");
});

// ── Type coercion ─────────────────────────────────────────────────────────

describe("Type coercion", () => {
  it("coerces integer fields", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "count",
          target: "x.count",
          type: "integer",
          fixedStart: 0,
          fixedLength: 10
        }
      ]
    };

    const result = parseFixed(schema, "       123");
    expect(result.rows[0]!.fields.count!.parsedValue).toBe(123);
  });

  it("coerces boolean fields", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "active",
          target: "x.active",
          type: "boolean",
          fixedStart: 0,
          fixedLength: 5
        }
      ]
    };

    const r1 = parseFixed(schema, "true ");
    expect(r1.rows[0]!.fields.active!.parsedValue).toBe(true);

    const r2 = parseFixed(schema, "0    ");
    expect(r2.rows[0]!.fields.active!.parsedValue).toBe(false);
  });

  it("coerces date fields with dateFormat", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "dt",
          target: "x.date",
          type: "date",
          fixedStart: 0,
          fixedLength: 10,
          dateFormat: "DD/MM/YYYY"
        }
      ]
    };

    const result = parseFixed(schema, "25/12/2026");
    const d = result.rows[0]!.fields.dt!.parsedValue as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString().slice(0, 10)).toBe("2026-12-25");
  });
});

// ── decimalDivisor ────────────────────────────────────────────────────────

describe("decimalDivisor", () => {
  it("applies decimalDivisor when explicitly set", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "amount",
          target: "x.amount",
          type: "currency",
          fixedStart: 0,
          fixedLength: 10,
          decimalDivisor: 100
        }
      ]
    };

    const result = parseFixed(schema, "     15000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(150);
  });

  it("does NOT apply decimalDivisor when not set", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "amount",
          target: "x.amount",
          type: "currency",
          fixedStart: 0,
          fixedLength: 10
        }
      ]
    };

    const result = parseFixed(schema, "     15000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(15000);
  });
});

// ── Skip blank rows ──────────────────────────────────────────────────────

describe("Skip blank rows", () => {
  it("skips blank lines when splitBlankRows=true (default)", () => {
    const schema = fixedSchema({ format: { type: "fixed" } });

    const input = [
      record("1000", "250.50", "2026-03-15"),
      "                                ", // 32 spaces
      record("2000", "100.00", "2026-03-16")
    ].join("\n");

    const result = parseFixed(schema, input);

    expect(result.rowCount).toBe(2);
    expect(result.skippedRows).toBe(1);
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[1]!.fields.account!.parsedValue).toBe("2000");
  });

  it("does NOT skip blank rows when skipBlankRows=false", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "code",
          target: "x.code",
          type: "string",
          fixedStart: 0,
          fixedLength: 5
        }
      ],
      options: { skipBlankRows: false }
    };

    const input = "HELLO\n     \nWORLD";
    const result = parseFixed(schema, input);

    expect(result.rowCount).toBe(3);
    expect(result.skippedRows).toBe(0);
  });
});

// ── maxErrors abort ──────────────────────────────────────────────────────

describe("maxErrors abort", () => {
  it("aborts when errors reach maxErrors threshold", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "num",
          target: "x.num",
          type: "integer",
          fixedStart: 0,
          fixedLength: 5,
          required: true
        }
      ],
      options: { maxErrors: 2 }
    };

    // 4 rows, all non-integer → should abort after 2 errors
    const input = "abcde\nfghij\nklmno\npqrst";
    const result = parseFixed(schema, input);

    expect(result.aborted).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.rowCount).toBeLessThan(4);
  });

  it("does not abort when errors are below maxErrors", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "num",
          target: "x.num",
          type: "integer",
          fixedStart: 0,
          fixedLength: 5
        }
      ],
      options: { maxErrors: 10 }
    };

    const input = "abcde\n  100\nfghij";
    const result = parseFixed(schema, input);

    expect(result.aborted).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.rowCount).toBe(3);
  });
});

// ── Field validation ─────────────────────────────────────────────────────

describe("Field validation", () => {
  it("returns REQUIRED_MISSING for empty required field", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "code",
          target: "x.code",
          type: "string",
          fixedStart: 0,
          fixedLength: 5,
          required: true
        },
        {
          name: "filler",
          target: "x.filler",
          type: "string",
          fixedStart: 5,
          fixedLength: 5
        }
      ],
      options: { skipBlankRows: false }
    };

    // First field is spaces (empty after trim), second has value
    const input = "     XXXXX";
    const result = parseFixed(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("REQUIRED_MISSING");
  });

  it("returns TYPE_MISMATCH for non-numeric integer field", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "count",
          target: "x.count",
          type: "integer",
          fixedStart: 0,
          fixedLength: 5
        }
      ]
    };

    const input = "abc  ";
    const result = parseFixed(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });

  it("returns INVALID_DATE_FORMAT for bad date", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "dt",
          target: "x.date",
          type: "date",
          fixedStart: 0,
          fixedLength: 10,
          dateFormat: "YYYY-MM-DD"
        }
      ]
    };

    const input = "not-a-date";
    const result = parseFixed(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("INVALID_DATE_FORMAT");
  });

  it("returns PATTERN_MISMATCH when regex fails", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "code",
          target: "x.code",
          type: "string",
          fixedStart: 0,
          fixedLength: 5,
          pattern: "^[A-Z]{5}$"
        }
      ]
    };

    const input = "ab123";
    const result = parseFixed(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("PATTERN_MISMATCH");
  });

  it("handles line shorter than field position gracefully", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        {
          name: "far",
          target: "x.far",
          type: "string",
          fixedStart: 50,
          fixedLength: 10,
          required: true
        }
      ]
    };

    const input = "short line";
    const result = parseFixed(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("REQUIRED_MISSING");
    expect(result.errors[0]!.message).toContain("line too short");
  });
});
