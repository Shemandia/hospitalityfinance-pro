/**
 * SIMPLE_XML parser + writer.
 *
 * Step 1 stub — real implementation lands in Step 4.
 */

import type { FsdParseResult, FsdRecordValue, FsdSchema, FsdWriteResult } from "../types.js";

export function parseXml(_definition: FsdSchema, _input: string): FsdParseResult {
  return {
    records: [],
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "NOT_IMPLEMENTED",
        message: "SIMPLE_XML parser not yet implemented (Step 4)"
      }
    ]
  };
}

export function writeXml(_definition: FsdSchema, _records: FsdRecordValue[]): FsdWriteResult {
  return {
    output: "",
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "NOT_IMPLEMENTED",
        message: "SIMPLE_XML writer not yet implemented (Step 4)"
      }
    ]
  };
}
