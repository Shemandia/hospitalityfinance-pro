import { describe, expect, it } from "vitest";
import { parseXml, writeXml } from "../src/parsers/xml.js";
import type { FsdSchema } from "../src/types.js";

/**
 * A transaction list with element-valued fields plus one attribute-valued id.
 */
const txnSchema: FsdSchema = {
  classification: "SIMPLE_XML",
  xmlRoot: "Transactions",
  record: {
    name: "Transaction",
    fields: [
      { name: "id", type: "integer", required: true, xmlAttribute: true },
      { name: "accountCode", type: "string", required: true, maxLength: 20 },
      { name: "amount", type: "number", required: true, maxLength: 20 },
      { name: "description", type: "string", maxLength: 200 },
      { name: "entryDate", type: "date", maxLength: 10 }
    ]
  }
};

describe("parseXml", () => {
  it("parses a 2-record XML document into typed records", () => {
    const input =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      "<Transactions>" +
      '<Transaction id="1">' +
      "<accountCode>50010</accountCode>" +
      "<amount>385000</amount>" +
      "<description>Rice 50kg</description>" +
      "<entryDate>2026-04-01</entryDate>" +
      "</Transaction>" +
      '<Transaction id="2">' +
      "<accountCode>20010</accountCode>" +
      "<amount>385000</amount>" +
      "<description>Control</description>" +
      "<entryDate>2026-04-01</entryDate>" +
      "</Transaction>" +
      "</Transactions>";
    const result = parseXml(txnSchema, input);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({
      id: 1,
      accountCode: "50010",
      amount: 385000,
      description: "Rice 50kg"
    });
    expect(result.records[0]!.entryDate).toBeInstanceOf(Date);
    expect(result.records[1]!.id).toBe(2);
  });

  it("parses a single-record document (record not in an array)", () => {
    const input =
      "<Transactions>" +
      '<Transaction id="1">' +
      "<accountCode>50010</accountCode>" +
      "<amount>100</amount>" +
      "<description>Single</description>" +
      "<entryDate>2026-04-01</entryDate>" +
      "</Transaction>" +
      "</Transactions>";
    const result = parseXml(txnSchema, input);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.accountCode).toBe("50010");
  });

  it("reports SCHEMA_MISSING_XML_ROOT when the schema omits xmlRoot", () => {
    const bad: FsdSchema = {
      classification: "SIMPLE_XML",
      record: { name: "Transaction", fields: [{ name: "x" }] }
    };
    const result = parseXml(bad, "<Transactions/>");
    expect(result.errors[0]?.code).toBe("SCHEMA_MISSING_XML_ROOT");
  });

  it("reports XML_ROOT_NOT_FOUND when the root element is wrong", () => {
    const result = parseXml(txnSchema, "<Other><x>1</x></Other>");
    expect(result.errors[0]?.code).toBe("XML_ROOT_NOT_FOUND");
  });

  it("reports XML_PARSE_ERROR for malformed XML", () => {
    const result = parseXml(txnSchema, "<Transactions><Transaction");
    expect(result.errors[0]?.code).toBe("XML_PARSE_ERROR");
  });

  it("surfaces field-level validation errors with recordIndex", () => {
    // Missing required accountCode on record 1
    const input =
      "<Transactions>" +
      '<Transaction id="1">' +
      "<amount>100</amount>" +
      "</Transaction>" +
      "</Transactions>";
    const result = parseXml(txnSchema, input);
    const required = result.errors.find((e) => e.code === "REQUIRED");
    expect(required?.field).toBe("accountCode");
    expect(required?.recordIndex).toBe(0);
  });
});

describe("writeXml + round-trip", () => {
  it("writes records to XML with attributes and child elements", () => {
    const records = [
      {
        id: 1,
        accountCode: "50010",
        amount: 385000,
        description: "Rice 50kg",
        entryDate: new Date("2026-04-01T00:00:00.000Z")
      }
    ];
    const result = writeXml(txnSchema, records);
    expect(result.errors).toEqual([]);
    expect(result.output).toContain('<Transaction id="1">');
    expect(result.output).toContain("<accountCode>50010</accountCode>");
    expect(result.output).toContain("<entryDate>2026-04-01</entryDate>");
  });

  it("round-trip: parse -> write -> parse yields identical records", () => {
    const input =
      "<Transactions>" +
      '<Transaction id="1">' +
      "<accountCode>50010</accountCode>" +
      "<amount>385000</amount>" +
      "<description>Rice 50kg</description>" +
      "<entryDate>2026-04-01</entryDate>" +
      "</Transaction>" +
      '<Transaction id="2">' +
      "<accountCode>20010</accountCode>" +
      "<amount>385000</amount>" +
      "<description>Control</description>" +
      "<entryDate>2026-04-01</entryDate>" +
      "</Transaction>" +
      "</Transactions>";
    const first = parseXml(txnSchema, input);
    expect(first.errors).toEqual([]);
    const written = writeXml(txnSchema, first.records);
    expect(written.errors).toEqual([]);
    const second = parseXml(txnSchema, written.output);
    expect(second.errors).toEqual([]);
    expect(second.records).toEqual(first.records);
  });
});
