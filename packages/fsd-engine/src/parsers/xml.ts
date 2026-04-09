/**
 * SIMPLE_XML parser + writer.
 *
 * Supports the spec's SIMPLE_XML classification: a single root element
 * wrapping one or more repeated record elements, with each record's
 * fields mapped to either child elements or attributes.
 *
 * Per spec §4.1 SIMPLE_XML notes: supports elements, attributes, and
 * occurrences. This engine does not support XSD import or namespaces
 * in Phase A (spec says those are GUI-builder features).
 *
 * Schema shape for SIMPLE_XML:
 *   schema.xmlRoot                → root element name (e.g. "Transactions")
 *   schema.record.xmlName | .name → record element name (e.g. "Transaction")
 *   field.xmlAttribute            → if true, field is read/written as an
 *                                    attribute of the record element
 *   field.xmlName | .name         → element/attribute name within the record
 */

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import {
  type FsdField,
  type FsdParseError,
  type FsdParseResult,
  type FsdRecordValue,
  type FsdSchema,
  type FsdWriteResult
} from "../types.js";
import { validateField } from "../validator.js";

const ATTR_PREFIX = "@_";
const TEXT_NODE = "#text";

type RootCheck =
  | { ok: true; root: string; recordName: string }
  | { ok: false; error: FsdParseError };

function requireRoot(definition: FsdSchema): RootCheck {
  if (!definition.record) {
    return {
      ok: false,
      error: {
        line: null,
        recordIndex: null,
        field: null,
        code: "SCHEMA_MISSING_RECORD",
        message: "SIMPLE_XML schema requires a top-level record definition"
      }
    };
  }
  if (!definition.xmlRoot) {
    return {
      ok: false,
      error: {
        line: null,
        recordIndex: null,
        field: null,
        code: "SCHEMA_MISSING_XML_ROOT",
        message: "SIMPLE_XML schema requires an xmlRoot name"
      }
    };
  }
  return {
    ok: true,
    root: definition.xmlRoot,
    recordName: definition.record.xmlName ?? definition.record.name
  };
}

function fieldXmlName(field: FsdField): string {
  return field.xmlName ?? field.name;
}

/**
 * Extract a plain string from a fast-xml-parser node. Nodes come through as
 * either a primitive (we asked for strings via parseTagValue=false), an
 * object with #text, or undefined.
 */
function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (typeof node === "object") {
    const t = (node as Record<string, unknown>)[TEXT_NODE];
    if (typeof t === "string") return t;
    if (typeof t === "number" || typeof t === "boolean") return String(t);
  }
  return "";
}

export function parseXml(definition: FsdSchema, input: string): FsdParseResult {
  const errors: FsdParseError[] = [];
  const records: FsdRecordValue[] = [];

  const check = requireRoot(definition);
  if (!check.ok) {
    return { records, errors: [check.error] };
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    // Force arrays for the record element so single-record and many-record
    // inputs produce the same shape.
    isArray: (_name, jpath) => jpath === `${check.root}.${check.recordName}`
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(input) as Record<string, unknown>;
  } catch (err) {
    return {
      records,
      errors: [
        {
          line: null,
          recordIndex: null,
          field: null,
          code: "XML_PARSE_ERROR",
          message: `Failed to parse XML: ${(err as Error).message}`
        }
      ]
    };
  }

  const rootNode = parsed[check.root];
  if (!rootNode || typeof rootNode !== "object") {
    return {
      records,
      errors: [
        {
          line: null,
          recordIndex: null,
          field: null,
          code: "XML_ROOT_NOT_FOUND",
          message: `XML root element <${check.root}> not found`
        }
      ]
    };
  }

  const rawRecords = (rootNode as Record<string, unknown>)[check.recordName];
  const recordArray: unknown[] = Array.isArray(rawRecords)
    ? rawRecords
    : rawRecords !== undefined
      ? [rawRecords]
      : [];

  const recordFields = definition.record!.fields;

  for (let r = 0; r < recordArray.length; r++) {
    const recordNode = recordArray[r];
    const recordIndex = records.length;
    const parsedRecord: FsdRecordValue = {};

    if (!recordNode || typeof recordNode !== "object") {
      errors.push({
        line: null,
        recordIndex,
        field: null,
        code: "XML_RECORD_NOT_OBJECT",
        message: `Record ${recordIndex} is not an XML element`
      });
      records.push(parsedRecord);
      continue;
    }
    const node = recordNode as Record<string, unknown>;

    for (const field of recordFields) {
      const xmlName = fieldXmlName(field);
      const lookupKey = field.xmlAttribute ? `${ATTR_PREFIX}${xmlName}` : xmlName;
      const raw = textOf(node[lookupKey]);
      const result = validateField({
        field,
        rawValue: raw,
        line: null,
        recordIndex
      });
      errors.push(...result.errors);
      if (field.output === false) continue;
      parsedRecord[field.name] = result.value === undefined ? raw : result.value;
    }
    records.push(parsedRecord);
  }

  return { records, errors };
}

// ── Writer ──────────────────────────────────────────────────────────────────

function stringifyValue(value: FsdRecordValue[string] | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function writeXml(definition: FsdSchema, records: FsdRecordValue[]): FsdWriteResult {
  const errors: FsdParseError[] = [];

  const check = requireRoot(definition);
  if (!check.ok) {
    return { output: "", errors: [check.error] };
  }

  const recordFields = definition.record!.fields;
  const recordNodes: Record<string, unknown>[] = [];

  for (let r = 0; r < records.length; r++) {
    const rec = records[r]!;
    const node: Record<string, unknown> = {};
    for (const field of recordFields) {
      const xmlName = fieldXmlName(field);
      let value: string;
      if (field.output === false) {
        value = field.validValue && field.validValue.length > 0 ? field.validValue[0]! : "";
      } else {
        value = stringifyValue(rec[field.name]);
      }
      if (value === "" && field.outputIfEmpty === false) continue;
      if (field.xmlAttribute) {
        node[`${ATTR_PREFIX}${xmlName}`] = value;
      } else {
        node[xmlName] = value;
      }
    }
    recordNodes.push(node);
  }

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: ATTR_PREFIX,
    format: true,
    suppressEmptyNode: false
  });

  const doc: Record<string, unknown> = {
    [check.root]: {
      [check.recordName]: recordNodes
    }
  };
  const output = builder.build(doc) as string;
  return { output, errors };
}
