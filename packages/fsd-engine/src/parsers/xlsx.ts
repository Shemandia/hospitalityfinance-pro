/**
 * Profile-level XLSX parser.
 *
 * Uses exceljs to read .xlsx buffers. Supports:
 *   - Sheet selection by sheetIndex (default 0)
 *   - skipRowsBeforeHeader — skip N rows before treating next as header
 *   - Header row mapping (columnName) or index-based mapping (columnIndex)
 *   - exceljs returns JS Date objects for date cells — preserved or
 *     re-parsed via dateFormat when the cell is a string
 *   - Reuses coerceAndValidate from shared.ts for string cells
 *   - skipBlankRows, maxErrors abort
 *   - decimalDivisor only when explicitly set
 */

import ExcelJS from "exceljs";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import utc from "dayjs/plugin/utc.js";
import { FSD_ERROR } from "../profile/errors.js";
import type {
  ProfileFsdSchema,
  ProfileFsdField,
  ProfileFsdFieldError,
  ProfileFsdParseResult,
  ProfileFsdRawRow
} from "../profile/types.js";
import { coerceAndValidate, makeError, abortResult } from "./shared.js";

dayjs.extend(customParseFormat);
dayjs.extend(utc);

// ── Public API ────────────────────────────────────────────────────────────

export async function parseXlsx(
  schema: ProfileFsdSchema,
  buffer: Buffer
): Promise<ProfileFsdParseResult> {
  const fmt = schema.format;
  const sheetIndex = fmt.sheetIndex ?? 0;
  const skipBefore = schema.options?.skipRowsBeforeHeader ?? 0;
  const hasHeader = fmt.hasHeaderRow !== false; // default true
  const skipBlankRows = schema.options?.skipBlankRows !== false;
  const maxErrors = schema.options?.maxErrors ?? 100;

  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);

  // Sheets are 1-indexed in exceljs
  const sheet = workbook.getWorksheet(sheetIndex + 1);
  if (!sheet) {
    return {
      rows: [],
      errors: [
        makeError(0, "", FSD_ERROR.SCHEMA_INVALID, `Sheet at index ${sheetIndex} not found.`, null)
      ],
      aborted: false,
      rowCount: 0,
      skippedRows: 0
    };
  }

  // Collect all rows as arrays of cell values
  const allRows: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    // row.values is 1-indexed (index 0 is undefined); normalise to 0-indexed
    const vals: unknown[] = [];
    for (let c = 1; c <= sheet.columnCount; c++) {
      const cell = row.getCell(c);
      vals.push(cellValue(cell));
    }
    allRows.push(vals);
  });

  if (allRows.length === 0) {
    return { rows: [], errors: [], aborted: false, rowCount: 0, skippedRows: 0 };
  }

  // Skip rows before header
  let dataStart = skipBefore;

  // Build header map
  let headerMap: Map<string, number> | null = null;
  if (hasHeader) {
    if (dataStart < allRows.length) {
      const headerRow = allRows[dataStart]!;
      headerMap = new Map();
      for (let i = 0; i < headerRow.length; i++) {
        const hdr = String(headerRow[i] ?? "").trim();
        if (hdr) headerMap.set(hdr, i);
      }
    }
    dataStart += 1;
  }

  const rows: ProfileFsdRawRow[] = [];
  const errors: ProfileFsdFieldError[] = [];
  let skippedRows = 0;

  for (let r = dataStart; r < allRows.length; r++) {
    const xlRow = allRows[r]!;

    // Blank-row detection
    if (
      skipBlankRows &&
      xlRow.every((c) => c === null || c === undefined || String(c).trim() === "")
    ) {
      skippedRows++;
      continue;
    }

    const rowIndex = rows.length;
    const parsedRow: ProfileFsdRawRow = { rowIndex, fields: {} };

    for (const field of schema.fields) {
      if (field.ignoreField) continue;

      const colIdx = resolveColumnIndex(field, headerMap);
      if (colIdx === null || colIdx < 0 || colIdx >= xlRow.length) {
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

      const cellVal = xlRow[colIdx];
      const { rawValue, parsedValue, fieldErrors } = processCell(cellVal, field, rowIndex);

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

// ── Cell Value Extraction ─────────────────────────────────────────────────

function cellValue(cell: ExcelJS.Cell): unknown {
  if (cell.type === ExcelJS.ValueType.Null) return null;
  if (cell.type === ExcelJS.ValueType.Date) return cell.value;
  if (cell.type === ExcelJS.ValueType.Number) return cell.value;
  if (cell.type === ExcelJS.ValueType.Boolean) return cell.value;
  if (cell.type === ExcelJS.ValueType.Formula) {
    return (cell.value as ExcelJS.CellFormulaValue)?.result ?? null;
  }
  if (cell.type === ExcelJS.ValueType.RichText) {
    const rt = cell.value as ExcelJS.CellRichTextValue;
    return rt.richText.map((r) => r.text).join("");
  }
  // String, Hyperlink, Error, SharedString → stringify
  return cell.text ?? String(cell.value ?? "");
}

// ── Cell Processing ───────────────────────────────────────────────────────

function processCell(
  cellVal: unknown,
  field: ProfileFsdField,
  rowIndex: number
): { rawValue: string; parsedValue: unknown; fieldErrors: ProfileFsdFieldError[] } {
  const fieldErrors: ProfileFsdFieldError[] = [];

  // exceljs Date objects — pass through directly for date/datetime fields
  if (cellVal instanceof Date && (field.type === "date" || field.type === "datetime")) {
    const rawValue = cellVal.toISOString();
    // If the field has a dateFormat, validate by re-parsing the formatted string
    if (field.dateFormat) {
      const formatted = dayjs.utc(cellVal).format(field.dateFormat);
      const reparsed = dayjs.utc(formatted, field.dateFormat, true);
      if (!reparsed.isValid()) {
        fieldErrors.push(
          makeError(
            rowIndex,
            field.name,
            FSD_ERROR.INVALID_DATE_FORMAT,
            `Date value cannot be formatted with "${field.dateFormat}".`,
            rawValue
          )
        );
        return { rawValue, parsedValue: cellVal, fieldErrors };
      }
    }
    return { rawValue, parsedValue: cellVal, fieldErrors };
  }

  // Numeric cells for numeric fields — handle directly to preserve precision
  if (
    typeof cellVal === "number" &&
    (field.type === "decimal" || field.type === "currency" || field.type === "integer")
  ) {
    const rawValue = String(cellVal);

    if (field.type === "integer" && !Number.isInteger(cellVal)) {
      fieldErrors.push(
        makeError(
          rowIndex,
          field.name,
          FSD_ERROR.TYPE_MISMATCH,
          `Cannot coerce "${rawValue}" to integer.`,
          rawValue
        )
      );
      return { rawValue, parsedValue: rawValue, fieldErrors };
    }

    const parsed = field.decimalDivisor ? cellVal / field.decimalDivisor : cellVal;
    return { rawValue, parsedValue: parsed, fieldErrors };
  }

  // Boolean cells for boolean fields
  if (typeof cellVal === "boolean" && field.type === "boolean") {
    return { rawValue: String(cellVal), parsedValue: cellVal, fieldErrors };
  }

  // Everything else: convert to string and use shared coerceAndValidate
  let strVal = cellVal === null || cellVal === undefined ? "" : String(cellVal);
  if (field.trimWhitespace !== false) {
    strVal = strVal.trim();
  }

  const parsedValue = coerceAndValidate(strVal, field, rowIndex, fieldErrors);
  return { rawValue: strVal, parsedValue, fieldErrors };
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
