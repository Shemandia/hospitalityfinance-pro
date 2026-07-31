/**
 * Shared coercion, validation, and helpers for profile-level parsers.
 *
 * Used by csv.ts and fixed.ts (and future xlsx/xml parsers).
 */

import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import utc from "dayjs/plugin/utc.js";
import { FSD_ERROR } from "../profile/errors.js";
import type {
  ProfileFsdField,
  ProfileFsdFieldError,
  ProfileFsdParseResult,
  ProfileFsdRawRow
} from "../profile/types.js";

dayjs.extend(customParseFormat);
dayjs.extend(utc);

// ── Type Coercion + Validation (fail-fast per field) ──────────────────────

export function coerceAndValidate(
  rawValue: string,
  field: ProfileFsdField,
  rowIndex: number,
  errors: ProfileFsdFieldError[]
): unknown {
  // Required check
  if (rawValue === "" || rawValue === undefined) {
    if (field.required) {
      errors.push(
        makeError(
          rowIndex,
          field.name,
          FSD_ERROR.REQUIRED_MISSING,
          `Required field "${field.name}" is empty.`,
          rawValue
        )
      );
      return undefined;
    }
    if (field.defaultValue !== undefined) return field.defaultValue;
    return rawValue === "" ? null : undefined;
  }

  // Type coercion
  let parsed: unknown = rawValue;

  switch (field.type) {
    case "integer": {
      const n = Number(rawValue);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        errors.push(
          makeError(
            rowIndex,
            field.name,
            FSD_ERROR.TYPE_MISMATCH,
            `Cannot coerce "${rawValue}" to integer.`,
            rawValue
          )
        );
        return rawValue;
      }
      parsed = n;
      break;
    }
    case "decimal":
    case "currency": {
      const n = Number(rawValue);
      if (!Number.isFinite(n)) {
        errors.push(
          makeError(
            rowIndex,
            field.name,
            FSD_ERROR.TYPE_MISMATCH,
            `Cannot coerce "${rawValue}" to ${field.type}.`,
            rawValue
          )
        );
        return rawValue;
      }
      // decimalDivisor: ALWAYS opt-in, never default
      parsed = field.decimalDivisor ? n / field.decimalDivisor : n;
      // Precision check
      if (field.precision !== undefined) {
        const decimalStr = String(parsed as number).split(".")[1] ?? "";
        if (decimalStr.length > field.precision) {
          errors.push(
            makeError(
              rowIndex,
              field.name,
              FSD_ERROR.DECIMAL_PRECISION_ERROR,
              `Value has ${decimalStr.length} decimal places, exceeds precision ${field.precision}.`,
              rawValue
            )
          );
          return parsed;
        }
      }
      break;
    }
    case "boolean": {
      const lower = rawValue.toLowerCase();
      if (["true", "1", "yes", "y"].includes(lower)) parsed = true;
      else if (["false", "0", "no", "n"].includes(lower)) parsed = false;
      else {
        errors.push(
          makeError(
            rowIndex,
            field.name,
            FSD_ERROR.TYPE_MISMATCH,
            `Cannot coerce "${rawValue}" to boolean.`,
            rawValue
          )
        );
        return rawValue;
      }
      break;
    }
    case "date":
    case "datetime": {
      if (field.dateFormat) {
        const d = dayjs.utc(rawValue, field.dateFormat, true);
        if (!d.isValid()) {
          errors.push(
            makeError(
              rowIndex,
              field.name,
              FSD_ERROR.INVALID_DATE_FORMAT,
              `Cannot parse "${rawValue}" with format "${field.dateFormat}".`,
              rawValue
            )
          );
          return rawValue;
        }
        parsed = d.toDate();
      } else {
        // Fallback: ISO parse in UTC
        const d = dayjs.utc(rawValue);
        if (!d.isValid()) {
          errors.push(
            makeError(
              rowIndex,
              field.name,
              FSD_ERROR.INVALID_DATE_FORMAT,
              `Cannot parse "${rawValue}" as date.`,
              rawValue
            )
          );
          return rawValue;
        }
        parsed = d.toDate();
      }
      break;
    }
    case "enum": {
      if (field.allowedValues && !field.allowedValues.includes(rawValue)) {
        errors.push(
          makeError(
            rowIndex,
            field.name,
            FSD_ERROR.VALUE_NOT_IN_ALLOWED,
            `Value "${rawValue}" not in allowed values: ${field.allowedValues.join(", ")}.`,
            rawValue
          )
        );
        return rawValue;
      }
      parsed = rawValue;
      break;
    }
    case "account":
    case "string":
    default:
      parsed = rawValue;
      break;
  }

  // String-level validation (only for string-like values after coercion)
  if (typeof rawValue === "string") {
    if (field.maxLength !== undefined && rawValue.length > field.maxLength) {
      errors.push(
        makeError(
          rowIndex,
          field.name,
          FSD_ERROR.MAX_LENGTH_EXCEEDED,
          `Value length ${rawValue.length} exceeds maxLength ${field.maxLength}.`,
          rawValue
        )
      );
      return parsed;
    }
    if (field.minLength !== undefined && rawValue.length < field.minLength) {
      errors.push(
        makeError(
          rowIndex,
          field.name,
          FSD_ERROR.MIN_LENGTH_VIOLATED,
          `Value length ${rawValue.length} is less than minLength ${field.minLength}.`,
          rawValue
        )
      );
      return parsed;
    }
    if (field.pattern) {
      const re = new RegExp(field.pattern);
      if (!re.test(rawValue)) {
        errors.push(
          makeError(
            rowIndex,
            field.name,
            FSD_ERROR.PATTERN_MISMATCH,
            `Value "${rawValue}" does not match pattern /${field.pattern}/.`,
            rawValue
          )
        );
        return parsed;
      }
    }
  }

  return parsed;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function makeError(
  rowIndex: number,
  fieldName: string,
  errorCode: string,
  message: string,
  rawValue: unknown
): ProfileFsdFieldError {
  return {
    rowIndex,
    fieldName,
    errorCode: errorCode as ProfileFsdFieldError["errorCode"],
    message,
    rawValue
  };
}

export function abortResult(
  rows: ProfileFsdRawRow[],
  errors: ProfileFsdFieldError[],
  processedRows: number,
  skippedRows: number
): ProfileFsdParseResult {
  return {
    rows,
    errors,
    aborted: true,
    rowCount: rows.length,
    skippedRows
  };
}
