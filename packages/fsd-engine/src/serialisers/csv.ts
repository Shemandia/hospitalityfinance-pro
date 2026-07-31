/**
 * Profile-level CSV/TSV serialiser.
 *
 * Converts structured rows → string (or Buffer with encoding).
 *
 * Mirrors the CSV parser:
 *   - Apply decimalDivisor in reverse (multiply) for numeric fields
 *   - Format dates using dateFormat via dayjs
 *   - Null/undefined → options.outputNullAs (default "")
 *   - Always quote fields containing delimiter, quote char, or newlines
 *   - Support lineEnding: CRLF (default) or LF
 *   - Support encoding (utf-8 default, latin1)
 *   - TSV = same serialiser with delimiter="\t"
 *   - Write header row when hasHeaderRow=true
 */

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import type {
  ProfileFsdSchema,
  ProfileFsdField,
  ProfileFsdStructuredRow
} from "../profile/types.js";

dayjs.extend(utc);

// ── Public API ────────────────────────────────────────────────────────────

export function serialiseCsv(schema: ProfileFsdSchema, rows: ProfileFsdStructuredRow[]): Buffer {
  const fmt = schema.format;
  const delimiter = fmt.delimiter ?? (fmt.type === "tsv" ? "\t" : ",");
  const quoteChar = fmt.quoteChar ?? '"';
  const lineEnding = fmt.lineEnding === "LF" ? "\n" : "\r\n";
  const encoding = (fmt.encoding ?? "utf-8") as BufferEncoding;
  const hasHeader = fmt.hasHeaderRow !== false; // default true
  const outputNullAs = schema.options?.outputNullAs ?? "";

  const lines: string[] = [];

  // Header row
  if (hasHeader) {
    const headerCells = schema.fields
      .filter((f) => !f.ignoreField)
      .map((f) => quoteIfNeeded(f.columnName ?? f.name, delimiter, quoteChar));
    lines.push(headerCells.join(delimiter));
  }

  // Data rows
  for (const row of rows) {
    const cells: string[] = [];
    for (const field of schema.fields) {
      if (field.ignoreField) continue;

      const rawVal = row[field.name];
      const str = stringifyValue(rawVal, field, outputNullAs);
      cells.push(quoteIfNeeded(str, delimiter, quoteChar));
    }
    lines.push(cells.join(delimiter));
  }

  const output = lines.join(lineEnding);
  return Buffer.from(output, encoding);
}

// ── Value Stringification ─────────────────────────────────────────────────

function stringifyValue(value: unknown, field: ProfileFsdField, outputNullAs: string): string {
  if (value === null || value === undefined) {
    return outputNullAs;
  }

  // Date formatting
  if ((field.type === "date" || field.type === "datetime") && value instanceof Date) {
    if (field.dateFormat) {
      return dayjs.utc(value).format(field.dateFormat);
    }
    // Default ISO
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }

  // Numeric with decimalDivisor — reverse (multiply)
  if (
    (field.type === "decimal" || field.type === "currency" || field.type === "integer") &&
    typeof value === "number"
  ) {
    const output = field.decimalDivisor ? value * field.decimalDivisor : value;
    return String(output);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return String(value);
}

// ── Quoting ───────────────────────────────────────────────────────────────

function quoteIfNeeded(value: string, delimiter: string, quoteChar: string): string {
  if (
    value.includes(delimiter) ||
    value.includes(quoteChar) ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    // Escape quotes by doubling them
    const escaped = value.replace(new RegExp(escapeRegex(quoteChar), "g"), quoteChar + quoteChar);
    return quoteChar + escaped + quoteChar;
  }
  return value;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
