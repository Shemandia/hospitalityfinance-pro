# HFP Codebase Assessment — Consolidated Results

**Date:** 2026-04-07
**Scope:** Gap analysis against three HFP specification documents
**Process:** Followed `CODEBASE_ASSESSMENT_TASKS.md` Phases 1–4 via 3 parallel research agents
**Exclusions honored:** Inventory Control, Purchase Order Processing, Purchase Invoice Processing, Requisitions, Sales Order Processing, ItemMaster, Supplier master-data management, PurchaseOrder/SalesOrder BODs, ION Workflows for purchase/requisition approval, Value Labels for Purchase/Sales Order BOD fields — all handled by Sky Jana MMS.

---

## Executive summary

HFP has a **solid, working core ledger** (GL, AP, AR, FX, Period, Consolidation, Audit, SAF import, COA import, payment runs, bank reconciliation) with three major areas where the codebase diverges from the three specs:

1. **Financials Admin spec** — Core ledger is well-implemented against the spec. **Recently completed** (Sprints 15–17): Process Locks, Payment Profiles, Revaluation Profiles, Ledger Revaluation engine, Year-End P&L Cleardown, Intercompany Journals with dual-approval workflow. **Still missing**: Fixed Assets, Corporate Allocations, multi-stage Authorization workflow, Financial Calendars, 3-Writer Reporting (FAL/FSL/FTL). Several ENUMs and tables need **expanding** rather than rebuilding (`JournalSource`, `JournalLine` analysis dimensions, missing `ledger_setup` table).

2. **Transfer Desk Technical spec** — The current `integration/` module is a functional layer of ad-hoc connectors (Opera Cloud, Sky Jana, Simphony, Mews, SAF, Bank, Payroll, Inbound) glued together by a custom `transform-engine.ts`. The spec's Transfer Desk model (18 tables, 73 endpoints, 2 custom libraries: `@hfp/fsd-engine` and `@hfp/tml-engine`) **does not exist as such**. `InterfaceDefinition` conflates what the spec separates into `transfer_formats` and `transfer_transformations`. The parsing rules are correct (Jana whole-integer vs ÷1000, Opera ÷1000); they just need to be ported into FSD/TML when those engines are built.

3. **Transfer Desk Self-Service Designer (UI) spec** — The UI is **~6% complete**. Only one embedded page exists (`settings/integrations/transfer-desk/page.tsx`), which is effectively Step 5 (Mapping) of the spec's 8-step profile wizard. None of the other 16 routes, 9 wizards, visual mapper, Format Designer, Lookup Editor, Automation Builder, File Repository, or Execution History exist. The RBAC divergence is significant — spec requires `transfer:user/power-user/designer/admin` namespace; codebase uses generic `VIEWER/CONTROLLER/ADMIN/SUPERADMIN`.

**What's working today (protect at all costs):**

- GL account CRUD, COA import, trial balance with comparative period
- Journal post / approve / reject workflow
- Period lifecycle (OPEN → CLOSED → LOCKED) with precondition checks
- AP payment run (Propose → Approve → Confirm) with CSV bank file + voucher PDF
- AR invoices, receipts, allocations, ageing, dunning
- FX rates with manual CRUD + ECB import + IAS 21 revaluation
- Consolidation with CTA elimination
- Hardcoded KPI reports (trial balance, balance sheet, cash flow, USALI P&L)
- SAF import end-to-end (journals, lines, suppliers auto-create)
- Bank reconciliation with match candidates
- Process locks (advisory lock table with acquire/release/timeout/cleanup)
- Payment profiles (reusable payment run templates with selection criteria + grouping rules)
- Revaluation profiles (FX revaluation config with auto-reverse + gain/loss accounts)
- Ledger revaluation engine (IAS 21 compliant with process lock + auto-reversal)
- Year-end P&L cleardown (sweep REVENUE+EXPENSE to Retained Earnings, configurable fiscal year)
- Intercompany journals (cross-entity posting, IC account pairs, dual-approval, INTERCOMPANY dimension for consolidation elimination)
- Per-tenant DB isolation + RLS + Entity model in `RLS_MODELS`
- Keycloak refresh-token flow + tenant-scoped navigation helpers

**The other CODEBASE_ASSESSMENT_RESULTS output that predates this file** (`finalv1 findings.md`) covers tenant-isolation security findings and should be read alongside this document — neither supersedes the other.

---

## What's covered by each spec (inventory counts)

| Spec                     | Tables                              | Endpoints           | ENUMs | Business rules | Coverage today                                                                                                                                                                   |
| ------------------------ | ----------------------------------- | ------------------- | ----- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transfer Desk Technical  | 18                                  | 73                  | 12    | 28+            | 0 TD-native tables; 4 overlapping (`InterfaceDefinition`, `ConnectorMapping`, `ImportLog`, `PMSStatistic`). ~30 connector endpoints exist vs 73 spec endpoints. No FSD/TML libs. |
| Financials Admin         | 43                                  | 25+                 | 7     | 15+            | 23 implemented / 8 partial / 12 missing. Core GL/AP/AR/FX/Period solid; Fixed Assets + Allocations + multi-stage auth entirely absent.                                           |
| Self-Service Designer UI | 17 routes, 9 wizards, 15 components | 13 UI-specific APIs | —     | —              | 1 partial route; 0 wizards; 0 visual designers; 0 RBAC matrix. ~6% complete.                                                                                                     |

---

## Critical path to MVP — P0 and P1

This is the ordered fix list if the goal is "ship a product that customers can use end-to-end" within a reasonable horizon.

### P0 — blocks a core financial operation or regression risk

**From Financials Admin:**

1. **Expand `JournalSource` enum** to add `IMPORT`, `SYSTM`, `PAYMT`, `PAYDS`, `DEPRC`, `ALLOC`, `REVAL` — enum migration only, near-zero risk. Period-end processes need these for filtering. Blocks nothing today but every future feature on the list needs it. (`schema-tenant.prisma` Journal model)
2. **Add `ledger_setup` table** for per-BU ledger config (provisional posting mode, rounding method, FX source, tax defaults, authorization workflow). Currencies live on `Entity` today; this is the missing "how does posting work for this BU" configuration. (`schema-tenant.prisma`)
3. **Journal source list fix** — when the new enum values land, update the gl router to expose them in the journal create/post endpoints. Don't let this drift.
4. **Expand `JournalLine` analysis dimensions from 6 to 10** (T7–T10). Spec requires 10; hospitality reporting benefits from the extra dimensions. Schema migration + service updates. (`schema-tenant.prisma` JournalLine)

**From Transfer Desk Technical (blocks new profile-driven work, not existing connectors):**

5. **Add `transfer_profiles`, `transfer_profile_versions`, `transfer_filters`, `transfer_executions`, `transfer_execution_logs` tables.** These are the foundation; nothing in modules 2/3/4/5 can be built without them. (`schema-tenant.prisma`)
6. **Implement `TD-API-001..008`** (execution queue/list/detail/logs/payload/cancel/progress/purge) **and `TD-API-009..020`** (profile + filter CRUD). First batch of endpoints needed for any UI.
7. **RLS policies on `transfer_*` tables** — do this as each table is added, not retroactively.
8. **BullMQ `transfer:{tenant-slug}` worker** wired with per-tenant concurrency limits. Pattern already exists elsewhere; just needs a new worker class.
9. **`is_valid` flag enforcement** — profiles with `is_valid=false` cannot be executed or added to automations.

**From Self-Service Designer UI (the only P0/P1 UI items):**

10. **Transfer Desk RBAC** — add `canTransferDeskUser`, `canTransferDeskPowerUser`, `canTransferDeskDesigner`, `canTransferDeskAdmin` helpers to `useUserRole.ts`. Don't create new Keycloak roles yet; map from the existing 4-level hierarchy for MVP. This unblocks all UI gating work. (1–2 hours.)
11. **Landing page** (`/{tenant}/transfer-desk`) with sidebar nav + quick actions + recent executions + system profiles grid. Without this there's no entry point.
12. **Profile list + detail + execution dialog** (3 pages). The existing `settings/integrations/transfer-desk/page.tsx` can be refactored into the detail view.
13. **Execution history + execution detail pages** — paginated list + record-level log table. Required for users to investigate failures.

### P1 — required for MVP (the full feature set a customer expects)

**Financials Admin:**

- **Corporate Allocations engine** — source/target/ratio/setup/calendar tables + allocation batch run + Charge vs Split logic. USALI distributes undistributed operating expenses to departments; this matters for hospitality.
- **Fixed Assets module** — asset register, depreciation tables, monthly depreciation batch posting to BS + P&L with source `DEPRC`. Only P1 if fixed assets are in customer scope; otherwise defer to P3.
- **Account category hierarchy** — 5-level category structure on `Account` (category1..5, lookup_code, linked_supplier/customer, tax_code, opening_balance, is_control_account, is_intercompany).
- **Analysis dimensions + codes tables** — master data for T1..T10 with per-dimension validation lists / ranges.
- **Multi-stage authorization workflow** — `authorization_stages`, `authorization_teams` tables. Today's `ApprovalRule` is flat; spec wants staged with rejection routing.
- **Process locks** (`process_locks` table) so revaluation, payment run, depreciation, allocation runs cannot execute concurrently.
- **Budget checking on journal post** — integrate the budget variance calculation into the journal post flow with warn/prevent modes.
- **Voucher number streams** — sequential per journal class, separate from journal numbering.
- **Financial calendars** abstraction — currently periods are hardcoded to year/month on Entity.
- **Period lifecycle: add `SOFT_CLOSE`** intermediate state between OPEN and LOCKED, and add flags (`revaluation_run`, `depreciation_run`, `allocations_run`, `year_end_processed`) on Period.

**Transfer Desk Technical (the hard engineering work):**

- **`@hfp/fsd-engine`** custom library — FSD XML parser/writer supporting 6 format classifications (delimited, single_fixed, multiple_fixed, other_flat, user_xml, simple_xml). Handles sequence/choice/record/field elements with all attributes (field-sep, record-sep, validValue, defaultValue, leading/trailingChars, outputIfEmpty, maxLength, truncate, quoted). Include the CSV triple-quote edge case normalization. **Prototype first** — this is the most technically complex item on the whole list.
- **`@hfp/tml-engine`** custom library — TML XML parser + JS sandbox. Four commands: `map`, `set`, `transform`, `lookup`. Slash-separated data paths (spec) converted to dot notation (internal JSON model). `isolated-vm` with 64MB memory cap, 5s timeout, no filesystem/network, ES2020 only. This is the second-hardest item.
- **Automation Engine** — `transfer_automations`, `transfer_automation_steps`, `transfer_automation_schedules` tables + `TD-API-021..030` endpoints + BullMQ flow orchestration (fail-on-error, parameter overrides that don't mutate the underlying profile). Cron scheduling with tenant timezone.
- **Lookup Tables** — `transfer_lookup_tables`, `_columns`, `_rows`, `_values`. Critical detail: lookup ranges use **alphabetical collation**, not numeric. Value types: `constant`, `copy`, `map_to`, `omit`, `reverse_sign`. BU scope resolution with fallback to global.
- **Journal Range Control** — `transfer_journal_ranges` table tracking `journal_number_from/to` per BU × ledger, auto-incrementing on subsequent runs.
- **Port existing connector parsing rules into FSD + TML definitions** — once the engines exist, convert the hardcoded Opera/Jana/Simphony mappers into database-stored `transfer_formats` + `transfer_transformations` rows. The parsing rules (Jana whole-integer vs ÷1000, Opera ÷1000) are already correct in the connectors; it's a migration, not a rewrite.

**Self-Service Designer UI:**

- **Profile creation wizard** — 8 steps with conditional logic per profile type (Import/Export/Process/Internal/External). This is the single largest frontend task on the list.
- **Parameter form framework** — reusable collapsible parameter groups (General, File, Ledger, Range Control, Notifications) with overridable toggles, required indicators, and per-profile-type visibility rules.
- **SSE execution progress** — both backend endpoint (`GET /executions/{id}/progress`) and frontend hook. Backend currently runs sync; this needs a pub/sub layer tied to the BullMQ worker.
- **File Repository stub** — folder tree + file list + upload zone. Even a minimal implementation unblocks wizard Step 2 (Source file upload).
- **Format auto-detection endpoint** (`POST /transfer/formats/detect`) — required by wizard Step 4 (auto-detect classification, delimiter, headers, fields, encoding).

### P2 — required for GA (polish and depth)

**Financials Admin:**

- **3-Writer Reporting** — `report_layouts` + `report_columns` + `report_rows` + `column_heading_codes` tables. Today's hardcoded KPI reports (trial balance, balance sheet, cash flow, USALI P&L) work fine; this is a future flexible report writer replacement.
- ~~**Payment Profiles** — reusable payment run templates.~~ ✅ Done (Sprint 16)
- ~~**Revaluation Profiles** — FX revaluation configuration templates.~~ ✅ Done (Sprint 16)
- **Depreciation tables** — user-defined depreciation curves (straight-line, reducing balance, sum-of-digits, user table).
- ~~**Year-end cleardown** workflow.~~ ✅ Done (Sprint 17) — P&L sweep to Retained Earnings with configurable FY start month, process lock, idempotency check.
- ~~**Intercompany journals**~~ ✅ Done (Sprint 17) — cross-entity posting with mirrored entries, IC account pairs, dual-approval workflow, INTERCOMPANY dimension for consolidation elimination.
- **Multi-currency reporting** with reporting currency columns on JournalLine.

**Transfer Desk Technical:**

- **Server Folder Management** — `transfer_folders`, `transfer_folder_access`, `transfer_files` tables + `TD-API-063..070`. S3 pre-signed URLs, folder hierarchy, per-folder access control.
- **Configuration Export/Import/Cleardown** — `TD-API-031..033`. Serialize all TD config to a single JSON file in S3; double-confirm token-based cleardown.
- **Pre-built hospitality profiles in DB** — once FSD/TML engines exist, ship Opera EZZRV/EZZCL/EZZMS/EZZDS, Jana purchasing voucher / internal movement / inventory differences, Simphony POS as system profiles that tenants can clone.
- **License entitlement gating** — feature tier matrix (Starter/Pro/Enterprise) for Transfer Desk features.

**Self-Service Designer UI:**

- **Visual Transformation Mapper** — three-column layout (source tree, canvas with connection lines, target tree), drag-drop, 4 mapping operations (Direct Map, Set Fixed Value, Transform with Function, Lookup), function library browser, custom JS function editor, TML code view with yellow banner on manual edit, auto-map button.
- **Format Designer GUI** — GUI tab (classification badge, general settings, fields table, live preview) + Code tab (raw FSD XML editor with CodeMirror/Monaco).
- **Lookup Table Editor** — spreadsheet UI with Add Row/Column, cell editing with 5 value types, BU scope selector.
- **Filter Designer** — visual query builder with rule rows (Field, Operator, Value), AND/OR logic, nested groups, preview.
- **Automation Builder** — visual pipeline canvas, cron builder, Run As user selector.
- **Fixed-Width Column Ruler** component for fixed-width format detection.
- **Diff Viewer** for execution payload comparison.

### P3 — post-GA

- **Ledger Conversion** utilities (Module 10 of Financials Admin) — migration from legacy SunSystems. Deprioritized; not needed for new customers.
- **Collaborative editing via WebSocket** on the visual mapper.
- **Execution stats dashboard** (`TD-API-010`) — executions by day, success rate, avg duration, top profiles.
- **XSL alternative to TML**.
- **Advanced depreciation methods** (custom curves per asset).

---

## Quick wins (each < 1 day)

These are low-risk items that close a visible gap fast:

1. **Expand `JournalSource` enum** with the 7 missing values. Migration + enum update. ~1 hour.
2. **Add `canTransferDesk*` helpers** to `useUserRole.ts`. ~1 hour.
3. **Rename-or-delete `withRLSBypassed`** (dead code, flagged in the tenant-isolation audit) and the manual `setEntityDbContext` exports. ~30 mins.
4. **Stub the 9 missing Transfer Desk API-client functions** in `gl-api.ts` (detectFormat, getComponentSchemas, autoMap, getFunctionLibrary, testFunction, validateProfile, dryRun, getExecutionStats, getLicenseEntitlements) so the frontend pages don't break on import. ~2 hours.
5. **Add `GET /api/v1/integration/transfer-desk/components`** returning HFP component schemas (Ledger, AP, AR, COA, Supplier, Customer, AddressBook, PO, Budget). ~3 hours.
6. **Transfer Desk Landing page** (static dashboard with nav + cards). ~3 hours.
7. **Transfer Desk Settings page** stub (Export / Import / Cleardown tabs with no-op mutations). ~3 hours.
8. **File Repository stub page** (folder tree + file list + disabled upload). ~2 hours.
9. **Extract `FieldMappingEditor`** component from the current transfer-desk page so it can be reused in the wizard Step 5. ~3 hours.
10. **Add `tenantSlug` to every TanStack Query key** as a defensive prefix (from the tenant-isolation audit MED-7). ~2 hours.

---

## Recommended implementation order

**Sprint 1 — Enum and schema hygiene (1 week):**

- P0 items 1–4 from the P0 list (JournalSource enum, ledger_setup table, source list fix, 10 analysis dimensions)
- Plus Quick wins 1, 2, 3, 10

**Sprint 2 — Transfer Desk foundation (2 weeks):**

- P0 items 5–9 (TD tables, first 20 endpoints, RLS, BullMQ worker, is_valid enforcement)
- Plus Quick wins 4, 5

**Sprint 3 — Transfer Desk entry UI (2 weeks):**

- P0 items 10–13 (RBAC helpers, Landing, Profile list/detail/execution dialog, Execution history)
- Plus Quick wins 6, 7, 8, 9

**Sprint 4–6 — FSD engine + Profile Wizard (6 weeks):**

- `@hfp/fsd-engine` (prototype first, then full build)
- Profile creation wizard (8 steps with conditional logic)
- Format auto-detection endpoint + file upload flow
- Parameter form framework

**Sprint 7–9 — TML engine + Visual Mapper (6 weeks):**

- `@hfp/tml-engine` with `isolated-vm` sandbox
- Visual Transformation Mapper UI
- Function library browser
- TML code view

**Sprint 10–11 — Automation + Lookup (4 weeks):**

- Automation Engine (tables + API + BullMQ flows + cron)
- Lookup Table Editor (spreadsheet UI)
- Port existing connector rules into FSD/TML definitions

**Sprint 12+ — Financials Admin back-office (variable):**

- Corporate Allocations (2–3 weeks)
- Fixed Assets (3–4 weeks, only if in scope)
- Multi-stage Authorization (1–2 weeks)
- 3-Writer Reporting (3–4 weeks, only if flexible reports requested)

**Estimated total effort to MVP (Sprints 1–9):** ~17 weeks of focused work for a small team. GA (Sprints 10–12): another 4–8 weeks.

---

## Per-domain gap summary tables

### A. Financials Admin — top 15 gaps (see Financials Admin agent report for the full 43-table matrix)

| Spec ID        | Item                                                                               | Status                                          | File(s)                                                                                       | Priority       |
| -------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------- |
| FA-ENUM-001    | `JournalSource` missing `IMPORT/SYSTM/PAYMT/PAYDS/DEPRC/ALLOC/REVAL`               | ⚠️ Partial                                      | `schema-tenant.prisma` Journal                                                                | P0             |
| FA-DB-001      | `ledger_setup` table                                                               | ❌ Missing                                      | `schema-tenant.prisma`                                                                        | P0             |
| FA-DB-013      | `JournalLine` dimensions 7–10                                                      | ⚠️ Partial                                      | `schema-tenant.prisma` JournalLine                                                            | P0             |
| FA-DB-007      | `Account` 5-level category hierarchy + lookup_code                                 | ⚠️ Partial                                      | `schema-tenant.prisma` Account                                                                | P1             |
| FA-DB-008/009  | `analysis_dimensions` + `analysis_codes` master                                    | ❌ Missing                                      | `schema-tenant.prisma`                                                                        | P1             |
| FA-DB-032      | `process_locks` advisory lock table                                                | ✅ Done                                         | `schema-tenant.prisma`, `process-lock/service.ts`                                             | P1             |
| FA-DB-033..035 | Fixed Assets (`fixed_assets`, `depreciation_tables`, `asset_notes`)                | ❌ Missing                                      | —                                                                                             | P1 if in scope |
| FA-DB-021..025 | Corporate Allocations (5 tables + engine)                                          | ❌ Missing                                      | —                                                                                             | P1             |
| FA-DB-004/005  | Multi-stage authorization (`authorization_stages`, `authorization_teams`)          | ❌ Missing                                      | —                                                                                             | P1             |
| FA-DB-019/020  | Budget definitions missing checking_mode, committed tracking                       | ⚠️ Partial                                      | `schema-tenant.prisma` BudgetDefinition/BudgetLine                                            | P1             |
| FA-DB-031      | Period `SOFT_CLOSE` state + run flags (`yearEndProcessed`, `revaluationProcessed`) | ⚠️ Partial (run flags done, SOFT_CLOSE pending) | `schema-tenant.prisma` PeriodCloseStatus                                                      | P1             |
| FA-DB-006      | `voucher_number_streams` table                                                     | ❌ Missing                                      | `schema-tenant.prisma`                                                                        | P1             |
| FA-DB-026..029 | 3-Writer Reporting (FAL/FSL/FTL)                                                   | ❌ Missing                                      | —                                                                                             | P2             |
| FA-DB-014      | `payment_profiles`                                                                 | ✅ Done                                         | `schema-tenant.prisma`, `ap/payment-profile-service.ts`, `settings/payment-profiles/page.tsx` | P2             |
| FA-DB-030      | `revaluation_profiles`                                                             | ✅ Done                                         | `schema-tenant.prisma`, `fx/ledger-revaluation.ts`, `settings/revaluation-profiles/page.tsx`  | P2             |

**Well-implemented (protect):** Period lifecycle, AP/AR, Payment Run 3-step process, FX rates + revaluation, Consolidation with CTA, Audit log, SAF import.

### B. Transfer Desk Technical — top 15 gaps (see TD Technical agent report for the full 73-endpoint matrix)

| Spec ID         | Item                                                                       | Status       | File(s)                 | Priority |
| --------------- | -------------------------------------------------------------------------- | ------------ | ----------------------- | -------- |
| TD-DB-003       | `transfer_profiles` table                                                  | ❌ Missing   | `schema-tenant.prisma`  | P0       |
| TD-DB-001/002   | `transfer_executions` + `transfer_execution_logs`                          | ❌ Missing   | `schema-tenant.prisma`  | P0       |
| TD-API-001..008 | Execution endpoints (queue/list/detail/logs/payload/cancel/progress/purge) | ❌ Missing   | `integration/router.ts` | P0       |
| TD-API-009..020 | Profile + Filter CRUD endpoints                                            | ❌ Missing   | `integration/router.ts` | P0       |
| TD-BL-026       | RLS policies on `transfer_*` tables                                        | ❌ Missing   | `db/sql/entity-rls.sql` | P0       |
| TD-BL-027       | BullMQ `transfer:{tenant-slug}` worker                                     | ❌ Missing   | `jobs/`                 | P0       |
| TD-DB-010       | `transfer_formats` table (separate from InterfaceDefinition)               | 🔄 Divergent | `schema-tenant.prisma`  | P0       |
| TD-FSD-001..010 | `@hfp/fsd-engine` library (6 format classifications)                       | ❌ Missing   | —                       | P1       |
| TD-TML-001..008 | `@hfp/tml-engine` library + `isolated-vm` sandbox                          | ❌ Missing   | —                       | P1       |
| TD-DB-007..009  | Automation engine tables                                                   | ❌ Missing   | `schema-tenant.prisma`  | P1       |
| TD-DB-012..015  | Lookup tables (4 tables, alpha collation)                                  | ❌ Missing   | `schema-tenant.prisma`  | P1       |
| TD-DB-006       | `transfer_journal_ranges` (Journal Range Control)                          | ❌ Missing   | `schema-tenant.prisma`  | P1       |
| TD-DB-016..018  | Server folder management (3 tables)                                        | ❌ Missing   | `schema-tenant.prisma`  | P2       |
| TD-API-031..033 | Config export/import/cleardown                                             | ❌ Missing   | `integration/router.ts` | P2       |
| TD-HOS-001..010 | Pre-built hospitality profiles as DB rows                                  | ⚠️ Partial   | `connectors/`           | P2       |

**Well-implemented (protect):** Jana parsing rules (`sky-jana-parser.ts:69-75`), Opera ÷1000 rule (`opera-cloud-mapper.ts`), transform-engine parsing for 7 source formats, SAF end-to-end flow, connector mappers as algorithms.

**Intentional divergences to document and keep:**

- Dot notation vs slash notation for data paths (JSON-native vs SSML-native)
- No SunSystems `source_component`/`target_component` concept (HFP uses connector types)

### C. Self-Service Designer UI — top 15 gaps (see SSD agent report for the full 17-route matrix)

| Spec ID          | Item                                                  | Status     | File(s)                                        | Priority |
| ---------------- | ----------------------------------------------------- | ---------- | ---------------------------------------------- | -------- |
| UI-RBAC-001..004 | `transfer:user/power-user/designer/admin` RBAC matrix | ❌ Missing | `use-user-role.ts`                             | P0       |
| UI-URL-001       | `/{tenant}/transfer-desk` landing page                | ❌ Missing | —                                              | P1       |
| UI-URL-002       | `/{tenant}/transfer-desk/profiles` list               | ❌ Missing | —                                              | P1       |
| UI-URL-003       | Profile creation wizard (5 types × 8 steps)           | ❌ Missing | —                                              | P1       |
| UI-URL-004       | Profile detail / editor                               | ⚠️ Partial | `settings/integrations/transfer-desk/page.tsx` | P1       |
| UI-URL-005       | Profile execution dialog with SSE                     | ⚠️ Partial | same page                                      | P1       |
| UI-URL-019       | `/{tenant}/transfer-desk/history` execution history   | ❌ Missing | —                                              | P1       |
| UI-URL-020       | Execution detail with record-level logs               | ❌ Missing | —                                              | P1       |
| UI-RT-001        | SSE progress streaming                                | ❌ Missing | —                                              | P1       |
| UI-VM-001..011   | Visual Transformation Mapper (three-column canvas)    | ❌ Missing | —                                              | P2       |
| UI-URL-011       | Format Designer (GUI + Code tabs)                     | ❌ Missing | —                                              | P2       |
| UI-URL-017       | Lookup Table Editor (spreadsheet)                     | ❌ Missing | —                                              | P2       |
| UI-URL-008       | Automation Builder (visual pipeline canvas)           | ❌ Missing | —                                              | P2       |
| UI-URL-018       | File Repository browser                               | ❌ Missing | —                                              | P2       |
| UI-URL-021       | Config Export/Import/Cleardown admin page             | ❌ Missing | —                                              | P3       |

**Well-implemented (protect):** InterfaceDefinition CRUD + PreviewPanel + execution dialog (these will become the Profile detail view). Field mapping table as the foundation for Step 5 of the wizard.

**Intentional divergences to resolve:**

- Role system: map spec roles to existing 4-level hierarchy initially, add Keycloak realm roles later.

---

## Exclusions honored

Per the user's explicit exclusions, the following domains were **not assessed** and should not appear in any remediation task:

- Inventory Control / Inventory Management — Sky Jana MMS
- Purchase Order Processing / Purchase Orders — Sky Jana MMS
- Purchase Invoice Processing / Purchase Invoices — Sky Jana MMS
- Requisitions — Sky Jana MMS
- Sales Order Processing / Sales Orders — not applicable to HFP
- ItemMaster / Item records — Sky Jana MMS
- Supplier master-data management — Sky Jana MMS (HFP has a read-only `Supplier` table for AP matching only)
- PurchaseOrder BODs / SalesOrder BODs (Ch 7 SunSystems Integration Config)
- ION Workflow definitions for purchase/requisition approval
- Value Labels mapping to Purchase/Sales Order BOD fields

**What HFP does own (confirmed in scope):**

- General Ledger including Chart of Accounts, Journal Entry, Period Lifecycle
- Accounts Payable at the control/payment/reporting level (journal imports from Jana land here)
- Accounts Receivable end-to-end
- FX rates + IAS 21 revaluation
- Budgets, Allocations (planned), Consolidation
- Financial Reporting (trial balance, balance sheet, cash flow, USALI P&L)
- Fixed Assets (planned, spec present)
- Transfer Desk for journal-only imports from PMS (Opera), POS (Simphony), Inventory System (Jana), Bank statements

---

## Cross-references

- **Tenant isolation audit** — see `finalv1 findings.md` in this directory for 5 critical, 8 high, 11 medium findings on cross-tenant data exposure. That audit is independent of this assessment and should be read alongside.
- **Spec documents** — `HFP_TransferDesk_TechnicalSpecification_v1_0.md`, `HFP_FinancialsAdmin_TechnicalSpec_v1_0.md`, `HFP_TransferDesk_SelfService_Designer_v1_0.md` in this directory.
- **Assessment process** — `CODEBASE_ASSESSMENT_TASKS.md` in this directory.

---

## Next steps for the development team

1. **Review and prioritize** — this report presents the agents' priority assignments. The team should challenge any P0/P1 that doesn't match actual customer demand (e.g., Fixed Assets may be P3, not P1).
2. **Decide on TD engine build-vs-buy** — `@hfp/fsd-engine` and `@hfp/tml-engine` are the hardest items. Evaluate whether an existing XML-schema library (e.g., xml2js + AJV) can be adapted, or whether a full custom build is required.
3. **Spin off the quick wins** as a single PR so the low-risk items don't get blocked on the heavy lifts.
4. **Adopt this file** as the living roadmap — update the status columns as items move from ❌/⚠️/🔄 to ✅.
