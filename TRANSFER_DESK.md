# Transfer Desk — HospitalityFinancePro Implementation Guide

> Modeled after Infor SunSystems Transfer Desk (Release 2024.x)  
> Stack: Node.js / TypeScript · PostgreSQL · Redis / BullMQ

---

## 1. Overview

Transfer Desk is the **data import/export and integration gateway** for HospitalityFinancePro. It enables:

- Inbound data from PMS (Opera/Protel), POS (Micros/Infrasys), Payroll, and Procurement (Sky Jana)
- Outbound exports for reporting, auditing, and inter-system sync
- Profile-based transfer definitions with field mapping, validation, data format definition, and TML transformation scripting
- Automated, prioritized transfer queues with scheduling and full execution history
- Integration Activity monitoring (live, history, scheduled views)

---

## 2. Core Concepts & SunSystems Mapping

| SunSystems Term | HospitalityFinancePro Equivalent |
|---|---|
| Transfer Profile | `TransferProfile` — saved import/export configuration |
| Profile Type | `IMPORT`, `EXPORT`, `INTERNAL_TRANSFER`, `EXTERNAL_TRANSFER`, `PROCESS` |
| Format Designer / FSD | `DataFormat` — describes structure of external files |
| Transformation Designer / TML | Raw TML XML stored in DB; parsed + executed at runtime |
| Lookup Table | `LookupTable` — alpha-range value substitution used by transformations |
| Automation | `TransferAutomation` — ordered collection of profiles, schedulable via cron |
| Runtime Override | Profile fields flagged `allowRuntimeOverride: true` |
| Transfer Run / Integration Activity | `transfer_runs` — audit log of every execution |
| Error Correction | `transfer_errors` table + correction UI + child re-run |
| Payload | SSML-equivalent JSON envelope sent to/from target components |
| Storage | `transfer_storage` — managed file repository for import/export files |

---

## 3. Supported File Formats

Transfer Desk accepts four inbound file types. The file reader layer normalises all of them into a `RawRecord[]` array before the TML engine runs — the rest of the pipeline is identical regardless of source format.

| Extension | Type | Parser | Notes |
|---|---|---|---|
| `.csv` | Comma-separated | `csv-parse` | Standard delimited; handle Excel-generated triple double-quotes |
| `.txt` | Delimited text | `csv-parse` | Tab, pipe, or custom delimiter — same code path as CSV, delimiter detected from FSD profile |
| `.SUN` | SunSystems SSML/XML | `fast-xml-parser` | Native SunSystems payload — already in SSML format; **no transformation required** if source matches target component |
| `.xlsx` / `.xls` | Excel workbook | `exceljs` | Parse first sheet (or named sheet from profile config) to row array; convert to flat records |

### File Reader (`file-reader.ts`)

```typescript
import { parse as csvParse } from 'csv-parse/sync';
import { XMLParser }         from 'fast-xml-parser';
import ExcelJS               from 'exceljs';

export type RawRecord = Record<string, unknown>;

export async function readFile(
  filePath: string,
  ext: string,
  fsdProfile: FSDSchema | null,
  sheetName?: string
): Promise<RawRecord[]> {
  switch (ext.toLowerCase()) {

    case '.csv':
    case '.txt': {
      const content   = await fs.readFile(filePath, 'utf-8');
      const delimiter = fsdProfile?.root?.children?.[0]?.fields?.[0]?.fieldSep ?? ',';
      return csvParse(content, {
        columns:          true,
        delimiter,
        skip_empty_lines: true,
        trim:             true,
        bom:              true,           // strip UTF-8 BOM if present
      }) as RawRecord[];
    }

    case '.sun': {
      // SunSystems SSML/XML payload — parse directly to records
      const content = await fs.readFile(filePath, 'utf-8');
      const parser  = new XMLParser({ ignoreAttributes: false, parseAttributeValue: true });
      const doc     = parser.parse(content);
      // Navigate SSC/Payload/* to extract record array
      return extractSSMLRecords(doc);
    }

    case '.xlsx':
    case '.xls': {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const sheet = sheetName
        ? workbook.getWorksheet(sheetName)
        : workbook.worksheets[0];
      if (!sheet) throw new FileReadError('Worksheet not found');
      return excelSheetToRecords(sheet);
    }

    default:
      throw new FileReadError(`Unsupported file extension: ${ext}`);
  }
}

// Excel helper — row 1 = headers, rows 2+ = data
function excelSheetToRecords(sheet: ExcelJS.Worksheet): RawRecord[] {
  const rows    = sheet.getSheetValues() as unknown[][];
  const headers = (rows[1] as string[]).map(h => String(h ?? '').trim());
  return rows.slice(2)
    .filter(row => row.some(cell => cell != null))
    .map(row =>
      Object.fromEntries(
        headers.map((h, i) => [h, row[i + 1] ?? null])  // ExcelJS rows are 1-indexed
      )
    );
}

// .SUN SSML helper — extract records from SSC/Payload/* structure
function extractSSMLRecords(doc: Record<string, unknown>): RawRecord[] {
  const payload = (doc as any)?.SSC?.Payload;
  if (!payload) throw new FileReadError('Invalid .SUN file: SSC/Payload not found');
  // Payload may contain one or more component arrays e.g. Ledger, PurchaseOrder
  const componentKey = Object.keys(payload).find(k => k !== '@_version');
  const records      = payload[componentKey!];
  return Array.isArray(records) ? records : [records];
}
```

### File Upload Validation (`transfer-desk.storage.ts`)

```typescript
const ALLOWED_EXTENSIONS = ['.csv', '.txt', '.sun', '.xlsx', '.xls'];
const MAX_FILE_SIZE_MB    = 50;

export function validateUploadedFile(file: Express.Multer.File): void {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext))
    throw new ValidationError(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024)
    throw new ValidationError(`File exceeds ${MAX_FILE_SIZE_MB}MB limit`);

  // Enforce UTF-8 for text-based formats
  if (['.csv', '.txt', '.sun'].includes(ext)) {
    const sample = file.buffer.slice(0, 4);
    if (hasNonUTF8BOM(sample))
      throw new ValidationError('File must be UTF-8 encoded. Please re-save as UTF-8.');
  }
}
```

### Profile `file_config` Shape

Add these fields to the `file_config` JSONB column on `transfer_profiles`:

```typescript
interface FileConfig {
  fileName?:            string;    // default filename/path in storage
  fileEncoding:         string;    // 'UTF-8' (default) | 'ASCII'
  generateUniqueName:   boolean;   // append user + timestamp to filename
  overwriteExisting:    boolean;   // mutually exclusive with appendToExisting
  appendToExisting:     boolean;
  fileActionAfter:      'NONE' | 'RENAME' | 'MOVE' | 'DELETE';
  fileActionTarget?:    string;    // new name or folder path for RENAME/MOVE
  excelSheetName?:      string;    // which sheet to read; null = first sheet
  delimiter?:           string;    // for .txt overrides; defaults to FSD profile
  savePayload:          'INPUT' | 'OUTPUT' | 'BOTH' | 'NONE';
}
```

---

## 4. TML — Transformation Markup Language

### Storage Approach: Raw TML XML in Database

Transformations are stored as **raw TML XML strings** in the `tml_script TEXT` column — exactly as SunSystems stores them. This means:

- Hotel IT teams can migrate existing SunSystems TML scripts directly with no conversion
- Power users can edit the raw XML in a script editor (TML Details ↔ Script view toggle, matching SunSystems UX)
- At runtime the XML is parsed into TypeScript structs and executed by the TML engine
- JavaScript function bodies containing `<` / `>` are CDATA-wrapped in the XML — the engine handles encoding/decoding transparently

### What a TML Script Looks Like

```xml
<?xml version='1.0' encoding='UTF-8'?>
<transformation>

  <!-- 1. MAP: copy source field to target field -->
  <map>
    <target>SSC/Payload/Ledger/AccountCode</target>
    <source>PMS/Revenue/RoomCode</source>
  </map>

  <!-- 2. MAP: multiple sources concatenated into one target -->
  <map>
    <target>SSC/Payload/Ledger/Description</target>
    <source>PMS/Revenue/RoomType</source>
    <source>PMS/Revenue/GuestName</source>
  </map>

  <!-- 3. SET: fixed literal value -->
  <set>
    <target>SSC/Payload/Ledger/LedgerCode</target>
    <value>A</value>
  </set>

  <!-- 4. TRANSFORM: calculated value using JavaScript function -->
  <transform>
    <target>SSC/Payload/Ledger/Amount</target>
    <function name="negateIfCredit">
      <param from-source="yes" type="number">PMS/Revenue/Amount</param>
      <param from-source="yes" type="string">PMS/Revenue/DrCr</param>
    </function>
  </transform>

  <!-- 5. LOOKUP: substitute source value via lookup table -->
  <lookup table="PMSRevenueToGL" business-unit="auto:target" unknown="fail">
    <target>SSC/Payload/Ledger/AccountCode</target>
    <source>PMS/Revenue/RevenueCategory</source>
  </lookup>

  <!-- JavaScript functions — CDATA prevents XML parse errors -->
  <script>
  <![CDATA[
    function negateIfCredit(amount, drCr) {
      return drCr === 'CR' ? amount * -1 : amount;
    }

    function formatHospitalityDate(ddmmyyyy) {
      // SunSystems standard: ddmmyyyy
      return ddmmyyyy.substring(4) + ddmmyyyy.substring(2,4) + ddmmyyyy.substring(0,2);
    }
  ]]>
  </script>

</transformation>
```

### TML Parser (`tml-parser.ts`)

```typescript
import { XMLParser } from 'fast-xml-parser';

export function parseTML(xmlString: string): TMLTransformation {
  const parser = new XMLParser({
    ignoreAttributes:    false,
    attributeNamePrefix: '@_',
    isArray: (name) => ['map','set','transform','lookup','source','param','script'].includes(name),
  });

  const doc = parser.parse(xmlString);
  const root = doc.transformation;

  return {
    outputEncoding:      root['@_output-encoding'] ?? 'UTF-8',
    scripts:             (root.script ?? []).map((s: any) => String(s)),
    commands:            parseCommands(root),
  };
}

function parseCommands(root: any): TMLCommand[] {
  const commands: TMLCommand[] = [];

  for (const map of root.map ?? []) {
    commands.push({
      type:    'map',
      target:  map.target,
      sources: (Array.isArray(map.source) ? map.source : [map.source]).map((s: any) => ({
        path:         typeof s === 'string' ? s : s['#text'],
        doesForEach:  s['@_does-for-each'] === 'yes',
        passesValue:  s['@_passes-value'] !== 'no',
        name:         s['@_name'],
      })),
    });
  }

  for (const set of root.set ?? []) {
    commands.push({ type: 'set', target: set.target, value: String(set.value) });
  }

  for (const transform of root.transform ?? []) {
    commands.push({
      type:         'transform',
      target:       transform.target,
      functionName: transform.function['@_name'],
      params:       (transform.function.param ?? []).map((p: any) => ({
        fromSource: p['@_from-source'] === 'yes',
        dataType:   p['@_type'] ?? 'string',
        value:      typeof p === 'string' ? p : p['#text'],
      })),
    });
  }

  for (const lookup of root.lookup ?? []) {
    commands.push({
      type:         'lookup',
      table:        lookup['@_table'],
      businessUnit: lookup['@_business-unit'] ?? 'auto:target',
      unknown:      lookup['@_unknown'] ?? 'fail',
      target:       lookup.target,
      source:       lookup.source,
    });
  }

  return commands;
}
```

### TML Executor (`tml-engine.ts`)

```typescript
import vm from 'node:vm';

export async function executeTML(
  tml: TMLTransformation,
  inputDoc: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {};

  // Compile all JavaScript functions from <script> blocks into a sandbox
  const sandbox = buildJSSandbox(tml.scripts);

  for (const cmd of tml.commands) {
    switch (cmd.type) {

      case 'map': {
        // does-for-each: iterate over array source (e.g. invoice lines)
        // passes-value: leaf node — copy value directly
        const values = cmd.sources.map(s =>
          s.doesForEach
            ? getPathArray(inputDoc, s.path)
            : getPath(inputDoc, s.path)
        );
        setPath(output, cmd.target, values.length === 1 ? values[0] : values.join(''));
        break;
      }

      case 'set': {
        setPath(output, cmd.target, cmd.value);
        break;
      }

      case 'transform': {
        const args = cmd.params.map(p =>
          p.fromSource ? getPath(inputDoc, p.value) : coerce(p.value, p.dataType)
        );
        const result = sandbox[cmd.functionName]?.(...args);
        if (result === undefined) throw new TMLError(`Function "${cmd.functionName}" not found`);
        setPath(output, cmd.target, result);
        break;
      }

      case 'lookup': {
        const sourceValue = getPath(inputDoc, cmd.source) as string;
        const resolved    = await resolveLookup(cmd.table, sourceValue, cmd.businessUnit, cmd.unknown);
        setPath(output, cmd.target, resolved);
        break;
      }
    }
  }

  return output;
}

// Safely execute user JS in a Node vm sandbox
function buildJSSandbox(scripts: string[]): Record<string, Function> {
  const sandbox: Record<string, unknown> = {};
  const context = vm.createContext(sandbox);
  for (const script of scripts) {
    vm.runInContext(script, context, { timeout: 2000 });
  }
  return sandbox as Record<string, Function>;
}
```

### Dual View: Script Editor vs Form Builder

The UI must offer both views (matching SunSystems TML Details ↔ Script toggle):

**Script View** — raw TML XML textarea, syntax highlighted, for ADMINISTRATOR / POWER_USER  
**Form Builder View** — row-by-row table: Target Path | Operation (Map/Set/Transform/Lookup) | Source(s) / Value — for USER-friendly editing

```typescript
// API: toggle between views
GET  /api/v1/transfer-desk/transformations/:id/script    # Returns raw TML XML string
GET  /api/v1/transfer-desk/transformations/:id/form      # Returns parsed TMLTransformation JSON
PUT  /api/v1/transfer-desk/transformations/:id/script    # Save raw TML XML (validates before saving)
PUT  /api/v1/transfer-desk/transformations/:id/form      # Save from form builder (serialises to TML XML)
POST /api/v1/transfer-desk/transformations/:id/validate  # Parse + validate TML XML
POST /api/v1/transfer-desk/transformations/:id/test      # Run against sample file, return before/after
```

**Important:** Once a user edits in Script View, lock Form Builder view until re-validated — matches SunSystems behaviour.

---

## 5. Database Schema

```sql
-- DATA FORMATS (Format Designer / FSD)
CREATE TABLE transfer_data_formats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL UNIQUE,
  description     TEXT,
  classification  VARCHAR(30) NOT NULL CHECK (classification IN (
                    'DELIMITED','SINGLE_FIXED_WIDTH','MULTI_FIXED_WIDTH',
                    'OTHER_FLAT','USER_XML','SIMPLE_XML')),
  fsd_script      TEXT NOT NULL,           -- raw FSD XML schema
  is_validated    BOOLEAN DEFAULT false,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- LOOKUP TABLES
CREATE TABLE transfer_lookup_tables (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL UNIQUE,
  description  TEXT,
  property_id  UUID REFERENCES properties(id),  -- NULL = global
  columns      JSONB NOT NULL DEFAULT '[]',      -- [{name:"Output_Value"}, ...]
  rows         JSONB NOT NULL DEFAULT '[]',      -- [{rangeFrom:"001",rangeTo:"009",Output_Value:"GL1000"}]
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- TRANSFORMATIONS — TML XML stored as text
CREATE TABLE transfer_transformations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(100) NOT NULL UNIQUE,
  description       TEXT,
  script_type       VARCHAR(5) NOT NULL DEFAULT 'TML' CHECK (script_type IN ('TML','XSL')),
  source_format_id  UUID REFERENCES transfer_data_formats(id),
  target_format_id  UUID REFERENCES transfer_data_formats(id),
  tml_script        TEXT NOT NULL,          -- raw TML XML string (CDATA wraps JS blocks)
  is_validated      BOOLEAN DEFAULT false,
  form_locked       BOOLEAN DEFAULT false,  -- true after direct script edits
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- TRANSFER PROFILES
CREATE TABLE transfer_profiles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id          UUID REFERENCES properties(id),
  name                 VARCHAR(100) NOT NULL,
  description          TEXT,
  profile_type         VARCHAR(20) NOT NULL CHECK (profile_type IN (
                         'IMPORT','EXPORT','INTERNAL_TRANSFER','EXTERNAL_TRANSFER','PROCESS')),
  source_component     VARCHAR(50),
  target_component     VARCHAR(50),
  source_method        VARCHAR(30),
  target_method        VARCHAR(30),
  source_format_id     UUID REFERENCES transfer_data_formats(id),
  target_format_id     UUID REFERENCES transfer_data_formats(id),
  transformation_id    UUID REFERENCES transfer_transformations(id),
  filter_config        JSONB DEFAULT '{}',
  consolidation_config JSONB DEFAULT '{}',
  runtime_params       JSONB DEFAULT '{}',
  allow_overrides      JSONB DEFAULT '{}',
  file_config          JSONB DEFAULT '{}',  -- FileConfig shape (see Section 3)
  range_control        BOOLEAN DEFAULT false,
  is_active            BOOLEAN DEFAULT true,
  created_by           UUID REFERENCES users(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Profile access control
CREATE TABLE transfer_profile_access (
  profile_id  UUID REFERENCES transfer_profiles(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  role        VARCHAR(20) CHECK (role IN ('USER','POWER_USER','ADMINISTRATOR')),
  PRIMARY KEY (profile_id, user_id)
);

-- AUTOMATIONS
CREATE TABLE transfer_automations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID REFERENCES properties(id),
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  profile_ids     UUID[] NOT NULL,
  fail_on_error   BOOLEAN DEFAULT false,
  ignore_invalid  BOOLEAN DEFAULT false,
  cron_expr       VARCHAR(50),
  schedule_start  TIMESTAMPTZ,
  schedule_end    TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT true,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- TRANSFER RUNS (Integration Activity)
CREATE TABLE transfer_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       UUID REFERENCES transfer_profiles(id),
  automation_id    UUID REFERENCES transfer_automations(id),
  parent_run_id    UUID REFERENCES transfer_runs(id),
  property_id      UUID REFERENCES properties(id),
  source_type      VARCHAR(20) DEFAULT 'PROFILE' CHECK (source_type IN (
                     'PROFILE','AUTOMATION','SOAP','BOD','GATEWAY')),
  started_at       TIMESTAMPTZ DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  status           VARCHAR(25) CHECK (status IN (
                     'PENDING','RUNNING','SUCCESS','COMPLETE_WITH_ERRORS','FAILED')),
  records_total    INTEGER DEFAULT 0,
  records_success  INTEGER DEFAULT 0,
  records_failed   INTEGER DEFAULT 0,
  runtime_params   JSONB DEFAULT '{}',
  input_file_path  TEXT,
  output_file_path TEXT,
  input_payload    JSONB,
  output_payload   JSONB,
  range_from       INTEGER,
  range_to         INTEGER,
  initiated_by     UUID REFERENCES users(id)
);

-- PER-RECORD ERRORS
CREATE TABLE transfer_errors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID REFERENCES transfer_runs(id) ON DELETE CASCADE,
  row_number      INTEGER,
  raw_data        JSONB NOT NULL,
  error_code      VARCHAR(50),
  error_message   TEXT,
  corrected_data  JSONB,
  corrected_by    UUID REFERENCES users(id),
  corrected_at    TIMESTAMPTZ,
  rerun_id        UUID REFERENCES transfer_runs(id),
  status          VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING','CORRECTED','IGNORED'))
);

-- FILE STORAGE
CREATE TABLE transfer_storage (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id  UUID REFERENCES properties(id),
  folder_path  VARCHAR(500) NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  file_size    BIGINT,
  mime_type    VARCHAR(100),
  storage_key  VARCHAR(500) NOT NULL UNIQUE,
  uploaded_by  UUID REFERENCES users(id),
  uploaded_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (property_id, folder_path, file_name)
);
```

---

## 6. Security Roles

| Role | Permissions |
|---|---|
| `USER` | Run profiles and automations; view Integration Activity for own runs |
| `POWER_USER` | Run profiles; change runtime-overridable params; view all activity |
| `ADMINISTRATOR` | Full access: create/edit/delete profiles, automations, formats, transformations, lookups, storage, config |

```typescript
export function requireTransferRole(minRole: 'USER' | 'POWER_USER' | 'ADMINISTRATOR') {
  return (req: Request, res: Response, next: NextFunction) => {
    const hierarchy = ['USER', 'POWER_USER', 'ADMINISTRATOR'];
    if (hierarchy.indexOf(req.user.transferDeskRole) >= hierarchy.indexOf(minRole))
      return next();
    res.status(403).json({ error: 'Insufficient Transfer Desk permissions' });
  };
}
```

---

## 7. File Structure

```
src/
  modules/
    transfer-desk/
      transfer-desk.router.ts
      transfer-desk.service.ts
      transfer-desk.auth.ts
      transfer-desk.queue.ts
      transfer-desk.history.ts
      transfer-desk.storage.ts
      file-reader/
        file-reader.ts              # Dispatcher for all 4 file types
        csv-txt-reader.ts           # .csv + .txt via csv-parse
        sun-reader.ts               # .SUN SSML/XML via fast-xml-parser
        excel-reader.ts             # .xlsx/.xls via exceljs
        file-validator.ts           # Extension + encoding + size checks
      format-designer/
        format-designer.service.ts
        fsd-parser.ts
        fsd-delimited.ts
        fsd-fixed-width.ts
        fsd-xml.ts
      transformation-designer/
        transformation.service.ts
        tml-parser.ts               # XML string → TMLTransformation struct
        tml-serialiser.ts           # TMLTransformation struct → XML string
        tml-engine.ts               # Execute TML against input doc
        tml-sandbox.ts              # Node vm sandbox for user JS
        tml-functions.ts            # Built-in JS function library
      lookup-designer/
        lookup.service.ts
        lookup.resolver.ts
      adapters/
        pms.adapter.ts
        pos.adapter.ts
        payroll.adapter.ts
        procurement.adapter.ts
      processors/
        gl-processor.ts
        ap-processor.ts
        ar-processor.ts
        po-processor.ts
```

---

## 8. npm Dependencies to Add

```json
{
  "dependencies": {
    "csv-parse":       "^5.5.0",   // .csv and .txt parsing
    "fast-xml-parser": "^4.3.0",   // .SUN (SSML) parsing + TML XML parsing
    "exceljs":         "^4.4.0",   // .xlsx / .xls reading and writing
    "vm2":             "^3.9.0"    // safer JS sandbox for TML user scripts (or use Node built-in vm)
  }
}
```

> **Note on JS sandbox:** Node's built-in `vm` module is used above. For production, evaluate `vm2` or `isolated-vm` for stronger sandboxing of user-supplied TML JavaScript. Set a 2-second execution timeout on all user function calls.

---

## 9. Core Service Flow

```typescript
export async function runProfile(
  profileId: string,
  runId: string,
  runtimeParams: Record<string, unknown> = {}
): Promise<void> {
  const profile = await getProfile(profileId);
  const mergedParams = mergeRuntimeParams(profile.runtimeParams, runtimeParams, profile.allowOverrides);

  // Write PENDING before first record — crash-safe audit
  await updateRunStatus(runId, 'RUNNING');

  // 1. Read file → normalised RawRecord[]
  const filePath = resolveFilePath(profile, mergedParams);
  const ext      = path.extname(filePath).toLowerCase();
  const records  = await readFile(filePath, ext, profile.sourceFormat, profile.fileConfig.excelSheetName);

  // 2. Parse TML transformation (XML → struct, cached per run)
  const tml = parseTML(profile.transformation.tml_script);

  const results = { success: 0, failed: 0 };

  for (const [index, raw] of records.entries()) {
    try {
      // 3. Execute TML: map + set + transform + lookup
      const transformed = await executeTML(tml, raw);

      // 4. Validate against target component business rules
      await validateRecord(transformed, profile.targetComponent);

      // 5. Post to target (GL, AP, AR, PO, etc.)
      await postToTarget(transformed, profile.targetComponent, profile.targetMethod);

      results.success++;
    } catch (err) {
      await saveError(runId, index, raw, err);
      results.failed++;
    }
  }

  // 6. Post-processing file action (RENAME / MOVE / DELETE)
  await applyFileAction(filePath, profile.fileConfig);

  const finalStatus =
    results.failed === 0  ? 'SUCCESS' :
    results.success === 0 ? 'FAILED'  : 'COMPLETE_WITH_ERRORS';

  await updateRunStatus(runId, finalStatus, results);
}
```

---

## 10. BullMQ Queue

```typescript
export type TransferJob =
  | { type: 'RUN_PROFILE';    profileId: string; runId: string; runtimeParams?: object }
  | { type: 'RUN_AUTOMATION'; automationId: string }
  | { type: 'RERUN_ERRORS';   runId: string; errorIds: string[] };

export const transferWorker = new Worker(
  'transfer-desk',
  async (job) => {
    const data = job.data as TransferJob;
    switch (data.type) {
      case 'RUN_PROFILE':    return runProfile(data.profileId, data.runId, data.runtimeParams);
      case 'RUN_AUTOMATION': return runAutomation(data.automationId);
      case 'RERUN_ERRORS':   return rerunErrors(data.runId, data.errorIds);
    }
  },
  { connection: redis, concurrency: 5 }
);
```

---

## 11. Integration Activity (INA)

Three views matching SunSystems INA exactly — default pagination 50 records per page:

**History** — completed runs (`SUCCESS`, `COMPLETE_WITH_ERRORS`, `FAILED`)  
Fields: `integrationId`, `sourceType`, `startTime`, `endTime`, `status`, `succeeded`, `failed`, `source`, `target`, `user`, `method`

**Live** — active runs (`RUNNING`, `PENDING`)  
Same fields, `endTime` replaced with `elapsedTime`

**Schedule** — active automation schedules  
Fields: `name`, `lastStartTime`, `lastEndTime`, `lastResult`, `nextStartTime`, `recurring`, `occurrencesRemaining`, `owner`

---

## 12. Format Designer — FSD Engine

All classifications and their handling:

| Classification | File types | Parser |
|---|---|---|
| `DELIMITED` | `.csv`, `.txt` | csv-parse with FSD-defined delimiter |
| `SINGLE_FIXED_WIDTH` | `.txt` | FSD start+length field slicing |
| `MULTI_FIXED_WIDTH` | `.txt` | FSD prefix pattern matching per record type |
| `OTHER_FLAT` / `USER_XML` | `.txt`, `.xml` | Raw FSD XML script |
| `SIMPLE_XML` | `.xml`, `.SUN` | fast-xml-parser with namespace support |

```typescript
export interface FSDField {
  name:          string;
  output:        boolean;
  fieldSep?:     string;       // absent = fixed-width using maxLength
  validValue?:   string;       // for choice pattern matching
  defaultValue?: string;
  leadingChars?: string;
  trailingChars?: string;
  outputIfEmpty: boolean;
  maxLength:     number;       // default 128
  minLength:     number;       // default 0
  truncate:      boolean;
  quoted:        'yes' | 'no' | 'auto';
}
```

Key rules:
- All text files must be **UTF-8** — validate at upload
- `choice` elements use pattern matching — **performance overhead**, warn in UI
- Field names must be valid XML element names — no numeric start, no half-width Katakana
- `maxOccur = 0` means unlimited repetitions

---

## 13. Lookup Tables

**Critical:** Alpha-collation only — alphabetical text string ranges. **Not suitable for numeric ranges** (dates, journal numbers, amounts). Enforce with a UI warning.

```typescript
export async function resolveLookup(
  tableName: string,
  sourceValue: string,
  propertyId: string | null,
  unknown: 'fail' | 'copy'
): Promise<string> {
  const table       = await getLookupTable(tableName, propertyId); // null = global
  const matchingRow = table.rows.find(row =>
    sourceValue >= row.rangeFrom && sourceValue <= row.rangeTo     // alpha sort
  );
  if (!matchingRow) {
    if (unknown === 'fail') throw new LookupError(`"${sourceValue}" not in "${tableName}"`);
    return sourceValue;
  }
  return matchingRow[table.defaultOutputColumn];
}
```

---

## 14. Record Methods

| Method | Behaviour |
|---|---|
| `AMEND` | Amends existing records only; rejects if not found |
| `CREATE_OR_AMEND` | Creates if absent; amends if exists |
| `BULK_CREATE_OR_AMEND` | Same, optimised for large payloads |
| `CREATE_AS_DRAFT` | Creates in pending-approval state |
| `DELETE` | Deletes matching records |
| `CREATE_REPLACE_OR_DELETE` | Sync: replace if exists in source, delete if absent |
| `CLOSED` | Sets record closed — cannot post transactions |
| `HIDDEN` | Hidden from inquiry; available for processing |
| `SUSPENDED_HELD` | Suspends record |

---

## 15. Hospitality-Specific Profiles

### PMS → GL (Opera / Protel)
- **Profile type**: IMPORT · **Target**: GL · **Method**: CREATE_OR_AMEND
- **Accepted file types**: `.txt` (night audit flat file) or `.csv`
- **Transformation**: Map Room Revenue, F&B, Other Revenue, Taxes → GL account codes via lookup table `PMSRevenueToGL`
- **Profile name**: `PMS_NIGHT_AUDIT_TO_GL`

### POS → GL (Micros / Infrasys)
- **Profile type**: IMPORT · **Target**: GL
- **Accepted file types**: `.csv` or `.SUN` (if Infrasys exports SSML)
- **Transformation**: Net Sales, VAT, Tips, Voids, Discounts per outlet → revenue/liability accounts
- **Profile name**: `POS_SHIFT_CLOSE_TO_GL`

### Sky Jana → PO
- **Profile type**: IMPORT · **Target**: PO · **Method**: CREATE_OR_AMEND
- **Accepted file types**: `.xlsx` (Sky Jana export) or `.xml`
- **Profile name**: `SKYJANA_PO_IMPORT`

### Payroll → GL
- **Profile type**: IMPORT · **Target**: GL
- **Accepted file types**: `.xlsx` or `.csv`
- **Transformation**: Department, Gross Pay, Deductions, Net Pay → wage expense + liability accounts
- **Profile name**: `PAYROLL_TO_GL`

### GL Trial Balance Export
- **Profile type**: EXPORT · **Source**: GL Ledger · **Output**: `.csv` or `.xlsx`
- **Filter**: date range, property, account range · **Consolidation**: sum by account
- **Range control**: Yes (journal number from/to)
- **Profile name**: `GL_TRIAL_BALANCE_EXPORT`

### Inter-Property GL Transfer
- **Profile type**: INTERNAL_TRANSFER
- **Use case**: Copy actuals from property ledger to cluster/corporate rollup
- **Transformation**: Remap property account codes → group chart of accounts
- **Profile name**: `INTER_PROPERTY_GL_TRANSFER`

---

## 16. Error Correction Workflow

1. Run completes `COMPLETE_WITH_ERRORS` or `FAILED`
2. Integration Activity → History → run detail → View Errors
3. UI shows each row: `rowNumber`, `rawData`, `errorCode`, `errorMessage`
4. User edits `correctedData` inline → `PATCH /errors/:id` → status = `CORRECTED`
5. `POST /runs/:id/rerun` creates child run with `parentRunId` reference
6. Child run processes corrected records only; parent audit trail intact
7. Parent status updated to reflect child outcome

---

## 17. API Endpoints

```
# Profiles
POST   /api/v1/transfer-desk/profiles
GET    /api/v1/transfer-desk/profiles
GET    /api/v1/transfer-desk/profiles/:id
PUT    /api/v1/transfer-desk/profiles/:id
POST   /api/v1/transfer-desk/profiles/:id/copy
DELETE /api/v1/transfer-desk/profiles/:id
POST   /api/v1/transfer-desk/profiles/:id/run
POST   /api/v1/transfer-desk/import                 # Multipart: file upload + profileId + runtimeParams

# Automations
POST   /api/v1/transfer-desk/automations
GET    /api/v1/transfer-desk/automations
PUT    /api/v1/transfer-desk/automations/:id
POST   /api/v1/transfer-desk/automations/:id/copy
DELETE /api/v1/transfer-desk/automations/:id
POST   /api/v1/transfer-desk/automations/:id/run

# Integration Activity
GET    /api/v1/transfer-desk/activity/history
GET    /api/v1/transfer-desk/activity/live
GET    /api/v1/transfer-desk/activity/scheduled
GET    /api/v1/transfer-desk/runs/:id
GET    /api/v1/transfer-desk/runs/:id/errors
PATCH  /api/v1/transfer-desk/errors/:id
POST   /api/v1/transfer-desk/runs/:id/rerun
GET    /api/v1/transfer-desk/export/:profileId      # Stream file download

# Format Designer
POST   /api/v1/transfer-desk/formats
GET    /api/v1/transfer-desk/formats
PUT    /api/v1/transfer-desk/formats/:id
POST   /api/v1/transfer-desk/formats/:id/copy
POST   /api/v1/transfer-desk/formats/:id/validate
POST   /api/v1/transfer-desk/formats/:id/test       # Test against sample file upload

# Transformation Designer
POST   /api/v1/transfer-desk/transformations
GET    /api/v1/transfer-desk/transformations
PUT    /api/v1/transfer-desk/transformations/:id
POST   /api/v1/transfer-desk/transformations/:id/copy
GET    /api/v1/transfer-desk/transformations/:id/script     # Raw TML XML
GET    /api/v1/transfer-desk/transformations/:id/form       # Parsed JSON struct
PUT    /api/v1/transfer-desk/transformations/:id/script     # Save raw TML XML
PUT    /api/v1/transfer-desk/transformations/:id/form       # Save from form builder
POST   /api/v1/transfer-desk/transformations/:id/validate
POST   /api/v1/transfer-desk/transformations/:id/test

# Lookup Tables
POST   /api/v1/transfer-desk/lookups
GET    /api/v1/transfer-desk/lookups
PUT    /api/v1/transfer-desk/lookups/:id

# Configuration
GET    /api/v1/transfer-desk/config/export
POST   /api/v1/transfer-desk/config/import
DELETE /api/v1/transfer-desk/config/cleardown        # ADMINISTRATOR only

# Storage
GET    /api/v1/transfer-desk/storage
POST   /api/v1/transfer-desk/storage/upload          # Accepts .csv .txt .SUN .xlsx .xls
GET    /api/v1/transfer-desk/storage/download/:id
DELETE /api/v1/transfer-desk/storage/:id
```

---

## 18. Implementation Sprints

| Sprint | Deliverable |
|---|---|
| 1 | DB schema (all tables), security roles middleware, profile CRUD API |
| 2 | File reader layer — `.csv`, `.txt`, `.SUN`, `.xlsx`; upload validation |
| 3 | FSD parser engine — delimited, fixed-width, XML classifications |
| 4 | TML parser + serialiser (XML ↔ TypeScript struct) |
| 5 | TML executor — map, set, transform (JS sandbox), lookup commands |
| 6 | Built-in JS function library; validate + test endpoints |
| 7 | Lookup Table Designer + alpha-range resolver |
| 8 | GL processor + AP processor + validation rules; manual IMPORT run end-to-end |
| 9 | Error table, correction workflow, child re-run |
| 10 | BullMQ queue, AUTOMATION scheduling (cron), fail_on_error / ignore_invalid |
| 11 | Integration Activity API — history, live, scheduled views |
| 12 | EXPORT profiles — range control, consolidation/summarisation, file output |
| 13 | INTERNAL_TRANSFER + EXTERNAL_TRANSFER profile types |
| 14 | PMS night audit adapter, POS shift-close adapter |
| 15 | Sky Jana PO adapter, Payroll adapter |
| 16 | Config export/import/cleardown, Storage file manager |
| 17 | UI: profile builder, format designer, transformation designer (script + form views) |
| 18 | UI: Integration Activity monitor (live refresh), error correction grid |

---

## 19. Notes for Claude Code

- Use `decimal.js` for **all** monetary transforms — never native floats
- Write `status = PENDING` to `transfer_runs` **before** the first record — crash-safe audit
- Per-record transactions — save error and continue; never abort the entire batch for a single record failure
- Runtime overrides validated against `allow_overrides` whitelist before merging — never trust raw client params
- TML XML with JS `<script>` blocks must use **CDATA** — handle encoding/decoding in `tml-parser.ts` and `tml-serialiser.ts`
- JS user functions execute in a **vm sandbox with 2-second timeout** — prevent runaway scripts
- Adapter layer is **pluggable** — `readFile()` dispatches by extension; new file types never touch core service logic
- BullMQ jobs must be **idempotent** — safe to retry with same `runId`
- FSD `choice` elements carry a pattern-matching performance overhead — show a UI warning
- Lookup tables are **alpha-collation only** — validate and warn users attempting numeric ranges in the UI
- All text files must be **UTF-8** — validate encoding at upload and reject non-UTF-8 with a clear message
- Excel workbook: default to first worksheet; allow `excelSheetName` override in `file_config`
- `.SUN` files bypass FSD parsing and TML transformation if the source component already matches the target component — detect and short-circuit in the service layer
- `ignoreInvalid` on automations risks data integrity with sequential profiles — surface this as a warning in the UI
- Payload numeric fields use `.` decimal separator, no thousands separator; date fields use `ddmmyyyy` format
