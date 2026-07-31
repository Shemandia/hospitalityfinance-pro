/**
 * Profile-level row validator.
 *
 * Validates already-parsed rows against a schema. Can be called independently
 * after parse() to re-validate, or used by the wizard to preview validation.
 *
 * This is a thin wrapper around the shared coerceAndValidate logic used by
 * all parsers — it adds UNKNOWN_COLUMN detection (strictMode) and the
 * public validate(rows, schema) API surface from spec §10.
 */

import { FSD_ERROR } from "./errors.js";
import type { ProfileFsdSchema, ProfileFsdFieldError, ProfileFsdRawRow } from "./types.js";
import { coerceAndValidate, makeError } from "../parsers/shared.js";

// ── Result Type ───────────────────────────────────────────────────────────

export interface ProfileFsdValidationResult {
  errors: ProfileFsdFieldError[];
  aborted: boolean;
  rowsValidated: number;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Validate already-parsed rows against a schema.
 *
 * Re-runs coercion + validation on every field in every row. Useful for
 * re-validating after schema edits in the wizard or for batch validation
 * of imported data.
 *
 * - Fail-fast per field: stops after first error per field per row.
 * - Aborts when `errors.length >= options.maxErrors`.
 * - In strictMode, any field present in a row but not declared in the
 *   schema produces an UNKNOWN_COLUMN error.
 */
export function validateRows(
  rows: ProfileFsdRawRow[],
  schema: ProfileFsdSchema
): ProfileFsdValidationResult {
  const maxErrors = schema.options?.maxErrors ?? 100;
  const strictMode = schema.options?.strictMode ?? false;
  const errors: ProfileFsdFieldError[] = [];
  const fieldNames = new Set(schema.fields.map((f) => f.name));

  let rowsValidated = 0;

  for (const row of rows) {
    rowsValidated++;

    // strictMode: detect unknown columns
    if (strictMode) {
      for (const key of Object.keys(row.fields)) {
        if (!fieldNames.has(key)) {
          errors.push(
            makeError(
              row.rowIndex,
              key,
              FSD_ERROR.UNKNOWN_COLUMN,
              `Unknown column "${key}" not declared in schema (strictMode).`,
              row.fields[key]?.rawValue ?? null
            )
          );
          if (errors.length >= maxErrors) {
            return { errors, aborted: true, rowsValidated };
          }
        }
      }
    }

    // Validate each declared field
    for (const field of schema.fields) {
      if (field.ignoreField) continue;

      const cell = row.fields[field.name];
      const rawValue = cell?.rawValue ?? "";

      const fieldErrors: ProfileFsdFieldError[] = [];
      coerceAndValidate(rawValue, field, row.rowIndex, fieldErrors);

      errors.push(...fieldErrors);

      if (errors.length >= maxErrors) {
        return { errors, aborted: true, rowsValidated };
      }
    }
  }

  return { errors, aborted: false, rowsValidated };
}
