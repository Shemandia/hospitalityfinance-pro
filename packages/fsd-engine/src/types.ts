/**
 * Internal FSD model types.
 *
 * These match the class structure in spec section 4.4.1 but are plain
 * TypeScript interfaces (no classes, no inheritance) so they serialise cleanly
 * to JSON and can be constructed by hand in tests.
 */

// ── Classification ──────────────────────────────────────────────────────────

export type FsdClassification =
  | "DELIMITED"
  | "SINGLE_FIXED"
  | "MULTIPLE_FIXED"
  | "OTHER_FLAT"
  | "USER_XML"
  | "SIMPLE_XML";

// ── Field-level types ──────────────────────────────────────────────────────

/**
 * Value type the engine will coerce parsed strings to before returning them
 * as record values. The spec's FSD XML doesn't carry this — FSD is purely
 * byte-level. HFP adds type coercion as a convenience so downstream
 * transformations can work with typed data.
 */
export type FsdFieldType = "string" | "number" | "integer" | "boolean" | "date";

/**
 * Quoting mode per spec §4.1:
 *   auto — quotes are used only when the field value contains the separator
 *   yes  — quotes are always added on write; always stripped on read
 *   no   — no quote handling at all
 */
export type FsdQuoteMode = "auto" | "yes" | "no";

/**
 * A single atomic data unit (matches FSD \<field\> element).
 */
export type FsdField = {
  /** Target property name on the parsed record */
  name: string;
  /**
   * `false` means this field is read for structure navigation but not emitted
   * into the parsed record. Maps to FSD `output` attribute.
   */
  output?: boolean;
  /** Value type coercion (HFP extension) */
  type?: FsdFieldType;
  /** Override the record's field separator for this field (delimited formats) */
  fieldSep?: string;
  /**
   * Restrict the value to one of a fixed set (spec: `valid-value`).
   * If set on a field with `output=false`, the constant is written to the flat
   * output on JSON-to-flat conversion (marker fields).
   */
  validValue?: string[];
  /** Default value used when the source field is empty */
  defaultValue?: string;
  /** Leading padding char (fixed-width). First char of the string is used. */
  leadingChars?: string;
  /** Trailing padding char (fixed-width). First char of the string is used. */
  trailingChars?: string;
  /** If false, empty values are suppressed from output */
  outputIfEmpty?: boolean;
  /** Default 128 per spec */
  maxLength?: number;
  /** Default 0 per spec */
  minLength?: number;
  /** If true, values longer than maxLength are truncated silently */
  truncate?: boolean;
  /** Quoting mode — only applies to delimited records */
  quoted?: FsdQuoteMode;
  /** HFP extension: required flag. Missing/empty → validation error */
  required?: boolean;
  /** HFP extension: regex applied after other validation */
  pattern?: string;
  /** XML-only: element or attribute name (if different from `name`) */
  xmlName?: string;
  /** XML-only: true = this field is an attribute of the record element */
  xmlAttribute?: boolean;
};

// ── Record-level ────────────────────────────────────────────────────────────

/**
 * A record is a container of fields with optional record separator. Matches
 * FSD \<record\> element.
 */
export type FsdRecord = {
  name: string;
  output?: boolean;
  /** Record separator — defaults to \\r\\n (Windows). Used by delimited + fixed-width. */
  recordSep?: string;
  minOccur?: number;
  /** maxOccur = 0 means unlimited (per spec §4.1) */
  maxOccur?: number;
  fields: FsdField[];
  /** XML-only: element name for the record wrapper (if different from `name`) */
  xmlName?: string;
};

// ── Sequence / Choice (for future MULTIPLE_FIXED support) ──────────────────

export type FsdSequence = {
  kind: "sequence";
  name?: string;
  output?: boolean;
  minOccur?: number;
  maxOccur?: number;
  children: (FsdRecord | FsdSequence | FsdChoice)[];
};

export type FsdChoice = {
  kind: "choice";
  name?: string;
  output?: boolean;
  minOccur?: number;
  maxOccur?: number;
  children: (FsdRecord | FsdSequence | FsdChoice)[];
};

// ── Schema (root) ──────────────────────────────────────────────────────────

/**
 * Root schema. The HFP-adapted shape is flatter than the spec's strict
 * sequence/choice tree: for the 3 classifications we support in Phase A
 * (DELIMITED, SINGLE_FIXED, SIMPLE_XML) there's exactly one record type,
 * so we expose it at the top level as `record`.
 *
 * MULTIPLE_FIXED support in a later sprint will use the `sequence`/`choice`
 * fields instead.
 */
export type FsdSchema = {
  /** FSD schema version; purely informational for this library */
  version?: string;
  classification: FsdClassification;
  /** Delimited default `,`; fixed-width ignored; XML ignored */
  fieldSep?: string;
  /** Default `\r\n`. Used as the record separator for delimited + fixed-width. */
  recordSep?: string;
  /** Skip the first N lines of the input (e.g. column headers) */
  initialLinesToIgnore?: number;
  /** Character encoding; purely informational — the caller decodes */
  encoding?: string;
  /**
   * Exactly one record type for Phase A classifications. When missing, the
   * schema is invalid.
   */
  record?: FsdRecord;
  /** For MULTIPLE_FIXED (future) */
  sequence?: FsdSequence;
  /** SIMPLE_XML: the name of the wrapping root element (e.g. "Transactions") */
  xmlRoot?: string;
};

// ── Parse / write result ────────────────────────────────────────────────────

/**
 * A parsed record. Keys are the `name` of each FSD field; values are coerced
 * according to the field's `type`.
 */
export type FsdRecordValue = Record<string, string | number | boolean | Date | null>;

export type FsdParseError = {
  /** 1-based line number in the input; null for whole-input errors */
  line: number | null;
  /** 0-based record index; null for structural errors */
  recordIndex: number | null;
  /** Field name; null for record-level errors */
  field: string | null;
  /** Machine-friendly error code */
  code: string;
  /** Human-readable error message */
  message: string;
};

export type FsdParseResult = {
  records: FsdRecordValue[];
  errors: FsdParseError[];
};

export type FsdWriteResult = {
  output: string;
  errors: FsdParseError[];
};

// ── Parser / writer function shapes ────────────────────────────────────────

export type FsdParser = (definition: FsdSchema, input: string) => FsdParseResult;
export type FsdWriter = (definition: FsdSchema, records: FsdRecordValue[]) => FsdWriteResult;

// ── Defaults (spec §4.4.1) ──────────────────────────────────────────────────

export const DEFAULT_MAX_LENGTH = 128;
export const DEFAULT_MIN_LENGTH = 0;
export const DEFAULT_RECORD_SEP = "\r\n";
export const DEFAULT_FIELD_SEP = ",";
