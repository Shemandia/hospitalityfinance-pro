import { describe, it, expect } from "vitest";
import { FsdEngine } from "../src/engine.js";
import type {
  ProfileFsdSchema,
  ProfileFsdRawRow,
  ProfileFsdStructuredRow
} from "../src/profile/types.js";

const engine = new FsdEngine();

// ── validateSchema ────────────────────────────────────────────────────────

describe("FsdEngine.validateSchema", () => {
  it("returns valid for a correct schema", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv" },
      fields: [{ name: "code", target: "x.code", type: "string", columnIndex: 0 }]
    };

    const result = engine.validateSchema(schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns errors for an invalid schema", () => {
    const result = engine.validateSchema({ version: "2.0" });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ── parse — CSV routing ───────────────────────────────────────────────────

describe("FsdEngine.parse — CSV", () => {
  it("routes to CSV parser for type=csv", async () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true },
      fields: [
        { name: "code", target: "x.code", type: "string", columnName: "Code" },
        { name: "val", target: "x.val", type: "integer", columnName: "Val" }
      ]
    };

    const buf = Buffer.from("Code,Val\nABC,42\nDEF,99\n");
    const result = await engine.parse(buf, schema);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]!.fields.code!.parsedValue).toBe("ABC");
    expect(result.rows[0]!.fields.val!.parsedValue).toBe(42);
  });
});

// ── parse — TSV routing ───────────────────────────────────────────────────

describe("FsdEngine.parse — TSV", () => {
  it("routes to CSV parser with tab delimiter for type=tsv", async () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "tsv", hasHeaderRow: true },
      fields: [
        { name: "a", target: "x.a", type: "string", columnName: "A" },
        { name: "b", target: "x.b", type: "string", columnName: "B" }
      ]
    };

    const buf = Buffer.from("A\tB\n1\t2\n");
    const result = await engine.parse(buf, schema);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.fields.a!.parsedValue).toBe("1");
  });
});

// ── parse — Fixed routing ─────────────────────────────────────────────────

describe("FsdEngine.parse — Fixed", () => {
  it("routes to fixed parser for type=fixed", async () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: [
        { name: "code", target: "x.code", type: "string", fixedStart: 0, fixedLength: 5 },
        { name: "num", target: "x.num", type: "integer", fixedStart: 5, fixedLength: 5 }
      ]
    };

    const buf = Buffer.from("ABCDE  042");
    const result = await engine.parse(buf, schema);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.fields.code!.parsedValue).toBe("ABCDE");
    expect(result.rows[0]!.fields.num!.parsedValue).toBe(42);
  });
});

// ── parse — XML routing ──────────────────────────────────────────────────

describe("FsdEngine.parse — XML/SSML", () => {
  it("routes to XML parser for type=xml_ssml", async () => {
    const xml = `<SSC><TRANSACTION><CODE>ABC</CODE><AMT>5000</AMT></TRANSACTION></SSC>`;
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "TRANSACTION" },
      fields: [
        { name: "code", target: "x.code", type: "string", xmlPath: "CODE" },
        { name: "amt", target: "x.amt", type: "currency", xmlPath: "AMT", decimalDivisor: 1000 }
      ]
    };

    const buf = Buffer.from(xml);
    const result = await engine.parse(buf, schema);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.fields.code!.parsedValue).toBe("ABC");
    expect(result.rows[0]!.fields.amt!.parsedValue).toBe(5);
  });
});

// ── parse — unsupported type ──────────────────────────────────────────────

describe("FsdEngine.parse — unsupported", () => {
  it("returns error for unsupported format type", async () => {
    const schema = {
      version: "1.0",
      format: { type: "unknown" },
      fields: []
    } as unknown as ProfileFsdSchema;

    const result = await engine.parse(Buffer.alloc(0), schema);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("Unsupported");
  });
});

// ── validate ──────────────────────────────────────────────────────────────

describe("FsdEngine.validate", () => {
  it("validates parsed rows and returns errors", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv" },
      fields: [{ name: "num", target: "x.num", type: "integer" }]
    };

    const rows: ProfileFsdRawRow[] = [
      {
        rowIndex: 0,
        fields: {
          num: { rawValue: "abc", parsedValue: "abc", mappedPath: "x.num", errors: [] }
        }
      }
    ];

    const result = engine.validate(rows, schema);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });

  it("returns no errors for valid rows", () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv" },
      fields: [{ name: "num", target: "x.num", type: "integer" }]
    };

    const rows: ProfileFsdRawRow[] = [
      {
        rowIndex: 0,
        fields: {
          num: { rawValue: "42", parsedValue: 42, mappedPath: "x.num", errors: [] }
        }
      }
    ];

    const result = engine.validate(rows, schema);
    expect(result.errors).toHaveLength(0);
  });
});

// ── serialise ─────────────────────────────────────────────────────────────

describe("FsdEngine.serialise", () => {
  it("serialises CSV rows to a Buffer", async () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true, lineEnding: "LF" },
      fields: [
        { name: "code", target: "x.code", type: "string", columnName: "Code" },
        { name: "val", target: "x.val", type: "integer", columnName: "Val" }
      ]
    };

    const rows: ProfileFsdStructuredRow[] = [
      { code: "ABC", val: 42 },
      { code: "DEF", val: 99 }
    ];

    const buf = await engine.serialise(rows, schema);
    const output = buf.toString("utf-8");
    expect(output).toBe("Code,Val\nABC,42\nDEF,99");
  });

  it("throws for unsupported serialisation format", async () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "fixed" },
      fields: []
    };

    await expect(engine.serialise([], schema)).rejects.toThrow(/not yet supported/i);
  });
});

// ── detectFormat ──────────────────────────────────────────────────────────

describe("FsdEngine.detectFormat", () => {
  it("detects CSV format", () => {
    const sample = Buffer.from("Name,Amount,Date,Code,Status\nA,1,2026-01-01,X,Y\n");
    const result = engine.detectFormat(sample);
    expect(result.detectedFormat.type).toBe("csv");
  });

  it("detects XML format", () => {
    const sample = Buffer.from('<?xml version="1.0"?><root></root>');
    const result = engine.detectFormat(sample);
    expect(result.detectedFormat.type).toBe("xml_ssml");
  });

  it("accepts hint parameter", () => {
    const sample = Buffer.from("some\tdata\there");
    const result = engine.detectFormat(sample, { type: "tsv" });
    expect(result.detectedFormat.type).toBe("tsv");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

// ── Full integration: parse → validate → serialise ────────────────────────

describe("Full integration", () => {
  it("parse → validate → serialise round-trip", async () => {
    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "csv", hasHeaderRow: true, lineEnding: "LF" },
      fields: [
        { name: "code", target: "x.code", type: "string", columnName: "Code", required: true },
        { name: "amount", target: "x.amount", type: "decimal", columnName: "Amount" }
      ]
    };

    const input = Buffer.from("Code,Amount\nABC,100.50\nDEF,200.75\n");

    // Parse
    const parsed = await engine.parse(input, schema);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.rowCount).toBe(2);

    // Validate
    const validated = engine.validate(parsed.rows, schema);
    expect(validated.errors).toHaveLength(0);

    // Serialise
    const structured: ProfileFsdStructuredRow[] = parsed.rows.map((row) => {
      const obj: ProfileFsdStructuredRow = {};
      for (const [name, cell] of Object.entries(row.fields)) {
        obj[name] = cell.parsedValue;
      }
      return obj;
    });

    const output = await engine.serialise(structured, schema);
    const text = output.toString("utf-8");
    expect(text).toBe("Code,Amount\nABC,100.5\nDEF,200.75");
  });
});
