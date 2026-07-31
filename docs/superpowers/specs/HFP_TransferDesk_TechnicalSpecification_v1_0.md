**HospitalityFinancePro**

Transfer Desk Module

Complete Technical Specification

Critical Analysis of SunSystems 6.4.x Transfer Desk

Version 1.0 --- April 2026

HospitalityPro Platform Suite

_Node.js / Fastify / Next.js / PostgreSQL / Keycloak / Redis / BullMQ_

**Table of Contents**

**Executive Summary**

This document provides a comprehensive, module-by-module technical specification for implementing the Transfer Desk within HospitalityFinancePro (HFP). It is derived from a critical examination of the Infor SunSystems Transfer Desk 6.4.x official documentation, cross-referenced with the HFP architecture decisions already established (Node.js/Fastify backend, Next.js frontend, PostgreSQL with schema-per-tenant, Keycloak OIDC, Redis/BullMQ job queues, AWS ECS Fargate).

The specification covers seven modules corresponding to the seven chapters of the SunSystems documentation, plus two additional HFP-specific modules for multi-tenancy and hospitality integration. Each module includes: a critical analysis of the SunSystems design, the HFP adaptation rationale, complete database schema, API endpoint specifications, business logic rules, UI component specifications, and security considerations.

**Modules Covered**

- Module 1: Transfer Desk Core Engine --- Profile execution runtime, result handling, Transfer History

- Module 2: Profile Management --- All 5 profile types (Import, Export, Process, Internal Transfer, External Transfer), runtime parameters, cloning, lifecycle

- Module 3: Automation Engine --- Profile orchestration, sequencing, scheduling, fail-on-error, BullMQ integration

- Module 4: Format Designer (FSD Engine) --- Flat file schema definitions, delimited/fixed-width/XML formats, validation, testing

- Module 5: Transformation Designer (TML Engine) --- Data mapping language, map/set/transform/lookup commands, JavaScript function engine

- Module 6: Lookup Table Designer --- Reference data tables, business-unit scoping, range-based value substitution

- Module 7: Server Folder Management --- Secure file repository, folder access control, upload/download, S3 integration

- Module 8: Multi-Tenancy & License Entitlement --- HFP-specific: tenant isolation, schema separation, feature gating (not in SunSystems)

- Module 9: Hospitality Integration Profiles --- HFP-specific: pre-built profiles for Opera PMS, Sky Jana, MICROS Simphony

**Module 1: Transfer Desk Core Engine**

**1.1 Critical Analysis of SunSystems Design**

The SunSystems Transfer Desk is a Windows desktop application (AutomationDesk.exe) with a hierarchy pane showing profiles and automations, a toolbar for CRUD operations, and a Transfer Results dialog for monitoring execution. Key design observations:

- **Synchronous execution model**: Profiles run in-process within the Windows client. The Transfer Results dialog blocks the UI during execution and shows a spinning progress indicator. This is inappropriate for a SaaS platform where transfers may process millions of records.

- **Command-line interface**: SunSystems allows running profiles via AutomationDesk.exe with -p, -a, -n, -s, -u, -x flags. This maps well to a REST API + background job queue pattern.

- **Four security groups**: Users (run only), Power Users (run + override parameters), Designers (full CRUD), Administrators (+ Server Folder Management). This is a simple but effective RBAC model that must be extended to tenant-scoped permissions in HFP.

- **Transfer History Viewer (TRH)**: A separate function that logs all execution results with start/end times, record counts (success/fail), user ID, component, and method. Payloads can optionally be saved. This is essential for audit trails in hospitality finance.

- **UTF-8 mandate**: All import files must be UTF-8. XML files without encoding declaration default to UTF-8. This simplifies HFP design --- we enforce UTF-8 everywhere.

- **Payload storage**: Input/output payloads are saved to C:\\ProgramData\\Infor\\Payload\\ by default. In HFP, this becomes S3 object storage with tenant-scoped buckets.

**1.2 HFP Architecture Decision**

+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Design Decision** |
| |
| Replace the synchronous Windows desktop model with an asynchronous job-queue architecture. Each profile execution becomes a BullMQ job processed by a dedicated worker pool. The Next.js frontend provides real-time progress via Server-Sent Events (SSE). |
+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**1.3 Database Schema**

All tables below are created in the **tenant schema** (e.g., tenant_ezz.transfer\_\*). The registry schema holds only tenant metadata.

**1.3.1 transfer_executions**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Unique execution identifier

profile_id UUID FK NOT NULL References transfer_profiles.id

automation_id UUID FK NULL If run as part of automation, references transfer_automations.id

automation_step INTEGER NULL Position within automation sequence (1-based)

status ENUM NOT NULL queued, running, completed, failed, cancelled

started_at TIMESTAMPTZ NULL When execution began processing

completed_at TIMESTAMPTZ NULL When execution finished (success or failure)

records_total INTEGER DEFAULT 0 Total records in source data

records_succeeded INTEGER DEFAULT 0 Records successfully transferred

records_failed INTEGER DEFAULT 0 Records that failed validation or transfer

error_message TEXT NULL Top-level error if entire execution failed

error_details JSONB NULL Structured error detail array for per-record failures

runtime_params_snapshot JSONB NOT NULL Frozen copy of runtime parameters used (including overrides)

input_payload_key VARCHAR(500) NULL S3 object key for saved input payload

output_payload_key VARCHAR(500) NULL S3 object key for saved output payload

initiated_by UUID FK NOT NULL Keycloak user ID who triggered execution

job_id VARCHAR(100) NULL BullMQ job ID for correlation

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**1.3.2 transfer_execution_logs**

Per-record transfer log for detailed audit trail and error correction:

---

**Column** **Type** **Nullable** **Description**

---

id BIGSERIAL PK NOT NULL Auto-incrementing log entry ID

execution_id UUID FK NOT NULL References transfer_executions.id

record_index INTEGER NOT NULL 0-based position in source data

status ENUM NOT NULL success, failed, skipped

source_data JSONB NULL Original source record (for error correction)

transformed_data JSONB NULL Post-transformation data (before import)

error_code VARCHAR(50) NULL Machine-readable error classification

error_message TEXT NULL Human-readable error description

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**1.4 API Endpoints**

---

**Method** **Endpoint** **Auth Role** **Description**

---

POST /api/{tenant}/transfer/execute/{profileId} Power User+ Queue a profile for execution with optional runtime parameter overrides

GET /api/{tenant}/transfer/executions User+ List execution history with pagination, filtering by status/date/profile

GET /api/{tenant}/transfer/executions/{id} User+ Get detailed execution result including record-level logs

GET /api/{tenant}/transfer/executions/{id}/logs User+ Paginated record-level execution logs

GET /api/{tenant}/transfer/executions/{id}/payload/{type} Designer+ Download saved input or output payload from S3

POST /api/{tenant}/transfer/executions/{id}/cancel Power User+ Cancel a queued or running execution

GET /api/{tenant}/transfer/executions/{id}/progress User+ SSE endpoint for real-time progress updates

DELETE /api/{tenant}/transfer/executions Admin Purge execution history older than specified date

---

**1.5 BullMQ Job Queue Design**

Each tenant gets a dedicated BullMQ queue named transfer:{tenant-slug}. Jobs are processed by a shared worker pool with concurrency limited to 3 per tenant to prevent resource starvation.

---

**Parameter** **Value** **Rationale**

---

Queue name transfer:{tenant-slug} Tenant isolation for rate limiting and prioritization

Default concurrency 3 per tenant Prevent single tenant monopolizing workers

Job timeout 30 minutes Configurable per profile; longest transfers rarely exceed 20 min

Retry attempts 0 (no auto-retry) Financial data transfers must not auto-retry to prevent duplicates

Backoff N/A Manual re-execution required after investigating failures

Job data { profileId, runtimeOverrides, userId, automationCtx } Minimal; worker fetches full profile from DB

Progress reporting Via BullMQ job.updateProgress() Relayed to frontend via SSE

Result storage PostgreSQL (transfer_executions) BullMQ results expire; DB is source of truth

---

**1.6 Security Model**

The four SunSystems Connect groups map to Keycloak roles within each tenant realm:

---

**SunSystems Group** **HFP Keycloak Role** **Permissions**

---

Users transfer:user Run pre-configured profiles (no parameter changes), view execution history

Power Users transfer:power-user Run profiles with runtime parameter overrides, view history with payloads

Designers transfer:designer Full CRUD on profiles, formats, transformations, lookup tables, automations

Administrators transfer:admin All Designer rights + Server Folder Management + configuration export/import/cleardown

---

+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **CRITICAL: Tenant Isolation** |
| |
| Every API endpoint MUST validate that the authenticated user belongs to the tenant specified in the URL path. The PostgreSQL RLS policies on transfer\_\* tables enforce schema-level isolation. The BullMQ worker sets the search_path to the tenant schema before processing any job. |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 2: Profile Management**

**2.1 Critical Analysis of SunSystems Design**

SunSystems defines five distinct profile types, each with its own Profile Designer dialog. This is the heart of Transfer Desk --- profiles define WHAT data moves, WHERE it goes, and HOW it is transformed. Key observations:

- **Five profile types**: Import, Export, Process, Internal Transfer, External Transfer. Each has distinct source/target component combinations and runtime parameter sets.

- **Import profiles**: Source is an external file (flat/XML); target is a SunSystems component (Ledger, Purchase Order, etc.). Runtime params include business unit, target ledger, journal type, error suspense account, posting options, balancing options.

- **Export profiles**: Source is a SunSystems component; target is an external file. Supports filtering, summarization/consolidation, and Journal Range Control for audit-safe sequential exports.

- **Process profiles**: No file I/O --- triggers SunSystems processes like payment runs, revaluations. Target options depend on selected process.

- **Internal Transfer profiles**: Export + Import in one step within the same database. Source and target are both SunSystems components. Used for cross-business-unit copies, ledger-to-ledger transfers.

- **External Transfer profiles**: File-to-file transformation. Source is an external file; target is a different external file format. No SunSystems component involved on either end (except the transformation engine).

- **Runtime parameter overridability**: Each parameter has an Overridable checkbox. If checked, the parameter can be changed at execution time without editing the profile. This is essential for flexible operations.

- **Mandatory field indicators**: Red exclamation marks on incomplete mandatory fields prevent execution of invalid profiles.

- **Transformations are mandatory**: Even for same-format transfers, a default system transformation is provided. Custom transformations are required when source and target formats differ.

- **Consolidation/Summarization**: Ledger exports/imports can consolidate transactions by selected fields and sum financial values, with control over debit/credit handling (sum separate, net total, detail one/summarize other).

- **Profile filters**: Export and Internal Transfer profiles support Filter Designer for complex AND/OR filter logic on any source data element. Filters support operators including Not Equals with NULL handling.

- **Journal Range Control**: Ledger exports can track journal number ranges per business-unit/ledger combination to prevent duplicate or missed exports --- critical for audit compliance.

- **File handling options**: Generate unique filename, overwrite/append to existing files, client vs server file basis, file encoding selection, post-processing actions (none/delete/rename/move).

- **Email notifications**: Profiles can auto-notify email recipients on completion with success/failure status and custom text.

- **Wildcard support**: Import/Export file names support \* and ? wildcards for batch processing.

**2.2 HFP Adaptation Rationale**

The five profile types are preserved in HFP but adapted for the SaaS multi-tenant context. Key differences:

- **Client file basis eliminated**: No local filesystem access in SaaS. All files go through S3 (Server file basis) or direct upload via the web UI.

- **Process profiles expanded**: Beyond SunSystems processes, HFP Process profiles can trigger internal HFP processes (GL posting, period close, bank reconciliation, FX revaluation).

- **Webhook notifications replace email**: In addition to email, HFP supports webhook callbacks for integration with external systems and Slack/Teams notifications.

- **Versioned profiles**: Every profile edit creates a version record. Executions reference the profile version, not the mutable profile, ensuring audit-trail integrity.

**2.3 Database Schema**

**2.3.1 transfer_profiles**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Profile identifier

name VARCHAR(100) NOT NULL Unique profile name within tenant (UNIQUE constraint)

description TEXT NULL Human-readable description

profile_type ENUM NOT NULL import, export, process, internal_transfer, external_transfer

source_component VARCHAR(100) NULL Source SunSystems-equivalent component (e.g., Ledger, PurchaseOrder, AddressBook) or NULL for imports/external

source_format_id UUID FK NULL References transfer_formats.id for external source data format

target_component VARCHAR(100) NULL Target component or NULL for exports/external

target_format_id UUID FK NULL References transfer_formats.id for external target data format

transformation_id UUID FK NOT NULL References transfer_transformations.id

source_params JSONB NOT NULL Source runtime parameters with overridable flags

target_params JSONB NOT NULL Target runtime parameters with overridable flags

filter_id UUID FK NULL References transfer_filters.id (export/internal only)

filter_enabled BOOLEAN DEFAULT false Whether the filter is active

consolidation_config JSONB NULL Consolidation/summarization settings (ledger only)

range_control_enabled BOOLEAN DEFAULT false Journal Range Control (ledger export only)

email_notification JSONB NULL {enabled, addresses\[\], content}

webhook_notification JSONB NULL {enabled, url, headers, events\[\]}

is_valid BOOLEAN DEFAULT false All mandatory fields complete

version INTEGER DEFAULT 1 Auto-incremented on each edit

created_by UUID NOT NULL Keycloak user ID

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**2.3.2 transfer_profile_versions**

Immutable snapshot of each profile version for audit trail:

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Version record identifier

profile_id UUID FK NOT NULL References transfer_profiles.id

version INTEGER NOT NULL Version number

snapshot JSONB NOT NULL Complete serialized profile state at this version

changed_by UUID NOT NULL Keycloak user ID who made the change

changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**2.3.3 transfer_filters**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Filter identifier

name VARCHAR(100) NOT NULL Unique filter name within tenant

description TEXT NULL Human-readable description

source_component VARCHAR(100) NOT NULL Component this filter applies to

filter_clauses JSONB NOT NULL Array of {field, operator, value, logic} objects representing AND/OR filter tree

created_by UUID NOT NULL Creator user ID

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**2.3.4 transfer_journal_ranges**

Tracks Journal Range Control state per business unit + ledger combination:

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Range record identifier

profile_id UUID FK NOT NULL Export profile using range control

business_unit VARCHAR(20) NOT NULL Business unit code

ledger CHAR(1) NOT NULL Ledger letter (A-K)

journal_number_from BIGINT NOT NULL Start of last exported range

journal_number_to BIGINT NOT NULL End of last exported range

execution_id UUID FK NOT NULL Execution that established this range

exported_at TIMESTAMPTZ NOT NULL When the range was exported

---

**2.4 Runtime Parameters Structure**

The source_params and target_params JSONB columns store parameters with their values and overridability flags. This structure must support the full set of SunSystems runtime parameters:

---

**Parameter** **Profile Types** **Type** **Overridable** **Notes**

---

business_unit All VARCHAR(20) Yes Mandatory at runtime if blank on profile

ledger Ledger-related CHAR(1) A-K Yes Mandatory for ledger source/target

save_payload All ENUM (none/input/output/both) Yes Controls S3 payload archival

file_key Import/Export/External VARCHAR(500) Yes S3 object key for source/target file

file_encoding Import/Export/External VARCHAR(20) Yes Default UTF-8

file_action Import/External ENUM (none/delete/rename/move) Yes Post-processing action on source file

generate_unique_name Export/External BOOLEAN Yes Append timestamp+user to filename

overwrite_existing Export/External BOOLEAN Yes Allow overwriting target file

append_to_existing Export/External BOOLEAN Yes Append to existing target file

journal_type Ledger import VARCHAR(5) Yes Alphanumeric journal type code

error_suspense_account Ledger import VARCHAR(30) Yes Account for unresolvable errors

posting_period Ledger import VARCHAR(8) No PPP/YYYY format

posting_options Ledger import ENUM Yes Post immediately / Hold / Validate only

allow_over_budget Ledger import BOOLEAN No Y/N on profile only

balancing_options Ledger import ENUM Yes Auto-balance / Reject unbalanced / Suspense

post_if_no_errors Ledger import ENUM Yes Post all or none if any errors exist

journal_number_from Ledger export (range) BIGINT No Set by range control, not overridable

journal_number_to Ledger export (range) BIGINT Yes Defaults to highest posted journal number

---

**2.5 API Endpoints**

---

**Method** **Endpoint** **Auth Role** **Description**

---

GET /api/{tenant}/transfer/profiles User+ List all profiles with type filter

GET /api/{tenant}/transfer/profiles/{id} User+ Get profile detail with full params

POST /api/{tenant}/transfer/profiles Designer+ Create new profile (any type)

PUT /api/{tenant}/transfer/profiles/{id} Designer+ Update profile (creates new version)

DELETE /api/{tenant}/transfer/profiles/{id} Designer+ Soft-delete profile

POST /api/{tenant}/transfer/profiles/{id}/clone Designer+ Clone profile with new name

GET /api/{tenant}/transfer/profiles/{id}/versions Designer+ List version history

POST /api/{tenant}/transfer/profiles/{id}/validate Designer+ Validate all mandatory fields are complete

GET /api/{tenant}/transfer/filters Designer+ List all filters

POST /api/{tenant}/transfer/filters Designer+ Create filter

PUT /api/{tenant}/transfer/filters/{id} Designer+ Update filter

DELETE /api/{tenant}/transfer/filters/{id} Designer+ Delete filter (if not referenced by profile)

---

**2.6 Business Logic Rules**

**2.6.1 Profile Validation Rules**

- Profile name must be unique within the tenant

- At least one of source_component or source_format_id must be set (depending on profile type)

- At least one of target_component or target_format_id must be set (depending on profile type)

- transformation_id is always mandatory --- system default provided for same-format transfers

- Import profiles: target_component is mandatory; source_format_id required if non-SSML source

- Export profiles: source_component is mandatory; target_format_id required if non-SSML target

- Process profiles: target_component mandatory; no file parameters required

- Internal Transfer: source_component mandatory; same component auto-set as target; transformation mandatory

- External Transfer: both source_format_id and target_format_id mandatory; no SunSystems components

- Ledger parameters (journal_type, error_suspense_account, etc.) required only when source/target is Ledger

- Filter can only be attached to Export and Internal Transfer profiles

- Range control can only be enabled on Export profiles with Ledger source

- Journal Range Control: journal_number_from defaults to 1 on first run; subsequent runs auto-set to previous journal_number_to + 1

- Profiles with validation errors (is_valid = false) cannot be executed or added to automations

**2.6.2 Consolidation/Summarization Rules**

When consolidation is enabled on ledger transfers:

- User selects Consolidating Columns (group-by fields) and Summing Columns (value fields to total)

- Debit/credit handling options: (a) Sum debits and credits as two separate values, (b) Net total debits and credits, (c) Summarize debits only --- detail credits, (d) Summarize credits only --- detail debits

- Non-consolidating, non-summing fields have no value in output (can be set by transformation)

- Consolidation order can be rearranged by the user

**2.6.3 File Handling Rules**

- **Generate unique filename**: Appends {userId}\_{timestamp} to the base filename

- **Overwrite and Append are mutually exclusive**: Cannot enable both

- **Append to XML files warning**: Appended XML files are not well-formed; append is only suitable for archiving

- **File action after import**: None (default), Delete source file, Rename source file, Move source file to archive folder

- **Wildcard file matching**: \* matches any characters, ? matches single character --- used for batch imports of multiple files

+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **CRITICAL: Sales/Purchase Order Import Restriction** |
| |
| SunSystems documents a known restriction: when importing purchase/sales orders with multiple header lines, only the first header is treated as the header --- all subsequent lines (including lines belonging to other headers) are treated as line items of the first header. HFP must implement proper multi-document parsing to handle multiple orders in a single file. |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 3: Automation Engine**

**3.1 Critical Analysis of SunSystems Design**

Automations group profiles into ordered sequences that execute as a single unit. The Automation Designer provides:

- **Profile selection and ordering**: Profiles are added from an Available pane to a Selected pane with up/down reordering. The execution order in the hierarchy reflects the processing order.

- **Fail-on-Error control**: Per-profile setting --- \'Fail on Error\' stops the entire automation; \'Ignore if Invalid\' continues with remaining profiles. SunSystems warns that \'Ignore if Invalid\' may cause data dependency issues.

- **Runtime parameter overrides per automation step**: The same profile can appear multiple times in an automation with different runtime parameters. Changes to parameters within the automation do NOT modify the original profile.

- **Scheduling via external schedulers**: SunSystems relies on NT Scheduler or other OS-level schedulers. Command line: AutomationDesk.exe -a {name} -n -u {user} -x {password}.

- **Configuration Export/Import/Cleardown**: Full export of all Transfer Desk settings (automations, profiles, formats, transformations, filters, lookup tables) to a file. Import to build a new database. Cleardown to wipe all settings.

- **Progress dialog**: Shows current profile name, position in queue, and links to results. Cannot be closed without terminating the process.

- **Automation History**: Transfer History Viewer shows automation-level results (name, start/end, task count, success/fail count) with drill-down to individual profile results.

**3.2 HFP Adaptation**

+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Design Decision** |
| |
| Automations become first-class BullMQ flow jobs. Each automation is a parent job; each profile step is a child job. BullMQ\'s built-in flow dependencies handle ordering. Fail-on-Error translates to flow failParentOnFailure. Built-in cron scheduling via BullMQ Repeat replaces external OS schedulers. |
+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**3.3 Database Schema**

**3.3.1 transfer_automations**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Automation identifier

name VARCHAR(100) NOT NULL Unique automation name within tenant

description TEXT NULL Human-readable description

is_enabled BOOLEAN DEFAULT true Can be disabled without deletion

created_by UUID NOT NULL Creator user ID

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**3.3.2 transfer_automation_steps**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Step identifier

automation_id UUID FK NOT NULL References transfer_automations.id

profile_id UUID FK NOT NULL References transfer_profiles.id

step_order INTEGER NOT NULL Execution position (1-based, unique per automation)

fail_on_error BOOLEAN DEFAULT true If true, automation stops on this step\'s failure

source_param_overrides JSONB NULL Step-specific source parameter overrides

target_param_overrides JSONB NULL Step-specific target parameter overrides

---

**3.3.3 transfer_automation_schedules**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Schedule identifier

automation_id UUID FK NOT NULL References transfer_automations.id

cron_expression VARCHAR(100) NOT NULL Standard 5-field cron expression

timezone VARCHAR(50) NOT NULL IANA timezone (e.g., Africa/Dar_es_Salaam)

is_active BOOLEAN DEFAULT true Enable/disable schedule without deletion

run_as_user UUID NOT NULL Keycloak user ID for execution context

next_run_at TIMESTAMPTZ NULL Computed next execution time

last_run_at TIMESTAMPTZ NULL Last actual execution time

bullmq_repeat_key VARCHAR(200) NULL BullMQ repeat job key for management

---

**3.4 API Endpoints**

---

**Method** **Endpoint** **Auth Role** **Description**

---

GET /api/{tenant}/transfer/automations User+ List all automations

GET /api/{tenant}/transfer/automations/{id} User+ Get automation with steps and schedule

POST /api/{tenant}/transfer/automations Designer+ Create automation

PUT /api/{tenant}/transfer/automations/{id} Designer+ Update automation (name, desc, steps, order)

DELETE /api/{tenant}/transfer/automations/{id} Designer+ Delete automation

POST /api/{tenant}/transfer/automations/{id}/execute Power User+ Queue automation for execution

GET /api/{tenant}/transfer/automations/{id}/progress User+ SSE endpoint for automation progress

POST /api/{tenant}/transfer/automations/{id}/schedules Designer+ Create cron schedule

PUT /api/{tenant}/transfer/automations/{id}/schedules/{sid} Designer+ Update schedule

DELETE /api/{tenant}/transfer/automations/{id}/schedules/{sid} Designer+ Delete schedule

POST /api/{tenant}/transfer/config/export Admin Export all Transfer Desk configuration to JSON

POST /api/{tenant}/transfer/config/import Admin Import Transfer Desk configuration from JSON

POST /api/{tenant}/transfer/config/cleardown Admin Delete all Transfer Desk configuration (requires confirmation token)

---

**3.5 Business Logic Rules**

- Profiles with is_valid = false cannot be added to automations

- Same profile can appear multiple times in an automation with different parameter overrides

- Step parameter overrides do NOT modify the original profile record

- Fail-on-Error = true: automation stops immediately, remaining steps are marked \'skipped\'

- Fail-on-Error = false (Ignore if Invalid): automation continues, failed step is logged, next step proceeds

- Automation execution creates one transfer_executions record per step, all linked by automation_id

- Configuration Export serializes all profiles, automations, formats, transformations, filters, and lookup tables to a single JSON file stored in S3

- Configuration Import merges or overwrites based on name matching; conflicts reported in import log

- Configuration Cleardown requires a double-confirmation: first API call returns a confirmation_token (valid 60 seconds), second call with token executes the cleardown

- Cron schedules respect tenant timezone; next_run_at is always stored in UTC

**Module 4: Format Designer (FSD Engine)**

**4.1 Critical Analysis of SunSystems Design**

Format Designer defines the structure of external (non-SunSystems) data files using Flat-file Schema Definitions (FSD). This is one of the most technically complex modules. Key observations:

- **Six format classifications**: (1) Delimited, (2) Single Fixed Width Record, (3) Multiple Fixed Width Records, (4) Other Flat Files/User XML, (5) Simple XML, (6) SSML (native SunSystems XML --- no user definition needed).

- **FSD is XML**: The schema definition itself is an XML document using namespace http://www.systemsunion.com/2001/TD/SSTransform/fsd/ version 1.0. It describes flat data structure precisely enough for bidirectional conversion between flat and XML.

- **Core FSD elements**: schema (root), sequence (ordered records), choice (pattern-matched records), record (field container with separator), field (atomic data unit with separator, length, padding, quoting).

- **Field attributes are extensive**: name, output (yes/no), field-sep, valid-value, default-value, leading-chars, trailing-chars, output-if-empty, max-length (default 128), min-length (default 0), truncate (yes/no), quoted (auto/yes/no).

- **Record separators**: Support \\r (carriage-return), \\n (line-feed), \\t (tab), and arbitrary strings. Windows New Line (\\r\\n) is default.

- **Occurrence control**: max-occur and min-occur on sequence, choice, and record elements. max-occur=0 means unlimited. Used for validation and navigation.

- **Choice element for pattern matching**: Matches records based on field lengths, delimiters, field count, and valid-value attributes. Performance overhead warning in documentation.

- **Quoting modes**: auto (default for delimited --- treats data as quoted if it contains the field separator), yes (always strip/add quotes), no (verbatim).

- **Trailing/leading char padding**: Used for fixed-width fields to pad/strip values. First character in the string is used as the filler.

- **Initial lines to ignore**: Configurable number of header lines to skip before parsing begins.

- **Read File**: Import field names from an example data file (requires column headings). Very useful for auto-detection.

- **Simple XML**: GUI-based builder with elements, attributes, namespaces, and occurrences. Supports XSD import.

- **Clone, Edit, Validate, Test, Reset, Delete**: Full lifecycle management. Test compares sample data against the format definition and shows XML output.

- **Text View**: Users can switch between GUI and raw XML editing of the FSD. Once manual XML edits are made, GUI view may become unavailable.

- **XML character restriction**: Only valid XML 1.0 characters allowed in field names. Half-width Katakana explicitly excluded.

**4.2 HFP Adaptation**

+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Design Decision** |
| |
| The FSD engine will be implemented as a standalone Node.js library (@hfp/fsd-engine) that can parse FSD XML definitions and perform bidirectional conversion between flat files and JSON (not XML). JSON is the native intermediate format in HFP, replacing SSML. The FSD XML schema is fully preserved for compatibility, but the runtime operates on JSON objects internally. |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**4.3 Database Schema**

**4.3.1 transfer_formats**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Format identifier

name VARCHAR(100) NOT NULL Unique format name within tenant

description TEXT NULL Human-readable description

classification ENUM NOT NULL delimited, single_fixed, multiple_fixed, other_flat, user_xml, simple_xml

fsd_xml TEXT NOT NULL Raw FSD XML definition stored as text

gui_state JSONB NULL Serialized GUI designer state for round-trip editing

is_system BOOLEAN DEFAULT false System-provided formats (e.g., SSML) cannot be edited or deleted

is_valid BOOLEAN DEFAULT false Last validation result

validation_errors JSONB NULL Array of validation error messages

created_by UUID NOT NULL Creator user ID

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**4.4 FSD Engine Specification**

**4.4.1 Parser: FSD XML to Internal Model**

The FSD parser converts FSD XML into an internal tree of TypeScript objects:

---

**Class** **Properties** **Maps to FSD Element**

---

FsdSchema version, children: (FsdSequence \| FsdChoice)\[\] \<schema\>

FsdSequence name?, output, minOccur, maxOccur, children: (FsdRecord \| FsdSequence \| FsdChoice)\[\] \<sequence\>

FsdChoice name?, output, minOccur, maxOccur, children: (FsdRecord \| FsdSequence \| FsdChoice)\[\] \<choice\>

FsdRecord name, output, recordSep?, minOccur, maxOccur, fields: FsdField\[\] \<record\>

FsdField name, output, fieldSep?, validValue?, defaultValue?, leadingChars?, trailingChars?, outputIfEmpty, maxLength, minLength, truncate, quoted \<field\>

---

**4.4.2 Flat-to-JSON Converter**

The converter reads flat file data and produces JSON objects based on the FSD definition. Processing rules:

- **Initial lines skipped** per the \'initial lines to ignore\' setting

- **Record separator** splits input into records; field separator splits records into fields

- **Fixed-width fields** use max-length to read exact byte counts

- **Trailing/leading chars** are stripped from field values

- **Quoted fields** have surrounding quotes removed; escaped quotes (double quotes) are unescaped

- **Choice elements** perform pattern matching: compare field count, field lengths, valid-values, and separators against each candidate record definition

- **Occurrence tracking** validates min-occur and max-occur; errors generated for violations

- **Output=no** elements are processed for structure navigation but not included in JSON output

**4.4.3 JSON-to-Flat Converter**

The reverse converter generates flat file output from JSON using the FSD definition:

- **Field values padded** using leading-chars (left-pad) or trailing-chars (right-pad) to meet min-length

- **Field values truncated** to max-length if truncate=yes

- **Quoted fields** wrapped in double-quotes with internal quotes escaped

- **Field separators** appended after each field (except last field in record, which uses record separator)

- **Output-if-empty=no** suppresses empty fields from output

- **Valid-value fields with output=no** write the valid-value constant to flat output (marker fields)

**4.5 API Endpoints**

---

**Method** **Endpoint** **Auth Role** **Description**

---

GET /api/{tenant}/transfer/formats Designer+ List all formats

GET /api/{tenant}/transfer/formats/{id} Designer+ Get format detail with FSD XML

POST /api/{tenant}/transfer/formats Designer+ Create new format

PUT /api/{tenant}/transfer/formats/{id} Designer+ Update format definition

DELETE /api/{tenant}/transfer/formats/{id} Designer+ Delete format (if not used by transformation)

POST /api/{tenant}/transfer/formats/{id}/clone Designer+ Clone format with new name

POST /api/{tenant}/transfer/formats/{id}/validate Designer+ Validate FSD XML syntax and structure

POST /api/{tenant}/transfer/formats/{id}/test Designer+ Test format against uploaded sample file

POST /api/{tenant}/transfer/formats/detect Designer+ Auto-detect format from uploaded sample file (Read File equivalent)

---

+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **CRITICAL: CSV Quoting Edge Case** |
| |
| SunSystems warns that Excel CSV exports wrap double-quotes in triple double-quotes, which SSC cannot process. HFP must handle this edge case by normalizing triple-quotes to escaped double-quotes during import preprocessing. |
+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 5: Transformation Designer (TML Engine)**

**5.1 Critical Analysis of SunSystems Design**

The Transformation Markup Language (TML) is the core data processing language of Transfer Desk. It defines how source data is mapped, set, transformed, and looked up to produce target data. Key observations:

- **Four TML commands**: map (source-to-target field mapping), set (fixed value assignment), transform (JavaScript function application), lookup (lookup table value substitution).

- **TML is XML**: The transformation script is an XML document with \<transformation\> as root. It contains \<map\>, \<set\>, \<transform\>, and \<script\> elements.

- **Data paths**: Fully qualified slash-separated paths (e.g., SSC/Payload/Ledger/AccountCode). Support @ notation for XML attributes.

- **Multiple source mapping**: A single target field can receive values from multiple source fields, concatenated in order.

- **does-for-each / passes-value**: Source attributes controlling iteration. Elements with children default to for-each=yes, passes-value=no. Leaf elements default to for-each=no, passes-value=yes. Only one source in a map can have for-each=yes.

- **JavaScript functions**: User-defined functions in \<script\> elements using JavaScript. Used via the \<transform\> command with \<function\> and \<param\> elements. Parameters can come from source data (from-source=yes) or be fixed values, typed as string or number.

- **XML character escaping in scripts**: Less-than signs and other XML-invalid characters must use XML equivalents (&lt;, &gt;) or CDATA sections.

- **Pre-built function library**: Importable JavaScript functions for date conversion, percentage calculation, string capitalization, etc.

- **Auto-generated default transformations**: When source and target are the same SunSystems component, field-to-field mappings are generated automatically.

- **TML Details view vs Script view**: GUI shows source/target data elements with operation columns (Map, Assign To, Function, Lookup, Undefined) and filtering options. Script view shows raw XML.

- **Operations**: Map (direct field copy), Assign To/Set (fixed value), Function/Transform (JS function), Lookup (table substitution), Undefined (unmapped --- field excluded from output).

- **Transformation output encoding**: Configurable via output-encoding attribute (default UTF-8). Also supports output-system-doctype and output-public-doctype for XML output.

- **Clone, Edit, Validate, Test, Reset, Delete**: Full lifecycle. Cannot delete a transformation attached to an existing profile.

- **XSL alternative**: TML is default, but XSL transformations are also supported (Script view only). This provides XSLT 1.0 compatibility.

**5.2 HFP Adaptation**

+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Design Decision** |
| |
| TML is reimplemented as a JSON-based transformation engine (@hfp/tml-engine). The TML XML syntax is preserved for import/export compatibility, but internally the engine operates on JSON transformation rules. JavaScript functions execute in a V8 isolate sandbox (via isolated-vm) for security. Data paths use dot notation (e.g., Payload.Ledger.AccountCode) instead of slash notation. |
+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**5.3 Database Schema**

**5.3.1 transfer_transformations**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Transformation identifier

name VARCHAR(100) NOT NULL Unique transformation name within tenant

description TEXT NULL Human-readable description

script_type ENUM NOT NULL tml, xsl

source_format_id UUID FK NULL Source data format (FK to transfer_formats or NULL for SunSystems component)

source_component VARCHAR(100) NULL Source SunSystems component (if not external format)

target_format_id UUID FK NULL Target data format

target_component VARCHAR(100) NULL Target SunSystems component

tml_xml TEXT NOT NULL Raw TML/XSL XML stored as text

rules_json JSONB NULL Parsed TML rules in internal JSON format (compiled cache)

functions_json JSONB NULL Array of {name, description, params, body} JavaScript functions

is_system BOOLEAN DEFAULT false System-generated default transformations

is_valid BOOLEAN DEFAULT false Last validation result

validation_errors JSONB NULL Validation error messages

created_by UUID NOT NULL Creator user ID

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**5.4 TML Command Specifications**

**5.4.1 Map Command**

Maps data from source to target. Supports single-field, multi-field concatenation, and iterative (for-each) mapping.

---

**Parameter** **Required** **Type** **Description**

---

target Yes String (data path) Fully qualified target path in output data

source Yes (1+) String (data path) One or more source paths. Multiple sources concatenate in order.

source.does-for-each No Boolean If true, iterate over all occurrences (for parent/child structures). Default: yes for nodes with children, no for leaf nodes.

source.passes-value No Boolean If true, pass the field value to output. Default: yes for leaf nodes, no for parent nodes.

---

**5.4.2 Set Command**

Sets a fixed value in the target output:

---

**Parameter** **Required** **Type** **Description**

---

target Yes String (data path) Fully qualified target path

value Yes String Fixed value to write to target

---

**5.4.3 Transform Command**

Applies a JavaScript function to generate the target value:

---

**Parameter** **Required** **Type** **Description**

---

target Yes String (data path) Fully qualified target path

function.name Yes String Name of JavaScript function defined in \<script\>

function.param\[\] 0+ String + attributes Parameters passed to function. from-source=yes reads from input data. type=number\|string controls casting.

---

**5.4.4 Lookup Command**

Substitutes values using a lookup table:

---

**Parameter** **Required** **Type** **Description**

---

table Yes String Lookup table name

business-unit No auto:source \| auto:target \| literal Which business unit context to use for lookup

unknown No fail \| copy Behavior when source value not found: fail (error) or copy (pass through)

target Yes String (data path) Fully qualified target path

source No String (data path) Source value to look up. If absent, default from lookup table is used.

---

**5.5 JavaScript Function Sandbox**

User-defined JavaScript functions execute in a sandboxed V8 isolate with these constraints:

- **No filesystem access**: Functions cannot read/write files

- **No network access**: Functions cannot make HTTP requests

- **Memory limit**: 64MB per isolate

- **Execution timeout**: 5 seconds per function call

- **No require/import**: Only built-in JavaScript (ES2020) available

- **Decimal handling**: Commas as decimal separators are NOT supported --- use full stop (period) only, or apply a function to transform

- **Pre-built function library**: Date conversion, percentage calculation, string capitalization, number formatting --- imported from \@hfp/tml-functions

**5.6 API Endpoints**

---

**Method** **Endpoint** **Auth Role** **Description**

---

GET /api/{tenant}/transfer/transformations Designer+ List all transformations

GET /api/{tenant}/transfer/transformations/{id} Designer+ Get transformation detail

POST /api/{tenant}/transfer/transformations Designer+ Create transformation (specify source/target formats)

PUT /api/{tenant}/transfer/transformations/{id} Designer+ Update transformation

DELETE /api/{tenant}/transfer/transformations/{id} Designer+ Delete (blocked if attached to a profile)

POST /api/{tenant}/transfer/transformations/{id}/clone Designer+ Clone transformation

POST /api/{tenant}/transfer/transformations/{id}/validate Designer+ Validate TML XML structure and function syntax

POST /api/{tenant}/transfer/transformations/{id}/test Designer+ Test transformation against sample input file

GET /api/{tenant}/transfer/transformations/functions/library Designer+ List available pre-built JavaScript functions

POST /api/{tenant}/transfer/transformations/functions/test Designer+ Test a JavaScript function with sample parameters

---

**Module 6: Lookup Table Designer**

**6.1 Critical Analysis of SunSystems Design**

Lookup Tables provide range-based value substitution used by the TML lookup command. Key observations:

- **Alpha collation only**: Lookup tables use alphabetical ordering, NOT numeric. This means they work well for account codes and analysis codes but are NOT recommended for dates, journal numbers, or financial amounts.

- **Range-based rows**: Each row defines a From-To range. Ranges cannot overlap. The source value is matched against these ranges to find the applicable row.

- **Multiple columns**: Each table can have multiple named columns, each containing a different output value for the same range.

- **Column Value Types**: Five types per cell: (1) Constant --- fixed output value, (2) Copy \<Copy\> --- pass through original source value, (3) Map other source value \<Map To\> --- substitute with another source field, (4) Omit value \<Omit\> --- exclude from output, (5) Reverse sign \<Reverse sign\> --- negate the value.

- **Business Unit scoping**: Tables can be Global (apply to all business units) or specific to a single business unit. When executing, the business-unit parameter on the lookup command determines which scope to use.

- **Default values**: If a source value is not present, the default value from the SSX_LOOKUP_VALUE table is used.

- **Unknown handling**: If a source value is present but not found in any range, behavior is controlled by the unknown attribute: fail (error) or copy (pass through).

**6.2 Database Schema**

**6.2.1 transfer_lookup_tables**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Lookup table identifier

name VARCHAR(100) NOT NULL Unique table name within tenant

description TEXT NULL Human-readable description

created_by UUID NOT NULL Creator user ID

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**6.2.2 transfer_lookup_columns**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Column identifier

table_id UUID FK NOT NULL References transfer_lookup_tables.id

name VARCHAR(100) NOT NULL Column name (unique within table)

column_order INTEGER NOT NULL Display/processing order

---

**6.2.3 transfer_lookup_rows**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Row identifier

table_id UUID FK NOT NULL References transfer_lookup_tables.id

business_unit VARCHAR(20) NULL NULL = Global Data; otherwise BU-specific

range_from VARCHAR(100) NOT NULL Start of alpha range (inclusive)

range_to VARCHAR(100) NOT NULL End of alpha range (inclusive)

row_order INTEGER NOT NULL Display order

---

**6.2.4 transfer_lookup_values**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Value identifier

row_id UUID FK NOT NULL References transfer_lookup_rows.id

column_id UUID FK NOT NULL References transfer_lookup_columns.id

value_type ENUM NOT NULL constant, copy, map_to, omit, reverse_sign

value_param VARCHAR(500) NULL Required for constant (the literal value) and map_to (source field path)

is_default BOOLEAN DEFAULT false If true, used when source value is absent

---

**6.3 Lookup Resolution Algorithm**

When the TML engine executes a lookup command, the following resolution order applies:

1.  Determine business unit context from the lookup command\'s business-unit parameter (auto:source, auto:target, or literal BU code). If none specified, use NULL (Global).

2.  Search transfer_lookup_rows for the specified table_id and business_unit WHERE range_from \<= source_value AND range_to \>= source_value (alphabetical comparison).

3.  If a matching row is found, retrieve the transfer_lookup_values for that row and the specified column.

4.  Apply the value_type: constant returns value_param; copy returns the original source value; map_to reads from value_param data path; omit excludes the field; reverse_sign negates the numeric value.

5.  If no matching row is found and a row with is_default = true exists for that table/column/BU, use the default row\'s value.

6.  If no matching row and no default exists, apply the unknown behavior: fail raises an error; copy passes through the original source value.

7.  If business-unit-specific lookup found no match, fall back to Global Data rows (business_unit IS NULL) before applying unknown behavior.

**6.4 API Endpoints**

---

**Method** **Endpoint** **Auth Role** **Description**

---

GET /api/{tenant}/transfer/lookups Designer+ List all lookup tables

GET /api/{tenant}/transfer/lookups/{id} Designer+ Get table with columns, rows, and values

POST /api/{tenant}/transfer/lookups Designer+ Create lookup table

PUT /api/{tenant}/transfer/lookups/{id} Designer+ Update table metadata

DELETE /api/{tenant}/transfer/lookups/{id} Designer+ Delete table (blocked if referenced by transformation)

POST /api/{tenant}/transfer/lookups/{id}/columns Designer+ Add column

DELETE /api/{tenant}/transfer/lookups/{id}/columns/{cid} Designer+ Remove column

POST /api/{tenant}/transfer/lookups/{id}/rows Designer+ Add row with range and values

PUT /api/{tenant}/transfer/lookups/{id}/rows/{rid} Designer+ Update row range and values

DELETE /api/{tenant}/transfer/lookups/{id}/rows/{rid} Designer+ Remove row

---

+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **CRITICAL: Alpha Collation Warning** |
| |
| Lookup tables use alphabetical string comparison, NOT numeric. Range \'010\' to \'099\' will NOT match numeric value 50 (string \'50\' \> \'099\' alphabetically). Always zero-pad numeric values used in lookup ranges to ensure correct alphabetical ordering. |
+------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 7: Server Folder Management**

**7.1 Critical Analysis of SunSystems Design**

Server Folder Management provides a secure file repository on a dedicated Windows file server, restricted by user group access. Key observations:

- **Root directory**: Administrator specifies a shared Windows folder as the root. All Transfer Desk file activity occurs under this root, preventing users from accessing the rest of the file server.

- **Folder-level access control**: Each folder is assigned one or more SunSystems User Groups. Only users in assigned groups can access the folder\'s contents.

- **Administrator-only access**: Only SSC Administrators can create/delete folders, assign groups, and upload/download files.

- **Upload/Download**: Uploading copies a file to the repository; downloading copies a file from the repository to a local/network location.

- **Server file basis**: When a profile uses \'Server\' file basis, it references files in this repository using the path \\\\FileServer\\RootFolder\\MyFolder\\filename.

- **Root directory prerequisite**: Must exist before importing Transfer Desk configuration.

**7.2 HFP Adaptation: S3-Based File Repository**

+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Design Decision** |
| |
| Replace the Windows file server with AWS S3. Each tenant gets a dedicated S3 prefix (s3://{bucket}/tenants/{tenant-slug}/transfer-desk/). Folders become S3 key prefixes. Access control is enforced at the application layer using the same Keycloak role model, with S3 pre-signed URLs for secure upload/download. |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**7.3 Database Schema**

**7.3.1 transfer_folders**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Folder identifier

name VARCHAR(100) NOT NULL Folder name (unique within parent)

description TEXT NULL Human-readable description

parent_id UUID FK NULL NULL = root level; otherwise parent folder

s3_prefix VARCHAR(500) NOT NULL Computed S3 key prefix

created_by UUID NOT NULL Creator user ID

created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**7.3.2 transfer_folder_access**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL Access record identifier

folder_id UUID FK NOT NULL References transfer_folders.id

role_name VARCHAR(50) NOT NULL Keycloak role name (e.g., transfer:user, transfer:designer)

---

**7.3.3 transfer_files**

---

**Column** **Type** **Nullable** **Description**

---

id UUID PK NOT NULL File record identifier

folder_id UUID FK NOT NULL References transfer_folders.id

filename VARCHAR(255) NOT NULL Original filename

s3_key VARCHAR(500) NOT NULL Full S3 object key

file_size BIGINT NOT NULL File size in bytes

content_type VARCHAR(100) NULL MIME type

encoding VARCHAR(20) DEFAULT \'UTF-8\' Character encoding

uploaded_by UUID NOT NULL Uploader user ID

uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

---

**7.4 API Endpoints**

---

**Method** **Endpoint** **Auth Role** **Description**

---

GET /api/{tenant}/transfer/folders User+ List folders accessible to current user

GET /api/{tenant}/transfer/folders/{id}/files User+ List files in folder (if user has access)

POST /api/{tenant}/transfer/folders Admin Create folder with access group assignments

PUT /api/{tenant}/transfer/folders/{id} Admin Update folder name/description/access groups

DELETE /api/{tenant}/transfer/folders/{id} Admin Delete folder (must be empty)

POST /api/{tenant}/transfer/folders/{id}/upload Admin Get pre-signed S3 upload URL

GET /api/{tenant}/transfer/files/{id}/download User+ (with folder access) Get pre-signed S3 download URL

DELETE /api/{tenant}/transfer/files/{id} Admin Delete file from repository

---

**Module 8: Multi-Tenancy & License Entitlement**

**8.1 HFP-Specific Module (No SunSystems Equivalent)**

SunSystems Transfer Desk is a single-tenant Windows application. HFP operates as a multi-tenant SaaS platform, requiring tenant isolation and license-based feature gating for the Transfer Desk module. This module defines the additional infrastructure required.

**8.2 Tenant Isolation Architecture**

- **Schema-per-tenant**: Each tenant\'s Transfer Desk tables exist in a dedicated PostgreSQL schema (e.g., tenant_ezz.transfer_profiles). The registry schema contains only tenant metadata.

- **Row-Level Security (RLS)**: All transfer\_\* tables have RLS policies enforcing that queries only return rows for the current tenant, as a defense-in-depth measure alongside schema separation.

- **Search path isolation**: Every database connection sets search_path to the active tenant schema before executing any query. BullMQ workers set search_path before processing each job.

- **S3 prefix isolation**: All file operations are scoped to s3://{bucket}/tenants/{tenant-slug}/transfer-desk/. IAM policies prevent cross-tenant access.

- **BullMQ queue isolation**: Queue name includes tenant slug (transfer:{tenant-slug}), enabling per-tenant rate limiting and monitoring.

- **Keycloak realm isolation**: Each tenant has its own Keycloak realm with Transfer Desk roles defined. Cross-tenant authentication is impossible.

**8.3 License Entitlement for Transfer Desk**

Transfer Desk capabilities are gated by the tenant\'s license tier:

---

**Feature** **Starter** **Professional** **Enterprise**

---

Manual import/export profiles 5 profiles Unlimited Unlimited

Process profiles Not available 10 profiles Unlimited

Internal/External Transfer profiles Not available 10 profiles Unlimited

Automations Not available 5 automations Unlimited

Scheduled automations (cron) Not available Not available Unlimited

Format Designer 3 formats 20 formats Unlimited

Transformation Designer 3 transformations 20 transformations Unlimited

Lookup Table Designer Not available 10 tables Unlimited

JavaScript functions in TML Not available Available Available

Configuration Export/Import Not available Available Available

Server Folder Management 1 folder 10 folders Unlimited

Max file size (upload) 10 MB 100 MB 500 MB

Execution history retention 30 days 90 days Unlimited

Payload archival (S3) Not available 90 days Unlimited

Concurrent executions per tenant 1 3 10

Pre-built hospitality profiles Opera PMS only Opera + Jana All (Opera, Jana, Simphony, custom)

Webhook notifications Not available Available Available

API access Not available Available Available

---

**8.4 Entitlement Enforcement**

License entitlements are enforced at three levels:

- **API middleware**: Before processing any request, the Fastify preHandler hook checks the tenant\'s license entitlements in Redis (cached from the registry.tenant_licenses table). If the feature is not entitled, HTTP 403 is returned with a clear upgrade message.

- **BullMQ worker**: Before processing a job, the worker validates that the profile type and execution concurrency are within entitlement limits. Over-limit jobs are rejected with a license_exceeded error.

- **UI feature gating**: The Next.js frontend receives the tenant\'s entitlement summary via the /api/{tenant}/license/entitlements endpoint and conditionally renders/disables features.

**Module 9: Hospitality Integration Profiles**

**9.1 HFP-Specific Module (No SunSystems Equivalent)**

While SunSystems Transfer Desk is a generic integration platform, HFP provides pre-built profiles specifically designed for hospitality system integrations. These are installed as system profiles during tenant provisioning and cannot be deleted (but can be cloned and customized).

**9.2 Oracle Opera PMS Integration Profiles**

Four pre-built import profiles for Oracle Opera Cloud PMS data, matching the established HFP integration spec:

---

**Profile Name** **Opera File Type** **Target Component** **Description**

---

Opera Revenue Import EZZRV Ledger (Journal Import) Daily revenue postings: room revenue, F&B, spa, other. Parsing rule: amounts use ÷1000 (3 implied decimals).

Opera City Ledger Import EZZCL Ledger (Journal Import) City ledger / AR transactions. Same ÷1000 parsing rule.

Opera Miscellaneous Import EZZMS Ledger (Journal Import) Miscellaneous charges, adjustments, and deposits. Same ÷1000 parsing rule.

Opera Deposits Import EZZDS Ledger (Journal Import) Guest deposit transactions (advance payments). Same ÷1000 parsing rule.

---

**9.3 Sky Jana MMS Integration Profiles**

---

**Profile Name** **Direction** **Target/Source** **Description**

---

Jana Purchasing Voucher Import Import Ledger (AP Invoice) Purchasing vouchers from Sky Jana. Parsing rule: amounts are whole integers (TZS zero-decimal). Source detected by Journal Type field.

Jana Internal Movement Import Import Ledger (Journal Import) Inter-store transfers, consumption postings. Parsing rule: amounts use ÷1000 (3 implied decimals).

Jana Inventory Differences Import Import Ledger (Journal Import) Stock-take variance postings. Same ÷1000 parsing rule as internal movements.

Jana Purchasing Export Export Ledger (AP Transactions) Export approved AP transactions back to Jana for payment tracking.

---

**9.4 MICROS Simphony POS Integration Profiles**

---

**Profile Name** **Direction** **Description**

---

Simphony POS Revenue Import Import Daily POS revenue from Simphony Report Builder exports. Uses the semicolon-delimited 9-field format with location code \'EZZ\'.

Simphony STS Gen2 Live Import Import Real-time revenue import via Simphony STS Gen2 API (OpenID Connect / id_token auth). Process profile triggers API polling.

---

**9.5 Pre-Built FSD Formats**

Each integration profile includes a matching FSD format definition:

---

**Format Name** **Classification** **Separator** **Key Fields**

---

Opera EZZRV Format Delimited Pipe (\|) BusinessDate, RevenueCenter, AccountCode, Amount, CurrencyCode, Reference

Opera EZZCL Format Delimited Pipe (\|) BusinessDate, GuestName, FolioNumber, AccountCode, Amount, CurrencyCode

Jana Purchasing Voucher Format Delimited Semicolon (;) VoucherNo, VoucherDate, SupplierCode, ItemCode, Quantity, UnitPrice, TotalAmount, AccountCode, JournalType

Jana Internal Movement Format Delimited Semicolon (;) MovementNo, MovementDate, FromStore, ToStore, ItemCode, Quantity, Amount, MovementType

Simphony POS Format Delimited Semicolon (;) LocationCode, BusinessDate, RevenueCenter, MajorGroup, FamilyGroup, Amount, TaxAmount, Covers, TransactionCount

---

**9.6 Pre-Built TML Transformations**

Each integration profile includes a matching transformation that maps the external format to HFP\'s internal ledger journal structure. Key transformation rules:

- **Opera transformations**: Map Opera account codes to HFP COA codes via a lookup table (Opera_Account_Mapping). Apply ÷1000 division to all amount fields. Set journal type from profile runtime parameter.

- **Jana Purchasing transformation**: Map Jana supplier codes to HFP supplier master via lookup table (Jana_Supplier_Mapping). Amounts are whole integers --- no division needed. Map to AP invoice structure (DR Expense, CR AP 2100).

- **Jana Internal Movement transformation**: Apply ÷1000 division. Map Jana store codes to HFP cost centers via lookup table (Jana_Store_Mapping).

- **Simphony transformation**: Map Simphony revenue centers to HFP account codes via lookup table (Simphony_Revenue_Mapping). Parse the 9-field semicolon format per the established simphony_to_jana.py converter logic.

+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **CRITICAL: Parsing Rule Detection** |
| |
| The source system is detected by the Journal Type / Source field in the data. Jana purchasing uses whole integers (TZS zero-decimal). Jana internal movements and Opera PMS use ÷1000 (3 implied decimals). The transformation MUST apply the correct division factor based on the detected source --- incorrect parsing would result in amounts that are 1000x too large or too small. |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Appendix A: Complete Table Summary**

Summary of all database tables introduced by the Transfer Desk module (all in tenant schema):

---

**Table Name** **Module** **Purpose**

---

transfer_executions 1 - Core Engine Execution history and results

transfer_execution_logs 1 - Core Engine Per-record execution audit trail

transfer_profiles 2 - Profile Management Profile definitions (all 5 types)

transfer_profile_versions 2 - Profile Management Immutable profile version snapshots

transfer_filters 2 - Profile Management Export/Internal transfer filter definitions

transfer_journal_ranges 2 - Profile Management Journal Range Control state per BU/ledger

transfer_automations 3 - Automation Engine Automation definitions

transfer_automation_steps 3 - Automation Engine Ordered profile steps within automations

transfer_automation_schedules 3 - Automation Engine Cron schedules for automated execution

transfer_formats 4 - Format Designer FSD format definitions

transfer_transformations 5 - TML Engine TML/XSL transformation definitions

transfer_lookup_tables 6 - Lookup Designer Lookup table metadata

transfer_lookup_columns 6 - Lookup Designer Lookup table column definitions

transfer_lookup_rows 6 - Lookup Designer Lookup table range rows

transfer_lookup_values 6 - Lookup Designer Lookup table cell values

transfer_folders 7 - Folder Management File repository folder hierarchy

transfer_folder_access 7 - Folder Management Folder-to-role access control

transfer_files 7 - Folder Management File metadata and S3 key references

---

**Appendix B: API Endpoint Summary**

Total unique API endpoints across all modules: **73 endpoints**. All endpoints follow the pattern /api/{tenant-slug}/transfer/\... and require Keycloak OIDC bearer token authentication. Tenant slug is extracted from the URL path and validated against the token\'s realm.

**Appendix C: Technology Stack Reference**

---

**Component** **Technology** **Purpose**

---

Backend API Node.js + Fastify REST API server with OpenAPI spec

Frontend Next.js (React) Transfer Desk UI with profile designers, format editors, TML visual editor

Database PostgreSQL 16+ Multi-tenant schema-per-tenant with RLS

Authentication Keycloak (OIDC) Tenant-scoped realms with Transfer Desk role definitions

Job Queue Redis + BullMQ Async profile execution, automation orchestration, cron scheduling

Object Storage AWS S3 File repository, payload archival, configuration export/import

FSD Engine \@hfp/fsd-engine Custom Node.js library for flat file schema definition parsing and conversion

TML Engine \@hfp/tml-engine Custom Node.js library for transformation markup language execution

JS Sandbox isolated-vm V8 isolate for secure user-defined JavaScript function execution

Container Runtime AWS ECS Fargate Serverless container hosting for API and worker processes

Monitoring CloudWatch + Prometheus Execution metrics, queue depth, error rates per tenant

---
