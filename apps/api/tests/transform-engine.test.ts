import { describe, expect, it } from "vitest";
import {
  parseSourceData,
  applyTransform,
  applyFilters
} from "../src/modules/integration/transform-engine.js";

describe("parseSourceData", () => {
  it("parses CSV with headers", () => {
    const csv = "code,name,amount\n1000,Cash,50000\n2000,AP,-30000";
    const rows = parseSourceData(csv, "CSV");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ code: "1000", name: "Cash", amount: "50000" });
    expect(rows[1]).toEqual({ code: "2000", name: "AP", amount: "-30000" });
  });

  it("parses CSV with custom delimiter", () => {
    const tsv = "code\tname\tamount\n1000\tCash\t50000";
    const rows = parseSourceData(tsv, "CSV", { delimiter: "\t" });
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("1000");
  });

  it("parses CSV without headers", () => {
    const csv = "1000,Cash,50000\n2000,AP,-30000";
    const rows = parseSourceData(csv, "CSV", { hasHeader: false });
    expect(rows).toHaveLength(2);
    expect(rows[0].col1).toBe("1000");
  });

  it("handles quoted CSV fields", () => {
    const csv = 'code,name,amount\n1000,"Cash & Equivalents",50000';
    const rows = parseSourceData(csv, "CSV");
    expect(rows[0].name).toBe("Cash & Equivalents");
  });

  it("skips rows", () => {
    const csv = "Title Row\ncode,name\n1000,Cash\n2000,AP";
    const rows = parseSourceData(csv, "CSV", { skipRows: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0].code).toBe("1000");
  });

  it("parses JSON array", () => {
    const json = '[{"code":"1000","name":"Cash"},{"code":"2000","name":"AP"}]';
    const rows = parseSourceData(json, "JSON");
    expect(rows).toHaveLength(2);
    expect(rows[0].code).toBe("1000");
  });

  it("parses JSON single object", () => {
    const json = '{"code":"1000","name":"Cash"}';
    const rows = parseSourceData(json, "JSON");
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("1000");
  });

  it("flattens nested JSON", () => {
    const json = '[{"account":{"code":"1000"},"amount":50000}]';
    const rows = parseSourceData(json, "JSON");
    expect(rows[0]["account.code"]).toBe("1000");
    expect(rows[0].amount).toBe("50000");
  });

  it("parses XML with row tag", () => {
    const xml =
      "<data><row><code>1000</code><name>Cash</name></row><row><code>2000</code><name>AP</name></row></data>";
    const rows = parseSourceData(xml, "XML", { xmlRowTag: "row" });
    expect(rows).toHaveLength(2);
    expect(rows[0].code).toBe("1000");
  });

  it("parses fixed-width data", () => {
    const text = "1000Cash       50000\n2000AP         -30000";
    const rows = parseSourceData(text, "FIXED_WIDTH", {
      fixedWidthColumns: [
        { name: "code", start: 0, length: 4 },
        { name: "name", start: 4, length: 11 },
        { name: "amount", start: 15, length: 6 }
      ]
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].code).toBe("1000");
    expect(rows[0].name).toBe("Cash");
  });

  it("parses pipe-delimited SAF format", () => {
    const saf = "code|name|amount\n1000|Cash|50000";
    const rows = parseSourceData(saf, "SAF");
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("1000");
  });
});

describe("applyTransform", () => {
  it("UPPERCASE", () => {
    expect(applyTransform("hello", "UPPERCASE")).toBe("HELLO");
  });

  it("LOWERCASE", () => {
    expect(applyTransform("HELLO", "LOWERCASE")).toBe("hello");
  });

  it("TRIM", () => {
    expect(applyTransform("  hello  ", "TRIM")).toBe("hello");
  });

  it("ABS", () => {
    expect(applyTransform("-42", "ABS")).toBe("42");
  });

  it("NEGATE", () => {
    expect(applyTransform("42", "NEGATE")).toBe("-42");
  });

  it("ROUND", () => {
    expect(applyTransform("3.14159", "ROUND", "2")).toBe("3.14");
  });

  it("LEFT", () => {
    expect(applyTransform("ABCDEF", "LEFT", "3")).toBe("ABC");
  });

  it("RIGHT", () => {
    expect(applyTransform("ABCDEF", "RIGHT", "3")).toBe("DEF");
  });

  it("SUBSTRING", () => {
    expect(applyTransform("ABCDEF", "SUBSTRING", "2,3")).toBe("CDE");
  });

  it("REPLACE", () => {
    expect(applyTransform("hello-world", "REPLACE", "-| ")).toBe("hello world");
  });

  it("SPLIT", () => {
    expect(applyTransform("A,B,C", "SPLIT", ",|1")).toBe("B");
  });

  it("PAD_LEFT", () => {
    expect(applyTransform("42", "PAD_LEFT", "5,0")).toBe("00042");
  });

  it("DATE_FORMAT converts ISO", () => {
    expect(applyTransform("2026-03-21T00:00:00Z", "DATE_FORMAT")).toBe("2026-03-21");
  });

  it("DATE_PARSE converts DD/MM/YYYY", () => {
    expect(applyTransform("21/03/2026", "DATE_PARSE", "DD/MM/YYYY")).toBe("2026-03-21");
  });

  it("DATE_PARSE converts YYYYMMDD", () => {
    expect(applyTransform("20260321", "DATE_PARSE", "YYYYMMDD")).toBe("2026-03-21");
  });

  it("MULTIPLY", () => {
    expect(Number(applyTransform("100", "MULTIPLY", "1.15"))).toBeCloseTo(115, 5);
  });

  it("DIVIDE", () => {
    expect(applyTransform("1000", "DIVIDE", "100")).toBe("10");
  });

  it("MAP_VALUE", () => {
    expect(applyTransform("D", "MAP_VALUE", "D=Debit,C=Credit,*=Unknown")).toBe("Debit");
    expect(applyTransform("C", "MAP_VALUE", "D=Debit,C=Credit,*=Unknown")).toBe("Credit");
    expect(applyTransform("X", "MAP_VALUE", "D=Debit,C=Credit,*=Unknown")).toBe("Unknown");
  });

  it("STRIP_NON_NUMERIC", () => {
    expect(applyTransform("USD 1,234.56", "STRIP_NON_NUMERIC")).toBe("1234.56");
  });

  it("DEFAULT_IF_EMPTY", () => {
    expect(applyTransform("", "DEFAULT_IF_EMPTY", "USD")).toBe("USD");
    expect(applyTransform("EUR", "DEFAULT_IF_EMPTY", "USD")).toBe("EUR");
  });

  it("CONCAT", () => {
    expect(applyTransform("hello", "CONCAT", " world")).toBe("hello world");
  });

  it("NONE returns unchanged", () => {
    expect(applyTransform("hello", "NONE")).toBe("hello");
  });
});

describe("applyFilters", () => {
  const rows = [
    { name: "Room Revenue", amount: "50000", dept: "ROOMS" },
    { name: "F&B Revenue", amount: "30000", dept: "FNB" },
    { name: "Spa Revenue", amount: "5000", dept: "SPA" },
    { name: "Zero Line", amount: "0", dept: "" }
  ];

  it("filters by EQUALS", () => {
    const result = applyFilters(rows, [{ column: "dept", operator: "EQUALS", value: "ROOMS" }]);
    expect(result.passed).toHaveLength(1);
    expect(result.skipped).toBe(3);
  });

  it("filters by NOT_EQUALS", () => {
    const result = applyFilters(rows, [{ column: "dept", operator: "NOT_EQUALS", value: "" }]);
    expect(result.passed).toHaveLength(3);
  });

  it("filters by GT", () => {
    const result = applyFilters(rows, [{ column: "amount", operator: "GT", value: "10000" }]);
    expect(result.passed).toHaveLength(2);
  });

  it("filters by NOT_EMPTY", () => {
    const result = applyFilters(rows, [{ column: "dept", operator: "NOT_EMPTY", value: "" }]);
    expect(result.passed).toHaveLength(3);
  });

  it("filters by CONTAINS", () => {
    const result = applyFilters(rows, [{ column: "name", operator: "CONTAINS", value: "Revenue" }]);
    expect(result.passed).toHaveLength(3);
  });

  it("applies multiple filters (AND logic)", () => {
    const result = applyFilters(rows, [
      { column: "dept", operator: "NOT_EMPTY", value: "" },
      { column: "amount", operator: "GT", value: "10000" }
    ]);
    expect(result.passed).toHaveLength(2);
  });

  it("returns all rows when no filters", () => {
    const result = applyFilters(rows, []);
    expect(result.passed).toHaveLength(4);
    expect(result.skipped).toBe(0);
  });
});
