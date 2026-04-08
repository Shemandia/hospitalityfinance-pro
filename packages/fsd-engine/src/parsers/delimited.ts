/**
 * Delimited parser + writer (CSV / TSV / semicolon / custom).
 *
 * Implements FSD classification "DELIMITED" per spec §4.4.2 / §4.4.3.
 *
 * Parser:
 *   - splits input on recordSep into lines
 *   - skips initialLinesToIgnore
 *   - tokenises each line with a character-level state machine that
 *     honours quoting modes (auto / yes / no)
 *   - doubled-quote escape: "" inside a quoted field → literal "
 *   - Excel triple-quote normalisation: """ → "" (always on, per spec §4.5)
 *   - runs validateField per field, collecting errors with 1-based line +
 *     field name
 *
 * Writer:
 *   - pads/truncates per field (via leading-/trailingChars + truncate)
 *   - applies quoted mode: auto wraps if value contains field sep or quote;
 *     yes always wraps; no is verbatim
 *   - escapes internal quotes by doubling
 *   - suppresses empty fields when outputIfEmpty=false (field contributes
 *     its separator position but no value)
 *   - for output=false fields with a validValue, writes the validValue
 *     constant (marker fields, spec §4.4.3)
 */

import {
  DEFAULT_FIELD_SEP,
  DEFAULT_RECORD_SEP,
  type FsdField,
  type FsdParseError,
  type FsdParseResult,
  type FsdRecordValue,
  type FsdSchema,
  type FsdWriteResult
} from "../types.js";
import { validateField } from "../validator.js";

/** Collapse Excel triple-double-quote sequences to the SSC-compatible doubled form. */
function normalizeExcelQuotes(input: string): string {
  // """ → "" globally. Run once; the result cannot re-introduce triple quotes
  // because each replacement shortens the run by 1.
  return input.replace(/"""/g, '""');
}

/** Split raw input into lines on recordSep, preserving empty trailing line removal. */
function splitLines(input: string, recordSep: string): string[] {
  if (input === "") return [];
  // Accept \r\n, \n, and \r as record separators when the schema uses the default
  // (most hospitality exports mix these). If the user sets a custom recordSep we
  // honour it exactly.
  if (recordSep === DEFAULT_RECORD_SEP) {
    return input.split(/\r\n|\n|\r/);
  }
  return input.split(recordSep);
}

/**
 * Tokenise a single delimited line into field strings using a small state machine.
 *
 * Behaviour:
 *   - outside a quoted field: a separator ends the current field
 *   - a leading `"` starts a quoted field (mode=yes or auto)
 *   - inside a quoted field: `""` → literal `"`; a lone `"` ends the field
 *   - whitespace inside quotes is preserved
 *
 * quoteMode is the record-level default; individual fields with their own
 * `quoted` attribute are not yet supported by this tokeniser because the
 * spec allows only a single per-record tokenisation pass.
 */
function tokeniseLine(line: string, fieldSep: string, honourQuotes: boolean): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        // doubled quote = literal quote, else end of quoted field
        if (line[i + 1] === '"') {
          buf += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      buf += ch;
      i += 1;
      continue;
    }
    // outside quotes
    if (honourQuotes && ch === '"' && buf === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (line.startsWith(fieldSep, i)) {
      out.push(buf);
      buf = "";
      i += fieldSep.length;
      continue;
    }
    buf += ch;
    i += 1;
  }
  out.push(buf);
  return out;
}

/** Strip leading + trailing padding characters from a raw field value. */
function stripPadding(value: string, leading?: string, trailing?: string): string {
  let result = value;
  if (leading && leading.length > 0) {
    const ch = leading[0]!;
    let start = 0;
    while (start < result.length && result[start] === ch) start += 1;
    result = result.slice(start);
  }
  if (trailing && trailing.length > 0) {
    const ch = trailing[0]!;
    let end = result.length;
    while (end > 0 && result[end - 1] === ch) end -= 1;
    result = result.slice(0, end);
  }
  return result;
}

export function parseDelimited(definition: FsdSchema, input: string): FsdParseResult {
  const errors: FsdParseError[] = [];
  const records: FsdRecordValue[] = [];

  const record = definition.record;
  if (!record) {
    return {
      records,
      errors: [
        {
          line: null,
          recordIndex: null,
          field: null,
          code: "SCHEMA_MISSING_RECORD",
          message: "DELIMITED schema requires a top-level record definition"
        }
      ]
    };
  }

  const fieldSep = definition.fieldSep ?? DEFAULT_FIELD_SEP;
  const recordSep = definition.recordSep ?? DEFAULT_RECORD_SEP;
  const skip = definition.initialLinesToIgnore ?? 0;

  // Determine quoting — if ANY field says quoted=no, honour that per-field later,
  // but for the tokeniser we use the loosest setting (auto) unless the whole
  // record is marked quoted=no on every field (rare).
  const allNoQuotes = record.fields.every((f) => f.quoted === "no");
  const honourQuotes = !allNoQuotes;

  const normalised = normalizeExcelQuotes(input);
  const lines = splitLines(normalised, recordSep);

  // Drop a single trailing empty line that a file ending in recordSep produces.
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    if (lineIdx < skip) continue;
    const rawLine = lines[lineIdx]!;
    const recordIndex = records.length;
    const lineNumber = lineIdx + 1;

    const tokens = tokeniseLine(rawLine, fieldSep, honourQuotes);

    if (tokens.length !== record.fields.length) {
      errors.push({
        line: lineNumber,
        recordIndex,
        field: null,
        code: "FIELD_COUNT_MISMATCH",
        message: `Line ${lineNumber} has ${tokens.length} fields; expected ${record.fields.length}`
      });
      // Still attempt to build a partial record so downstream tooling can
      // surface as much as possible; pad missing tokens with empty strings.
      while (tokens.length < record.fields.length) tokens.push("");
    }

    const parsed: FsdRecordValue = {};
    for (let f = 0; f < record.fields.length; f++) {
      const field = record.fields[f]!;
      const raw = stripPadding(tokens[f] ?? "", field.leadingChars, field.trailingChars);
      const result = validateField({
        field,
        rawValue: raw,
        line: lineNumber,
        recordIndex
      });
      errors.push(...result.errors);
      if (field.output === false) continue;
      // Use raw string when coercion produced undefined (validation failed hard)
      parsed[field.name] = result.value === undefined ? raw : result.value;
    }
    records.push(parsed);
  }

  return { records, errors };
}

// ── Writer ──────────────────────────────────────────────────────────────────

function stringifyValue(value: FsdRecordValue[string] | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // Prefer YYYY-MM-DD for midnight-UTC dates (common for financial data);
    // full ISO timestamp otherwise. This gives stable round-trips for dates
    // that were originally parsed from a YYYY-MM-DD string.
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function padValue(field: FsdField, value: string): string {
  let out = value;
  if (field.maxLength !== undefined && out.length > field.maxLength && field.truncate) {
    out = out.slice(0, field.maxLength);
  }
  const minLength = field.minLength ?? 0;
  if (out.length < minLength) {
    const pad = minLength - out.length;
    if (field.leadingChars && field.leadingChars.length > 0) {
      out = field.leadingChars[0]!.repeat(pad) + out;
    } else if (field.trailingChars && field.trailingChars.length > 0) {
      out = out + field.trailingChars[0]!.repeat(pad);
    }
  }
  return out;
}

function quoteValue(field: FsdField, value: string, fieldSep: string): string {
  const mode = field.quoted ?? "auto";
  if (mode === "no") return value;
  const needsQuoting =
    mode === "yes" || value.includes(fieldSep) || value.includes('"') || value.includes("\n");
  if (!needsQuoting) return value;
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function writeDelimited(definition: FsdSchema, records: FsdRecordValue[]): FsdWriteResult {
  const errors: FsdParseError[] = [];
  const record = definition.record;
  if (!record) {
    return {
      output: "",
      errors: [
        {
          line: null,
          recordIndex: null,
          field: null,
          code: "SCHEMA_MISSING_RECORD",
          message: "DELIMITED schema requires a top-level record definition"
        }
      ]
    };
  }

  const fieldSep = definition.fieldSep ?? DEFAULT_FIELD_SEP;
  const recordSep = definition.recordSep ?? DEFAULT_RECORD_SEP;

  const lines: string[] = [];
  for (let r = 0; r < records.length; r++) {
    const rec = records[r]!;
    const tokens: string[] = [];
    for (const field of record.fields) {
      // Marker field: output=false + validValue → write the constant.
      if (field.output === false) {
        if (field.validValue && field.validValue.length > 0) {
          tokens.push(quoteValue(field, padValue(field, field.validValue[0]!), fieldSep));
        } else {
          tokens.push("");
        }
        continue;
      }
      const raw = rec[field.name];
      const str = stringifyValue(raw);
      if (str === "" && field.outputIfEmpty === false) {
        tokens.push("");
        continue;
      }
      tokens.push(quoteValue(field, padValue(field, str), fieldSep));
    }
    lines.push(tokens.join(fieldSep));
  }

  return { output: lines.join(recordSep), errors };
}
