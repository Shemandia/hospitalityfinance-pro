/**
 * @hfp/fsd-engine
 *
 * Flat-file Schema Definition engine for HFP Transfer Desk.
 *
 * Parses FSD definitions (TypeScript/JSON model) and performs bidirectional
 * conversion between flat files and JSON record arrays. Supports 3 of the 6
 * FSD classifications from the Transfer Desk Technical Specification Module 4:
 *
 *   - DELIMITED        — CSV, TSV, semicolon, custom delimiters
 *   - SINGLE_FIXED     — fixed-width with one record type
 *   - SIMPLE_XML       — GUI-built XML with elements + attributes
 *
 * Not yet supported (sprint 5+):
 *   - MULTIPLE_FIXED   — fixed-width with choice-based record dispatch
 *   - OTHER_FLAT       — arbitrary flat layouts
 *   - USER_XML         — user-authored XML schemas
 *
 * The runtime engine operates on a JSON-native internal model per spec §4.2.
 * FSD XML ↔ JSON conversion is a separate concern handled by the profile
 * wizard / format designer layer; this library takes the internal model in
 * directly.
 *
 * Public surface — imported by the BullMQ worker (Sprint 2) and the format
 * designer UI (sprint 5+):
 *
 *   parse(definition, input)   -> { records, errors }
 *   write(definition, records) -> { output, errors }
 *
 * Plus all internal-model types and the field validator for callers that
 * want to run validation without parsing.
 */

export * from "./types.js";
export * from "./validator.js";
export * from "./parsers/delimited.js";
export * from "./parsers/fixed-width.js";
export * from "./parsers/xml.js";
export { parse, write } from "./api.js";
