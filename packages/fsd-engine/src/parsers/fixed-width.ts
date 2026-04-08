/**
 * Fixed-width parser + writer (SINGLE_FIXED classification).
 *
 * Step 1 stub — real implementation lands in Step 3.
 */

import type { FsdParseResult, FsdRecordValue, FsdSchema, FsdWriteResult } from "../types.js";

export function parseFixedWidth(_definition: FsdSchema, _input: string): FsdParseResult {
  return {
    records: [],
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "NOT_IMPLEMENTED",
        message: "Fixed-width parser not yet implemented (Step 3)"
      }
    ]
  };
}

export function writeFixedWidth(
  _definition: FsdSchema,
  _records: FsdRecordValue[]
): FsdWriteResult {
  return {
    output: "",
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "NOT_IMPLEMENTED",
        message: "Fixed-width writer not yet implemented (Step 3)"
      }
    ]
  };
}
