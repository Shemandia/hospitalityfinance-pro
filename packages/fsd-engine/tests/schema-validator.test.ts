import { describe, expect, it } from "vitest";
import { validateProfileSchema } from "../src/profile/schema-validator.js";
import type { ProfileFsdSchema } from "../src/profile/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function validCsvSchema(overrides?: Partial<ProfileFsdSchema>): ProfileFsdSchema {
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
        columnIndex: 1
      }
    ],
    ...overrides
  };
}

function validFixedSchema(): ProfileFsdSchema {
  return {
    version: "1.0",
    format: { type: "fixed", fixedRecordLength: 80 },
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
        fixedLength: 15
      }
    ]
  };
}

function validXmlSchema(): ProfileFsdSchema {
  return {
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
        type: "decimal",
        xmlPath: "AMOUNT",
        decimalDivisor: 1000
      }
    ]
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("validateProfileSchema", () => {
  // ── Valid schemas ────────────────────────────────────────────────────

  describe("valid schemas", () => {
    it("accepts a valid CSV schema", () => {
      const result = validateProfileSchema(validCsvSchema());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts a valid fixed-width schema", () => {
      const result = validateProfileSchema(validFixedSchema());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts a valid XML/SSML schema", () => {
      const result = validateProfileSchema(validXmlSchema());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts a valid TSV schema with columnIndex", () => {
      const schema: ProfileFsdSchema = {
        version: "1.0",
        format: { type: "tsv" },
        fields: [{ name: "col1", target: "journal.ref", type: "string", columnIndex: 0 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(true);
    });

    it("accepts a valid XLSX schema", () => {
      const schema: ProfileFsdSchema = {
        version: "1.0",
        format: { type: "xlsx", sheetIndex: 0, hasHeaderRow: true },
        fields: [{ name: "date", target: "journal.date", type: "date", columnName: "Date" }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(true);
    });

    it("accepts schema with all optional field properties", () => {
      const schema: ProfileFsdSchema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [
          {
            name: "amount",
            target: "journal.lines[].debit",
            type: "currency",
            columnIndex: 0,
            required: true,
            defaultValue: "0",
            maxLength: 20,
            minLength: 1,
            pattern: "^\\d+\\.?\\d*$",
            decimalDivisor: 1000,
            precision: 2,
            trimWhitespace: true,
            ignoreField: false
          }
        ]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(true);
    });

    it("accepts schema with options", () => {
      const schema = validCsvSchema();
      schema.options = {
        skipBlankRows: true,
        maxErrors: 50,
        strictMode: true,
        outputNullAs: "NULL"
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(true);
    });
  });

  // ── Missing version ─────────────────────────────────────────────────

  describe("version validation", () => {
    it("fails when version is missing", () => {
      const schema = {
        format: { type: "csv" },
        fields: [{ name: "a", target: "b", type: "string", columnIndex: 0 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "version")).toBe(true);
    });

    it("fails when version is not 1.0", () => {
      const schema = validCsvSchema({ version: "2.0" as any });
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "version")).toBe(true);
    });
  });

  // ── Format validation ───────────────────────────────────────────────

  describe("format validation", () => {
    it("fails when format is missing", () => {
      const result = validateProfileSchema({ version: "1.0", fields: [] });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "format")).toBe(true);
    });

    it("fails when format.type is unknown", () => {
      const schema = {
        version: "1.0",
        format: { type: "parquet" },
        fields: [{ name: "a", target: "b", type: "string" }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "format.type")).toBe(true);
      expect(result.errors[0]?.message).toContain("parquet");
    });

    it("fails with invalid lineEnding", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv", lineEnding: "CR" },
        fields: [{ name: "a", target: "b", type: "string", columnIndex: 0 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "format.lineEnding")).toBe(true);
    });

    it("fails with negative sheetIndex for xlsx", () => {
      const schema = {
        version: "1.0",
        format: { type: "xlsx", sheetIndex: -1 },
        fields: [{ name: "a", target: "b", type: "string", columnName: "A" }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "format.sheetIndex")).toBe(true);
    });
  });

  // ── Field validation ────────────────────────────────────────────────

  describe("field validation", () => {
    it("fails when fields array is missing", () => {
      const result = validateProfileSchema({ version: "1.0", format: { type: "csv" } });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "fields")).toBe(true);
    });

    it("fails when fields array is empty", () => {
      const result = validateProfileSchema({
        version: "1.0",
        format: { type: "csv" },
        fields: []
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "fields")).toBe(true);
    });

    it("fails when field has no name", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [{ target: "journal.ref", type: "string", columnIndex: 0 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "fields[0].name")).toBe(true);
    });

    it("fails when field has no target", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [{ name: "a", type: "string", columnIndex: 0 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "fields[0].target")).toBe(true);
    });

    it("fails with unknown field type", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [{ name: "a", target: "b", type: "blob", columnIndex: 0 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "fields[0].type")).toBe(true);
      expect(result.errors[0]?.message).toContain("blob");
    });

    it("detects duplicate field names", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [
          { name: "amount", target: "journal.lines[].debit", type: "decimal", columnIndex: 0 },
          { name: "amount", target: "journal.lines[].credit", type: "decimal", columnIndex: 1 }
        ]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
    });

    it("fails with invalid regex pattern", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [
          {
            name: "code",
            target: "line.account",
            type: "string",
            columnIndex: 0,
            pattern: "[invalid"
          }
        ]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "fields[0].pattern")).toBe(true);
    });

    it("fails with negative maxLength", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [{ name: "a", target: "b", type: "string", columnIndex: 0, maxLength: -5 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "fields[0].maxLength")).toBe(true);
    });

    it("fails with zero decimalDivisor", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [{ name: "a", target: "b", type: "decimal", columnIndex: 0, decimalDivisor: 0 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "fields[0].decimalDivisor")).toBe(true);
    });

    it("fails with non-string allowedValues", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [
          {
            name: "status",
            target: "line.status",
            type: "enum",
            columnIndex: 0,
            allowedValues: [1, 2]
          }
        ]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "fields[0].allowedValues")).toBe(true);
    });
  });

  // ── Position validation per format ──────────────────────────────────

  describe("field position validation", () => {
    it("csv field without columnIndex or columnName fails", () => {
      const schema = {
        version: "1.0",
        format: { type: "csv" },
        fields: [{ name: "a", target: "b", type: "string" }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("columnIndex"))).toBe(true);
    });

    it("tsv field without columnIndex or columnName fails", () => {
      const schema = {
        version: "1.0",
        format: { type: "tsv" },
        fields: [{ name: "a", target: "b", type: "string" }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
    });

    it("xlsx field with columnName is valid", () => {
      const schema = {
        version: "1.0",
        format: { type: "xlsx" },
        fields: [{ name: "a", target: "b", type: "string", columnName: "Column A" }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(true);
    });

    it("fixed field without fixedStart fails", () => {
      const schema = {
        version: "1.0",
        format: { type: "fixed" },
        fields: [{ name: "a", target: "b", type: "string", fixedLength: 10 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("fixedStart"))).toBe(true);
    });

    it("fixed field without fixedLength fails", () => {
      const schema = {
        version: "1.0",
        format: { type: "fixed" },
        fields: [{ name: "a", target: "b", type: "string", fixedStart: 0 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("fixedLength"))).toBe(true);
    });

    it("fixed field with negative fixedStart fails", () => {
      const schema = {
        version: "1.0",
        format: { type: "fixed" },
        fields: [{ name: "a", target: "b", type: "string", fixedStart: -1, fixedLength: 10 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
    });

    it("fixed field with zero fixedLength fails", () => {
      const schema = {
        version: "1.0",
        format: { type: "fixed" },
        fields: [{ name: "a", target: "b", type: "string", fixedStart: 0, fixedLength: 0 }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
    });

    it("xml_ssml field without xmlPath fails", () => {
      const schema = {
        version: "1.0",
        format: { type: "xml_ssml" },
        fields: [{ name: "a", target: "b", type: "string" }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("xmlPath"))).toBe(true);
    });

    it("xml_ssml field with xmlPath is valid", () => {
      const schema = {
        version: "1.0",
        format: { type: "xml_ssml", xmlRootElement: "TX" },
        fields: [{ name: "a", target: "b", type: "string", xmlPath: "FIELD_A" }]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(true);
    });
  });

  // ── Options validation ──────────────────────────────────────────────

  describe("options validation", () => {
    it("fails with maxErrors less than 1", () => {
      const schema = validCsvSchema();
      schema.options = { maxErrors: 0 };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "options.maxErrors")).toBe(true);
    });

    it("fails with negative skipRowsBeforeHeader", () => {
      const schema = validCsvSchema();
      schema.options = { skipRowsBeforeHeader: -1 };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "options.skipRowsBeforeHeader")).toBe(true);
    });

    it("fails when options is not an object", () => {
      const schema = { ...validCsvSchema(), options: "invalid" };
      const result = validateProfileSchema(schema as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.path === "options")).toBe(true);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("rejects null schema", () => {
      const result = validateProfileSchema(null);
      expect(result.valid).toBe(false);
    });

    it("rejects undefined schema", () => {
      const result = validateProfileSchema(undefined);
      expect(result.valid).toBe(false);
    });

    it("rejects a string", () => {
      const result = validateProfileSchema("not a schema");
      expect(result.valid).toBe(false);
    });

    it("rejects an empty object", () => {
      const result = validateProfileSchema({});
      expect(result.valid).toBe(false);
    });

    it("all errors have SCHEMA_INVALID code", () => {
      const result = validateProfileSchema({});
      expect(result.errors.length).toBeGreaterThan(0);
      for (const error of result.errors) {
        expect(error.code).toBe("SCHEMA_INVALID");
      }
    });

    it("collects multiple errors in one pass", () => {
      const schema = {
        version: "2.0",
        format: { type: "csv" },
        fields: [
          { name: "a", type: "blob" },
          { target: "b", type: "string", columnIndex: 0 }
        ]
      };
      const result = validateProfileSchema(schema);
      expect(result.valid).toBe(false);
      // Should have version error + field errors
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
