# HFP — Sprint 4 Session A: FSD Engine

## `packages/fsd-engine/`

---

## 1. Context & Purpose

HospitalityFinancePro (HFP) is a multi-tenant SaaS financial platform for hospitality, built as a
spiritual successor to Infor SunSystems. The **FSD Engine** (Format Schema Definition) is the core
parsing, validation, and serialisation layer for the Transfer Desk module.

Every data exchange in Transfer Desk — import from Opera PMS, export to Sky Jana MMS, internal GL
transfers, external bank reconciliations — flows through an FSD schema. The engine must be rock-solid
before the Profile Creation Wizard UI (Session B) or the BullMQ worker (Sprint 3 skeleton) can be
completed.

---

## 2. What is FSD?

An **FSD (Format Schema Definition)** is a JSON document stored in the database
(`transfer_profiles.fsd_schema` column, `jsonb`) that describes:

- The **file format** of an inbound or outbound file (CSV, TSV, fixed-width TXT, XLSX, XML/SSML `.SUN`)
- The **field layout** — column names, positions, data types, validation rules
- The **mapping** from raw source fields → HFP canonical fields (dot-notation)
- **Transformation hints** used by the TML engine (a separate concern — do NOT build TML here)

The FSD engine's job is to:

1. **Parse** a raw file buffer → structured row array using the schema
2. **Validate** each row against field rules → annotated error list
3. **Serialise** a structured row array → raw file buffer (for exports)
4. **Detect** file format from a sample buffer (used by the auto-detection wizard)

---

## 3. Profile Types

There are five Transfer Desk profile types. FSD schemas exist for all five.

| Type                | Direction | Description                                 |
| ------------------- | --------- | ------------------------------------------- |
| `IMPORT`            | Inbound   | Parse external file → HFP journal / voucher |
| `EXPORT`            | Outbound  | Serialise HFP data → external file          |
| `INTERNAL_TRANSFER` | Both      | GL-to-GL movement within HFP                |
| `EXTERNAL_TRANSFER` | Both      | Cross-system sync (Opera, Jana, bank)       |
| `PROCESS`           | Internal  | Transformation pipeline, no file I/O        |

For this session, focus on `IMPORT` and `EXPORT` — these are the file I/O types that exercise the
full parse/validate/serialise cycle. `INTERNAL_TRANSFER`, `EXTERNAL_TRANSFER`, and `PROCESS` schemas
follow the same structure but with fewer file-format concerns.

---

## 4. FSD Schema Structure (JSON)

```typescript
interface FsdSchema {
  version: "1.0";
  format: FsdFormat;
  fields: FsdField[];
  options?: FsdOptions;
}

interface FsdFormat {
  type: "csv" | "tsv" | "fixed" | "xlsx" | "xml_ssml";
  delimiter?: string; // csv/tsv only; default "," for csv, "\t" for tsv
  quoteChar?: string; // csv/tsv only; default '"'
  escapeChar?: string; // csv/tsv only; default '"' (doubled-quote convention)
  hasHeaderRow?: boolean; // csv/tsv/xlsx; default true
  sheetIndex?: number; // xlsx only; default 0
  encoding?: string; // default "utf-8"; "latin1" common for SunSystems exports
  lineEnding?: "CRLF" | "LF"; // serialise only; default "CRLF" (SunSystems compat)
  fixedRecordLength?: number; // fixed-width only; bytes per record
  xmlRootElement?: string; // xml_ssml only; e.g. "TRANSACTION"
}

interface FsdField {
  name: string; // Raw source column name or fixed-width field name
  target: string; // Dot-notation HFP canonical path e.g. "journal.lines[].account"
  type: FsdFieldType;
  required?: boolean; // default false
  defaultValue?: unknown; // used when field missing and not required
  // Position — use ONE of:
  columnIndex?: number; // csv/tsv/xlsx: 0-based column index
  columnName?: string; // csv/tsv/xlsx: header name (used when hasHeaderRow=true)
  fixedStart?: number; // fixed-width: 0-based char offset
  fixedLength?: number; // fixed-width: field length in chars
  xmlPath?: string; // xml_ssml: XPath relative to root element
  // Validation
  maxLength?: number;
  minLength?: number;
  pattern?: string; // regex string
  allowedValues?: string[]; // enum constraint
  // Numeric
  decimalDivisor?: number; // e.g. 1000 for Jana internal movements (÷1000 rule)
  precision?: number; // decimal places for output
  // Date/time
  dateFormat?: string; // dayjs-compatible format string e.g. "DD/MM/YYYY"
  // Special
  trimWhitespace?: boolean; // default true
  ignoreField?: boolean; // parse but do not map to target (audit/passthrough)
}

type FsdFieldType =
  | "string"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "currency" // decimal with currency-aware formatting
  | "account" // validated against COA — validation only, no external calls needed here
  | "enum";

interface FsdOptions {
  skipBlankRows?: boolean; // default true
  skipRowsBeforeHeader?: number; // fixed-width/xlsx: rows to skip before header
  maxErrors?: number; // abort parse after N errors; default 100
  strictMode?: boolean; // if true, unknown columns are errors; default false
  outputNullAs?: string; // serialise null fields as this string; default ""
}
```

---

## 5. Dot-Notation Canonical Field Paths

HFP uses dot-notation (not SunSystems slash-notation) for field mapping. Examples:

```
journal.reference
journal.date
journal.currency
journal.lines[].account
journal.lines[].debit
journal.lines[].credit
journal.lines[].description
journal.lines[].analysis.dim1
journal.lines[].analysis.dim2
payment.supplier
payment.amount
payment.bank_account
```

The `[]` in a path means the field repeats per row and maps into an array. The engine does NOT need
to assemble the full canonical object graph — that is the TML engine's job. The FSD engine just
annotates each parsed row with `{ rawValue, mappedPath, parsedValue, errors[] }`.

---

## 6. Parsing Rules

### CSV / TSV

- Use `csv-parse` library (already in monorepo dependencies)
- Handle BOM (`\uFEFF`) stripping
- When `hasHeaderRow=true`, map fields by `columnName`; fall back to `columnIndex`
- When `hasHeaderRow=false`, map fields by `columnIndex` only
- Empty rows (all fields blank or whitespace): skip if `skipBlankRows=true`

### Fixed-Width TXT

- Read line-by-line
- Extract each field by `fixedStart` + `fixedLength` char slice
- Pad or truncate on serialise to exactly `fixedLength` chars

### XLSX

- Use `exceljs` library
- Read sheet at `sheetIndex`
- Skip `skipRowsBeforeHeader` rows before treating a row as the header
- Dates: exceljs returns JS Date objects — convert using `dateFormat`

### XML / SSML (`.SUN`)

- Use `fast-xml-parser` library
- Root element defined by `xmlRootElement`
- Each child element matching that tag = one row
- `xmlPath` is relative XPath from the root element (simple dot paths only, no predicates)
- SunSystems SSML stores amounts as signed integers in minor units — apply `decimalDivisor` where specified

---

## 7. Validation Rules

Each field validation returns zero or more `FsdFieldError`:

```typescript
interface FsdFieldError {
  rowIndex: number; // 0-based
  fieldName: string;
  errorCode: FsdErrorCode;
  message: string;
  rawValue: unknown;
}

type FsdErrorCode =
  | "REQUIRED_MISSING"
  | "TYPE_MISMATCH"
  | "MAX_LENGTH_EXCEEDED"
  | "MIN_LENGTH_VIOLATED"
  | "PATTERN_MISMATCH"
  | "VALUE_NOT_IN_ALLOWED"
  | "INVALID_DATE_FORMAT"
  | "DECIMAL_PRECISION_ERROR"
  | "UNKNOWN_COLUMN" // strictMode only
  | "SCHEMA_INVALID"; // schema itself is malformed
```

Validation runs AFTER type coercion. Stop collecting errors for a single field after the first error
(fail-fast per field). Continue to next field.

Abort entire parse (throw `FsdAbortError`) if `errors.length >= options.maxErrors`.

---

## 8. Serialisation Rules

Serialisation = structured rows → file buffer. Mirrors parsing.

- Apply `decimalDivisor` in reverse (multiply) for currency fields on output
- Format dates using `dateFormat`
- Null/undefined fields → `options.outputNullAs` (default `""`)
- Fixed-width: right-pad strings, right-align numbers within `fixedLength`
- CSV: always quote fields containing delimiter, quote char, or newlines
- XLSX: write as `.xlsx` buffer using exceljs, return as `Buffer`
- XML/SSML: build elements using `fast-xml-parser` builder

---

## 9. Auto-Detection (for Wizard)

`detectFormat(sampleBuffer: Buffer, hint?: Partial<FsdFormat>): FsdFormatDetectionResult`

```typescript
interface FsdFormatDetectionResult {
  confidence: number; // 0–1
  detectedFormat: FsdFormat;
  detectedFields: Array<{
    name: string;
    sampleValues: string[];
    suggestedType: FsdFieldType;
  }>;
  warnings: string[];
}
```

Detection heuristics (in order):

1. If starts with `<?xml` or `<TRANSACTION` → `xml_ssml`
2. If first bytes are PK ZIP magic → `xlsx`
3. Count tab characters in first 5 lines; if avg > 3 → `tsv`
4. Count comma characters in first 5 lines; if avg > 3 → `csv`
5. Check if line lengths are consistent (±2 chars) across first 10 lines → `fixed`
6. Default → `csv` with confidence 0.3

For CSV/TSV: attempt header row detection by checking if first row has no numeric fields.
For each detected field, suggest `FsdFieldType` based on sample values:

- All values match ISO date pattern → `date`
- All values are numeric with decimal → `decimal`
- All values are integer-like → `integer`
- Otherwise → `string`

---

## 10. Engine Public API

```typescript
// packages/fsd-engine/src/index.ts

export class FsdEngine {
  // Validate an FSD schema document itself (not data)
  validateSchema(schema: FsdSchema): FsdSchemaValidationResult;

  // Parse a file buffer using a schema
  parse(buffer: Buffer, schema: FsdSchema): Promise<FsdParseResult>;

  // Validate already-parsed rows (can be called after parse())
  validate(rows: FsdRawRow[], schema: FsdSchema): FsdValidationResult;

  // Serialise structured rows to a file buffer
  serialise(rows: FsdStructuredRow[], schema: FsdSchema): Promise<Buffer>;

  // Auto-detect format from a sample
  detectFormat(sample: Buffer, hint?: Partial<FsdFormat>): FsdFormatDetectionResult;
}

interface FsdParseResult {
  rows: FsdRawRow[];
  errors: FsdFieldError[];
  aborted: boolean; // true if maxErrors exceeded
  rowCount: number;
  skippedRows: number;
}

interface FsdRawRow {
  rowIndex: number;
  fields: Record<
    string,
    {
      rawValue: string;
      parsedValue: unknown;
      mappedPath: string; // dot-notation target
      errors: FsdFieldError[];
    }
  >;
}
```

---

## 11. Known Real-World Quirks (reference only)

> **CRITICAL ENGINE RULE: `decimalDivisor` is ALWAYS opt-in per field.**
> The engine NEVER assumes, infers, or defaults a divisor based on source system, file type,
> journal type, or any other context. If `decimalDivisor` is not explicitly set on a field in
> the schema JSON, the raw numeric value is used as-is. No exceptions.
>
> The table below documents real-world examples to guide profile authors when configuring
> schemas. It is NOT behaviour the engine implements automatically.

| Source System                  | Field         | Quirk                            | Schema Config                                  |
| ------------------------------ | ------------- | -------------------------------- | ---------------------------------------------- |
| Sky Jana — Internal Movements  | Amount fields | Stored as integer × 1000         | `decimalDivisor: 1000` on those fields         |
| Sky Jana — Purchasing Vouchers | Amount fields | Whole integers, TZS zero-decimal | No `decimalDivisor` (omit entirely)            |
| Sky Jana — Any other file type | Amount fields | Depends on export settings       | Profile author must verify and set accordingly |
| Opera PMS Night Audit          | Amount fields | Stored as integer × 1000         | `decimalDivisor: 1000` on those fields         |
| Opera PMS — Other file types   | Amount fields | May or may not use ÷1000         | Profile author must verify                     |
| SunSystems SSML                | File format   | `.SUN` is XML in SSML envelope   | `type: "xml_ssml"`                             |
| SunSystems exports             | Encoding      | Often `latin1`, CRLF endings     | `encoding: "latin1"`                           |
| All Opera files                | Dates         | Format varies by property config | Set `dateFormat` explicitly per profile        |
| Any custom file                | Any field     | No divisor needed                | Omit `decimalDivisor` — value used as-is       |

**The Jana journal type distinction** (`PURCH`/`PURVCH` vs `INTMOV`/`INVDIFF`) determines
which divisor rule applies. This detection belongs in the **calling code or TML engine**,
which selects the correct pre-configured FSD schema for the job. The FSD engine receives
an already-configured schema and executes it blindly — it does not inspect journal types
or make any runtime decisions about divisors.

---

## 12. Dependencies

These are already available in the monorepo. Do NOT add alternatives.

```json
{
  "csv-parse": "^5.x",
  "fast-xml-parser": "^4.x",
  "exceljs": "^4.x",
  "dayjs": "^1.x"
}
```

Dev dependencies:

```json
{
  "vitest": "^1.x",
  "@types/node": "^20.x"
}
```

---

## 13. Package Structure

```
packages/fsd-engine/
  src/
    index.ts              ← FsdEngine class (public API)
    schema-validator.ts   ← validateSchema()
    parsers/
      csv.ts              ← CSV + TSV parser
      fixed.ts            ← Fixed-width parser
      xlsx.ts             ← XLSX parser
      xml-ssml.ts         ← XML/SSML parser
    serialisers/
      csv.ts
      fixed.ts
      xlsx.ts
      xml-ssml.ts
    validator.ts          ← Row-level field validation
    detector.ts           ← detectFormat()
    types.ts              ← All interfaces/types exported
    errors.ts             ← FsdAbortError, error code constants
  tests/
    schema-validator.test.ts
    parsers/
      csv.test.ts
      fixed.test.ts
      xlsx.test.ts
      xml-ssml.test.ts
    serialisers/
      csv.test.ts
    validator.test.ts
    detector.test.ts
    fixtures/             ← Sample files for tests
      sample.csv
      sample.tsv
      sample_fixed.txt
      sample_ssml.SUN
  package.json
  tsconfig.json
  vitest.config.ts
```

---

## 14. Vitest Test Requirements

Every test file must cover:

### `csv.test.ts`

- Parse CSV with header row
- Parse CSV without header row (columnIndex mapping)
- BOM stripping
- Quoted fields containing delimiter
- Skip blank rows
- `maxErrors` abort
- Encoding: latin1

### `fixed.test.ts`

- Parse fixed-width with known record length
- Field extraction by `fixedStart` + `fixedLength`
- Serialise back to exact same bytes (round-trip)

### `xlsx.test.ts`

- Parse XLSX sheet 0
- `skipRowsBeforeHeader` skips correctly
- Date fields returned as parsed JS Date

### `xml-ssml.test.ts`

- Parse `.SUN` SSML XML
- `xmlPath` extraction
- `decimalDivisor: 1000` applied

### `validator.test.ts`

- `REQUIRED_MISSING` for absent required field
- `TYPE_MISMATCH` for non-numeric in integer field
- `PATTERN_MISMATCH` for regex violation
- `VALUE_NOT_IN_ALLOWED` for enum violation
- `INVALID_DATE_FORMAT` for unparseable date
- `UNKNOWN_COLUMN` in strictMode

### `detector.test.ts`

- CSV detection from sample
- TSV detection (tabs)
- XLSX detection (PK magic bytes)
- XML detection
- Field type suggestion: integer, decimal, date, string

### `schema-validator.test.ts`

- Valid schema passes
- Missing `version` fails with `SCHEMA_INVALID`
- Field with neither `columnIndex` nor `columnName` for csv type fails
- Unknown `type` in FsdFormat fails

---

## 15. What NOT to Build in This Session

| Out of Scope                 | Reason                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| TML transformation engine    | Separate package `packages/tml-engine/`                                                        |
| BullMQ job execution         | Already scaffolded in Sprint 3 worker                                                          |
| Profile database CRUD        | API layer, not engine                                                                          |
| COA account existence lookup | Requires DB connection — FSD only marks field as `account` type, validation is structural only |
| UI / wizard                  | Session B                                                                                      |
| Multi-tenant context         | Engine is stateless; tenant context injected by caller                                         |

---

## 16. Definition of Done

- [ ] All five parsers implemented and passing Vitest tests
- [ ] Serialiser for CSV implemented and round-trip tested
- [ ] `detectFormat()` implemented with heuristics above
- [ ] `validateSchema()` implemented
- [ ] All types exported from `packages/fsd-engine/src/types.ts`
- [ ] `FsdEngine` class exported from `packages/fsd-engine/src/index.ts`
- [ ] `vitest run` passes with zero failures
- [ ] No external dependencies added beyond those in §12
- [ ] No DB connections, no HTTP calls, no BullMQ references in this package

---

_Document version: Sprint 4 / Session A — prepared for Claude Code context handoff_
_Project: HospitalityFinancePro (HFP) | Entity: Essque Zalu Zanzibar (EZZ)_
