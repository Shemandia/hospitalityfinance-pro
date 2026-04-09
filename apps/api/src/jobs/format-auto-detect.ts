/**
 * Format auto-detection engine.
 *
 * Analyses a sample file (first 100 lines) and returns a best-guess FsdSchema
 * plus metadata (confidence, detected fields, encoding).
 *
 * Supports:
 *   - Delimited: CSV (comma), TSV (tab), semicolon, pipe
 *   - Fixed-width: consistent field positions across lines
 *   - XML: detect root element and repeating record element
 *
 * Pure functions — no I/O, no database access.
 */

import type { FsdSchema, FsdField, FsdClassification, FsdFieldType } from "@hfp/fsd-engine";

// ── Public types ────────────────────────────────────────────────────────────

export type DetectedField = {
  name: string;
  type: FsdFieldType;
  required: boolean;
  maxLength: number;
  minLength: number;
  /** Start position (0-based) — only for fixed-width */
  startPos?: number;
  /** Field length — only for fixed-width */
  length?: number;
  /** Sample values from the first few records */
  sampleValues: string[];
};

export type DetectionResult = {
  classification: FsdClassification;
  delimiter?: string;
  recordSep: string;
  encoding: string;
  hasHeaders: boolean;
  fields: DetectedField[];
  confidence: number;
  previewRows: Record<string, string>[];
  suggestedSchema: FsdSchema;
};

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_SAMPLE_LINES = 100;
const DELIMITERS = [",", "\t", ";", "|"] as const;

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/, // ISO: 2026-04-01
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, // ISO datetime
  /^\d{2}\/\d{2}\/\d{4}$/, // US: 04/01/2026
  /^\d{2}\.\d{2}\.\d{4}$/, // EU: 01.04.2026
  /^\d{2}-\d{2}-\d{4}$/ // 01-04-2026
];

// ── Main entry point ────────────────────────────────────────────────────────

export function detectFormat(content: string): DetectionResult {
  if (!content || content.trim().length === 0) {
    return emptyResult();
  }

  const encoding = detectEncoding(content);
  const trimmed = stripBom(content);

  // Try XML first — if content starts with < it's likely XML
  if (trimmed.trimStart().startsWith("<")) {
    return detectXml(trimmed, encoding);
  }

  // Try delimited detection
  const delimitedResult = detectDelimited(trimmed, encoding);
  if (delimitedResult.confidence >= 50) {
    return delimitedResult;
  }

  // Try fixed-width
  const fixedResult = detectFixedWidth(trimmed, encoding);
  if (fixedResult.confidence >= 30) {
    return fixedResult;
  }

  // Fall back to delimited even with low confidence
  return delimitedResult;
}

// ── Encoding detection ──────────────────────────────────────────────────────

function detectEncoding(content: string): string {
  // BOM detection (content already decoded to string, but BOM chars remain)
  if (content.charCodeAt(0) === 0xfeff) return "UTF-8";
  if (content.charCodeAt(0) === 0xfffe) return "UTF-16LE";
  if (content.charCodeAt(0) === 0xfeff && content.charCodeAt(1) === 0x0000) return "UTF-16BE";

  // Heuristic: check for non-ASCII chars
  for (let i = 0; i < Math.min(content.length, 1000); i++) {
    if (content.charCodeAt(i) > 127) return "UTF-8";
  }
  return "ASCII";
}

function stripBom(content: string): string {
  if (content.charCodeAt(0) === 0xfeff || content.charCodeAt(0) === 0xfffe) {
    return content.slice(1);
  }
  return content;
}

// ── Delimited detection ─────────────────────────────────────────────────────

function detectDelimited(content: string, encoding: string): DetectionResult {
  const recordSep = detectRecordSep(content);
  const lines = splitLines(content, recordSep);

  // Count delimiter occurrences per line
  const delimiterScores = DELIMITERS.map((delim) => {
    const counts = lines.map((line) => countDelimiter(line, delim));
    const consistency = computeConsistency(counts);
    const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
    return { delim, consistency, avgCount, counts };
  });

  // Best delimiter: highest consistency, then highest average count
  delimiterScores.sort((a, b) => {
    if (Math.abs(a.consistency - b.consistency) > 0.05) return b.consistency - a.consistency;
    return b.avgCount - a.avgCount;
  });

  const best = delimiterScores[0]!;
  const delimiter = best.delim;
  const fieldCount = best.counts.length > 0 ? mostCommonValue(best.counts) : 0;

  if (fieldCount === 0) {
    return emptyResult();
  }

  // Split all lines by the chosen delimiter
  const splitRows = lines.map((line) => splitDelimitedLine(line, delimiter));

  // Detect headers
  const hasHeaders = detectHeaders(splitRows);
  const dataStartIndex = hasHeaders ? 1 : 0;
  const headerRow = hasHeaders ? splitRows[0]! : null;
  const dataRows = splitRows.slice(dataStartIndex, dataStartIndex + MAX_SAMPLE_LINES);

  // Build fields
  const actualFieldCount = fieldCount + 1; // delimiter count → field count
  const fields: DetectedField[] = [];

  for (let col = 0; col < actualFieldCount; col++) {
    const values = dataRows
      .map((row) => (col < row.length ? row[col]! : ""))
      .filter((v) => v.length > 0);

    const name =
      headerRow && col < headerRow.length ? sanitizeFieldName(headerRow[col]!) : `field${col + 1}`;

    const type = inferFieldType(values);
    const maxLen = values.reduce((max, v) => Math.max(max, v.length), 0);
    const minLen = values.reduce((min, v) => Math.min(min, v.length), maxLen);
    const hasEmpty = dataRows.some((row) => col >= row.length || row[col]!.trim() === "");

    fields.push({
      name,
      type,
      required: !hasEmpty,
      maxLength: Math.max(maxLen, 1),
      minLength: Math.min(minLen, maxLen),
      sampleValues: values.slice(0, 5)
    });
  }

  // Build preview rows
  const previewRows = dataRows.slice(0, 10).map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i++) {
      obj[fields[i]!.name] = i < row.length ? row[i]! : "";
    }
    return obj;
  });

  // Confidence: consistency-based
  const confidence = Math.round(best.consistency * 100);

  const suggestedSchema = buildDelimitedSchema(delimiter, recordSep, hasHeaders, fields, encoding);

  return {
    classification: "DELIMITED",
    delimiter,
    recordSep,
    encoding,
    hasHeaders,
    fields,
    confidence,
    previewRows,
    suggestedSchema
  };
}

function countDelimiter(line: string, delim: string): number {
  let count = 0;
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (!inQuote && ch === delim) {
      count++;
    }
  }
  return count;
}

function splitDelimitedLine(line: string, delim: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuote && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (!inQuote && ch === delim) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function computeConsistency(counts: number[]): number {
  if (counts.length === 0) return 0;
  const mode = mostCommonValue(counts);
  if (mode === 0) return 0;
  const matching = counts.filter((c) => c === mode).length;
  return matching / counts.length;
}

function mostCommonValue(arr: number[]): number {
  const freq = new Map<number, number>();
  for (const v of arr) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [val, count] of freq) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

// ── Fixed-width detection ───────────────────────────────────────────────────

function detectFixedWidth(content: string, encoding: string): DetectionResult {
  const recordSep = detectRecordSep(content);
  const lines = splitLines(content, recordSep);

  if (lines.length < 2) {
    return { ...emptyResult(), confidence: 0 };
  }

  // All lines should be roughly the same length for fixed-width
  const lengths = lines.map((l) => l.length);
  const modeLength = mostCommonValue(lengths);
  const lengthConsistency = lengths.filter((l) => l === modeLength).length / lengths.length;

  if (lengthConsistency < 0.8 || modeLength < 10) {
    return { ...emptyResult(), confidence: 0 };
  }

  // Detect field boundaries by finding columns that are always space or always non-space
  const boundaries = detectFieldBoundaries(lines, modeLength);

  if (boundaries.length < 2) {
    return { ...emptyResult(), confidence: 0 };
  }

  // Detect headers
  const hasHeaders = detectFixedWidthHeaders(lines, boundaries);
  const dataStartIndex = hasHeaders ? 1 : 0;
  const headerLine = hasHeaders ? lines[0]! : null;
  const dataLines = lines.slice(dataStartIndex);

  // Build fields from boundaries
  const fields: DetectedField[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    const length = end - start;

    const values = dataLines
      .map((line) => line.substring(start, Math.min(end, line.length)).trim())
      .filter((v) => v.length > 0);

    const name = headerLine
      ? sanitizeFieldName(headerLine.substring(start, Math.min(end, headerLine.length)).trim())
      : `field${i + 1}`;

    const type = inferFieldType(values);
    const hasEmpty = dataLines.some(
      (line) => line.substring(start, Math.min(end, line.length)).trim() === ""
    );

    fields.push({
      name: name || `field${i + 1}`,
      type,
      required: !hasEmpty,
      maxLength: length,
      minLength: 0,
      startPos: start,
      length,
      sampleValues: values.slice(0, 5)
    });
  }

  const previewRows = dataLines.slice(0, 10).map((line) => {
    const obj: Record<string, string> = {};
    for (const field of fields) {
      obj[field.name] = line
        .substring(field.startPos!, Math.min(field.startPos! + field.length!, line.length))
        .trim();
    }
    return obj;
  });

  const confidence = Math.round(lengthConsistency * 80);

  const suggestedSchema = buildFixedWidthSchema(recordSep, hasHeaders, fields, encoding);

  return {
    classification: "SINGLE_FIXED",
    recordSep,
    encoding,
    hasHeaders,
    fields,
    confidence,
    previewRows,
    suggestedSchema
  };
}

function detectFieldBoundaries(lines: string[], lineLength: number): number[] {
  // A boundary exists where a column transitions from non-space to space
  // across most lines, or where spacing is consistent
  const spaceFreq = new Array<number>(lineLength).fill(0);

  for (const line of lines) {
    for (let i = 0; i < Math.min(line.length, lineLength); i++) {
      if (line[i] === " ") spaceFreq[i]!++;
    }
  }

  const threshold = lines.length * 0.7;
  const boundaries: number[] = [0]; // always start at 0

  let inSpace = false;
  for (let i = 1; i < lineLength; i++) {
    const isSpace = spaceFreq[i]! >= threshold;
    if (inSpace && !isSpace) {
      boundaries.push(i);
    }
    inSpace = isSpace;
  }

  boundaries.push(lineLength);
  return boundaries;
}

function detectFixedWidthHeaders(lines: string[], boundaries: number[]): boolean {
  if (lines.length < 2) return false;
  const firstLine = lines[0]!;
  const secondLine = lines[1]!;

  // Check if first line is all-text and second line has numbers
  let firstLineAllText = true;
  let secondLineHasNumbers = false;

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    const val1 = firstLine.substring(start, Math.min(end, firstLine.length)).trim();
    const val2 = secondLine.substring(start, Math.min(end, secondLine.length)).trim();

    if (/^\d+(\.\d+)?$/.test(val1)) firstLineAllText = false;
    if (/^\d+(\.\d+)?$/.test(val2)) secondLineHasNumbers = true;
  }

  return firstLineAllText && secondLineHasNumbers;
}

// ── XML detection ───────────────────────────────────────────────────────────

function detectXml(content: string, encoding: string): DetectionResult {
  // Find root element
  const rootMatch = content.match(/<(\w[\w-]*)[^>]*>/);
  if (!rootMatch) {
    return { ...emptyResult(), confidence: 10 };
  }
  const rootElement = rootMatch[1]!;

  // Find the most common child element (the record element)
  const childPattern = new RegExp(`<(\\w[\\w-]*)(?:\\s[^>]*)?(?:>|/>)`, "g");
  const childCounts = new Map<string, number>();
  let match;
  while ((match = childPattern.exec(content)) !== null) {
    const tag = match[1]!;
    if (tag !== rootElement && !tag.startsWith("?") && !tag.startsWith("!")) {
      childCounts.set(tag, (childCounts.get(tag) ?? 0) + 1);
    }
  }

  // Record element is the most frequent direct child
  let recordElement = "";
  let maxCount = 0;
  for (const [tag, count] of childCounts) {
    if (count > maxCount) {
      recordElement = tag;
      maxCount = count;
    }
  }

  if (!recordElement) {
    return { ...emptyResult(), confidence: 15 };
  }

  // Extract fields from the first record element
  const recordPattern = new RegExp(`<${recordElement}[^>]*>([\\s\\S]*?)</${recordElement}>`, "g");
  const records: string[] = [];
  let recMatch;
  while ((recMatch = recordPattern.exec(content)) !== null && records.length < 10) {
    records.push(recMatch[1]!);
  }

  if (records.length === 0) {
    return { ...emptyResult(), confidence: 20 };
  }

  // Parse field names and sample values from first record
  const fieldPattern = /<(\w[\w-]*)>([^<]*)<\/\1>/g;
  const fieldNames: string[] = [];
  const fieldSamples = new Map<string, string[]>();

  for (const rec of records) {
    let fMatch;
    while ((fMatch = fieldPattern.exec(rec)) !== null) {
      const fname = fMatch[1]!;
      const fval = fMatch[2]!.trim();
      if (!fieldNames.includes(fname)) fieldNames.push(fname);
      const samples = fieldSamples.get(fname) ?? [];
      if (fval) samples.push(fval);
      fieldSamples.set(fname, samples);
    }
    fieldPattern.lastIndex = 0;
  }

  const fields: DetectedField[] = fieldNames.map((name) => {
    const samples = fieldSamples.get(name) ?? [];
    const type = inferFieldType(samples);
    const maxLen = samples.reduce((m, v) => Math.max(m, v.length), 0);
    return {
      name,
      type,
      required: samples.length === records.length,
      maxLength: Math.max(maxLen, 1),
      minLength: 0,
      sampleValues: samples.slice(0, 5)
    };
  });

  const previewRows = records.slice(0, 10).map((rec) => {
    const obj: Record<string, string> = {};
    let pm;
    while ((pm = fieldPattern.exec(rec)) !== null) {
      obj[pm[1]!] = pm[2]!.trim();
    }
    fieldPattern.lastIndex = 0;
    return obj;
  });

  const confidence = Math.min(95, 50 + maxCount * 5);

  const suggestedSchema: FsdSchema = {
    classification: "SIMPLE_XML",
    encoding,
    xmlRoot: rootElement,
    record: {
      name: recordElement,
      xmlName: recordElement,
      fields: fields.map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required,
        maxLength: f.maxLength
      }))
    }
  };

  return {
    classification: "SIMPLE_XML",
    recordSep: "\n",
    encoding,
    hasHeaders: false,
    fields,
    confidence,
    previewRows,
    suggestedSchema
  };
}

// ── Field type inference ────────────────────────────────────────────────────

function inferFieldType(values: string[]): FsdFieldType {
  if (values.length === 0) return "string";

  let allInteger = true;
  let allNumber = true;
  let allDate = true;

  for (const v of values) {
    if (allInteger && !/^-?\d+$/.test(v)) allInteger = false;
    if (allNumber && !/^-?\d+(\.\d+)?$/.test(v)) allNumber = false;
    if (allDate && !DATE_PATTERNS.some((p) => p.test(v))) allDate = false;

    if (!allInteger && !allNumber && !allDate) break;
  }

  if (allInteger) return "integer";
  if (allNumber) return "number";
  if (allDate) return "date";
  return "string";
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function detectRecordSep(content: string): string {
  const crlfCount = (content.match(/\r\n/g) ?? []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) ?? []).length;
  return crlfCount > lfCount ? "\r\n" : "\n";
}

function splitLines(content: string, recordSep: string): string[] {
  return content
    .split(recordSep)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_SAMPLE_LINES);
}

function sanitizeFieldName(raw: string): string {
  // Remove non-alphanumeric chars, camelCase multi-word
  const cleaned = raw.replace(/[^a-zA-Z0-9_\s]/g, "").trim();

  if (!cleaned) return "field";

  // camelCase: split on spaces/underscores, lowercase first word, capitalize rest
  const parts = cleaned.split(/[\s_]+/).filter(Boolean);
  if (parts.length === 0) return "field";

  return parts
    .map((p, i) =>
      i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    )
    .join("");
}

function detectHeaders(splitRows: string[][]): boolean {
  if (splitRows.length < 2) return false;
  const first = splitRows[0]!;
  const second = splitRows[1]!;

  // If first row is all text and second row has at least one number → headers
  let firstAllText = true;
  let secondHasNumber = false;

  for (const val of first) {
    if (/^-?\d+(\.\d+)?$/.test(val.trim()) && val.trim().length > 0) {
      firstAllText = false;
      break;
    }
  }

  for (const val of second) {
    if (/^-?\d+(\.\d+)?$/.test(val.trim()) && val.trim().length > 0) {
      secondHasNumber = true;
      break;
    }
  }

  return firstAllText && secondHasNumber;
}

// ── Schema builders ─────────────────────────────────────────────────────────

function buildDelimitedSchema(
  delimiter: string,
  recordSep: string,
  hasHeaders: boolean,
  fields: DetectedField[],
  encoding: string
): FsdSchema {
  const fsdFields: FsdField[] = fields.map((f) => ({
    name: f.name,
    type: f.type,
    required: f.required,
    maxLength: f.maxLength,
    minLength: f.minLength > 0 ? f.minLength : undefined
  }));

  return {
    classification: "DELIMITED",
    fieldSep: delimiter,
    recordSep,
    encoding,
    initialLinesToIgnore: hasHeaders ? 1 : 0,
    record: {
      name: "record",
      fields: fsdFields
    }
  };
}

function buildFixedWidthSchema(
  recordSep: string,
  hasHeaders: boolean,
  fields: DetectedField[],
  encoding: string
): FsdSchema {
  const fsdFields: FsdField[] = fields.map((f) => ({
    name: f.name,
    type: f.type,
    required: f.required,
    maxLength: f.length ?? f.maxLength,
    minLength: f.length ?? undefined
  }));

  return {
    classification: "SINGLE_FIXED",
    recordSep,
    encoding,
    initialLinesToIgnore: hasHeaders ? 1 : 0,
    record: {
      name: "record",
      fields: fsdFields
    }
  };
}

function emptyResult(): DetectionResult {
  return {
    classification: "DELIMITED",
    delimiter: ",",
    recordSep: "\n",
    encoding: "UTF-8",
    hasHeaders: false,
    fields: [],
    confidence: 0,
    previewRows: [],
    suggestedSchema: {
      classification: "DELIMITED",
      fieldSep: ",",
      recordSep: "\n",
      record: { name: "record", fields: [] }
    }
  };
}
