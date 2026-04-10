/**
 * Profile-level FSD types, errors, and schema validator.
 *
 * These are the wizard-facing types used by the Profile Creation Wizard
 * and auto-detection API. Distinct from the internal engine types in ../types.ts.
 */

export * from "./types.js";
export * from "./errors.js";
export { validateProfileSchema } from "./schema-validator.js";
