/**
 * Profile FSD schema validator.
 *
 * Validates the schema document itself (not data). Ensures the schema
 * structure is internally consistent before it's used for parsing.
 */

import { FSD_ERROR } from "./errors.js";
import type {
  ProfileFsdSchema,
  ProfileFsdField,
  ProfileFsdFormat,
  ProfileFsdSchemaValidationResult,
  ProfileFsdSchemaError,
  ProfileFormatType,
  ProfileFsdFieldType
} from "./types.js";

const VALID_FORMAT_TYPES: ReadonlySet<string> = new Set([
  "csv",
  "tsv",
  "fixed",
  "xlsx",
  "xml_ssml"
]);

const VALID_FIELD_TYPES: ReadonlySet<string> = new Set([
  "string",
  "integer",
  "decimal",
  "boolean",
  "date",
  "datetime",
  "currency",
  "account",
  "enum"
]);

const VALID_LINE_ENDINGS: ReadonlySet<string> = new Set(["CRLF", "LF"]);

/** Formats that use column-based positioning */
const COLUMN_FORMATS: ReadonlySet<ProfileFormatType> = new Set(["csv", "tsv", "xlsx"]);

/** Formats that use fixed-width positioning */
const FIXED_FORMATS: ReadonlySet<ProfileFormatType> = new Set(["fixed"]);

/** Formats that use XML path positioning */
const XML_FORMATS: ReadonlySet<ProfileFormatType> = new Set(["xml_ssml"]);

/**
 * Validate a ProfileFsdSchema document for structural correctness.
 *
 * Does NOT validate data — only the schema definition itself.
 */
export function validateProfileSchema(schema: unknown): ProfileFsdSchemaValidationResult {
  const errors: ProfileFsdSchemaError[] = [];

  if (!schema || typeof schema !== "object") {
    errors.push(err("", "Schema must be a non-null object."));
    return { valid: false, errors };
  }

  const s = schema as Record<string, unknown>;

  // ── version ──────────────────────────────────────────────────────────
  if (!("version" in s) || s.version !== "1.0") {
    errors.push(err("version", 'Schema version must be "1.0".'));
  }

  // ── format ───────────────────────────────────────────────────────────
  if (!("format" in s) || !s.format || typeof s.format !== "object") {
    errors.push(err("format", "Schema must have a format object."));
    return { valid: false, errors };
  }

  const format = s.format as Record<string, unknown>;
  const formatType = validateFormat(format, errors);

  // ── fields ───────────────────────────────────────────────────────────
  if (!("fields" in s) || !Array.isArray(s.fields)) {
    errors.push(err("fields", "Schema must have a fields array."));
    return { valid: false, errors };
  }

  if (s.fields.length === 0) {
    errors.push(err("fields", "Schema must have at least one field."));
  }

  const fieldNames = new Set<string>();
  for (let i = 0; i < s.fields.length; i++) {
    validateField(s.fields[i], i, formatType, fieldNames, errors);
  }

  // ── options (optional) ───────────────────────────────────────────────
  if ("options" in s && s.options !== undefined) {
    if (typeof s.options !== "object" || s.options === null) {
      errors.push(err("options", "Options must be an object if provided."));
    } else {
      validateOptions(s.options as Record<string, unknown>, errors);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Format Validation ──────────────────────────────────────────────────────

function validateFormat(
  format: Record<string, unknown>,
  errors: ProfileFsdSchemaError[]
): ProfileFormatType | null {
  if (!("type" in format) || typeof format.type !== "string") {
    errors.push(err("format.type", "Format must have a type string."));
    return null;
  }

  if (!VALID_FORMAT_TYPES.has(format.type)) {
    errors.push(
      err(
        "format.type",
        `Unknown format type "${format.type}". Must be one of: ${[...VALID_FORMAT_TYPES].join(", ")}.`
      )
    );
    return null;
  }

  const formatType = format.type as ProfileFormatType;

  // Validate format-specific fields
  if (formatType === "fixed") {
    if (
      "fixedRecordLength" in format &&
      (typeof format.fixedRecordLength !== "number" || format.fixedRecordLength <= 0)
    ) {
      errors.push(err("format.fixedRecordLength", "fixedRecordLength must be a positive number."));
    }
  }

  if (formatType === "xml_ssml") {
    if (
      "xmlRootElement" in format &&
      (typeof format.xmlRootElement !== "string" || format.xmlRootElement.length === 0)
    ) {
      errors.push(err("format.xmlRootElement", "xmlRootElement must be a non-empty string."));
    }
  }

  if (formatType === "xlsx") {
    if (
      "sheetIndex" in format &&
      (typeof format.sheetIndex !== "number" || format.sheetIndex < 0)
    ) {
      errors.push(err("format.sheetIndex", "sheetIndex must be a non-negative number."));
    }
  }

  if ("lineEnding" in format && typeof format.lineEnding === "string") {
    if (!VALID_LINE_ENDINGS.has(format.lineEnding)) {
      errors.push(err("format.lineEnding", `lineEnding must be "CRLF" or "LF".`));
    }
  }

  if ("encoding" in format && typeof format.encoding !== "string") {
    errors.push(err("format.encoding", "encoding must be a string."));
  }

  return formatType;
}

// ── Field Validation ───────────────────────────────────────────────────────

function validateField(
  field: unknown,
  index: number,
  formatType: ProfileFormatType | null,
  names: Set<string>,
  errors: ProfileFsdSchemaError[]
): void {
  const prefix = `fields[${index}]`;

  if (!field || typeof field !== "object") {
    errors.push(err(prefix, "Each field must be a non-null object."));
    return;
  }

  const f = field as Record<string, unknown>;

  // name
  if (!f.name || typeof f.name !== "string") {
    errors.push(err(`${prefix}.name`, "Field must have a non-empty name string."));
    return;
  }

  if (names.has(f.name as string)) {
    errors.push(err(`${prefix}.name`, `Duplicate field name "${f.name}".`));
  }
  names.add(f.name as string);

  // target
  if (!f.target || typeof f.target !== "string") {
    errors.push(err(`${prefix}.target`, "Field must have a non-empty target string."));
  }

  // type
  if (!f.type || typeof f.type !== "string") {
    errors.push(err(`${prefix}.type`, "Field must have a type string."));
  } else if (!VALID_FIELD_TYPES.has(f.type)) {
    errors.push(
      err(
        `${prefix}.type`,
        `Unknown field type "${f.type}". Must be one of: ${[...VALID_FIELD_TYPES].join(", ")}.`
      )
    );
  }

  // Position — validate based on format type
  if (formatType) {
    validateFieldPosition(f, prefix, formatType, errors);
  }

  // Numeric constraints
  if ("maxLength" in f && (typeof f.maxLength !== "number" || f.maxLength < 0)) {
    errors.push(err(`${prefix}.maxLength`, "maxLength must be a non-negative number."));
  }
  if ("minLength" in f && (typeof f.minLength !== "number" || f.minLength < 0)) {
    errors.push(err(`${prefix}.minLength`, "minLength must be a non-negative number."));
  }
  if ("decimalDivisor" in f && (typeof f.decimalDivisor !== "number" || f.decimalDivisor === 0)) {
    errors.push(err(`${prefix}.decimalDivisor`, "decimalDivisor must be a non-zero number."));
  }
  if ("precision" in f && (typeof f.precision !== "number" || f.precision < 0)) {
    errors.push(err(`${prefix}.precision`, "precision must be a non-negative number."));
  }

  // pattern — validate regex
  if ("pattern" in f && typeof f.pattern === "string") {
    try {
      new RegExp(f.pattern);
    } catch {
      errors.push(err(`${prefix}.pattern`, `Invalid regex pattern: "${f.pattern}".`));
    }
  }

  // allowedValues
  if ("allowedValues" in f) {
    if (!Array.isArray(f.allowedValues)) {
      errors.push(err(`${prefix}.allowedValues`, "allowedValues must be an array."));
    } else if (f.allowedValues.some((v: unknown) => typeof v !== "string")) {
      errors.push(err(`${prefix}.allowedValues`, "All allowedValues must be strings."));
    }
  }
}

function validateFieldPosition(
  field: Record<string, unknown>,
  prefix: string,
  formatType: ProfileFormatType,
  errors: ProfileFsdSchemaError[]
): void {
  if (COLUMN_FORMATS.has(formatType)) {
    // csv/tsv/xlsx require columnIndex or columnName
    const hasColumnIndex = "columnIndex" in field && typeof field.columnIndex === "number";
    const hasColumnName = "columnName" in field && typeof field.columnName === "string";
    if (!hasColumnIndex && !hasColumnName) {
      errors.push(
        err(
          `${prefix}`,
          `Field for ${formatType} format must have columnIndex (number) or columnName (string).`
        )
      );
    }
    if (hasColumnIndex && (field.columnIndex as number) < 0) {
      errors.push(err(`${prefix}.columnIndex`, "columnIndex must be non-negative."));
    }
  }

  if (FIXED_FORMATS.has(formatType)) {
    // fixed-width requires fixedStart and fixedLength
    const hasStart = "fixedStart" in field && typeof field.fixedStart === "number";
    const hasLength = "fixedLength" in field && typeof field.fixedLength === "number";
    if (!hasStart || !hasLength) {
      errors.push(
        err(
          `${prefix}`,
          "Field for fixed format must have both fixedStart and fixedLength (numbers)."
        )
      );
    }
    if (hasStart && (field.fixedStart as number) < 0) {
      errors.push(err(`${prefix}.fixedStart`, "fixedStart must be non-negative."));
    }
    if (hasLength && (field.fixedLength as number) <= 0) {
      errors.push(err(`${prefix}.fixedLength`, "fixedLength must be positive."));
    }
  }

  if (XML_FORMATS.has(formatType)) {
    // xml_ssml requires xmlPath
    const hasXmlPath = "xmlPath" in field && typeof field.xmlPath === "string";
    if (!hasXmlPath) {
      errors.push(err(`${prefix}`, "Field for xml_ssml format must have xmlPath (string)."));
    }
  }
}

// ── Options Validation ─────────────────────────────────────────────────────

function validateOptions(options: Record<string, unknown>, errors: ProfileFsdSchemaError[]): void {
  if ("maxErrors" in options && (typeof options.maxErrors !== "number" || options.maxErrors < 1)) {
    errors.push(err("options.maxErrors", "maxErrors must be a positive number."));
  }

  if (
    "skipRowsBeforeHeader" in options &&
    (typeof options.skipRowsBeforeHeader !== "number" || options.skipRowsBeforeHeader < 0)
  ) {
    errors.push(
      err("options.skipRowsBeforeHeader", "skipRowsBeforeHeader must be a non-negative number.")
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function err(path: string, message: string): ProfileFsdSchemaError {
  return { path, code: FSD_ERROR.SCHEMA_INVALID, message };
}
