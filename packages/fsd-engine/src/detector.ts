/**
 * Format auto-detection for the Profile Creation Wizard.
 *
 * Analyses a sample buffer to determine file format and suggest field
 * types. Used by the wizard's first step to pre-populate schema config.
 *
 * Detection heuristics (in order per spec §9):
 *   1. Starts with <?xml or <TRANSACTION → xml_ssml
 *   2. First bytes are PK ZIP magic (50 4B 03 04) → xlsx
 *   3. Count tabs in first 5 lines; avg > 3 → tsv
 *   4. Count commas in first 5 lines; avg > 3 → csv
 *   5. Line lengths consistent (±2 chars) across first 10 lines → fixed
 *   6. Default → csv with confidence 0.3
 *
 * For CSV/TSV: detect header row and suggest field types.
 */

import type {
  ProfileFsdFormat,
  ProfileFsdFieldType,
  ProfileFsdFormatDetectionResult
} from "./profile/types.js";

// ── Public API ────────────────────────────────────────────────────────────

export function detectFormat(
  sample: Buffer,
  hint?: Partial<ProfileFsdFormat>
): ProfileFsdFormatDetectionResult {
  const warnings: string[] = [];

  // If hint provides a type, trust it at high confidence
  if (hint?.type) {
    // XML/XLSX types don't have delimiter-based fields
    if (hint.type === "xml_ssml" || hint.type === "xlsx") {
      return {
        confidence: 0.9,
        detectedFormat: { type: hint.type, ...hint } as ProfileFsdFormat,
        detectedFields: [],
        warnings:
          hint.type === "xml_ssml"
            ? [
                "XML/SSML detected via file extension — field extraction requires xmlRootElement configuration."
              ]
            : ["XLSX detected via file extension — field extraction requires opening the workbook."]
      };
    }
    const text = sample.toString("utf-8");
    const fields = detectFields(text, hint.type === "tsv" ? "\t" : ",");
    return {
      confidence: 0.9,
      detectedFormat: { type: hint.type, ...hint } as ProfileFsdFormat,
      detectedFields: fields,
      warnings
    };
  }

  // ── Heuristic 1: XML ────────────────────────────────────────────────
  const head = sample.toString("utf-8", 0, Math.min(sample.length, 500)).trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<TRANSACTION")) {
    return {
      confidence: 0.95,
      detectedFormat: { type: "xml_ssml" },
      detectedFields: [],
      warnings: ["XML/SSML detected — field extraction requires xmlRootElement configuration."]
    };
  }

  // ── Heuristic 2: XLSX (PK ZIP magic bytes) ──────────────────────────
  if (
    sample.length >= 4 &&
    sample[0] === 0x50 &&
    sample[1] === 0x4b &&
    sample[2] === 0x03 &&
    sample[3] === 0x04
  ) {
    return {
      confidence: 0.95,
      detectedFormat: { type: "xlsx" },
      detectedFields: [],
      warnings: ["XLSX detected — field extraction requires opening the workbook."]
    };
  }

  // ── From here, work with text ───────────────────────────────────────
  const text = sample.toString("utf-8");
  const allLines = text.split(/\r\n|\n/).filter((l) => l.length > 0);

  if (allLines.length === 0) {
    return {
      confidence: 0.1,
      detectedFormat: { type: "csv" },
      detectedFields: [],
      warnings: ["Empty sample — defaulting to CSV."]
    };
  }

  const first5 = allLines.slice(0, 5);

  // ── Heuristic 3: TSV ────────────────────────────────────────────────
  const tabAvg = avgCount(first5, "\t");
  if (tabAvg > 3) {
    const hasHeader = detectHeaderRow(first5[0]!, "\t");
    const fields = detectFields(text, "\t");
    return {
      confidence: 0.85,
      detectedFormat: { type: "tsv", hasHeaderRow: hasHeader },
      detectedFields: fields,
      warnings
    };
  }

  // ── Heuristic 4: CSV ────────────────────────────────────────────────
  const commaAvg = avgCount(first5, ",");
  if (commaAvg > 3) {
    const hasHeader = detectHeaderRow(first5[0]!, ",");
    const fields = detectFields(text, ",");
    return {
      confidence: 0.85,
      detectedFormat: { type: "csv", hasHeaderRow: hasHeader },
      detectedFields: fields,
      warnings
    };
  }

  // ── Heuristic 5: Fixed-width ────────────────────────────────────────
  const first10 = allLines.slice(0, 10);
  if (first10.length >= 2 && linesConsistentLength(first10)) {
    return {
      confidence: 0.7,
      detectedFormat: {
        type: "fixed",
        fixedRecordLength: first10[0]!.length
      },
      detectedFields: [],
      warnings: ["Fixed-width detected — field positions must be configured manually."]
    };
  }

  // ── Heuristic 6: Default to CSV ────────────────────────────────────
  // Low-comma CSV or other format we can't identify
  const hasHeader = first5[0] ? detectHeaderRow(first5[0], ",") : false;
  const fields = detectFields(text, ",");
  return {
    confidence: 0.3,
    detectedFormat: { type: "csv", hasHeaderRow: hasHeader },
    detectedFields: fields,
    warnings: ["Could not confidently detect format — defaulting to CSV."]
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function avgCount(lines: string[], char: string): number {
  if (lines.length === 0) return 0;
  let total = 0;
  for (const line of lines) {
    let count = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === char) count++;
    }
    total += count;
  }
  return total / lines.length;
}

function linesConsistentLength(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const lengths = lines.map((l) => l.length);
  const first = lengths[0]!;
  return lengths.every((len) => Math.abs(len - first) <= 2);
}

/**
 * Header row heuristic: first row has no numeric-only fields.
 * If every cell in the first row is non-numeric, it's likely a header.
 */
function detectHeaderRow(firstLine: string, delimiter: string): boolean {
  const cells = firstLine.split(delimiter).map((c) => c.trim());
  if (cells.length === 0) return false;
  return cells.every((c) => c === "" || !isNumericStr(c));
}

function isNumericStr(s: string): boolean {
  // Matches integers, decimals, and negative numbers
  return /^-?\d+(\.\d+)?$/.test(s);
}

// ── Field Detection ───────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const INTEGER_RE = /^-?\d+$/;
const DECIMAL_RE = /^-?\d+\.\d+$/;

function detectFields(
  text: string,
  delimiter: string
): ProfileFsdFormatDetectionResult["detectedFields"] {
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  // Split all rows
  const rows = lines.map((l) => l.split(delimiter).map((c) => c.trim()));
  const headerRow = rows[0]!;
  const dataRows = rows.slice(1);

  if (dataRows.length === 0) return [];

  const colCount = headerRow.length;
  const fields: ProfileFsdFormatDetectionResult["detectedFields"] = [];

  for (let col = 0; col < colCount; col++) {
    const name = headerRow[col] || `column_${col}`;
    const sampleValues: string[] = [];

    for (const row of dataRows) {
      const val = row[col] ?? "";
      if (val !== "") sampleValues.push(val);
    }

    const suggestedType = suggestType(sampleValues);
    fields.push({ name, sampleValues: sampleValues.slice(0, 5), suggestedType });
  }

  return fields;
}

function suggestType(values: string[]): ProfileFsdFieldType {
  if (values.length === 0) return "string";

  // All ISO date?
  if (values.every((v) => ISO_DATE_RE.test(v))) return "date";
  // All decimal?
  if (values.every((v) => DECIMAL_RE.test(v))) return "decimal";
  // All integer?
  if (values.every((v) => INTEGER_RE.test(v))) return "integer";

  return "string";
}
