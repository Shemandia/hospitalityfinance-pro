/**
 * Field-level validator. Pure function — no side effects, no I/O.
 *
 * Called by every parser after splitting a line into raw field strings but
 * before coercing those strings to typed record values. Returns an array of
 * errors (empty = valid) and the coerced value to write into the record.
 *
 * Per spec §4.4.1, validation considers:
 *   - required (HFP extension)
 *   - minLength / maxLength (with truncate behavior)
 *   - validValue allow-list
 *   - pattern (HFP extension regex)
 *   - type coercion (string / number / integer / boolean / date)
 *
 * The validator does NOT enforce field-level XML escaping or encoding —
 * those are handled at the parser/writer level.
 */

import {
  DEFAULT_MAX_LENGTH,
  DEFAULT_MIN_LENGTH,
  type FsdField,
  type FsdParseError
} from "./types.js";

export type ValidateFieldArgs = {
  field: FsdField;
  rawValue: string;
  /** 1-based line number in the source input (or null for non-line sources like XML) */
  line: number | null;
  /** 0-based record index */
  recordIndex: number;
};

export type ValidateFieldResult = {
  errors: FsdParseError[];
  /** The coerced value to store on the record. Undefined when validation produced an error
   *  AND there's no usable fallback (caller decides whether to skip the record). */
  value: string | number | boolean | Date | null | undefined;
};

/**
 * Validate a single field's raw string value and coerce it to the typed
 * record value. Returns errors (empty = valid) plus the coerced value.
 */
export function validateField(args: ValidateFieldArgs): ValidateFieldResult {
  const { field, line, recordIndex } = args;
  let raw = args.rawValue;
  const errors: FsdParseError[] = [];

  // 1. Empty / required handling
  const isEmpty = raw === undefined || raw === null || raw === "";
  if (isEmpty && field.defaultValue !== undefined) {
    raw = field.defaultValue;
  }

  if ((raw === undefined || raw === null || raw === "") && field.required) {
    errors.push({
      line,
      recordIndex,
      field: field.name,
      code: "REQUIRED",
      message: `Field "${field.name}" is required but was empty`
    });
    return { errors, value: undefined };
  }

  if (raw === undefined || raw === null || raw === "") {
    // Optional + empty → null
    return { errors, value: null };
  }

  // 2. Length checks
  const minLength = field.minLength ?? DEFAULT_MIN_LENGTH;
  const maxLength = field.maxLength ?? DEFAULT_MAX_LENGTH;

  if (raw.length < minLength) {
    errors.push({
      line,
      recordIndex,
      field: field.name,
      code: "MIN_LENGTH",
      message: `Field "${field.name}" length ${raw.length} is below minimum ${minLength}`
    });
  }

  if (raw.length > maxLength) {
    if (field.truncate) {
      raw = raw.slice(0, maxLength);
    } else {
      errors.push({
        line,
        recordIndex,
        field: field.name,
        code: "MAX_LENGTH",
        message: `Field "${field.name}" length ${raw.length} exceeds maximum ${maxLength}`
      });
    }
  }

  // 3. validValue allow-list
  if (field.validValue && field.validValue.length > 0) {
    if (!field.validValue.includes(raw)) {
      errors.push({
        line,
        recordIndex,
        field: field.name,
        code: "INVALID_VALUE",
        message: `Field "${field.name}" value "${raw}" is not one of [${field.validValue.join(", ")}]`
      });
    }
  }

  // 4. Pattern (HFP extension)
  if (field.pattern) {
    let re: RegExp;
    try {
      re = new RegExp(field.pattern);
    } catch (err) {
      // Invalid regex in the schema is a schema error, not a data error
      errors.push({
        line: null,
        recordIndex: null,
        field: field.name,
        code: "INVALID_PATTERN_REGEX",
        message: `Field "${field.name}" has invalid regex pattern: ${(err as Error).message}`
      });
      return { errors, value: raw };
    }
    if (!re.test(raw)) {
      errors.push({
        line,
        recordIndex,
        field: field.name,
        code: "PATTERN_MISMATCH",
        message: `Field "${field.name}" value "${raw}" does not match pattern ${field.pattern}`
      });
    }
  }

  // 5. Type coercion
  const coerced = coerceValue(field, raw, line, recordIndex);
  if (coerced.error) {
    errors.push(coerced.error);
    // Coercion failed — return the raw string so callers can still inspect it
    return { errors, value: raw };
  }

  return { errors, value: coerced.value };
}

// ── Type coercion helpers ───────────────────────────────────────────────────

function coerceValue(
  field: FsdField,
  raw: string,
  line: number | null,
  recordIndex: number
): { value: string | number | boolean | Date | null; error?: FsdParseError } {
  const type = field.type ?? "string";

  switch (type) {
    case "string":
      return { value: raw };

    case "integer": {
      // Strip leading/trailing whitespace and a leading +/-
      const trimmed = raw.trim();
      if (!/^-?\d+$/.test(trimmed)) {
        return {
          value: null,
          error: {
            line,
            recordIndex,
            field: field.name,
            code: "TYPE_INTEGER",
            message: `Field "${field.name}" value "${raw}" is not a valid integer`
          }
        };
      }
      return { value: Number.parseInt(trimmed, 10) };
    }

    case "number": {
      const trimmed = raw.trim();
      // Reject anything that doesn't look like a JS number literal
      if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
        return {
          value: null,
          error: {
            line,
            recordIndex,
            field: field.name,
            code: "TYPE_NUMBER",
            message: `Field "${field.name}" value "${raw}" is not a valid number`
          }
        };
      }
      const n = Number.parseFloat(trimmed);
      if (!Number.isFinite(n)) {
        return {
          value: null,
          error: {
            line,
            recordIndex,
            field: field.name,
            code: "TYPE_NUMBER",
            message: `Field "${field.name}" value "${raw}" parsed to non-finite number`
          }
        };
      }
      return { value: n };
    }

    case "boolean": {
      const t = raw.trim().toLowerCase();
      if (t === "true" || t === "1" || t === "yes" || t === "y") return { value: true };
      if (t === "false" || t === "0" || t === "no" || t === "n") return { value: false };
      return {
        value: null,
        error: {
          line,
          recordIndex,
          field: field.name,
          code: "TYPE_BOOLEAN",
          message: `Field "${field.name}" value "${raw}" is not a recognised boolean`
        }
      };
    }

    case "date": {
      // Accept ISO 8601 (YYYY-MM-DD or full timestamp). Reject ambiguous formats.
      const trimmed = raw.trim();
      const d = new Date(trimmed);
      if (Number.isNaN(d.getTime())) {
        return {
          value: null,
          error: {
            line,
            recordIndex,
            field: field.name,
            code: "TYPE_DATE",
            message: `Field "${field.name}" value "${raw}" is not a valid ISO date`
          }
        };
      }
      return { value: d };
    }
  }
}
