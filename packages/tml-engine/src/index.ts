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

// Compiler (wizard → engine bridge)
export {
  compileMappings,
  type WizardTmlMapping,
  type WizardTmlTransform,
  type WizardTransformType
} from "./compiler.js";

// Sandbox
export {
  createSandbox,
  validateUserFunctions,
  SandboxValidationError,
  SandboxUnavailableError,
  type Sandbox,
  type SandboxOptions
} from "./sandbox.js";

// Pre-built function library
export { BUILTIN_FUNCTIONS_SOURCE, BUILTIN_FUNCTIONS_META } from "./functions.js";
