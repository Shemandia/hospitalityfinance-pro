/**
 * @hfp/tml-engine — Transformation Markup Language engine
 *
 * Applies TML rules (map, set, transform, lookup, conditional) to
 * FSD-parsed records and returns transformed output with per-record errors.
 */

// Types
export type {
  TmlRecord,
  TmlMapRule,
  TmlMapSource,
  TmlSetRule,
  TmlTransformRule,
  TmlFunctionRef,
  TmlFunctionParam,
  TmlLookupRule,
  TmlConditionalRule,
  TmlCondition,
  TmlRule,
  TmlDefinition,
  TmlUserFunction,
  TmlExecutionOptions,
  TmlResult,
  TmlRecordError
} from "./types.js";

// Engine
export { executeTransformation } from "./engine.js";

// Sandbox
export { createSandbox, type Sandbox, type SandboxOptions } from "./sandbox.js";

// Pre-built function library
export { BUILTIN_FUNCTIONS_SOURCE, BUILTIN_FUNCTIONS_META } from "./functions.js";
