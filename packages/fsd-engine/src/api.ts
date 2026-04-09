/**
 * Public parse/write API.
 *
 * Dispatches by schema.classification to the appropriate parser/writer.
 * Phase A supports DELIMITED, SINGLE_FIXED, and SIMPLE_XML; the other
 * three classifications (MULTIPLE_FIXED, OTHER_FLAT, USER_XML) return a
 * single UNSUPPORTED_CLASSIFICATION error so callers (e.g. the BullMQ
 * worker) can fail fast with a clear message.
 */

import { parseDelimited, writeDelimited } from "./parsers/delimited.js";
import { parseFixedWidth, writeFixedWidth } from "./parsers/fixed-width.js";
import { parseXml, writeXml } from "./parsers/xml.js";
import type {
  FsdClassification,
  FsdParseResult,
  FsdRecordValue,
  FsdSchema,
  FsdWriteResult
} from "./types.js";

const SUPPORTED: ReadonlySet<FsdClassification> = new Set([
  "DELIMITED",
  "SINGLE_FIXED",
  "SIMPLE_XML"
]);

function unsupportedParse(classification: FsdClassification): FsdParseResult {
  return {
    records: [],
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "UNSUPPORTED_CLASSIFICATION",
        message: `FSD classification "${classification}" is not supported in Phase A`
      }
    ]
  };
}

function unsupportedWrite(classification: FsdClassification): FsdWriteResult {
  return {
    output: "",
    errors: [
      {
        line: null,
        recordIndex: null,
        field: null,
        code: "UNSUPPORTED_CLASSIFICATION",
        message: `FSD classification "${classification}" is not supported in Phase A`
      }
    ]
  };
}

export function parse(definition: FsdSchema, input: string): FsdParseResult {
  if (!SUPPORTED.has(definition.classification)) {
    return unsupportedParse(definition.classification);
  }
  switch (definition.classification) {
    case "DELIMITED":
      return parseDelimited(definition, input);
    case "SINGLE_FIXED":
      return parseFixedWidth(definition, input);
    case "SIMPLE_XML":
      return parseXml(definition, input);
    default:
      return unsupportedParse(definition.classification);
  }
}

export function write(definition: FsdSchema, records: FsdRecordValue[]): FsdWriteResult {
  if (!SUPPORTED.has(definition.classification)) {
    return unsupportedWrite(definition.classification);
  }
  switch (definition.classification) {
    case "DELIMITED":
      return writeDelimited(definition, records);
    case "SINGLE_FIXED":
      return writeFixedWidth(definition, records);
    case "SIMPLE_XML":
      return writeXml(definition, records);
    default:
      return unsupportedWrite(definition.classification);
  }
}
