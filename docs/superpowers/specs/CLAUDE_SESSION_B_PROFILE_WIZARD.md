# CLAUDE.md — Session B: Transfer Desk Profile Creation Wizard UI

> **Purpose**: This is the Claude Code briefing for building the Profile Creation Wizard — the guided UI that lets users create, configure, and test Transfer Desk import/export profiles.
>
> **Prerequisite**: The FSD Engine (`packages/fsd-engine/`) must be built and tested (Session A) before this session begins. The wizard calls FSD Engine methods directly.
>
> **Hard boundary**: This session builds ONLY the wizard UI and its API routes. Do NOT modify the FSD Engine, TML Engine, BullMQ workers, or core Transfer Desk execution pipeline.

---

## §1 — What This Wizard Does

The Profile Creation Wizard is a multi-step guided interface that walks a user through creating a Transfer Desk profile. A profile defines:

- **What** file format to expect or produce (FSD schema)
- **How** to transform the data (TML mappings — configured here, executed elsewhere)
- **Where** data goes (target ledger, journal source, entity)
- **When** to run (manual trigger, scheduled, or event-driven via automation pipeline)

There are **5 profile types**, each with different wizard steps:

| Profile Type        | Direction     | Purpose                                                                   |
| ------------------- | ------------- | ------------------------------------------------------------------------- |
| `IMPORT`            | Inbound       | Parse external files → create HFP journals (Jana, Opera, bank statements) |
| `EXPORT`            | Outbound      | Extract HFP data → produce files for external systems                     |
| `INTERNAL_TRANSFER` | Internal      | Move data between HFP ledgers/entities                                    |
| `EXTERNAL_TRANSFER` | Bidirectional | Orchestrated data exchange with external system APIs                      |
| `PROCESS`           | Internal      | Scheduled batch operations (period close, revaluations, allocations)      |

---

## §2 — Wizard Step Flow

The wizard uses a **linear step progression** with conditional steps based on profile type. Every profile goes through these phases:

### Universal Steps (all profile types)

```
Step 1: Profile Type & Basics
Step 2: File Format Definition (FSD)    ← IMPORT/EXPORT only
Step 3: Field Mapping (TML)
Step 4: Validation Rules & Options
Step 5: Test & Preview
Step 6: Review & Activate
```

### Step Details

#### Step 1 — Profile Type & Basics

- Profile name (unique within entity, slug-friendly)
- Profile type selection (5 types above)
- Description (free text)
- Target entity selection (from tenant entities)
- Journal source code (e.g., `JANAP`, `OPERA`, `PAYMT`, `BANKI`)
- Target ledger selection
- Tags (optional, for filtering/grouping)

**UI**: Card-based type selector with icon + description for each profile type. On selection, the remaining steps dynamically adjust.

#### Step 2 — File Format Definition (FSD)

> **Only for IMPORT and EXPORT profiles.** Skip for INTERNAL_TRANSFER, EXTERNAL_TRANSFER, PROCESS.

This is the core step where the user defines the file structure. Two entry paths:

**Path A — Sample File Upload (recommended)**

1. User uploads a sample file (CSV, TSV, XLSX, fixed-width .txt, XML/SSML .sun)
2. FSD Engine's `autoDetect()` method analyses the file
3. Engine returns a proposed `FsdSchema` with detected fields, delimiters, encoding, header rows
4. User reviews and adjusts the auto-detected schema in the visual editor
5. On confirm, the `FsdSchema` JSON is saved to the profile

**Path B — Manual Definition**

1. User selects format type (CSV, TSV, FIXED_WIDTH, XLSX, XML)
2. User manually adds fields one by one:
   - Field name (canonical dot-notation path, e.g., `journal.line.account`)
   - Data type: `string | number | date | boolean`
   - Position: column index (delimited), character range (fixed-width), XPath (XML)
   - Required flag
   - `decimalDivisor` (optional — NEVER default this; see §8)
   - `dateFormat` (e.g., `YYYYMMDD`, `DD/MM/YYYY`)
   - `defaultValue` (optional)
   - Validation constraints (min, max, pattern, allowed values)

**UI for Step 2**:

- Tabbed interface: "Upload Sample" | "Define Manually"
- When sample uploaded: show file preview (first 10 rows) alongside detected schema
- Visual field editor: table/grid showing field name, type, position, options
- Drag-and-drop field reordering
- "Add Field" button appends to bottom
- Real-time validation: highlight conflicts (duplicate positions, overlapping fixed-width ranges)
- Format options panel: delimiter character, quote character, escape character, encoding, header row count, skip rows

#### Step 3 — Field Mapping (TML)

> **For IMPORT**: maps source file fields → HFP journal fields
> **For EXPORT**: maps HFP data fields → output file fields
> **For INTERNAL_TRANSFER / EXTERNAL_TRANSFER / PROCESS**: maps source → target with transformation rules

**UI — Visual Drag-and-Drop Mapper**:

- Left panel: Source fields (from FSD schema for IMPORT, or HFP data model for EXPORT)
- Right panel: Target fields (HFP journal fields for IMPORT, or FSD schema for EXPORT)
- Center: Connection lines showing mapped pairs
- Drag a source field to a target field to create a mapping
- Click a mapping line to configure transformation:
  - Direct copy (no transform)
  - Lookup table reference (e.g., account code mapping)
  - JavaScript expression (simple inline, e.g., `value.trim().toUpperCase()`)
  - Pre-built function (from the function library — see §7)
  - Concatenation of multiple source fields
  - Split a single source field into multiple targets
  - Static/default value injection

**Mapping Data Structure** (stored as JSON):

```typescript
interface TmlMapping {
  id: string; // UUID
  sourceField: string; // dot-notation path from source
  targetField: string; // dot-notation path to target
  transform: TmlTransform | null; // null = direct copy
}

interface TmlTransform {
  type: "direct" | "lookup" | "expression" | "function" | "concat" | "split" | "static";
  // For 'lookup':
  lookupTableId?: string;
  lookupSourceColumn?: string;
  lookupTargetColumn?: string;
  lookupDefaultValue?: string; // fallback if no match
  // For 'expression':
  expression?: string; // JS expression, `value` is the input
  // For 'function':
  functionId?: string; // reference to pre-built function library
  functionParams?: Record<string, unknown>;
  // For 'concat':
  additionalSources?: string[]; // other source fields to concatenate
  separator?: string;
  // For 'split':
  splitDelimiter?: string;
  splitIndex?: number;
  // For 'static':
  staticValue?: string;
}
```

#### Step 4 — Validation Rules & Options

- **Row-level validation rules**: conditions that must pass for a row to be accepted
  - Required field checks (already from FSD, but can add cross-field rules here)
  - Cross-field validation (e.g., debit + credit must not both be non-zero)
  - Range checks, pattern matches
  - Custom JS validation expressions
- **Error handling strategy**:
  - `REJECT_ROW` — skip invalid rows, continue processing
  - `REJECT_FILE` — abort entire file on first error
  - `QUARANTINE` — move invalid rows to quarantine table for manual review
- **Duplicate detection**:
  - Key fields for duplicate checking
  - Action on duplicate: `SKIP`, `OVERWRITE`, `ERROR`
- **Posting options** (IMPORT profiles):
  - Auto-post journals after import: yes/no
  - Require approval before posting: yes/no
  - Journal batch grouping: per-file, per-row, per-N-rows

**UI**: Form-based with collapsible sections. Each validation rule as an editable row in a table. Error handling as radio buttons. Posting options as toggle switches.

#### Step 5 — Test & Preview

- User uploads a test file (IMPORT) or selects test data range (EXPORT)
- System runs the full pipeline in **dry-run mode**:
  1. FSD Engine parses the file using the configured schema
  2. TML mappings transform the parsed data
  3. Validation rules are applied
  4. Preview shows: parsed rows, mapped output, validation results, error/warning summary
- **SSE Progress**: real-time progress events streamed to the UI:

  ```
  event: progress
  data: {"step": "parsing", "current": 45, "total": 200, "message": "Parsing row 45 of 200"}

  event: progress
  data: {"step": "mapping", "current": 45, "total": 200, "message": "Mapping row 45"}

  event: progress
  data: {"step": "validation", "current": 45, "total": 200, "message": "Validating row 45"}

  event: complete
  data: {"summary": {"totalRows": 200, "validRows": 195, "errorRows": 5, "warnings": 12}}
  ```

- **Preview display**:
  - Tab 1: Parsed Data — raw parsed output from FSD (table view)
  - Tab 2: Mapped Output — transformed data ready for journaling (table view)
  - Tab 3: Validation Report — errors and warnings with row numbers and field names
  - Tab 4: Journal Preview — what the GL journals would look like if posted (debit/credit balanced view)

**UI**: Split-screen with progress bar at top, tabbed results below. Errors highlighted in red, warnings in amber. Click an error row to jump to the source data.

#### Step 6 — Review & Activate

- Full summary of the profile configuration
- Read-only display of all settings from Steps 1-4
- "Save as Draft" — saves profile in `DRAFT` status
- "Activate" — saves profile in `ACTIVE` status, available for execution
- Profile versioning: each save creates a new version, previous versions retained

---

## §3 — Profile Statuses

```typescript
type ProfileStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
```

- `DRAFT` — being configured, not executable
- `ACTIVE` — available for manual or automated execution
- `INACTIVE` — temporarily disabled, retains configuration
- `ARCHIVED` — soft-deleted, not visible in default lists

---

## §4 — API Routes

The wizard UI calls these API endpoints. Build these as Fastify routes.

### Profile CRUD

```
POST   /api/v1/transfer-desk/profiles                    → Create new profile (draft)
GET    /api/v1/transfer-desk/profiles                    → List profiles (paginated, filterable by type/status/entity)
GET    /api/v1/transfer-desk/profiles/:profileId         → Get profile detail
PUT    /api/v1/transfer-desk/profiles/:profileId         → Update profile
PATCH  /api/v1/transfer-desk/profiles/:profileId/status  → Change status (activate/deactivate/archive)
DELETE /api/v1/transfer-desk/profiles/:profileId         → Soft delete (→ ARCHIVED)
GET    /api/v1/transfer-desk/profiles/:profileId/versions → List profile versions
GET    /api/v1/transfer-desk/profiles/:profileId/versions/:versionId → Get specific version
```

### FSD Auto-Detection

```
POST   /api/v1/transfer-desk/fsd/auto-detect             → Upload sample file, return proposed FsdSchema
POST   /api/v1/transfer-desk/fsd/validate-schema         → Validate an FsdSchema JSON
POST   /api/v1/transfer-desk/fsd/parse-preview           → Parse first N rows of a file using a given schema
```

### TML Mapping

```
GET    /api/v1/transfer-desk/mappings/target-fields       → List available HFP target fields (journal fields)
GET    /api/v1/transfer-desk/mappings/functions            → List pre-built transform functions
GET    /api/v1/transfer-desk/lookup-tables                 → List lookup tables
GET    /api/v1/transfer-desk/lookup-tables/:tableId        → Get lookup table entries
POST   /api/v1/transfer-desk/lookup-tables                 → Create lookup table
PUT    /api/v1/transfer-desk/lookup-tables/:tableId        → Update lookup table
```

### Test & Preview (SSE)

```
POST   /api/v1/transfer-desk/profiles/:profileId/test     → Run dry-run test, returns SSE stream
GET    /api/v1/transfer-desk/profiles/:profileId/test/:testId/results → Get cached test results
```

### Automation Pipeline

```
POST   /api/v1/transfer-desk/profiles/:profileId/schedule  → Set schedule (cron expression)
DELETE /api/v1/transfer-desk/profiles/:profileId/schedule  → Remove schedule
GET    /api/v1/transfer-desk/profiles/:profileId/schedule  → Get current schedule
```

---

## §5 — Database Tables (Already Created in Sprint 3)

The wizard reads/writes to these existing tables. Do NOT create new migrations — these tables exist.

| Table                 | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `td_profiles`         | Profile metadata (name, type, status, entity_id, config JSONB) |
| `td_profile_versions` | Version history per profile                                    |
| `td_fsd_schemas`      | FSD schema JSON storage, linked to profile                     |
| `td_tml_mappings`     | TML mapping definitions per profile                            |
| `td_lookup_tables`    | Lookup table metadata                                          |
| `td_lookup_entries`   | Lookup table key→value rows                                    |
| `td_validation_rules` | Per-profile validation rule definitions                        |
| `td_test_runs`        | Test/dry-run execution history                                 |
| `td_test_results`     | Row-level test results                                         |
| `td_schedules`        | Automation schedules per profile                               |

All tables have RLS policies scoped by `entity_id`. The middleware sets `SET LOCAL app.current_entity_id` before queries.

---

## §6 — FSD Engine Integration

The wizard imports and calls the FSD Engine from `packages/fsd-engine/`. Key integration points:

```typescript
import { FsdEngine } from "@hospitality-pro/fsd-engine";

// Step 2 — Auto-detect from sample file
const engine = new FsdEngine();
const proposedSchema = await engine.autoDetect(fileBuffer, fileName);

// Step 2 — Validate a manually-built schema
const errors = engine.validateSchema(schemaJson);

// Step 5 — Parse test file using configured schema
const parseResult = await engine.parse(fileBuffer, schemaJson);
// parseResult: { rows: ParsedRow[], errors: ParseError[], metadata: ParseMetadata }

// Step 5 — Serialise for EXPORT preview
const outputBuffer = await engine.serialise(rows, schemaJson);
```

**CRITICAL**: The FSD Engine is a pure, stateless library. It does NOT access the database. The wizard API routes handle all DB operations and pass data to/from the engine.

---

## §7 — Pre-Built Function Library

The wizard's mapping step (Step 3) offers pre-built transform functions. These are registered in the system and available via the `/mappings/functions` endpoint.

### Core Functions (ship with system)

| Function ID          | Name               | Description                                   | Params                                   |
| -------------------- | ------------------ | --------------------------------------------- | ---------------------------------------- |
| `fn_trim`            | Trim Whitespace    | Trim leading/trailing whitespace              | —                                        |
| `fn_upper`           | Uppercase          | Convert to uppercase                          | —                                        |
| `fn_lower`           | Lowercase          | Convert to lowercase                          | —                                        |
| `fn_pad_left`        | Pad Left           | Left-pad with character                       | `char`, `length`                         |
| `fn_pad_right`       | Pad Right          | Right-pad with character                      | `char`, `length`                         |
| `fn_date_format`     | Date Format        | Convert date between formats                  | `inputFormat`, `outputFormat`            |
| `fn_number_format`   | Number Format      | Format number (decimal places, thousands sep) | `decimals`, `thousandsSep`, `decimalSep` |
| `fn_substring`       | Substring          | Extract substring                             | `start`, `length`                        |
| `fn_replace`         | Replace            | Find and replace in string                    | `find`, `replace`, `regex` (boolean)     |
| `fn_lookup`          | Lookup             | Map value via lookup table                    | `tableId`, `defaultValue`                |
| `fn_divide`          | Divide             | Divide by a number                            | `divisor`                                |
| `fn_multiply`        | Multiply           | Multiply by a number                          | `multiplier`                             |
| `fn_default`         | Default Value      | Use fallback if empty/null                    | `defaultValue`                           |
| `fn_concat_fields`   | Concatenate Fields | Join multiple fields                          | `fields[]`, `separator`                  |
| `fn_split_field`     | Split Field        | Split and take Nth part                       | `delimiter`, `index`                     |
| `fn_currency_code`   | Currency Code      | Map currency abbreviation to ISO code         | `mappings{}`                             |
| `fn_account_segment` | Account Segment    | Extract segment from composite account code   | `delimiter`, `segmentIndex`              |

### Hospitality-Specific Functions

| Function ID       | Name                 | Description                                          | Params                    |
| ----------------- | -------------------- | ---------------------------------------------------- | ------------------------- |
| `fn_opera_date`   | Opera Date Parse     | Parse Opera PMS date formats (YYYYMMDD, YYMMDD)      | `format`                  |
| `fn_jana_amount`  | Jana Amount          | Apply ÷1000 divisor for Jana internal movement files | —                         |
| `fn_simphony_rvc` | Simphony RVC Map     | Map Simphony RVC code to department                  | `rvcMappings{}`           |
| `fn_usali_map`    | USALI Department Map | Map account to USALI department code                 | `usaliVersion`            |
| `fn_entity_code`  | Entity Code          | Map property code to HFP entity ID                   | —                         |
| `fn_tax_extract`  | Tax Extractor        | Split gross amount into net + tax                    | `taxRate`, `taxInclusive` |

**NOTE on `fn_jana_amount`**: This function explicitly applies ÷1000. It is offered as a convenience function the user can choose to apply on specific fields. The FSD Engine itself NEVER auto-applies this. The user must actively drag this function onto a mapping. If the file does not need ÷1000, the user simply does not apply this function.

---

## §8 — Critical Design Rules

1. **`decimalDivisor` is ALWAYS opt-in** — The wizard UI must NEVER pre-populate `decimalDivisor` on any field. The field input should be empty by default. Only the user can set it. Similarly, `fn_jana_amount` is a user-selected function, never auto-applied.

2. **Dot-notation for all field paths** — All field references use dot-notation (`journal.line.account`), never slash-notation (`journal/line/account`). The UI text input for field names should validate this pattern.

3. **JSON intermediate format** — All data flows through JSON between steps. No XML, no SSML, no proprietary formats inside the system. XML/SSML is only at the boundary (file parse/serialise).

4. **Profile isolation** — Each profile is self-contained. Profiles do not share FSD schemas or TML mappings. If a user wants to reuse a configuration, they clone a profile.

5. **Version immutability** — Once a profile version is created, it is immutable. Edits create a new version. The active version is the one used for execution.

6. **Entity scoping** — Every query, every list, every operation is scoped to the current entity via RLS. The UI never shows profiles from other entities.

7. **Draft safety** — A profile in DRAFT status cannot be executed (manually or via schedule). The "Activate" action in Step 6 is the only path to making a profile executable.

8. **Test before activate** — The UI should encourage (but not hard-require) running a test (Step 5) before activation. Show a warning if the user tries to activate without testing.

---

## §9 — UI Technology & Patterns

### Stack

- **Framework**: Next.js (app router)
- **Components**: Use existing HFP component library (shadcn/ui based)
- **State management**: React state + URL search params for wizard step tracking
- **Forms**: React Hook Form + Zod validation
- **Drag-and-drop**: `@dnd-kit/core` for the field mapper
- **File upload**: `react-dropzone` for sample file upload
- **SSE client**: `EventSource` API for test progress streaming
- **HTTP client**: Existing Axios instance with auth interceptor

### UI Patterns (HFP Standard)

1. **Action buttons in top-right toolbar** — on the same line as the page title. Every view follows this pattern. The wizard's "Next", "Back", "Save Draft", "Activate" buttons go here.

2. **Wizard step indicator** — horizontal stepper at the top showing all steps, current step highlighted, completed steps with checkmarks. Clickable to navigate back (but not forward past current).

3. **Page title format**: `Transfer Desk → New {ProfileType} Profile` or `Transfer Desk → Edit: {ProfileName}`

4. **Consistent table component** — all data tables use the HFP DataTable component with sorting, filtering, pagination.

5. **Toast notifications** — success/error feedback via toast, not inline alerts (except validation errors which are inline).

6. **Responsive but desktop-first** — Transfer Desk is a power-user feature. Optimise for desktop (1280px+). Responsive down to 1024px. Below that, show a "best viewed on desktop" message.

7. **Tenant slug in URL** — all routes are under `/{tenant-slug}/transfer-desk/profiles/...`

---

## §10 — File Upload & Sample File Handling

### Upload Flow

1. User drops/selects a file in the upload zone
2. Client validates: max 10MB, allowed extensions (.csv, .tsv, .txt, .xlsx, .xls, .xml, .sun)
3. File uploaded to API via multipart form data
4. API stores file temporarily (S3 temp bucket, 24hr TTL)
5. API calls `FsdEngine.autoDetect(buffer, filename)`
6. Returns proposed schema + first 10 rows preview to client
7. User adjusts schema in visual editor
8. On "Next", confirmed schema saved to `td_fsd_schemas`
9. Temp file reference stored for use in Step 5 testing

### File Preview

- CSV/TSV/TXT: Show as table (first 10 rows, max 20 columns)
- XLSX: Show sheet selector + table preview of selected sheet
- XML/SSML: Show tree view with expandable nodes
- Fixed-width: Show raw text with column position rulers

---

## §11 — Visual Field Mapper (Step 3) — Detailed Spec

The mapper is the most complex UI component. Here's the exact layout:

```
┌──────────────────────────────────────────────────────────────┐
│  Source Fields              Mappings            Target Fields │
│ ┌─────────────┐    ┌───────────────────┐    ┌──────────────┐│
│ │ ☐ field_a   │────│ direct            │────│ journal.date ││
│ │ ☐ field_b   │────│ fn_upper          │────│ journal.ref  ││
│ │ ☐ field_c   │    │                   │    │ journal.desc ││
│ │ ☐ field_d   │────│ fn_lookup(tbl_01) │────│ line.account ││
│ │ ☐ amount    │────│ fn_jana_amount    │────│ line.amount  ││
│ │ ☐ field_f   │    │                   │    │ line.curr    ││
│ └─────────────┘    └───────────────────┘    └──────────────┘│
│                                                              │
│  [+ Add Static Mapping]  [Auto-Map by Name]  [Clear All]    │
└──────────────────────────────────────────────────────────────┘
```

### Interactions

- **Drag** a source field → drop on a target field → creates a `direct` mapping
- **Click** a mapping connection → opens transform configuration panel (slide-in from right)
- **Auto-Map by Name** — matches source and target fields by fuzzy name similarity
- **Add Static Mapping** — creates a mapping with no source (static value or expression)
- **Unmapped source fields** — shown in normal weight, no connection line
- **Unmapped target fields** — shown with a subtle warning indicator if the field is required
- **Delete mapping** — click X on the connection line, or drag source field away

### Transform Configuration Panel

When a user clicks a mapping line, a slide-in panel shows:

- Current source → target fields (read-only)
- Transform type dropdown (direct, lookup, expression, function, concat, split, static)
- Dynamic form fields based on selected transform type
- Live preview: shows what the transform produces given sample data from the test file
- "Apply" and "Cancel" buttons

---

## §12 — Lookup Table Designer

Accessible from Step 3 when the user selects a lookup transform, or from a standalone Lookup Tables management page.

### Lookup Table Structure

```typescript
interface LookupTable {
  id: string;
  name: string; // e.g., "Jana Account Mapping"
  description?: string;
  columns: string[]; // e.g., ["source_code", "target_account", "department"]
  entries: LookupEntry[];
}

interface LookupEntry {
  id: string;
  values: Record<string, string>; // column_name → value
}
```

### UI

- Table editor (spreadsheet-like) for adding/editing rows
- Import from CSV/XLSX
- Search/filter entries
- Bulk edit support
- Used in TML mappings via `fn_lookup` function

---

## §13 — Automation Pipeline Builder (Step after activation)

After a profile is activated, users can optionally configure automated execution:

### Schedule Types

- **Cron-based**: Standard cron expression (e.g., `0 6 * * *` for daily at 6 AM)
- **File watch**: Monitor an S3 path for new files (polling interval configurable)
- **Event-driven**: Trigger on HFP events (e.g., period close, night audit complete)
- **Manual only**: No automation, triggered by user action

### UI

- Schedule type selector (radio cards)
- Cron expression builder (visual, with human-readable preview)
- File watch configuration (S3 path, file pattern, polling interval)
- Event selector (dropdown of available HFP events)
- Notification settings: email alerts on success/failure/warning
- Retry policy: max retries, backoff strategy

---

## §14 — Folder Structure

Build the wizard UI in the existing Next.js app structure:

```
src/
  app/
    [tenant]/
      transfer-desk/
        profiles/
          page.tsx                          # Profile list page
          new/
            page.tsx                        # New profile wizard (wraps WizardContainer)
          [profileId]/
            page.tsx                        # Profile detail/view
            edit/
              page.tsx                      # Edit profile wizard
            test/
              page.tsx                      # Test execution page
            schedule/
              page.tsx                      # Schedule configuration
  components/
    transfer-desk/
      wizard/
        WizardContainer.tsx                # Main wizard shell (stepper + step routing)
        WizardStepper.tsx                  # Step indicator bar
        steps/
          ProfileBasicsStep.tsx            # Step 1
          FileFormatStep.tsx               # Step 2
          FieldMappingStep.tsx             # Step 3
          ValidationStep.tsx               # Step 4
          TestPreviewStep.tsx              # Step 5
          ReviewActivateStep.tsx           # Step 6
        shared/
          FileUploadZone.tsx               # Drag-and-drop file upload
          SchemaEditor.tsx                 # Visual FSD schema editor
          FieldMapper.tsx                  # Drag-and-drop mapper (§11)
          TransformConfigPanel.tsx         # Slide-in transform editor
          LookupTableEditor.tsx            # Inline lookup table editor
          ParsePreview.tsx                 # File parse preview table
          JournalPreview.tsx               # GL journal preview
          ProgressStream.tsx               # SSE progress display
  lib/
    transfer-desk/
      api.ts                              # API client functions
      types.ts                            # TypeScript types (Profile, FsdSchema, TmlMapping, etc.)
      constants.ts                        # Profile types, statuses, function library registry
      validation.ts                       # Zod schemas for form validation
      hooks/
        useWizardState.ts                 # Wizard state management hook
        useFieldMapper.ts                 # Drag-and-drop state + mapping logic
        useTestStream.ts                  # SSE hook for test progress
        useProfileForm.ts                 # React Hook Form integration
```

---

## §15 — API Route Structure (Fastify)

```
src/
  server/
    routes/
      transfer-desk/
        profiles.ts                       # CRUD routes
        fsd.ts                            # Auto-detect, validate, parse-preview
        mappings.ts                       # Target fields, functions list
        lookup-tables.ts                  # Lookup table CRUD
        test.ts                           # Test execution + SSE
        schedules.ts                      # Automation schedule CRUD
    services/
      transfer-desk/
        profile.service.ts                # Profile business logic
        fsd-integration.service.ts        # FSD Engine wrapper (DB + engine calls)
        mapping.service.ts                # TML mapping logic
        test-runner.service.ts            # Dry-run orchestration
        schedule.service.ts               # Schedule management
```

---

## §16 — What NOT to Build (Out of Scope)

| Do NOT build               | Why                                                                     |
| -------------------------- | ----------------------------------------------------------------------- |
| FSD Engine                 | Built in Session A — import it as a dependency                          |
| TML Engine (execution)     | Separate future sprint — wizard only configures mappings                |
| BullMQ worker integration  | Sprint 3 skeleton exists — production wiring is a later sprint          |
| Actual journal posting     | Wizard only previews — real posting is Transfer Desk execution pipeline |
| File storage service       | Use existing S3 service from the platform                               |
| User/auth system           | Use existing Keycloak OIDC middleware                                   |
| Navigation/layout shell    | Use existing HFP layout components                                      |
| Intercompany journal logic | Separate spec (INTERCOMPANY_JOURNALS.md)                                |

---

## §17 — Definition of Done

Session B is complete when:

- [ ] Profile list page renders with filtering by type/status, sorting, pagination
- [ ] New profile wizard completes all 6 steps for IMPORT profile type
- [ ] New profile wizard completes all applicable steps for EXPORT profile type
- [ ] INTERNAL_TRANSFER / EXTERNAL_TRANSFER / PROCESS types skip Step 2 correctly
- [ ] Sample file upload triggers FSD auto-detection and shows preview
- [ ] Manual FSD schema definition works with all field types
- [ ] Visual field mapper renders source ↔ target with drag-and-drop
- [ ] All transform types configurable in the transform panel
- [ ] Lookup table inline editor works (create, edit, import CSV)
- [ ] Validation rules step saves rules to profile
- [ ] Test & Preview runs dry-run with SSE progress streaming
- [ ] Test results display in 4 tabs (parsed, mapped, validation, journal preview)
- [ ] Review step shows complete profile summary
- [ ] Save as Draft and Activate both work with correct status transitions
- [ ] Profile versioning creates new version on each save
- [ ] Edit existing profile loads all wizard steps with current data
- [ ] All API routes respond correctly with proper error handling
- [ ] RLS scoping verified — profiles only visible within own entity
- [ ] All form inputs validated with Zod schemas
- [ ] Responsive layout works at 1024px+ (desktop-first)
- [ ] Toast notifications for all user actions

---

## §18 — Quick Reference: HFP Target Journal Fields

These are the standard target fields available for IMPORT mapping (the right panel in the field mapper):

```
journal.date                    # Transaction date
journal.period                  # Accounting period (YYYYMM)
journal.source                  # Journal source code
journal.reference               # External reference number
journal.description             # Journal description
journal.currency                # ISO currency code
journal.exchangeRate            # Exchange rate to base currency
journal.entity                  # Entity code
line.sequence                   # Line sequence number
line.account                    # GL account code
line.analysisCode1              # Analysis dimension 1 (Department)
line.analysisCode2              # Analysis dimension 2 (Cost Centre)
line.analysisCode3              # Analysis dimension 3 (Project)
line.analysisCode4              # Analysis dimension 4
line.analysisCode5              # Analysis dimension 5
line.analysisCode6              # Analysis dimension 6
line.analysisCode7              # Analysis dimension 7
line.analysisCode8              # Analysis dimension 8
line.analysisCode9              # Analysis dimension 9
line.analysisCode10             # Analysis dimension 10
line.debit                      # Debit amount (base currency)
line.credit                     # Credit amount (base currency)
line.transactionDebit           # Debit amount (transaction currency)
line.transactionCredit          # Credit amount (transaction currency)
line.description                # Line description
line.reference                  # Line reference
line.dueDate                    # Due date (for AP/AR)
line.quantity                   # Quantity
line.unitPrice                  # Unit price
line.taxCode                    # Tax code
line.taxAmount                  # Tax amount
```

---

_End of Session B briefing. Build the wizard, test it, and once it's working — the Transfer Desk pipeline is ready for execution wiring in a future sprint._
