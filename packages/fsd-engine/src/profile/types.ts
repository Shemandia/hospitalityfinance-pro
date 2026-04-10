/**
 * Profile-level FSD schema types.
 *
 * These are the wizard-friendly types used by the Profile Creation Wizard UI
 * (Session B) and the auto-detection API. They describe file formats at a
 * higher level than the internal engine types in ../types.ts.
 *
 * The profile schema is stored as JSON in td_profiles.config and
 * td_fsd_schemas.schema_json. At execution time, a translator converts
 * this profile schema into the internal FsdSchema consumed by the engine's
 * parse/write functions.
 */

// ── Schema Root ────────────────────────────────────────────────────────────

export interface ProfileFsdSchema {
  version: "1.0";
  format: ProfileFsdFormat;
  fields: ProfileFsdField[];
  options?: ProfileFsdOptions;
}

// ── Format ─────────────────────────────────────────────────────────────────

export type ProfileFormatType = "csv" | "tsv" | "fixed" | "xlsx" | "xml_ssml";

export interface ProfileFsdFormat {
  type: ProfileFormatType;
  /** csv/tsv only; default "," for csv, "\t" for tsv */
  delimiter?: string;
  /** csv/tsv only; default '"' */
  quoteChar?: string;
  /** csv/tsv only; default '"' (doubled-quote convention) */
  escapeChar?: string;
  /** csv/tsv/xlsx; default true */
  hasHeaderRow?: boolean;
  /** xlsx only; default 0 */
  sheetIndex?: number;
  /** default "utf-8"; "latin1" common for SunSystems exports */
  encoding?: string;
  /** serialise only; default "CRLF" (SunSystems compat) */
  lineEnding?: "CRLF" | "LF";
  /** fixed-width only; bytes per record */
  fixedRecordLength?: number;
  /** xml_ssml only; e.g. "TRANSACTION" */
  xmlRootElement?: string;
}

// ── Field Types ────────────────────────────────────────────────────────────

export type ProfileFsdFieldType =
  | "string"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "currency"
  | "account"
  | "enum";

// ── Field Definition ───────────────────────────────────────────────────────

export interface ProfileFsdField {
  /** Raw source column name or fixed-width field name */
  name: string;
  /** Dot-notation HFP canonical path e.g. "journal.lines[].account" */
  target: string;
  type: ProfileFsdFieldType;
  required?: boolean;
  defaultValue?: unknown;

  // Position — use ONE of:
  /** csv/tsv/xlsx: 0-based column index */
  columnIndex?: number;
  /** csv/tsv/xlsx: header name (used when hasHeaderRow=true) */
  columnName?: string;
  /** fixed-width: 0-based char offset */
  fixedStart?: number;
  /** fixed-width: field length in chars */
  fixedLength?: number;
  /** xml_ssml: XPath relative to root element */
  xmlPath?: string;

  // Validation
  maxLength?: number;
  minLength?: number;
  /** regex string */
  pattern?: string;
  /** enum constraint */
  allowedValues?: string[];

  // Numeric
  /** e.g. 1000 for Jana internal movements (÷1000 rule) — ALWAYS opt-in */
  decimalDivisor?: number;
  /** decimal places for output */
  precision?: number;

  // Date/time
  /** dayjs-compatible format string e.g. "DD/MM/YYYY" */
  dateFormat?: string;

  // Special
  /** default true */
  trimWhitespace?: boolean;
  /** parse but do not map to target (audit/passthrough) */
  ignoreField?: boolean;
}

// ── Options ────────────────────────────────────────────────────────────────

export interface ProfileFsdOptions {
  /** default true */
  skipBlankRows?: boolean;
  /** fixed-width/xlsx: rows to skip before header */
  skipRowsBeforeHeader?: number;
  /** abort parse after N errors; default 100 */
  maxErrors?: number;
  /** if true, unknown columns are errors; default false */
  strictMode?: boolean;
  /** serialise null fields as this string; default "" */
  outputNullAs?: string;
}

// ── Parse Result ───────────────────────────────────────────────────────────

export interface ProfileFsdFieldError {
  /** 0-based */
  rowIndex: number;
  fieldName: string;
  errorCode: ProfileFsdErrorCode;
  message: string;
  rawValue: unknown;
}

export type ProfileFsdErrorCode =
  | "REQUIRED_MISSING"
  | "TYPE_MISMATCH"
  | "MAX_LENGTH_EXCEEDED"
  | "MIN_LENGTH_VIOLATED"
  | "PATTERN_MISMATCH"
  | "VALUE_NOT_IN_ALLOWED"
  | "INVALID_DATE_FORMAT"
  | "DECIMAL_PRECISION_ERROR"
  | "UNKNOWN_COLUMN"
  | "SCHEMA_INVALID";

export interface ProfileFsdRawRow {
  rowIndex: number;
  fields: Record<
    string,
    {
      rawValue: string;
      parsedValue: unknown;
      mappedPath: string;
      errors: ProfileFsdFieldError[];
    }
  >;
}

export interface ProfileFsdParseResult {
  rows: ProfileFsdRawRow[];
  errors: ProfileFsdFieldError[];
  aborted: boolean;
  rowCount: number;
  skippedRows: number;
}

export interface ProfileFsdStructuredRow {
  [key: string]: unknown;
}

// ── Schema Validation Result ───────────────────────────────────────────────

export interface ProfileFsdSchemaValidationResult {
  valid: boolean;
  errors: ProfileFsdSchemaError[];
}

export interface ProfileFsdSchemaError {
  path: string;
  code: "SCHEMA_INVALID";
  message: string;
}

// ── Auto-Detection Result ──────────────────────────────────────────────────

export interface ProfileFsdFormatDetectionResult {
  confidence: number;
  detectedFormat: ProfileFsdFormat;
  detectedFields: Array<{
    name: string;
    sampleValues: string[];
    suggestedType: ProfileFsdFieldType;
  }>;
  warnings: string[];
}
