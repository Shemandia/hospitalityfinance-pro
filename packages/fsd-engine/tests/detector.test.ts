import { describe, it, expect } from "vitest";
import { detectFormat } from "../src/detector.js";

// ── CSV detection ─────────────────────────────────────────────────────────

describe("CSV detection", () => {
  it("detects CSV with commas in first 5 lines", () => {
    const sample = Buffer.from(
      [
        "Name,Amount,Date,Code,Status",
        "Hotel A,1000,2026-01-01,H001,OPEN",
        "Hotel B,2000,2026-02-01,H002,CLOSED"
      ].join("\n")
    );

    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("csv");
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.detectedFormat.hasHeaderRow).toBe(true);
  });

  it("detects CSV without header (first row has numbers)", () => {
    const sample = Buffer.from(
      [
        "1000,250.50,2026-01-01,H001,1",
        "2000,100.00,2026-02-01,H002,2",
        "3000,75.25,2026-03-01,H003,3"
      ].join("\n")
    );

    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("csv");
    // First row has numeric fields → no header detected
    expect(result.detectedFormat.hasHeaderRow).toBe(false);
  });

  it("defaults to CSV with low confidence when no strong signal", () => {
    const sample = Buffer.from("hello world\nfoo bar\n");

    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("csv");
    expect(result.confidence).toBeLessThanOrEqual(0.3);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ── TSV detection ─────────────────────────────────────────────────────────

describe("TSV detection", () => {
  it("detects TSV with tabs in first 5 lines", () => {
    const sample = Buffer.from(
      [
        "Name\tAmount\tDate\tCode\tStatus",
        "Hotel A\t1000\t2026-01-01\tH001\tOPEN",
        "Hotel B\t2000\t2026-02-01\tH002\tCLOSED"
      ].join("\n")
    );

    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("tsv");
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.detectedFormat.hasHeaderRow).toBe(true);
  });
});

// ── XLSX detection ────────────────────────────────────────────────────────

describe("XLSX detection", () => {
  it("detects XLSX by PK ZIP magic bytes", () => {
    // Real XLSX files start with PK ZIP header
    const sample = Buffer.from([
      0x50,
      0x4b,
      0x03,
      0x04, // PK magic
      0x14,
      0x00,
      0x06,
      0x00, // version, flags
      // ... rest doesn't matter for detection
      0x00,
      0x00,
      0x00,
      0x00
    ]);

    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("xlsx");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

// ── XML/SSML detection ───────────────────────────────────────────────────

describe("XML/SSML detection", () => {
  it("detects XML starting with <?xml", () => {
    const sample = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<SSC><TRANSACTION></TRANSACTION></SSC>'
    );

    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("xml_ssml");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects XML starting with <TRANSACTION", () => {
    const sample = Buffer.from("<TRANSACTION><ACCNT_CODE>1000</ACCNT_CODE></TRANSACTION>");

    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("xml_ssml");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects XML with leading whitespace/BOM", () => {
    const sample = Buffer.from('  \n  <?xml version="1.0"?><root></root>');

    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("xml_ssml");
  });
});

// ── Fixed-width detection ─────────────────────────────────────────────────

describe("Fixed-width detection", () => {
  it("detects fixed-width when line lengths are consistent", () => {
    // All lines exactly 30 chars
    const lines = [
      "ACCT001   000250.502026-03-15",
      "ACCT002   000100.002026-03-16",
      "ACCT003   000075.252026-03-17",
      "ACCT004   000300.002026-03-18",
      "ACCT005   000150.752026-03-19",
      "ACCT006   000200.002026-03-20",
      "ACCT007   000125.002026-03-21",
      "ACCT008   000175.502026-03-22",
      "ACCT009   000225.002026-03-23",
      "ACCT010   000350.002026-03-24"
    ];
    // Verify all same length
    expect(lines.every((l) => l.length === lines[0]!.length)).toBe(true);

    const sample = Buffer.from(lines.join("\n"));
    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("fixed");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.detectedFormat.fixedRecordLength).toBe(lines[0]!.length);
  });
});

// ── Field type suggestions ────────────────────────────────────────────────

describe("Field type suggestions", () => {
  it("suggests date for ISO date columns", () => {
    const sample = Buffer.from(
      [
        "Name,StartDate,EndDate,Amount,Code",
        "Hotel A,2026-01-01,2026-01-31,1000,H001",
        "Hotel B,2026-02-01,2026-02-28,2000,H002",
        "Hotel C,2026-03-01,2026-03-31,3000,H003"
      ].join("\n")
    );

    const result = detectFormat(sample);

    expect(result.detectedFormat.type).toBe("csv");
    const dateFields = result.detectedFields.filter((f) => f.suggestedType === "date");
    expect(dateFields.length).toBe(2);
    expect(dateFields.map((f) => f.name)).toContain("StartDate");
    expect(dateFields.map((f) => f.name)).toContain("EndDate");
  });

  it("suggests integer for integer-like columns", () => {
    const sample = Buffer.from(
      [
        "Name,Count,Code,Total,Category",
        "A,100,X001,5000,cat1",
        "B,200,X002,3000,cat2",
        "C,300,X003,1000,cat3"
      ].join("\n")
    );

    const result = detectFormat(sample);

    const intFields = result.detectedFields.filter((f) => f.suggestedType === "integer");
    expect(intFields.map((f) => f.name)).toContain("Count");
    expect(intFields.map((f) => f.name)).toContain("Total");
  });

  it("suggests decimal for numeric columns with decimal points", () => {
    const sample = Buffer.from(
      [
        "Name,Amount,Rate,Code,Desc",
        "A,100.50,0.15,X001,test",
        "B,200.75,0.20,X002,test",
        "C,300.25,0.25,X003,test"
      ].join("\n")
    );

    const result = detectFormat(sample);

    const decFields = result.detectedFields.filter((f) => f.suggestedType === "decimal");
    expect(decFields.map((f) => f.name)).toContain("Amount");
    expect(decFields.map((f) => f.name)).toContain("Rate");
  });

  it("suggests string for mixed-type columns", () => {
    const sample = Buffer.from(
      [
        "Name,Code,Amount,Ref,Status",
        "Hotel A,H001,1000,REF-001,OPEN",
        "Hotel B,H002,2000,REF-002,CLOSED",
        "Hotel C,H003,3000,REF-003,PENDING"
      ].join("\n")
    );

    const result = detectFormat(sample);

    const nameField = result.detectedFields.find((f) => f.name === "Name");
    expect(nameField?.suggestedType).toBe("string");

    const codeField = result.detectedFields.find((f) => f.name === "Code");
    expect(codeField?.suggestedType).toBe("string");
  });

  it("includes sample values (max 5)", () => {
    const lines = [
      "Col1,Col2,Col3,Col4,Col5",
      ...Array.from({ length: 10 }, (_, i) => `v${i},${i},2026-01-0${(i % 9) + 1},${i}.${i},x`)
    ];
    const sample = Buffer.from(lines.join("\n"));

    const result = detectFormat(sample);

    for (const field of result.detectedFields) {
      expect(field.sampleValues.length).toBeLessThanOrEqual(5);
    }
  });
});

// ── Hint parameter ────────────────────────────────────────────────────────

describe("Hint parameter", () => {
  it("trusts hint type at high confidence", () => {
    const sample = Buffer.from("a\tb\tc\td\n1\t2\t3\t4\n");

    const result = detectFormat(sample, { type: "csv" });

    expect(result.detectedFormat.type).toBe("csv");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("handles empty buffer", () => {
    const result = detectFormat(Buffer.alloc(0));

    expect(result.detectedFormat.type).toBe("csv");
    expect(result.confidence).toBeLessThanOrEqual(0.3);
  });

  it("handles single-line buffer", () => {
    const sample = Buffer.from("just,some,comma,separated,values");

    const result = detectFormat(sample);

    // Only 1 line, avg commas > 3 → CSV
    expect(result.detectedFormat.type).toBe("csv");
  });
});
