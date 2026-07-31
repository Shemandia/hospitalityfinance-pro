import { describe, it, expect } from "vitest";
import { parseXmlSsml } from "../../src/parsers/xml-ssml.js";
import type { ProfileFsdSchema } from "../../src/profile/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

/** SunSystems-style SSML envelope with TRANSACTION records. */
function ssmlDoc(transactions: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<SSC>
${transactions}
</SSC>`;
}

function txn(fields: string): string {
  return `  <TRANSACTION>${fields}</TRANSACTION>`;
}

// ── 1. Parse .SUN SSML XML ───────────────────────────────────────────────

describe("Parse .SUN SSML XML", () => {
  it("parses a SunSystems SSML envelope with multiple transactions", () => {
    const xml = ssmlDoc(`
  <TRANSACTION>
    <ACCNT_CODE>1000</ACCNT_CODE>
    <AMOUNT>5000</AMOUNT>
    <JRNAL_NO>JV001</JRNAL_NO>
  </TRANSACTION>
  <TRANSACTION>
    <ACCNT_CODE>2000</ACCNT_CODE>
    <AMOUNT>3000</AMOUNT>
    <JRNAL_NO>JV002</JRNAL_NO>
  </TRANSACTION>
`);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "TRANSACTION" },
      fields: [
        {
          name: "account",
          target: "journal.lines[].account",
          type: "string",
          xmlPath: "ACCNT_CODE"
        },
        {
          name: "amount",
          target: "journal.lines[].debit",
          type: "currency",
          xmlPath: "AMOUNT",
          decimalDivisor: 1000
        },
        { name: "journal", target: "journal.reference", type: "string", xmlPath: "JRNAL_NO" }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.aborted).toBe(false);
    expect(result.rowCount).toBe(2);

    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(5); // 5000 / 1000
    expect(result.rows[0]!.fields.journal!.parsedValue).toBe("JV001");

    expect(result.rows[1]!.fields.account!.parsedValue).toBe("2000");
    expect(result.rows[1]!.fields.amount!.parsedValue).toBe(3); // 3000 / 1000
  });
});

// ── 2. xmlPath extraction (simple and nested dot-paths) ───────────────────

describe("xmlPath extraction", () => {
  it("extracts simple top-level element by xmlPath", () => {
    const xml = `<ROOT><ITEM><CODE>ABC</CODE></ITEM></ROOT>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ITEM" },
      fields: [{ name: "code", target: "x.code", type: "string", xmlPath: "CODE" }]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.code!.parsedValue).toBe("ABC");
  });

  it("extracts nested elements via dot-path traversal", () => {
    const xml = ssmlDoc(`
  <TRANSACTION>
    <HEADER>
      <DATE>2026-03-15</DATE>
      <REFERENCE>REF001</REFERENCE>
    </HEADER>
    <LINE>
      <ACCOUNT>1000</ACCOUNT>
      <AMOUNT>500</AMOUNT>
    </LINE>
  </TRANSACTION>
`);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "TRANSACTION" },
      fields: [
        {
          name: "date",
          target: "journal.date",
          type: "date",
          xmlPath: "HEADER.DATE",
          dateFormat: "YYYY-MM-DD"
        },
        { name: "ref", target: "journal.reference", type: "string", xmlPath: "HEADER.REFERENCE" },
        {
          name: "account",
          target: "journal.lines[].account",
          type: "string",
          xmlPath: "LINE.ACCOUNT"
        },
        { name: "amount", target: "journal.lines[].debit", type: "decimal", xmlPath: "LINE.AMOUNT" }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.fields.date!.parsedValue).toBeInstanceOf(Date);
    expect((result.rows[0]!.fields.date!.parsedValue as Date).toISOString().slice(0, 10)).toBe(
      "2026-03-15"
    );
    expect(result.rows[0]!.fields.ref!.parsedValue).toBe("REF001");
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(500);
  });

  it("returns null for non-existent dot-path", () => {
    const xml = `<ROOT><ITEM><CODE>X</CODE></ITEM></ROOT>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ITEM" },
      fields: [
        { name: "code", target: "x.code", type: "string", xmlPath: "CODE" },
        { name: "missing", target: "x.missing", type: "string", xmlPath: "NONEXISTENT.PATH" }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.fields.code!.parsedValue).toBe("X");
    expect(result.rows[0]!.fields.missing!.parsedValue).toBeNull();
  });
});

// ── 3. decimalDivisor: 1000 applied when set on field ─────────────────────

describe("decimalDivisor", () => {
  it("applies decimalDivisor: 1000 for SSML amounts", () => {
    const xml = ssmlDoc(`
  <TRANSACTION>
    <AMOUNT>12500</AMOUNT>
  </TRANSACTION>
`);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "TRANSACTION" },
      fields: [
        {
          name: "amount",
          target: "x.amount",
          type: "currency",
          xmlPath: "AMOUNT",
          decimalDivisor: 1000
        }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(12.5);
  });

  it("applies decimalDivisor: 100 for cent-based amounts", () => {
    const xml = ssmlDoc(`
  <TRANSACTION>
    <AMOUNT>15099</AMOUNT>
  </TRANSACTION>
`);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "TRANSACTION" },
      fields: [
        {
          name: "amount",
          target: "x.amount",
          type: "currency",
          xmlPath: "AMOUNT",
          decimalDivisor: 100
        }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(150.99);
  });

  // ── 4. decimalDivisor NOT applied when omitted ────────────────────────

  it("does NOT apply any divisor when decimalDivisor is omitted", () => {
    const xml = ssmlDoc(`
  <TRANSACTION>
    <AMOUNT>5000</AMOUNT>
  </TRANSACTION>
`);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "TRANSACTION" },
      fields: [{ name: "amount", target: "x.amount", type: "currency", xmlPath: "AMOUNT" }]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    // Value passes through as-is — no division applied
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(5000);
  });

  it("handles negative signed integers with divisor", () => {
    const xml = ssmlDoc(`
  <TRANSACTION>
    <AMOUNT>-7500</AMOUNT>
  </TRANSACTION>
`);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "TRANSACTION" },
      fields: [
        {
          name: "amount",
          target: "x.amount",
          type: "currency",
          xmlPath: "AMOUNT",
          decimalDivisor: 1000
        }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(-7.5);
  });
});

// ── 5. Multiple root elements (multiple rows) ────────────────────────────

describe("Multiple root elements", () => {
  it("parses multiple record elements as separate rows", () => {
    const xml = `<DATA>
  <ROW><ID>1</ID><NAME>Alpha</NAME></ROW>
  <ROW><ID>2</ID><NAME>Beta</NAME></ROW>
  <ROW><ID>3</ID><NAME>Gamma</NAME></ROW>
</DATA>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ROW" },
      fields: [
        { name: "id", target: "x.id", type: "integer", xmlPath: "ID" },
        { name: "name", target: "x.name", type: "string", xmlPath: "NAME" }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(3);
    expect(result.rows[0]!.fields.id!.parsedValue).toBe(1);
    expect(result.rows[0]!.fields.name!.parsedValue).toBe("Alpha");
    expect(result.rows[1]!.fields.id!.parsedValue).toBe(2);
    expect(result.rows[2]!.fields.name!.parsedValue).toBe("Gamma");
  });

  it("handles a single record element (not wrapped in array)", () => {
    const xml = `<DATA><ROW><ID>42</ID></ROW></DATA>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ROW" },
      fields: [{ name: "id", target: "x.id", type: "integer", xmlPath: "ID" }]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.fields.id!.parsedValue).toBe(42);
  });
});

// ── 6. Missing xmlPath field returns error ────────────────────────────────

describe("Missing xmlPath", () => {
  it("reports REQUIRED_MISSING when field has no xmlPath and is required", () => {
    const xml = `<DATA><ROW><CODE>X</CODE></ROW></DATA>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ROW" },
      fields: [
        { name: "code", target: "x.code", type: "string", xmlPath: "CODE" },
        { name: "missing", target: "x.missing", type: "string", required: true } as any
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("REQUIRED_MISSING");
    expect(result.errors[0]!.fieldName).toBe("missing");
  });

  it("returns error when xmlRootElement is not set", () => {
    const xml = `<DATA><ROW><CODE>X</CODE></ROW></DATA>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml" },
      fields: [{ name: "code", target: "x.code", type: "string", xmlPath: "CODE" }]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("xmlRootElement");
    expect(result.rowCount).toBe(0);
  });

  it("returns error when root element not found in XML", () => {
    const xml = `<DATA><WRONG>stuff</WRONG></DATA>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ROW" },
      fields: [{ name: "code", target: "x.code", type: "string", xmlPath: "CODE" }]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("<ROW>");
    expect(result.rowCount).toBe(0);
  });
});

// ── 7. Type coercion and field validation ─────────────────────────────────

describe("Type coercion and validation", () => {
  it("coerces integer fields", () => {
    const xml = `<D><R><NUM>42</NUM></R></D>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "R" },
      fields: [{ name: "num", target: "x.num", type: "integer", xmlPath: "NUM" }]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.num!.parsedValue).toBe(42);
  });

  it("returns TYPE_MISMATCH for non-integer value", () => {
    const xml = `<D><R><NUM>abc</NUM></R></D>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "R" },
      fields: [{ name: "num", target: "x.num", type: "integer", xmlPath: "NUM" }]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });

  it("coerces boolean fields", () => {
    const xml = `<D><R><ACTIVE>true</ACTIVE></R></D>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "R" },
      fields: [{ name: "active", target: "x.active", type: "boolean", xmlPath: "ACTIVE" }]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.active!.parsedValue).toBe(true);
  });

  it("returns INVALID_DATE_FORMAT for bad date", () => {
    const xml = `<D><R><DT>not-a-date</DT></R></D>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "R" },
      fields: [
        { name: "dt", target: "x.date", type: "date", xmlPath: "DT", dateFormat: "YYYY-MM-DD" }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("INVALID_DATE_FORMAT");
  });

  it("coerces date fields with dateFormat", () => {
    const xml = `<D><R><DT>15/03/2026</DT></R></D>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "R" },
      fields: [
        { name: "dt", target: "x.date", type: "date", xmlPath: "DT", dateFormat: "DD/MM/YYYY" }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(0);
    const d = result.rows[0]!.fields.dt!.parsedValue as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("returns REQUIRED_MISSING for empty required element", () => {
    const xml = `<D><R><CODE></CODE><FILLER>data</FILLER></R></D>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "R" },
      fields: [
        { name: "code", target: "x.code", type: "string", xmlPath: "CODE", required: true },
        { name: "filler", target: "x.filler", type: "string", xmlPath: "FILLER" }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("REQUIRED_MISSING");
  });

  it("returns PATTERN_MISMATCH for regex violation", () => {
    const xml = `<D><R><CODE>ab1</CODE></R></D>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "R" },
      fields: [
        { name: "code", target: "x.code", type: "string", xmlPath: "CODE", pattern: "^[A-Z]{3}$" }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("PATTERN_MISMATCH");
  });
});

// ── 8. Skip blank/empty elements ──────────────────────────────────────────

describe("Skip blank rows", () => {
  it("skips record elements where all fields are empty", () => {
    const xml = `<DATA>
  <ROW><CODE>ABC</CODE><VAL>100</VAL></ROW>
  <ROW><CODE></CODE><VAL></VAL></ROW>
  <ROW><CODE>DEF</CODE><VAL>200</VAL></ROW>
</DATA>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ROW" },
      fields: [
        { name: "code", target: "x.code", type: "string", xmlPath: "CODE" },
        { name: "val", target: "x.val", type: "integer", xmlPath: "VAL" }
      ]
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.rowCount).toBe(2);
    expect(result.skippedRows).toBe(1);
    expect(result.rows[0]!.fields.code!.parsedValue).toBe("ABC");
    expect(result.rows[1]!.fields.code!.parsedValue).toBe("DEF");
  });

  it("does NOT skip blank rows when skipBlankRows=false", () => {
    const xml = `<DATA>
  <ROW><CODE>ABC</CODE></ROW>
  <ROW><CODE></CODE></ROW>
  <ROW><CODE>DEF</CODE></ROW>
</DATA>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ROW" },
      fields: [{ name: "code", target: "x.code", type: "string", xmlPath: "CODE" }],
      options: { skipBlankRows: false }
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.rowCount).toBe(3);
    expect(result.skippedRows).toBe(0);
  });
});

// ── 9. maxErrors abort ───────────────────────────────────────────────────

describe("maxErrors abort", () => {
  it("aborts when errors reach maxErrors threshold", () => {
    const xml = `<DATA>
  <ROW><NUM>abc</NUM></ROW>
  <ROW><NUM>def</NUM></ROW>
  <ROW><NUM>ghi</NUM></ROW>
  <ROW><NUM>jkl</NUM></ROW>
</DATA>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ROW" },
      fields: [{ name: "num", target: "x.num", type: "integer", xmlPath: "NUM", required: true }],
      options: { maxErrors: 2 }
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.aborted).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.rowCount).toBeLessThan(4);
  });

  it("does not abort when errors are below maxErrors", () => {
    const xml = `<DATA>
  <ROW><NUM>abc</NUM></ROW>
  <ROW><NUM>100</NUM></ROW>
  <ROW><NUM>def</NUM></ROW>
</DATA>`;

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xml_ssml", xmlRootElement: "ROW" },
      fields: [{ name: "num", target: "x.num", type: "integer", xmlPath: "NUM" }],
      options: { maxErrors: 10 }
    };

    const result = parseXmlSsml(schema, xml);

    expect(result.aborted).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.rowCount).toBe(3);
  });
});
