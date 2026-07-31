import { describe, it, expect } from "vitest";
import { parseCsv } from "../../src/parsers/csv.js";
import type { ProfileFsdSchema } from "../../src/profile/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function csvSchema(overrides: Partial<ProfileFsdSchema> = {}): ProfileFsdSchema {
  return {
    version: "1.0",
    format: { type: "csv", hasHeaderRow: true },
    fields: [
      {
        name: "account",
        target: "journal.lines[].account",
        type: "string",
        columnName: "Account"
      },
      {
        name: "amount",
        target: "journal.lines[].debit",
        type: "decimal",
        columnName: "Amount"
      },
      {
        name: "date",
        target: "journal.date",
        type: "date",
        columnName: "Date",
        dateFormat: "DD/MM/YYYY"
      }
    ],
    ...overrides
  };
}

// ── 1. Parse CSV with header row ──────────────────────────────────────────

describe("CSV with header row", () => {
  it("maps fields by columnName from the header", () => {
    const input = ["Account,Amount,Date", "1000,250.50,15/03/2026", "2000,100.00,16/03/2026"].join(
      "\n"
    );

    const result = parseCsv(csvSchema(), input);

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

  it("falls back to columnIndex when columnName not found", () => {
    const schema = csvSchema({
      fields: [
        {
          name: "col0",
          target: "x.a",
          type: "string",
          columnIndex: 0
        },
        {
          name: "col1",
          target: "x.b",
          type: "string",
          columnIndex: 1
        }
      ]
    });
    const input = "Foo,Bar\nHello,World\n";
    // columnIndex maps to the parsed CSV columns (0-based, including header)
    // With hasHeaderRow=true but using columnIndex, it still skips the header
    const result = parseCsv(schema, input);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.fields.col0!.parsedValue).toBe("Hello");
    expect(result.rows[0]!.fields.col1!.parsedValue).toBe("World");
  });
});

// ── 2. Parse CSV without header row (columnIndex mapping) ─────────────────

describe("CSV without header row", () => {
  it("maps fields by columnIndex when hasHeaderRow=false", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        {
          name: "account",
          target: "journal.lines[].account",
          type: "string",
          columnIndex: 0
        },
        {
          name: "amount",
          target: "journal.lines[].debit",
          type: "decimal",
          columnIndex: 1
        },
        {
          name: "description",
          target: "journal.lines[].description",
          type: "string",
          columnIndex: 2
        }
      ]
    };

    const input = "1000,250.50,Revenue\n2000,100.00,Expense\n";
    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(250.5);
    expect(result.rows[0]!.fields.description!.parsedValue).toBe("Revenue");
    expect(result.rows[1]!.fields.account!.parsedValue).toBe("2000");
  });
});

// ── 3. BOM stripping ──────────────────────────────────────────────────────

describe("BOM stripping", () => {
  it("strips UTF-8 BOM from input before parsing", () => {
    const bom = "\uFEFF";
    const input = bom + "Account,Amount,Date\n1000,50.00,01/01/2026\n";

    const result = parseCsv(csvSchema(), input);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    // The BOM must not corrupt the first header cell
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
  });
});

// ── 4. Quoted fields containing delimiter ─────────────────────────────────

describe("Quoted fields containing delimiter", () => {
  it("handles quoted fields that contain commas", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true },
      fields: [
        { name: "name", target: "x.name", type: "string", columnName: "Name" },
        {
          name: "address",
          target: "x.address",
          type: "string",
          columnName: "Address"
        },
        {
          name: "code",
          target: "x.code",
          type: "string",
          columnName: "Code"
        }
      ]
    };

    const input = [
      "Name,Address,Code",
      '"Hotel Grand","123 Main St, Suite 5",HG01',
      '"Resort, Spa & Pool","456 Beach Rd, Building A",RS02'
    ].join("\n");

    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]!.fields.address!.parsedValue).toBe("123 Main St, Suite 5");
    expect(result.rows[1]!.fields.name!.parsedValue).toBe("Resort, Spa & Pool");
    expect(result.rows[1]!.fields.address!.parsedValue).toBe("456 Beach Rd, Building A");
  });

  it("handles doubled quotes inside quoted fields", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [{ name: "val", target: "x", type: "string", columnIndex: 0 }]
    };
    const input = '"He said ""hello"""\n';
    const result = parseCsv(schema, input);
    expect(result.rows[0]!.fields.val!.parsedValue).toBe('He said "hello"');
  });
});

// ── 5. Skip blank rows ───────────────────────────────────────────────────

describe("Skip blank rows", () => {
  it("skips blank rows when skipBlankRows=true (default)", () => {
    const input = [
      "Account,Amount,Date",
      "1000,50.00,01/01/2026",
      ",,",
      "",
      "2000,75.00,02/01/2026"
    ].join("\n");

    const result = parseCsv(csvSchema(), input);

    expect(result.rowCount).toBe(2);
    expect(result.skippedRows).toBe(2);
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[1]!.fields.account!.parsedValue).toBe("2000");
  });

  it("does NOT skip blank rows when skipBlankRows=false", () => {
    const schema = csvSchema({
      options: { skipBlankRows: false }
    });

    const input = [
      "Account,Amount,Date",
      "1000,50.00,01/01/2026",
      ",,",
      "2000,75.00,02/01/2026"
    ].join("\n");

    const result = parseCsv(schema, input);

    // The blank row is processed (not skipped)
    expect(result.rowCount).toBe(3);
    expect(result.skippedRows).toBe(0);
  });
});

// ── 6. maxErrors abort ───────────────────────────────────────────────────

describe("maxErrors abort", () => {
  it("aborts parse when errors reach maxErrors threshold", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true },
      fields: [
        {
          name: "amount",
          target: "x.amount",
          type: "integer",
          columnName: "Amount",
          required: true
        }
      ],
      options: { maxErrors: 2 }
    };

    // 4 rows, all with non-integer values → should abort after 2 errors
    const input = ["Amount", "abc", "def", "ghi", "jkl"].join("\n");

    const result = parseCsv(schema, input);

    expect(result.aborted).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    // Should not have processed all 4 rows
    expect(result.rowCount).toBeLessThan(4);
  });

  it("does not abort when errors are below maxErrors", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true },
      fields: [
        {
          name: "amount",
          target: "x.amount",
          type: "integer",
          columnName: "Amount"
        }
      ],
      options: { maxErrors: 10 }
    };

    const input = ["Amount", "abc", "100", "def"].join("\n");
    const result = parseCsv(schema, input);

    expect(result.aborted).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.rowCount).toBe(3);
  });
});

// ── 7. Encoding: latin1 ──────────────────────────────────────────────────

describe("Encoding: latin1", () => {
  it("parses latin1-encoded content when pre-decoded by caller", () => {
    // Simulate a latin1 file: encode to latin1 Buffer, then decode back
    // The engine receives a string — Buffer→string decoding is the caller's job.
    // This test verifies that the parser handles chars in the latin1 range (128–255).
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true, encoding: "latin1" },
      fields: [
        { name: "name", target: "x.name", type: "string", columnName: "Name" },
        {
          name: "amount",
          target: "x.amount",
          type: "decimal",
          columnName: "Amount"
        }
      ]
    };

    // latin1 chars: £ (0xA3), ü (0xFC), é (0xE9)
    const raw = "Name,Amount\nHôtel Résidence,1500.00\nCafé Münchën,2300.50\n";
    // Roundtrip through latin1 Buffer to prove the chars survive
    const buf = Buffer.from(raw, "latin1");
    const decoded = buf.toString("latin1");

    const result = parseCsv(schema, decoded);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]!.fields.name!.parsedValue).toBe("Hôtel Résidence");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(1500.0);
    expect(result.rows[1]!.fields.name!.parsedValue).toBe("Café Münchën");
    expect(result.rows[1]!.fields.amount!.parsedValue).toBe(2300.5);
  });
});

// ── TSV (delimiter="\t") ──────────────────────────────────────────────────

describe("TSV parsing", () => {
  it("parses TSV as CSV with tab delimiter", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "tsv" },
      fields: [
        {
          name: "account",
          target: "journal.lines[].account",
          type: "string",
          columnName: "Account"
        },
        {
          name: "amount",
          target: "journal.lines[].debit",
          type: "decimal",
          columnName: "Amount"
        }
      ]
    };

    const input = "Account\tAmount\n1000\t250.50\n2000\t100.00\n";
    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(250.5);
  });
});

// ── decimalDivisor (opt-in only) ──────────────────────────────────────────

describe("decimalDivisor", () => {
  it("applies decimalDivisor when explicitly set on a field", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        {
          name: "amount",
          target: "x.amount",
          type: "currency",
          columnIndex: 0,
          decimalDivisor: 1000
        }
      ]
    };

    const input = "5000\n";
    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(5);
  });

  it("does NOT apply decimalDivisor when not set", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        {
          name: "amount",
          target: "x.amount",
          type: "currency",
          columnIndex: 0
        }
      ]
    };

    const input = "5000\n";
    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(5000);
  });
});

// ── Field validation ──────────────────────────────────────────────────────

describe("Field validation", () => {
  it("returns REQUIRED_MISSING for empty required field", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        {
          name: "code",
          target: "x.code",
          type: "string",
          columnIndex: 0,
          required: true
        },
        {
          name: "other",
          target: "x.other",
          type: "string",
          columnIndex: 1
        }
      ],
      options: { skipBlankRows: false }
    };

    // First field empty, second has value → not a blank row, but required field is empty
    const input = ",something\n";
    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("REQUIRED_MISSING");
  });

  it("returns TYPE_MISMATCH for non-integer value", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        {
          name: "count",
          target: "x.count",
          type: "integer",
          columnIndex: 0
        }
      ]
    };

    const input = "not_a_number\n";
    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });

  it("returns INVALID_DATE_FORMAT for bad date", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        {
          name: "dt",
          target: "x.date",
          type: "date",
          columnIndex: 0,
          dateFormat: "YYYY-MM-DD"
        }
      ]
    };

    const input = "not-a-date\n";
    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("INVALID_DATE_FORMAT");
  });

  it("returns PATTERN_MISMATCH when regex fails", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        {
          name: "code",
          target: "x.code",
          type: "string",
          columnIndex: 0,
          pattern: "^[A-Z]{3}$"
        }
      ]
    };

    const input = "ab1\n";
    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("PATTERN_MISMATCH");
  });

  it("returns MAX_LENGTH_EXCEEDED", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        {
          name: "code",
          target: "x.code",
          type: "string",
          columnIndex: 0,
          maxLength: 3
        }
      ]
    };

    const input = "ABCDE\n";
    const result = parseCsv(schema, input);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("MAX_LENGTH_EXCEEDED");
  });
});
