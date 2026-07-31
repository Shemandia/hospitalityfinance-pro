/**
 * Profile-level CSV/TSV parser.
 *
 * Uses csv-parse for RFC 4180–compliant tokenisation with support for:
 *   - Header row mapping (columnName) or index-based mapping (columnIndex)
 *   - BOM stripping
 *   - Quoted fields containing delimiters/newlines
 *   - Blank row skipping
 *   - maxErrors abort via FsdAbortError
 *   - latin1 encoding (caller decodes Buffer before passing string)
 *   - Field-level type coercion + validation
 *
 * TSV is the same parser with delimiter="\t".
 */

import { parse as csvParse } from "csv-parse/sync";
import { FSD_ERROR } from "../profile/errors.js";
import type {
  ProfileFsdSchema,
  ProfileFsdField,
  ProfileFsdFieldError,
  ProfileFsdParseResult,
  ProfileFsdRawRow
} from "../profile/types.js";
import { coerceAndValidate, makeError, abortResult } from "./shared.js";

// ── BOM ───────────────────────────────────────────────────────────────────

const BOM = "\uFEFF";

function stripBom(input: string): string {
  return input.startsWith(BOM) ? input.slice(1) : input;
}

// ── Public API ────────────────────────────────────────────────────────────

export function parseCsv(schema: ProfileFsdSchema, input: string): ProfileFsdParseResult {
  const fmt = schema.format;
  const delimiter = fmt.delimiter ?? (fmt.type === "tsv" ? "\t" : ",");
  const quoteChar = fmt.quoteChar ?? '"';
  const escapeChar = fmt.escapeChar ?? '"';
  const hasHeader = fmt.hasHeaderRow !== false; // default true
  const skipBlankRows = schema.options?.skipBlankRows !== false; // default true
  const maxErrors = schema.options?.maxErrors ?? 100;

  const cleaned = stripBom(input);

  // csv-parse handles quoted fields, newlines inside quotes, etc.
  const raw: string[][] = csvParse(cleaned, {
    delimiter,
    quote: quoteChar,
    escape: escapeChar,
    relax_column_count: true,
    skip_empty_lines: false
  });

  if (raw.length === 0) {
    return {
      rows: [],
      errors: [],
      aborted: false,
      rowCount: 0,
      skippedRows: 0
    };
  }

  // Build header→index map when header row is present
  let headerMap: Map<string, number> | null = null;
  let dataStart = 0;

  if (hasHeader) {
    const headerRow = raw[0]!;
    headerMap = new Map();
    for (let i = 0; i < headerRow.length; i++) {
      headerMap.set(headerRow[i]!.trim(), i);
    }
    dataStart = 1;
  }

  const rows: ProfileFsdRawRow[] = [];
  const errors: ProfileFsdFieldError[] = [];
  let skippedRows = 0;

  for (let r = dataStart; r < raw.length; r++) {
    const csvRow = raw[r]!;

    // Blank-row detection: all cells empty or whitespace-only
    if (skipBlankRows && csvRow.every((c) => c.trim() === "")) {
      skippedRows++;
      continue;
    }

    const rowIndex = rows.length;
    const parsedRow: ProfileFsdRawRow = { rowIndex, fields: {} };

    for (const field of schema.fields) {
      if (field.ignoreField) continue;

      // Resolve column index
      const colIdx = resolveColumnIndex(field, headerMap);
      if (colIdx === null || colIdx < 0 || colIdx >= csvRow.length) {
        if (field.required) {
          const fieldErr = makeError(
            rowIndex,
            field.name,
            FSD_ERROR.REQUIRED_MISSING,
            `Required field "${field.name}" not found in row.`,
            undefined
          );
          errors.push(fieldErr);
          parsedRow.fields[field.name] = {
            rawValue: "",
            parsedValue: undefined,
            mappedPath: field.target,
            errors: [fieldErr]
          };
          if (errors.length >= maxErrors) {
            return abortResult(rows, errors, rowIndex + 1, skippedRows);
          }
        }
        continue;
      }

      let rawValue = csvRow[colIdx]!;
      if (field.trimWhitespace !== false) {
        rawValue = rawValue.trim();
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

// ── Column Resolution ─────────────────────────────────────────────────────

function resolveColumnIndex(
  field: ProfileFsdField,
  headerMap: Map<string, number> | null
): number | null {
  if (headerMap && field.columnName !== undefined) {
    const idx = headerMap.get(field.columnName);
    return idx !== undefined ? idx : null;
  }
  if (field.columnIndex !== undefined) {
    return field.columnIndex;
  }
  return null;
}
