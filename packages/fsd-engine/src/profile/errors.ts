/**
 * FSD profile-level error types.
 *
 * FsdAbortError is thrown when parse errors exceed maxErrors threshold.
 * Error code constants provide machine-friendly codes for all error conditions.
 */

import type { ProfileFsdFieldError } from "./types.js";

// ── Abort Error ────────────────────────────────────────────────────────────

/**
 * Thrown when the number of field errors reaches or exceeds
 * `options.maxErrors` during a parse operation.
 */
export class FsdAbortError extends Error {
  public readonly code = "FSD_ABORT" as const;
  public readonly errors: ProfileFsdFieldError[];
  public readonly processedRows: number;

  constructor(errors: ProfileFsdFieldError[], processedRows: number) {
    super(
      `Parse aborted: ${errors.length} errors reached the maxErrors threshold after ${processedRows} rows.`
    );
    this.name = "FsdAbortError";
    this.errors = errors;
    this.processedRows = processedRows;
  }
}

// ── Error Code Constants ───────────────────────────────────────────────────

/** Field-level error codes (data validation) */
export const FSD_ERROR = {
  /** Required field is missing or empty */
  REQUIRED_MISSING: "REQUIRED_MISSING",
  /** Value cannot be coerced to the declared field type */
  TYPE_MISMATCH: "TYPE_MISMATCH",
  /** Value exceeds field maxLength */
  MAX_LENGTH_EXCEEDED: "MAX_LENGTH_EXCEEDED",
  /** Value is shorter than field minLength */
  MIN_LENGTH_VIOLATED: "MIN_LENGTH_VIOLATED",
  /** Value does not match field pattern regex */
  PATTERN_MISMATCH: "PATTERN_MISMATCH",
  /** Value is not in the allowedValues list */
  VALUE_NOT_IN_ALLOWED: "VALUE_NOT_IN_ALLOWED",
  /** Date/datetime value cannot be parsed with the declared dateFormat */
  INVALID_DATE_FORMAT: "INVALID_DATE_FORMAT",
  /** Decimal precision error */
  DECIMAL_PRECISION_ERROR: "DECIMAL_PRECISION_ERROR",
  /** Column present in file but not declared in schema (strictMode only) */
  UNKNOWN_COLUMN: "UNKNOWN_COLUMN",
  /** The schema document itself is malformed */
  SCHEMA_INVALID: "SCHEMA_INVALID"
} as const;

export type FsdErrorCode = (typeof FSD_ERROR)[keyof typeof FSD_ERROR];
