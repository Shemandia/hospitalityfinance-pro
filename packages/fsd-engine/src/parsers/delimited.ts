/**
 * Delimited parser + writer (CSV / TSV / semicolon / custom).
 *
 * Step 1 stub — real implementation lands in Step 2.
 */

import type { FsdParseResult, FsdRecordValue, FsdSchema, FsdWriteResult } from "../types.js";

export function parseDelimited(_definition: FsdSchema, _input: string): FsdParseResult {
  return {
    records: [],
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "NOT_IMPLEMENTED",
        message: "Delimited parser not yet implemented (Step 2)"
      }
    ]
  };
}

export function writeDelimited(_definition: FsdSchema, _records: FsdRecordValue[]): FsdWriteResult {
  return {
    output: "",
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "NOT_IMPLEMENTED",
        message: "Delimited writer not yet implemented (Step 2)"
      }
    ]
  };
}
