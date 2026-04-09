/**
 * Fixed-width parser + writer (SINGLE_FIXED classification).
 *
 * Per spec §4.4.2/4.4.3:
 *   - fields are read by exact byte count (maxLength) from each line
 *   - leading/trailing pad chars are stripped on read
 *   - on write, values shorter than the field width are padded with
 *     leadingChars (left) or trailingChars (right); values longer
 *     than maxLength are truncated only when truncate=true
 *   - record separator splits the input into lines; initialLinesToIgnore
 *     is honoured for column headers
 */

import {
  DEFAULT_RECORD_SEP,
  type FsdField,
  type FsdParseError,
  type FsdParseResult,
  type FsdRecordValue,
  type FsdSchema,
  type FsdWriteResult
} from "../types.js";
import { validateField } from "../validator.js";

function splitLines(input: string, recordSep: string): string[] {
  if (input === "") return [];
  if (recordSep === DEFAULT_RECORD_SEP) {
    return input.split(/\r\n|\n|\r/);
  }
  return input.split(recordSep);
}

function stripPadding(value: string, leading?: string, trailing?: string): string {
  // Strip leading + trailing pad chars but preserve at least one char of
  // the original value when the whole field is pad chars (e.g. a zero-padded
  // "000000000000" integer field must parse as "0", not "").
  let result = value;
  if (leading && leading.length > 0) {
    const ch = leading[0]!;
    let start = 0;
    const keep = result.length > 0 ? 1 : 0;
    while (start < result.length - keep && result[start] === ch) start += 1;
    result = result.slice(start);
  }
  if (trailing && trailing.length > 0) {
    const ch = trailing[0]!;
    let end = result.length;
    const keep = result.length > 0 ? 1 : 0;
    while (end > keep && result[end - 1] === ch) end -= 1;
    result = result.slice(0, end);
  }
  return result;
}

export function parseFixedWidth(definition: FsdSchema, input: string): FsdParseResult {
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
          message: "SINGLE_FIXED schema requires a top-level record definition"
        }
      ]
    };
  }

  // Every field needs an explicit maxLength for fixed-width.
  const missingLength = record.fields.find((f) => f.maxLength === undefined);
  if (missingLength) {
    return {
      records,
      errors: [
        {
          line: null,
          recordIndex: null,
          field: missingLength.name,
          code: "SCHEMA_MISSING_FIELD_LENGTH",
          message: `Fixed-width field "${missingLength.name}" requires an explicit maxLength`
        }
      ]
    };
  }

  const recordSep = definition.recordSep ?? DEFAULT_RECORD_SEP;
  const skip = definition.initialLinesToIgnore ?? 0;
  const totalWidth = record.fields.reduce((sum, f) => sum + (f.maxLength ?? 0), 0);

  const lines = splitLines(input, recordSep);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    if (lineIdx < skip) continue;
    const rawLine = lines[lineIdx]!;
    const recordIndex = records.length;
    const lineNumber = lineIdx + 1;

    if (rawLine.length < totalWidth) {
      errors.push({
        line: lineNumber,
        recordIndex,
        field: null,
        code: "LINE_TOO_SHORT",
        message: `Line ${lineNumber} has ${rawLine.length} chars; expected at least ${totalWidth}`
      });
      // continue anyway — slice what we can
    }

    let cursor = 0;
    const parsed: FsdRecordValue = {};
    for (const field of record.fields) {
      const width = field.maxLength!;
      const slice = rawLine.slice(cursor, cursor + width);
      cursor += width;
      const raw = stripPadding(slice, field.leadingChars, field.trailingChars);
      const result = validateField({
        field,
        rawValue: raw,
        line: lineNumber,
        recordIndex
      });
      errors.push(...result.errors);
      if (field.output === false) continue;
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
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function padField(field: FsdField, value: string): string {
  const width = field.maxLength!;
  let out = value;
  if (out.length > width) {
    if (field.truncate) {
      out = out.slice(0, width);
    }
    // If not truncating we deliberately leave the overflowing value alone;
    // callers should pre-validate. The next parse round will emit MAX_LENGTH.
  }
  if (out.length < width) {
    const pad = width - out.length;
    if (field.leadingChars && field.leadingChars.length > 0) {
      out = field.leadingChars[0]!.repeat(pad) + out;
    } else if (field.trailingChars && field.trailingChars.length > 0) {
      out = out + field.trailingChars[0]!.repeat(pad);
    } else {
      // Default fill: right-pad with spaces (most common for alpha fields)
      out = out + " ".repeat(pad);
    }
  }
  return out;
}

export function writeFixedWidth(definition: FsdSchema, records: FsdRecordValue[]): FsdWriteResult {
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
          message: "SINGLE_FIXED schema requires a top-level record definition"
        }
      ]
    };
  }

  const recordSep = definition.recordSep ?? DEFAULT_RECORD_SEP;
  const lines: string[] = [];

  for (let r = 0; r < records.length; r++) {
    const rec = records[r]!;
    let line = "";
    for (const field of record.fields) {
      if (field.maxLength === undefined) {
        errors.push({
          line: null,
          recordIndex: r,
          field: field.name,
          code: "SCHEMA_MISSING_FIELD_LENGTH",
          message: `Fixed-width field "${field.name}" requires an explicit maxLength`
        });
        continue;
      }
      if (field.output === false) {
        if (field.validValue && field.validValue.length > 0) {
          line += padField(field, field.validValue[0]!);
        } else {
          line += padField(field, "");
        }
        continue;
      }
      const str = stringifyValue(rec[field.name]);
      line += padField(field, str);
    }
    lines.push(line);
  }

  return { output: lines.join(recordSep), errors };
}
