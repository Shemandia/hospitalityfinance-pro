/**
 * Profile-level fixed-width parser.
 *
 * Reads fixed-width text files where each field occupies a known
 * character range defined by fixedStart + fixedLength.
 *
 * Line splitting:
 *   - If format.fixedRecordLength is set, slices the input into chunks
 *     of that length (byte-level record boundaries, no newline required).
 *   - Otherwise, splits on newline (\r\n or \n).
 *
 * Supports:
 *   - trimWhitespace (default true) per field
 *   - Type coercion: string, integer, decimal, currency, date, boolean, enum
 *   - decimalDivisor applied only when explicitly set
 *   - skipBlankRows
 *   - maxErrors abort
 *   - Field validation identical to CSV parser
 */

import type {
  ProfileFsdSchema,
  ProfileFsdFieldError,
  ProfileFsdParseResult,
  ProfileFsdRawRow
} from "../profile/types.js";
import { coerceAndValidate, makeError, abortResult } from "./shared.js";
import { FSD_ERROR } from "../profile/errors.js";

// ── Public API ────────────────────────────────────────────────────────────

export function parseFixed(schema: ProfileFsdSchema, input: string): ProfileFsdParseResult {
  const skipBlankRows = schema.options?.skipBlankRows !== false;
  const maxErrors = schema.options?.maxErrors ?? 100;
  const recordLength = schema.format.fixedRecordLength;

  const lines = splitRecords(input, recordLength);

  const rows: ProfileFsdRawRow[] = [];
  const errors: ProfileFsdFieldError[] = [];
  let skippedRows = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;

    // Blank-row detection: line is empty or whitespace-only
    if (skipBlankRows && line.trim() === "") {
      skippedRows++;
      continue;
    }

    const rowIndex = rows.length;
    const parsedRow: ProfileFsdRawRow = { rowIndex, fields: {} };

    for (const field of schema.fields) {
      if (field.ignoreField) continue;

      if (field.fixedStart === undefined || field.fixedLength === undefined) {
        continue;
      }

      const start = field.fixedStart;
      const len = field.fixedLength;

      // Extract slice — if the line is shorter, pad with empty
      let rawSlice: string;
      if (start >= line.length) {
        rawSlice = "";
      } else {
        rawSlice = line.slice(start, start + len);
      }

      let rawValue = rawSlice;
      if (field.trimWhitespace !== false) {
        rawValue = rawValue.trim();
      }

      // Required check for missing field (line too short)
      if (rawSlice === "" && field.required) {
        const fieldErr = makeError(
          rowIndex,
          field.name,
          FSD_ERROR.REQUIRED_MISSING,
          `Required field "${field.name}" not found — line too short.`,
          ""
        );
        errors.push(fieldErr);
        parsedRow.fields[field.name] = {
          rawValue: "",
          parsedValue: undefined,
          mappedPath: field.target,
          errors: [fieldErr]
        };
        if (errors.length >= maxErrors) {
          rows.push(parsedRow);
          return abortResult(rows, errors, rowIndex + 1, skippedRows);
        }
        continue;
      }

      const fieldErrors: ProfileFsdFieldError[] = [];
      const parsedValue = coerceAndValidate(rawValue, field, rowIndex, fieldErrors);

      errors.push(...fieldErrors);
      parsedRow.fields[field.name] = {
        rawValue,
        parsedValue,
        mappedPath: field.target,
        errors: fieldErrors
      };

      if (errors.length >= maxErrors) {
        rows.push(parsedRow);
        return abortResult(rows, errors, rowIndex + 1, skippedRows);
      }
    }

    rows.push(parsedRow);
  }

  return {
    rows,
    errors,
    aborted: false,
    rowCount: rows.length,
    skippedRows
  };
}

// ── Line Splitting ────────────────────────────────────────────────────────

function splitRecords(input: string, fixedRecordLength: number | undefined): string[] {
  if (fixedRecordLength && fixedRecordLength > 0) {
    // Split by fixed record length — no newline required
    const records: string[] = [];
    for (let i = 0; i < input.length; i += fixedRecordLength) {
      records.push(input.slice(i, i + fixedRecordLength));
    }
    return records;
  }

  // Fallback: split on newlines
  const lines = input.split(/\r\n|\n/);
  // Drop trailing empty line from file ending with newline
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
