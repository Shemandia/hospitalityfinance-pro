/**
 * Profile-level XML/SSML parser.
 *
 * Handles SunSystems .SUN files and general XML imports. Uses
 * fast-xml-parser to convert XML → JS object, then extracts fields
 * using the simple dot-path `xmlPath` on each field definition.
 *
 * Structure:
 *   - `format.xmlRootElement` names the repeating record element
 *     (e.g. "TRANSACTION"). Each child of the document root that
 *     matches this name = one row.
 *   - `field.xmlPath` is a dot-separated path relative to each
 *     record element (e.g. "HEADER.DATE", "AMOUNT").
 *
 * Supports:
 *   - Nested elements via dot-path traversal
 *   - decimalDivisor applied only when explicitly set
 *   - skipBlankRows (all extracted fields empty)
 *   - maxErrors abort
 *   - Reuses coerceAndValidate from shared.ts
 */

import { XMLParser } from "fast-xml-parser";
import { FSD_ERROR } from "../profile/errors.js";
import type {
  ProfileFsdSchema,
  ProfileFsdFieldError,
  ProfileFsdParseResult,
  ProfileFsdRawRow
} from "../profile/types.js";
import { coerceAndValidate, makeError, abortResult } from "./shared.js";

// ── Public API ────────────────────────────────────────────────────────────

export function parseXmlSsml(schema: ProfileFsdSchema, input: string): ProfileFsdParseResult {
  const rootElement = schema.format.xmlRootElement;
  const skipBlankRows = schema.options?.skipBlankRows !== false;
  const maxErrors = schema.options?.maxErrors ?? 100;

  if (!rootElement) {
    return {
      rows: [],
      errors: [
        makeError(
          0,
          "",
          FSD_ERROR.SCHEMA_INVALID,
          "XML/SSML schema requires format.xmlRootElement.",
          null
        )
      ],
      aborted: false,
      rowCount: 0,
      skippedRows: 0
    };
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    // Force the record element into an array even when there's only one
    isArray: (_name, jpath) => {
      // Match any path that ends with the root element name
      // e.g. "SSC.TRANSACTION" or just "TRANSACTION" at top level
      if (typeof jpath !== "string") return false;
      const parts = jpath.split(".");
      return parts[parts.length - 1] === rootElement;
    }
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(input) as Record<string, unknown>;
  } catch (err) {
    return {
      rows: [],
      errors: [
        makeError(
          0,
          "",
          FSD_ERROR.SCHEMA_INVALID,
          `Failed to parse XML: ${(err as Error).message}`,
          null
        )
      ],
      aborted: false,
      rowCount: 0,
      skippedRows: 0
    };
  }

  // Find the record array — it may be nested under an envelope element
  const recordArray = findRecordArray(parsed, rootElement);

  if (!recordArray) {
    return {
      rows: [],
      errors: [
        makeError(
          0,
          "",
          FSD_ERROR.SCHEMA_INVALID,
          `No <${rootElement}> elements found in the XML document.`,
          null
        )
      ],
      aborted: false,
      rowCount: 0,
      skippedRows: 0
    };
  }

  const rows: ProfileFsdRawRow[] = [];
  const errors: ProfileFsdFieldError[] = [];
  let skippedRows = 0;

  for (let r = 0; r < recordArray.length; r++) {
    const recordNode = recordArray[r];

    if (!recordNode || typeof recordNode !== "object") {
      skippedRows++;
      continue;
    }

    const node = recordNode as Record<string, unknown>;

    // Extract all field values first to check for blank row
    const extracted: Array<{ rawValue: string; field: (typeof schema.fields)[number] }> = [];
    let allEmpty = true;

    for (const field of schema.fields) {
      if (field.ignoreField) continue;

      const xmlPath = field.xmlPath;
      if (!xmlPath) {
        continue;
      }

      const raw = resolveDotPath(node, xmlPath);
      const strVal = raw === null || raw === undefined ? "" : String(raw);
      const trimmed = field.trimWhitespace !== false ? strVal.trim() : strVal;

      extracted.push({ rawValue: trimmed, field });
      if (trimmed !== "") allEmpty = false;
    }

    // Blank-row detection
    if (skipBlankRows && allEmpty) {
      skippedRows++;
      continue;
    }

    const rowIndex = rows.length;
    const parsedRow: ProfileFsdRawRow = { rowIndex, fields: {} };

    for (const { rawValue, field } of extracted) {
      const fieldErrors: ProfileFsdFieldError[] = [];
      const parsedValue = coerceAndValidate(rawValue, field, rowIndex, fieldErrors);

      errors.push(...fieldErrors);
      parsedRow.fields[field.name] = {
        rawValue,
        parsedValue,
        mappedPath: field.target,
        errors: fieldErrors
      };

      if (errors.length >= maxErrors) {
        rows.push(parsedRow);
        return abortResult(rows, errors, rowIndex + 1, skippedRows);
      }
    }

    // Handle fields without xmlPath — report error if required
    for (const field of schema.fields) {
      if (field.ignoreField) continue;
      if (field.xmlPath) continue; // already handled
      if (parsedRow.fields[field.name]) continue;

      if (field.required) {
        const fieldErr = makeError(
          rowIndex,
          field.name,
          FSD_ERROR.REQUIRED_MISSING,
          `Required field "${field.name}" has no xmlPath defined.`,
          undefined
        );
        errors.push(fieldErr);
        parsedRow.fields[field.name] = {
          rawValue: "",
          parsedValue: undefined,
          mappedPath: field.target,
          errors: [fieldErr]
        };

        if (errors.length >= maxErrors) {
          rows.push(parsedRow);
          return abortResult(rows, errors, rowIndex + 1, skippedRows);
        }
      }
    }

    rows.push(parsedRow);
  }

  return {
    rows,
    errors,
    aborted: false,
    rowCount: rows.length,
    skippedRows
  };
}

// ── Dot-Path Traversal ────────────────────────────────────────────────────

/**
 * Resolve a dot-separated path against an object tree.
 * E.g. "HEADER.DATE" on { HEADER: { DATE: "2026-01-01" } } → "2026-01-01"
 */
function resolveDotPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ── Record Discovery ──────────────────────────────────────────────────────

/**
 * Find the array of record elements in the parsed XML tree.
 * Handles both direct children (flat XML) and nested envelopes
 * (e.g. <SSC><TRANSACTION>...</TRANSACTION></SSC>).
 */
function findRecordArray(parsed: Record<string, unknown>, rootElement: string): unknown[] | null {
  // Direct child
  if (rootElement in parsed) {
    const val = parsed[rootElement];
    return Array.isArray(val) ? val : val !== undefined ? [val] : null;
  }

  // Search one level deep (envelope element like <SSC>)
  for (const key of Object.keys(parsed)) {
    const child = parsed[key];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const inner = (child as Record<string, unknown>)[rootElement];
      if (inner !== undefined) {
        return Array.isArray(inner) ? inner : [inner];
      }
    }
  }

  return null;
}
