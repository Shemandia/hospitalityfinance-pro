/**
 * @hfp/tml-engine — Core transformation engine
 *
 * Applies an ordered list of TML rules to an array of FSD-parsed records.
 * Each record is processed independently; per-record errors are captured
 * without aborting the remaining records.
 */

import type {
  TmlDefinition,
  TmlRecord,
  TmlRule,
  TmlMapRule,
  TmlSetRule,
  TmlLookupRule,
  TmlConditionalRule,
  TmlCondition,
  TmlResult,
  TmlRecordError,
  TmlExecutionOptions
} from "./types.js";
import type { Sandbox } from "./sandbox.js";

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Execute a TML transformation on an array of records.
 *
 * @param definition - The TML definition (rules + optional user functions)
 * @param records    - Source records (output of FSD parse)
 * @param sandbox    - Optional sandbox for "transform" rules (required if any transform rules exist)
 * @param options    - Lookup tables and other execution options
 */
export function executeTransformation(
  definition: TmlDefinition,
  records: TmlRecord[],
  sandbox?: Sandbox | null,
  options?: TmlExecutionOptions
): TmlResult {
  const result: TmlResult = {
    records: [],
    errors: [],
    succeeded: 0,
    failed: 0
  };

  for (let ri = 0; ri < records.length; ri++) {
    const source = records[ri]!;
    let output: TmlRecord = {};
    let hasError = false;

    for (let ruleIdx = 0; ruleIdx < definition.rules.length; ruleIdx++) {
      const rule = definition.rules[ruleIdx]!;
      try {
        output = applyRule(rule, source, output, ruleIdx, sandbox, options);
      } catch (err) {
        hasError = true;
        result.errors.push({
          recordIndex: ri,
          ruleIndex: ruleIdx,
          ruleType: rule.type,
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }

    result.records.push(output);
    if (hasError) {
      result.failed++;
    } else {
      result.succeeded++;
    }
  }

  return result;
}

// ── Rule dispatcher ────────────────────────────────────────────────────────

function applyRule(
  rule: TmlRule,
  source: TmlRecord,
  output: TmlRecord,
  ruleIndex: number,
  sandbox?: Sandbox | null,
  options?: TmlExecutionOptions
): TmlRecord {
  switch (rule.type) {
    case "map":
      return applyMap(rule, source, output);
    case "set":
      return applySet(rule, output);
    case "transform":
      return applyTransform(rule, source, output, sandbox);
    case "lookup":
      return applyLookup(rule, source, output, options);
    case "conditional":
      return applyConditional(rule, source, output, ruleIndex, sandbox, options);
    default: {
      const _exhaustive: never = rule;
      throw new Error(`Unknown rule type: ${(rule as TmlRule).type}`);
    }
  }
}

// ── MAP ────────────────────────────────────────────────────────────────────

function applyMap(rule: TmlMapRule, source: TmlRecord, output: TmlRecord): TmlRecord {
  if (rule.sources.length === 0) {
    throw new Error(`map rule for "${rule.target}" has no sources`);
  }

  if (rule.sources.length === 1) {
    const src = rule.sources[0]!;
    const val = source[src.path];
    output[rule.target] = val ?? null;
  } else {
    // Multi-source: concatenate with optional separator
    const parts: string[] = [];
    for (const src of rule.sources) {
      const val = source[src.path];
      parts.push(val != null ? String(val) : "");
    }
    const sep = rule.sources[0]?.separator ?? "";
    output[rule.target] = parts.join(sep);
  }

  return output;
}

// ── SET ────────────────────────────────────────────────────────────────────

function applySet(rule: TmlSetRule, output: TmlRecord): TmlRecord {
  output[rule.target] = rule.value;
  return output;
}

// ── TRANSFORM (delegates to sandbox) ───────────────────────────────────────

function applyTransform(
  rule: {
    type: "transform";
    target: string;
    function: {
      name: string;
      params: { value: string | number; fromSource?: boolean; type?: "string" | "number" }[];
    };
  },
  source: TmlRecord,
  output: TmlRecord,
  sandbox?: Sandbox | null
): TmlRecord {
  if (!sandbox) {
    throw new Error(`transform rule requires a sandbox but none was provided`);
  }

  const resolvedParams: (string | number)[] = [];
  for (const p of rule.function.params) {
    let val: string | number;
    if (p.fromSource) {
      const raw = source[String(p.value)];
      val =
        raw != null
          ? p.type === "number"
            ? Number(raw)
            : String(raw)
          : p.type === "number"
            ? 0
            : "";
    } else {
      val = p.value;
    }
    resolvedParams.push(val);
  }

  const result = sandbox.callFunction(rule.function.name, resolvedParams);
  output[rule.target] = result;
  return output;
}

// ── LOOKUP ─────────────────────────────────────────────────────────────────

function applyLookup(
  rule: TmlLookupRule,
  source: TmlRecord,
  output: TmlRecord,
  options?: TmlExecutionOptions
): TmlRecord {
  if (!options?.lookupTables) {
    throw new Error(
      `lookup rule references table "${rule.table}" but no lookup tables were provided`
    );
  }

  const table = options.lookupTables.get(rule.table);
  if (!table) {
    throw new Error(`lookup table "${rule.table}" not found`);
  }

  // Determine the value to look up
  const sourceField = rule.source ?? rule.target;
  const sourceValue = String(source[sourceField] ?? output[sourceField] ?? "");

  const mapped = table.get(sourceValue);
  if (mapped !== undefined) {
    output[rule.target] = mapped;
  } else {
    const unknown = rule.unknown ?? "fail";
    if (unknown === "copy") {
      output[rule.target] = sourceValue;
    } else {
      throw new Error(`lookup table "${rule.table}" has no entry for "${sourceValue}"`);
    }
  }

  return output;
}

// ── CONDITIONAL ────────────────────────────────────────────────────────────

function applyConditional(
  rule: TmlConditionalRule,
  source: TmlRecord,
  output: TmlRecord,
  _ruleIndex: number,
  sandbox?: Sandbox | null,
  options?: TmlExecutionOptions
): TmlRecord {
  const matches = evaluateCondition(rule.condition, source, output);
  const branch = matches ? rule.then : (rule.else ?? []);

  for (const subRule of branch) {
    output = applyRule(subRule, source, output, -1, sandbox, options);
  }

  return output;
}

function evaluateCondition(cond: TmlCondition, source: TmlRecord, output: TmlRecord): boolean {
  const raw = source[cond.field] ?? output[cond.field];
  const fieldVal = raw != null ? raw : null;
  const compareVal = cond.value;

  switch (cond.operator) {
    case "==":
      return String(fieldVal) === String(compareVal);
    case "!=":
      return String(fieldVal) !== String(compareVal);
    case ">":
      return Number(fieldVal) > Number(compareVal);
    case "<":
      return Number(fieldVal) < Number(compareVal);
    case ">=":
      return Number(fieldVal) >= Number(compareVal);
    case "<=":
      return Number(fieldVal) <= Number(compareVal);
    case "contains":
      return String(fieldVal).includes(String(compareVal));
    case "startsWith":
      return String(fieldVal).startsWith(String(compareVal));
    case "endsWith":
      return String(fieldVal).endsWith(String(compareVal));
    default:
      throw new Error(`Unknown condition operator: ${cond.operator}`);
  }
}
