import { describe, it, expect } from "vitest";
import { serialiseCsv } from "../../src/serialisers/csv.js";
import { parseCsv } from "../../src/parsers/csv.js";
import type { ProfileFsdSchema, ProfileFsdStructuredRow } from "../../src/profile/types.js";

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

// ── Header row ────────────────────────────────────────────────────────────

describe("Header row", () => {
  it("writes header row when hasHeaderRow=true", () => {
    const buf = serialiseCsv(csvSchema(), []);
    const output = buf.toString("utf-8");

    expect(output).toBe("Account,Amount,Date");
  });

  it("uses columnName for headers, falling back to field name", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true },
      fields: [
        { name: "col_a", target: "x.a", type: "string", columnName: "Column A" },
        { name: "col_b", target: "x.b", type: "string" }
      ]
    };

    const buf = serialiseCsv(schema, []);
    const output = buf.toString("utf-8");
    expect(output).toBe("Column A,col_b");
  });

  it("omits header row when hasHeaderRow=false", () => {
    const schema = csvSchema({
      format: { type: "csv", hasHeaderRow: false }
    });

    const buf = serialiseCsv(schema, [{ account: "1000", amount: 250, date: null }]);
    const output = buf.toString("utf-8");

    // First line should be data, not header
    expect(output.startsWith("1000")).toBe(true);
  });
});

// ── Basic serialisation ───────────────────────────────────────────────────

describe("Basic serialisation", () => {
  it("serialises structured rows to CSV", () => {
    const rows: ProfileFsdStructuredRow[] = [
      { account: "1000", amount: 250.5, date: new Date(Date.UTC(2026, 2, 15)) },
      { account: "2000", amount: 100, date: new Date(Date.UTC(2026, 2, 16)) }
    ];

    const buf = serialiseCsv(csvSchema(), rows);
    const output = buf.toString("utf-8");
    const lines = output.split("\r\n");

    expect(lines[0]).toBe("Account,Amount,Date");
    expect(lines[1]).toBe("1000,250.5,15/03/2026");
    expect(lines[2]).toBe("2000,100,16/03/2026");
  });
});

// ── Date formatting ───────────────────────────────────────────────────────

describe("Date formatting", () => {
  it("formats dates using dateFormat", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [{ name: "dt", target: "x.date", type: "date", dateFormat: "YYYY-MM-DD" }]
    };

    const buf = serialiseCsv(schema, [{ dt: new Date(Date.UTC(2026, 11, 25)) }]);
    expect(buf.toString("utf-8")).toBe("2026-12-25");
  });

  it("uses ISO format when no dateFormat specified", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [{ name: "dt", target: "x.date", type: "date" }]
    };

    const buf = serialiseCsv(schema, [{ dt: new Date(Date.UTC(2026, 0, 1)) }]);
    expect(buf.toString("utf-8")).toBe("2026-01-01");
  });
});

// ── decimalDivisor reverse ────────────────────────────────────────────────

describe("decimalDivisor reverse", () => {
  it("multiplies by decimalDivisor on output", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [{ name: "amount", target: "x.amount", type: "currency", decimalDivisor: 1000 }]
    };

    // Value 5 * 1000 = 5000 on output
    const buf = serialiseCsv(schema, [{ amount: 5 }]);
    expect(buf.toString("utf-8")).toBe("5000");
  });

  it("does NOT multiply when decimalDivisor not set", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [{ name: "amount", target: "x.amount", type: "currency" }]
    };

    const buf = serialiseCsv(schema, [{ amount: 5000 }]);
    expect(buf.toString("utf-8")).toBe("5000");
  });
});

// ── Null handling ─────────────────────────────────────────────────────────

describe("Null handling", () => {
  it("outputs empty string for null by default", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        { name: "a", target: "x.a", type: "string" },
        { name: "b", target: "x.b", type: "string" }
      ]
    };

    const buf = serialiseCsv(schema, [{ a: "X", b: null }]);
    expect(buf.toString("utf-8")).toBe("X,");
  });

  it("uses outputNullAs when set", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [
        { name: "a", target: "x.a", type: "string" },
        { name: "b", target: "x.b", type: "string" }
      ],
      options: { outputNullAs: "NULL" }
    };

    const buf = serialiseCsv(schema, [{ a: "X", b: null }]);
    expect(buf.toString("utf-8")).toBe("X,NULL");
  });
});

// ── Quoting ───────────────────────────────────────────────────────────────

describe("Quoting", () => {
  it("quotes fields containing the delimiter", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [{ name: "desc", target: "x.desc", type: "string" }]
    };

    const buf = serialiseCsv(schema, [{ desc: "Hello, World" }]);
    expect(buf.toString("utf-8")).toBe('"Hello, World"');
  });

  it("quotes fields containing the quote character (and doubles it)", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [{ name: "desc", target: "x.desc", type: "string" }]
    };

    const buf = serialiseCsv(schema, [{ desc: 'He said "hello"' }]);
    expect(buf.toString("utf-8")).toBe('"He said ""hello"""');
  });

  it("quotes fields containing newlines", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false },
      fields: [{ name: "desc", target: "x.desc", type: "string" }]
    };

    const buf = serialiseCsv(schema, [{ desc: "line1\nline2" }]);
    expect(buf.toString("utf-8")).toBe('"line1\nline2"');
  });
});

// ── Line endings ──────────────────────────────────────────────────────────

describe("Line endings", () => {
  it("uses CRLF by default", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true },
      fields: [{ name: "a", target: "x.a", type: "string", columnName: "A" }]
    };

    const buf = serialiseCsv(schema, [{ a: "1" }, { a: "2" }]);
    const output = buf.toString("utf-8");
    expect(output).toBe("A\r\n1\r\n2");
  });

  it("uses LF when lineEnding=LF", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true, lineEnding: "LF" },
      fields: [{ name: "a", target: "x.a", type: "string", columnName: "A" }]
    };

    const buf = serialiseCsv(schema, [{ a: "1" }, { a: "2" }]);
    const output = buf.toString("utf-8");
    expect(output).toBe("A\n1\n2");
  });
});

// ── Encoding ──────────────────────────────────────────────────────────────

describe("Encoding", () => {
  it("encodes as latin1 when specified", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false, encoding: "latin1" },
      fields: [{ name: "name", target: "x.name", type: "string" }]
    };

    const buf = serialiseCsv(schema, [{ name: "Hôtel" }]);
    // Verify it's a Buffer and can be decoded as latin1
    const decoded = buf.toString("latin1");
    expect(decoded).toBe("Hôtel");
  });
});

// ── TSV ───────────────────────────────────────────────────────────────────

describe("TSV serialisation", () => {
  it("uses tab delimiter for TSV", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "tsv", hasHeaderRow: true },
      fields: [
        { name: "a", target: "x.a", type: "string", columnName: "A" },
        { name: "b", target: "x.b", type: "string", columnName: "B" }
      ]
    };

    const buf = serialiseCsv(schema, [{ a: "1", b: "2" }]);
    const output = buf.toString("utf-8");
    const lines = output.split("\r\n");
    expect(lines[0]).toBe("A\tB");
    expect(lines[1]).toBe("1\t2");
  });
});

// ── ignoreField ───────────────────────────────────────────────────────────

describe("ignoreField", () => {
  it("skips fields with ignoreField=true", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true },
      fields: [
        { name: "a", target: "x.a", type: "string", columnName: "A" },
        { name: "b", target: "x.b", type: "string", columnName: "B", ignoreField: true },
        { name: "c", target: "x.c", type: "string", columnName: "C" }
      ]
    };

    const buf = serialiseCsv(schema, [{ a: "1", b: "2", c: "3" }]);
    const output = buf.toString("utf-8");
    const lines = output.split("\r\n");
    expect(lines[0]).toBe("A,C");
    expect(lines[1]).toBe("1,3");
  });
});

// ── Round-trip: parse → serialise → parse ─────────────────────────────────

describe("Round-trip", () => {
  it("parse CSV → serialise → parse again → same data", () => {
    const schema = csvSchema({
      format: { type: "csv", hasHeaderRow: true, lineEnding: "LF" }
    });

    const original = ["Account,Amount,Date", "1000,250.5,15/03/2026", "2000,100,16/03/2026"].join(
      "\n"
    );

    // Parse
    const parsed = parseCsv(schema, original);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rowCount).toBe(2);

    // Convert parsed rows to structured rows for serialisation
    const structured: ProfileFsdStructuredRow[] = parsed.rows.map((row) => {
      const obj: ProfileFsdStructuredRow = {};
      for (const [name, cell] of Object.entries(row.fields)) {
        obj[name] = cell.parsedValue;
      }
      return obj;
    });

    // Serialise
    const buf = serialiseCsv(schema, structured);
    const serialised = buf.toString("utf-8");

    // Parse again
    const reparsed = parseCsv(schema, serialised);
    expect(reparsed.errors).toHaveLength(0);
    expect(reparsed.rowCount).toBe(2);

    // Compare values
    for (let i = 0; i < parsed.rowCount; i++) {
      const orig = parsed.rows[i]!;
      const round = reparsed.rows[i]!;
      for (const fieldName of Object.keys(orig.fields)) {
        const origVal = orig.fields[fieldName]!.parsedValue;
        const roundVal = round.fields[fieldName]!.parsedValue;
        if (origVal instanceof Date) {
          expect((roundVal as Date).toISOString(), `Row ${i} field ${fieldName}`).toBe(
            origVal.toISOString()
          );
        } else {
          expect(roundVal, `Row ${i} field ${fieldName}`).toEqual(origVal);
        }
      }
    }
  });

  it("round-trips with decimalDivisor correctly", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: false, lineEnding: "LF" },
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

    // Parse: "5000" → 5000 / 1000 = 5
    const parsed = parseCsv(schema, "5000\n");
    expect(parsed.rows[0]!.fields.amount!.parsedValue).toBe(5);

    // Serialise: 5 * 1000 = 5000
    const buf = serialiseCsv(schema, [{ amount: 5 }]);
    expect(buf.toString("utf-8")).toBe("5000");

    // Re-parse: "5000" → 5
    const reparsed = parseCsv(schema, buf.toString("utf-8") + "\n");
    expect(reparsed.rows[0]!.fields.amount!.parsedValue).toBe(5);
  });
});
