import { describe, expect, it } from "vitest";
import { parse, write } from "../src/api.js";
import type { FsdSchema } from "../src/types.js";

const delimitedSchema: FsdSchema = {
  classification: "DELIMITED",
  fieldSep: ",",
  recordSep: "\n",
  record: {
    name: "row",
    fields: [
      { name: "code", type: "string", required: true, maxLength: 10 },
      { name: "amount", type: "integer", required: true, maxLength: 10 }
    ]
  }
};

const fixedSchema: FsdSchema = {
  classification: "SINGLE_FIXED",
  recordSep: "\n",
  record: {
    name: "row",
    fields: [
      { name: "code", type: "string", maxLength: 5, trailingChars: " " },
      { name: "amount", type: "integer", maxLength: 10, leadingChars: "0" }
    ]
  }
};

const xmlSchema: FsdSchema = {
  classification: "SIMPLE_XML",
  xmlRoot: "Rows",
  record: {
    name: "Row",
    fields: [
      { name: "code", type: "string", required: true },
      { name: "amount", type: "integer", required: true }
    ]
  }
};

describe("parse() dispatch", () => {
  it("routes DELIMITED to the delimited parser", () => {
    const result = parse(delimitedSchema, "ABC,100\nDEF,200");
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { code: "ABC", amount: 100 },
      { code: "DEF", amount: 200 }
    ]);
  });

  it("routes SINGLE_FIXED to the fixed-width parser", () => {
    const result = parse(fixedSchema, "ABC  0000000100\nDEF  0000000200");
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { code: "ABC", amount: 100 },
      { code: "DEF", amount: 200 }
    ]);
  });

  it("routes SIMPLE_XML to the xml parser", () => {
    const input =
      "<Rows>" +
      "<Row><code>ABC</code><amount>100</amount></Row>" +
      "<Row><code>DEF</code><amount>200</amount></Row>" +
      "</Rows>";
    const result = parse(xmlSchema, input);
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      { code: "ABC", amount: 100 },
      { code: "DEF", amount: 200 }
    ]);
  });

  it("returns UNSUPPORTED_CLASSIFICATION for MULTIPLE_FIXED", () => {
    const schema: FsdSchema = {
      classification: "MULTIPLE_FIXED",
      record: { name: "r", fields: [] }
    };
    const result = parse(schema, "");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("UNSUPPORTED_CLASSIFICATION");
  });

  it("returns UNSUPPORTED_CLASSIFICATION for OTHER_FLAT", () => {
    const schema: FsdSchema = {
      classification: "OTHER_FLAT",
      record: { name: "r", fields: [] }
    };
    expect(parse(schema, "").errors[0]?.code).toBe("UNSUPPORTED_CLASSIFICATION");
  });

  it("returns UNSUPPORTED_CLASSIFICATION for USER_XML", () => {
    const schema: FsdSchema = {
      classification: "USER_XML",
      record: { name: "r", fields: [] }
    };
    expect(parse(schema, "").errors[0]?.code).toBe("UNSUPPORTED_CLASSIFICATION");
  });
});

describe("write() dispatch", () => {
  it("routes DELIMITED to the delimited writer", () => {
    const result = write(delimitedSchema, [{ code: "ABC", amount: 100 }]);
    expect(result.errors).toEqual([]);
    expect(result.output).toBe("ABC,100");
  });

  it("routes SINGLE_FIXED to the fixed-width writer", () => {
    const result = write(fixedSchema, [{ code: "ABC", amount: 100 }]);
    expect(result.errors).toEqual([]);
    expect(result.output).toBe("ABC  0000000100");
  });

  it("routes SIMPLE_XML to the xml writer", () => {
    const result = write(xmlSchema, [{ code: "ABC", amount: 100 }]);
    expect(result.errors).toEqual([]);
    expect(result.output).toContain("<Row>");
    expect(result.output).toContain("<code>ABC</code>");
    expect(result.output).toContain("<amount>100</amount>");
  });

  it("returns UNSUPPORTED_CLASSIFICATION for unsupported writes", () => {
    const schema: FsdSchema = {
      classification: "MULTIPLE_FIXED",
      record: { name: "r", fields: [] }
    };
    const result = write(schema, []);
    expect(result.errors[0]?.code).toBe("UNSUPPORTED_CLASSIFICATION");
    expect(result.output).toBe("");
  });
});
