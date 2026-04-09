/**
 * @hfp/tml-engine — Type definitions
 *
 * TML (Transformation Markup Language) rules define how FSD-parsed records
 * are transformed before being written to a target system or file.
 */

// ── Record types ───────────────────────────────────────────────────────────

/** A single record as key-value pairs (output of FSD parse). */
export type TmlRecord = Record<string, string | number | boolean | null>;

// ── Rule types ─────────────────────────────────────────────────────────────

/**
 * MAP — rename/copy fields from source to target.
 * Multiple sources are concatenated in order.
 */
export interface TmlMapRule {
  type: "map";
  target: string;
  sources: TmlMapSource[];
}

export interface TmlMapSource {
  path: string;
  /** Separator when concatenating multiple sources (default: "") */
  separator?: string;
}

/**
 * SET — write a constant value to the target field.
 */
export interface TmlSetRule {
  type: "set";
  target: string;
  value: string | number | boolean;
}

/**
 * TRANSFORM — apply a JavaScript function (runs in sandbox).
 */
export interface TmlTransformRule {
  type: "transform";
  target: string;
  function: TmlFunctionRef;
}

export interface TmlFunctionRef {
  name: string;
  params: TmlFunctionParam[];
}

export interface TmlFunctionParam {
  value: string | number;
  /** If true, `value` is a field path to read from the input record. */
  fromSource?: boolean;
  /** Cast hint — "string" or "number". */
  type?: "string" | "number";
}

/**
 * LOOKUP — substitute a value using a lookup table.
 */
export interface TmlLookupRule {
  type: "lookup";
  table: string;
  target: string;
  /** Source field to look up. If omitted, uses the target field's current value. */
  source?: string;
  /** Behaviour when the source value is not found: "fail" (default) or "copy". */
  unknown?: "fail" | "copy";
}

/**
 * CONDITIONAL — if/then/else branching.
 * HFP extension beyond the original SunSystems TML spec.
 */
export interface TmlConditionalRule {
  type: "conditional";
  condition: TmlCondition;
  then: TmlRule[];
  else?: TmlRule[];
}

export interface TmlCondition {
  field: string;
  operator: "==" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "startsWith" | "endsWith";
  value: string | number | boolean;
}

/** Union of all rule types. */
export type TmlRule =
  | TmlMapRule
  | TmlSetRule
  | TmlTransformRule
  | TmlLookupRule
  | TmlConditionalRule;

// ── Definition (top-level) ─────────────────────────────────────────────────

/**
 * A complete TML definition — stored as JSON in
 * transfer_transformations.definition column.
 */
export interface TmlDefinition {
  /** Ordered list of transformation rules. */
  rules: TmlRule[];
  /** User-defined JavaScript functions (name → body). */
  functions?: TmlUserFunction[];
}

export interface TmlUserFunction {
  name: string;
  params: string[];
  body: string;
}

// ── Execution options ──────────────────────────────────────────────────────

export interface TmlExecutionOptions {
  /**
   * Lookup tables: tableName → (sourceValue → targetValue).
   * Required if any rule uses the "lookup" type.
   */
  lookupTables?: Map<string, Map<string, string>>;
  /** Sandbox timeout in milliseconds (default: 2000). */
  sandboxTimeoutMs?: number;
  /** Sandbox memory limit in MB (default: 64). */
  sandboxMemoryMb?: number;
}

// ── Result types ───────────────────────────────────────────────────────────

export interface TmlResult {
  /** Transformed records. */
  records: TmlRecord[];
  /** Per-record errors (record may still appear in records with partial data). */
  errors: TmlRecordError[];
  /** Count of records that transformed without errors. */
  succeeded: number;
  /** Count of records that had at least one error. */
  failed: number;
}

export interface TmlRecordError {
  /** 0-based index of the source record. */
  recordIndex: number;
  /** Which rule failed (0-based index in rules array). */
  ruleIndex: number;
  /** Rule type that failed. */
  ruleType: TmlRule["type"];
  /** Human-readable error message. */
  message: string;
}
