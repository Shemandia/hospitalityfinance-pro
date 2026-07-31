import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseXlsx } from "../../src/parsers/xlsx.js";
import type { ProfileFsdSchema } from "../../src/profile/types.js";

// ── XLSX Buffer Helpers ───────────────────────────────────────────────────

/** Build an XLSX buffer from an array of sheets, each being an array of rows. */
async function makeXlsx(sheets: { name?: string; rows: unknown[][] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name ?? "Sheet1");
    for (const row of sheet.rows) {
      ws.addRow(row);
    }
  }
  const arrayBuf = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuf);
}

/** Shortcut: single sheet with given rows. */
async function makeSheet(rows: unknown[][]): Promise<Buffer> {
  return makeXlsx([{ rows }]);
}

// ── 1. Parse XLSX sheet 0 ─────────────────────────────────────────────────

describe("Parse XLSX sheet 0", () => {
  it("parses the first sheet with header row by default", async () => {
    const buf = await makeSheet([
      ["Account", "Amount", "Description"],
      ["1000", 250.5, "Revenue"],
      ["2000", 100, "Expense"]
    ]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [
        { name: "account", target: "j.account", type: "string", columnName: "Account" },
        { name: "amount", target: "j.amount", type: "decimal", columnName: "Amount" },
        { name: "desc", target: "j.desc", type: "string", columnName: "Description" }
      ]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.aborted).toBe(false);
    expect(result.rowCount).toBe(2);

    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(250.5);
    expect(result.rows[0]!.fields.desc!.parsedValue).toBe("Revenue");

    expect(result.rows[1]!.fields.account!.parsedValue).toBe("2000");
    expect(result.rows[1]!.fields.amount!.parsedValue).toBe(100);
  });
});

// ── 2. skipRowsBeforeHeader skips correctly ───────────────────────────────

describe("skipRowsBeforeHeader", () => {
  it("skips N rows before treating next row as header", async () => {
    const buf = await makeSheet([
      ["Report Title"], // row 0 — skip
      ["Generated: 2026-04-10"], // row 1 — skip
      ["Account", "Amount"], // row 2 — header
      ["1000", 500], // row 3 — data
      ["2000", 300] // row 4 — data
    ]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [
        { name: "account", target: "j.account", type: "string", columnName: "Account" },
        { name: "amount", target: "j.amount", type: "decimal", columnName: "Amount" }
      ],
      options: { skipRowsBeforeHeader: 2 }
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(500);
    expect(result.rows[1]!.fields.account!.parsedValue).toBe("2000");
  });
});

// ── 3. Date fields returned as parsed JS Date ────────────────────────────

describe("Date fields", () => {
  it("preserves exceljs Date objects for date fields", async () => {
    const testDate = new Date(Date.UTC(2026, 2, 15)); // 2026-03-15
    const buf = await makeSheet([
      ["Date", "Amount"],
      [testDate, 100]
    ]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [
        {
          name: "dt",
          target: "j.date",
          type: "date",
          columnName: "Date",
          dateFormat: "YYYY-MM-DD"
        },
        { name: "amount", target: "j.amount", type: "decimal", columnName: "Amount" }
      ]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);

    const parsed = result.rows[0]!.fields.dt!.parsedValue;
    expect(parsed).toBeInstanceOf(Date);
    expect((parsed as Date).toISOString().slice(0, 10)).toBe("2026-03-15");
  });

  it("parses string date cells using dateFormat", async () => {
    const buf = await makeSheet([["Date"], ["15/03/2026"]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [
        { name: "dt", target: "j.date", type: "date", columnName: "Date", dateFormat: "DD/MM/YYYY" }
      ]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    const parsed = result.rows[0]!.fields.dt!.parsedValue;
    expect(parsed).toBeInstanceOf(Date);
    expect((parsed as Date).toISOString().slice(0, 10)).toBe("2026-03-15");
  });
});

// ── 4. Sheet selection by sheetIndex ──────────────────────────────────────

describe("Sheet selection by sheetIndex", () => {
  it("reads from the specified sheetIndex", async () => {
    const buf = await makeXlsx([
      { name: "Summary", rows: [["Ignore", "This"]] },
      {
        name: "Data",
        rows: [
          ["Code", "Value"],
          ["ABC", 42]
        ]
      }
    ]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx", sheetIndex: 1 },
      fields: [
        { name: "code", target: "x.code", type: "string", columnName: "Code" },
        { name: "value", target: "x.value", type: "integer", columnName: "Value" }
      ]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.fields.code!.parsedValue).toBe("ABC");
    expect(result.rows[0]!.fields.value!.parsedValue).toBe(42);
  });

  it("returns error for non-existent sheet index", async () => {
    const buf = await makeSheet([["A"], [1]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx", sheetIndex: 99 },
      fields: [{ name: "a", target: "x.a", type: "string", columnIndex: 0 }]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("not found");
    expect(result.rowCount).toBe(0);
  });
});

// ── 5. Header row vs columnIndex mapping ──────────────────────────────────

describe("Header row vs columnIndex mapping", () => {
  it("maps by columnIndex when hasHeaderRow=false", async () => {
    const buf = await makeSheet([
      ["1000", 250.5, "Revenue"],
      ["2000", 100, "Expense"]
    ]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx", hasHeaderRow: false },
      fields: [
        { name: "account", target: "j.account", type: "string", columnIndex: 0 },
        { name: "amount", target: "j.amount", type: "decimal", columnIndex: 1 },
        { name: "desc", target: "j.desc", type: "string", columnIndex: 2 }
      ]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[0]!.fields.amount!.parsedValue).toBe(250.5);
    expect(result.rows[1]!.fields.desc!.parsedValue).toBe("Expense");
  });

  it("uses columnIndex as fallback when columnName not in header", async () => {
    const buf = await makeSheet([
      ["Account", "Amount"],
      ["1000", 42]
    ]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [{ name: "val", target: "x.val", type: "decimal", columnIndex: 1 }]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.val!.parsedValue).toBe(42);
  });
});

// ── 6. Type coercion and field validation ─────────────────────────────────

describe("Type coercion and validation", () => {
  it("coerces numeric cells directly for decimal fields", async () => {
    const buf = await makeSheet([["Val"], [1234.56]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [{ name: "val", target: "x.val", type: "decimal", columnName: "Val" }]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.val!.parsedValue).toBe(1234.56);
  });

  it("applies decimalDivisor when explicitly set", async () => {
    const buf = await makeSheet([["Val"], [5000]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [
        { name: "val", target: "x.val", type: "currency", columnName: "Val", decimalDivisor: 1000 }
      ]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.val!.parsedValue).toBe(5);
  });

  it("does NOT apply decimalDivisor when not set", async () => {
    const buf = await makeSheet([["Val"], [5000]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [{ name: "val", target: "x.val", type: "currency", columnName: "Val" }]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]!.fields.val!.parsedValue).toBe(5000);
  });

  it("returns TYPE_MISMATCH for non-integer in integer field", async () => {
    const buf = await makeSheet([["Num"], ["abc"]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [{ name: "num", target: "x.num", type: "integer", columnName: "Num" }]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });

  it("returns REQUIRED_MISSING for empty required field", async () => {
    const buf = await makeSheet([
      ["Code", "Filler"],
      ["", "data"]
    ]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [
        { name: "code", target: "x.code", type: "string", columnName: "Code", required: true },
        { name: "filler", target: "x.filler", type: "string", columnName: "Filler" }
      ]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("REQUIRED_MISSING");
  });

  it("coerces boolean cells for boolean fields", async () => {
    const buf = await makeSheet([["Active"], [true], [false]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [{ name: "active", target: "x.active", type: "boolean", columnName: "Active" }]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(0);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]!.fields.active!.parsedValue).toBe(true);
    expect(result.rows[1]!.fields.active!.parsedValue).toBe(false);
  });

  it("returns TYPE_MISMATCH for non-integer numeric cell in integer field", async () => {
    const buf = await makeSheet([["Num"], [3.14]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [{ name: "num", target: "x.num", type: "integer", columnName: "Num" }]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.errorCode).toBe("TYPE_MISMATCH");
  });

  it("aborts when errors reach maxErrors", async () => {
    const buf = await makeSheet([["Num"], ["abc"], ["def"], ["ghi"], ["jkl"]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [
        { name: "num", target: "x.num", type: "integer", columnName: "Num", required: true }
      ],
      options: { maxErrors: 2 }
    };

    const result = await parseXlsx(schema, buf);

    expect(result.aborted).toBe(true);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.rowCount).toBeLessThan(4);
  });
});

// ── 7. Skip blank rows ───────────────────────────────────────────────────

describe("Skip blank rows", () => {
  it("skips blank rows by default", async () => {
    const buf = await makeSheet([
      ["Account", "Amount"],
      ["1000", 100],
      [null, null],
      ["2000", 200]
    ]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [
        { name: "account", target: "j.account", type: "string", columnName: "Account" },
        { name: "amount", target: "j.amount", type: "decimal", columnName: "Amount" }
      ]
    };

    const result = await parseXlsx(schema, buf);

    expect(result.rowCount).toBe(2);
    expect(result.skippedRows).toBe(1);
    expect(result.rows[0]!.fields.account!.parsedValue).toBe("1000");
    expect(result.rows[1]!.fields.account!.parsedValue).toBe("2000");
  });

  it("does NOT skip blank rows when skipBlankRows=false", async () => {
    const buf = await makeSheet([["Code"], ["A"], [null], ["B"]]);

    const schema: ProfileFsdSchema = {
      version: "1.0",
      format: { type: "xlsx" },
      fields: [{ name: "code", target: "x.code", type: "string", columnName: "Code" }],
      options: { skipBlankRows: false }
    };

    const result = await parseXlsx(schema, buf);

    expect(result.rowCount).toBe(3);
    expect(result.skippedRows).toBe(0);
  });
});
