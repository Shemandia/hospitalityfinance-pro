/**
 * @hfp/tml-engine — TmlMapping → TmlDefinition compiler
 *
 * Converts the wizard's TmlMapping[] (declarative, per-field mappings with
 * optional transforms) into the engine's TmlDefinition (ordered rule list).
 *
 * This is the bridge between the UI (apps/web) and the engine (packages/tml-engine).
 */

import type {
  TmlDefinition,
  TmlRule,
  TmlMapRule,
  TmlSetRule,
  TmlTransformRule,
  TmlLookupRule,
  TmlUserFunction,
  TmlFunctionParam
} from "./types.js";

// ── Wizard-side types (mirrored from apps/web to avoid cross-package import) ──

export type WizardTransformType =
  | "direct"
  | "lookup"
  | "expression"
  | "function"
  | "concat"
  | "split"
  | "static";

export interface WizardTmlTransform {
  type: WizardTransformType;
  // lookup
  lookupTableId?: string;
  lookupSourceColumn?: string;
  lookupTargetColumn?: string;
  lookupDefaultValue?: string;
  // expression
  expression?: string;
  // function
  functionId?: string;
  functionParams?: Record<string, unknown>;
  // concat
  additionalSources?: string[];
  separator?: string;
  // split
  splitDelimiter?: string;
  splitIndex?: number;
  // static
  staticValue?: string;
}

export interface WizardTmlMapping {
  id: string;
  sourceField: string;
  targetField: string;
  transform: WizardTmlTransform | null;
}

// ── Function ID → sandbox function name mapping ──────────────────────────────

const FUNCTION_ID_TO_NAME: Record<string, string> = {
  fn_trim: "trim",
  fn_upper: "toUpperCase",
  fn_lower: "toLowerCase",
  fn_pad_left: "padLeft",
  fn_pad_right: "padRight",
  fn_date_format: "formatDate",
  fn_number_format: "numberFormat",
  fn_substring: "substring",
  fn_replace: "replace",
  fn_lookup: "lookupValue",
  fn_divide: "divide",
  fn_multiply: "multiply",
  fn_default: "defaultValue",
  fn_concat_fields: "concatFields",
  fn_split_field: "splitField",
  fn_currency_code: "currencyCode",
  fn_account_segment: "accountSegment",
  fn_opera_date: "operaDate",
  fn_jana_amount: "janaAmount",
  fn_simphony_rvc: "simphonyRvc",
  fn_usali_map: "usaliMap",
  fn_entity_code: "entityCode",
  fn_tax_extract: "taxExtract"
};

// ── Wizard param key → positional order for each function ───────────────────
// After the source value (always first), remaining params are ordered by this list.
// Keys not in the list are appended in their original order.
const FUNCTION_PARAM_ORDER: Record<string, string[]> = {
  fn_pad_left: ["length", "char"],
  fn_pad_right: ["length", "char"],
  fn_date_format: ["inputFormat", "outputFormat"],
  fn_number_format: ["decimals", "thousandsSep", "decimalSep"],
  fn_substring: ["start", "end"],
  fn_replace: ["search", "replacement"],
  fn_divide: ["divisor"],
  fn_multiply: ["multiplier"],
  fn_tax_extract: ["rate", "mode"]
};

// ── Compiler ─────────────────────────────────────────────────────────────────

/**
 * Compile wizard TmlMapping[] into engine TmlDefinition.
 *
 * @param mappings - Array of wizard-format mappings from Step 3
 * @returns TmlDefinition ready for executeTransformation()
 */
export function compileMappings(mappings: WizardTmlMapping[]): TmlDefinition {
  const rules: TmlRule[] = [];
  const userFunctions: TmlUserFunction[] = [];
  let exprCounter = 0;

  for (const mapping of mappings) {
    const transform = mapping.transform;
    const target = mapping.targetField;
    const source = mapping.sourceField;

    if (!transform || transform.type === "direct") {
      // Direct copy: source → target
      rules.push(compileDirectMapping(source, target));
    } else {
      switch (transform.type) {
        case "static":
          rules.push(compileStaticMapping(target, transform));
          break;

        case "lookup":
          rules.push(compileLookupMapping(source, target, transform));
          break;

        case "expression": {
          const fnName = `__expr_${exprCounter++}`;
          const { rule, userFunction } = compileExpressionMapping(
            source,
            target,
            transform,
            fnName
          );
          rules.push(rule);
          userFunctions.push(userFunction);
          break;
        }

        case "function":
          rules.push(compileFunctionMapping(source, target, transform));
          break;

        case "concat":
          rules.push(compileConcatMapping(source, target, transform));
          break;

        case "split":
          rules.push(compileSplitMapping(source, target, transform));
          break;

        default:
          // Unknown transform type — fall back to direct copy
          rules.push(compileDirectMapping(source, target));
          break;
      }
    }
  }

  return {
    rules,
    functions: userFunctions.length > 0 ? userFunctions : undefined
  };
}

// ── Compilation helpers ──────────────────────────────────────────────────────

function compileDirectMapping(source: string, target: string): TmlMapRule {
  return {
    type: "map",
    target,
    sources: [{ path: source }]
  };
}

function compileStaticMapping(target: string, transform: WizardTmlTransform): TmlSetRule {
  const value = transform.staticValue ?? "";
  // Try to parse as number if it looks numeric
  const num = Number(value);
  if (value !== "" && !isNaN(num) && String(num) === value) {
    return { type: "set", target, value: num };
  }
  // Try to parse as boolean
  if (value === "true") return { type: "set", target, value: true };
  if (value === "false") return { type: "set", target, value: false };
  return { type: "set", target, value };
}

function compileLookupMapping(
  source: string,
  target: string,
  transform: WizardTmlTransform
): TmlLookupRule {
  return {
    type: "lookup",
    table: transform.lookupTableId ?? "",
    target,
    source: source !== "__static__" ? source : undefined,
    unknown: transform.lookupDefaultValue ? "copy" : "fail"
  };
}

function compileExpressionMapping(
  source: string,
  target: string,
  transform: WizardTmlTransform,
  fnName: string
): { rule: TmlTransformRule; userFunction: TmlUserFunction } {
  const expression = transform.expression ?? "value";
  const userFunction: TmlUserFunction = {
    name: fnName,
    params: ["value"],
    body: `return (${expression});`
  };

  const rule: TmlTransformRule = {
    type: "transform",
    target,
    function: {
      name: fnName,
      params: [{ value: source, fromSource: true }]
    }
  };

  return { rule, userFunction };
}

function compileFunctionMapping(
  source: string,
  target: string,
  transform: WizardTmlTransform
): TmlTransformRule {
  const functionId = transform.functionId ?? "";
  const sandboxName = FUNCTION_ID_TO_NAME[functionId] ?? functionId;
  const fnParams = transform.functionParams ?? {};

  // Build params: first param is always the source field value
  const params: TmlFunctionParam[] = [];

  if (source !== "__static__") {
    params.push({ value: source, fromSource: true });
  }

  // Add function-specific params in the correct positional order
  const paramOrder = FUNCTION_PARAM_ORDER[functionId];
  const orderedEntries = paramOrder
    ? sortEntriesByOrder(Object.entries(fnParams), paramOrder)
    : Object.entries(fnParams);

  for (const [_key, val] of orderedEntries) {
    if (typeof val === "number") {
      params.push({ value: val });
    } else if (typeof val === "object") {
      // JSON-encode objects (e.g., mapping tables)
      params.push({ value: JSON.stringify(val) });
    } else {
      params.push({ value: String(val ?? "") });
    }
  }

  return {
    type: "transform",
    target,
    function: {
      name: sandboxName,
      params
    }
  };
}

function compileConcatMapping(
  source: string,
  target: string,
  transform: WizardTmlTransform
): TmlTransformRule {
  const additional = transform.additionalSources ?? [];
  const separator = transform.separator ?? "";

  // Build params: all source fields + separator as last arg
  const params: TmlFunctionParam[] = [];

  if (source !== "__static__") {
    params.push({ value: source, fromSource: true });
  }
  for (const field of additional) {
    params.push({ value: field, fromSource: true });
  }
  params.push({ value: separator });

  return {
    type: "transform",
    target,
    function: {
      name: "concatFields",
      params
    }
  };
}

function compileSplitMapping(
  source: string,
  target: string,
  transform: WizardTmlTransform
): TmlTransformRule {
  const delimiter = transform.splitDelimiter ?? ",";
  const index = transform.splitIndex ?? 0;

  return {
    type: "transform",
    target,
    function: {
      name: "splitField",
      params: [{ value: source, fromSource: true }, { value: delimiter }, { value: index }]
    }
  };
}

// ── Utility ─────────────────────────────────────────────────────────────────

function sortEntriesByOrder(entries: [string, unknown][], order: string[]): [string, unknown][] {
  const map = new Map(entries);
  const result: [string, unknown][] = [];
  for (const key of order) {
    if (map.has(key)) {
      result.push([key, map.get(key)]);
      map.delete(key);
    }
  }
  // Append any remaining entries not in the order list
  for (const [key, val] of map) {
    result.push([key, val]);
  }
  return result;
}
