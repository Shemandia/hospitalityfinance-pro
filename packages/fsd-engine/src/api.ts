/**
 * Public parse/write API.
 *
 * Step 1 stub — real dispatcher lands in Step 5. For now both functions
 * return an UNSUPPORTED error so the barrel export compiles without
 * accidentally claiming to handle any classification.
 */

import type { FsdParseResult, FsdRecordValue, FsdSchema, FsdWriteResult } from "./types.js";

export function parse(_definition: FsdSchema, _input: string): FsdParseResult {
  return {
    records: [],
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "NOT_IMPLEMENTED",
        message: "parse() dispatcher not yet implemented (Step 5)"
      }
    ]
  };
}

export function write(_definition: FsdSchema, _records: FsdRecordValue[]): FsdWriteResult {
  return {
    output: "",
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "NOT_IMPLEMENTED",
        message: "write() dispatcher not yet implemented (Step 5)"
      }
    ]
  };
}
