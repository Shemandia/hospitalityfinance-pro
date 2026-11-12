# HospitalityFinance Pro — Remediation Report and Implementation Brief

Nov 11, 2026 · @SHABANI RAMADHANI

## 1. Summary

HospitalityFinance Pro has a strong accounting engine but is not yet a scalable, user-defined ERP that accepts other systems' files. Three things block that goal: the user-defined import path fails at the posting step, tenant databases have no reliable upgrade path, and business rules are hard-coded in source instead of stored as tenant configuration.

**Scope reviewed.** Repository `Shemandia/hospitalityfinance-pro`, branch `fix/p0-quick-wins`, commit `03b2b0f` (31 July 2026). The `main` branch is at `2cb6248` (11 March 2026) and is missing most of the product, so it was not the basis for this review. Nothing in the repository was changed.

**How to use this brief.** Sections 3 to 5 explain what is structurally wrong and the target design. Section 6 lists every hard-coded value and where it must move. Section 7 is the full findings register with file and line references. Section 8 is the ordered work plan with acceptance criteria. Every finding has an ID (for example `IMP-01`) so commits and pull requests can reference it.

**Severity scale used throughout.**

| Level | Meaning                                                                                                      |
| ----- | ------------------------------------------------------------------------------------------------------------ |
| P0    | Wrong numbers, failed postings, data loss or a security hole. Fix before any hotel goes live.                |
| P1    | Blocks the stated goal (scalable, user-defined, open to other systems). Fix before a second tenant.          |
| P2    | Quality, maintainability or hardening. Fix as part of the same work packages where the file is already open. |

## 2. Working rules for the implementer

These rules apply to every work package in section 8. They exist because the current test suite passed while the import path was broken.

1. **Branch and merge first.** Merge `fix/p0-quick-wins` into `main` before new work (WP-0). All later work branches from `main`, one finding ID per commit, conventional commit messages that name the ID.
2. **No hard-coded business values.** A value belongs in source only if it is true for every tenant, every country and every source system forever. Everything else follows the placement rule below.
3. **Prove it against a real database.** Every fix to posting, imports, tenancy or security needs an integration test that runs against PostgreSQL. A mocked unit test alone does not close a finding.
4. **Schema changes are migrations.** No `prisma db push` outside local development. Each change is a migration that applies cleanly on an empty database and on a copy of an existing tenant.
5. **One canonical path.** Do not add a fourth way to import or a second way to post. Extend the canonical path in section 5 and delete what it replaces.
6. **Fail closed.** Authorization, approval and validation errors stop the operation. Never `catch` and continue on a control check.
7. **Type the boundaries.** New code has no `as any`. Request bodies are validated with Zod. Service inputs use the Prisma-generated types.
8. **Do not edit applied migrations.** Add a corrective migration instead.

**Placement rule for values that are currently hard-coded**

| Kind of value                                                                 | Where it must live                                                                                              | Who changes it                 |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Infrastructure address or secret (database, Redis, mail, storage)             | Environment, read once through a validated config module that fails at startup when a required value is missing | Operator                       |
| Platform-wide limit or default (pool size, upload limit, token lifetime)      | Same config module, with a documented default                                                                   | Operator                       |
| Tenant plan limit (properties, users, import concurrency, modules)            | Registry database, `TenantEntitlement`                                                                          | Platform admin                 |
| Entity setting (currencies, time zone, fiscal calendar, locale, tolerances)   | Tenant database, entity or ledger settings tables                                                               | Tenant admin, in the UI        |
| Business mapping (source code to account, department, tax code, journal type) | Tenant database, lookup and mapping tables                                                                      | Tenant finance user, in the UI |
| Report layout and KPI definition                                              | Tenant database, `ReportDefinition` rows created from a seed template at onboarding                             | Tenant finance user            |
| Source-system file layout and decimal rule                                    | Tenant database, `TransferFormat` and `TransferTransformation`, seeded from a template library                  | Tenant finance or IT user      |
| Integration credentials and endpoints                                         | Tenant database, encrypted, one row per entity and source system                                                | Tenant admin                   |

## 3. Architecture failures

Eleven structural problems explain most of the individual findings in section 7. Fixing findings one by one without fixing these will not reach the goal. Paths are relative to `apps/api/src` unless they start with `apps/` or `packages/`.

| ID     | Failure                                            | Evidence                                                                                                                                                                                                                                                                                                                   | Consequence                                                                                                                                                                                    |
| ------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARC-01 | Three separate ingestion paths                     | Hard-coded connectors in `modules/integration/connectors/` (Opera, Simphony, Mews, Sky Jana, SAF, bank, payroll); the interface-definition engine in `modules/integration/transform-engine.ts` and `routes/interfaces.ts`; Transfer Desk in `jobs/transfer-desk-*.ts` with `packages/fsd-engine` and `packages/tml-engine` | Each path has its own parsing, mapping, duplicate check and posting behaviour. A new source system means new code, not new configuration.                                                      |
| ARC-02 | No canonical posting contract                      | `Journal` has no transaction date, no ledger and no source-document key (`db/schema-tenant.prisma:710`); services are called with `as any` inputs                                                                                                                                                                          | Imports cannot place a transaction in the right day or period, cannot be de-duplicated at the database, and each caller invents its own input shape.                                           |
| ARC-03 | Tenant schema has no lifecycle                     | Provisioning runs `prisma db push` (`modules/tenant/provisioning-service.ts:227`); the migration chain fails on an empty database at `20260407000001_transfer_desk_tables`; registry and tenant migrations share one folder; `db/schema.prisma` is a dead third schema                                                     | Tenant databases have no migration history. There is no safe way to upgrade tenant 2 to tenant 200 to a new release.                                                                           |
| ARC-04 | Connection model does not scale                    | One Prisma client and pool per tenant per process, up to 50 (`db/tenantPool.ts:23`); eviction disconnects a client that may be mid-request (`tenantPool.ts:44-75`); every query is wrapped in its own transaction (`db/rlsMiddleware.ts`); no connection pooler                                                            | Connections grow with tenants times processes. PostgreSQL connection limits are reached long before CPU or memory.                                                                             |
| ARC-05 | Tenant context is not safely bound to the request  | `app.ts:104` still calls `enterRequestContext`, which uses `AsyncLocalStorage.enterWith` (`db/requestContext.ts:47`), although the file itself documents that this can lose context                                                                                                                                        | Under load a request can run with another request's tenant or entity. This was raised in the April audit and is still open.                                                                    |
| ARC-06 | Integration credentials are platform-wide          | Opera, Mews and Sky Jana SFTP credentials are read from `process.env` (`OHIP_*`, `MEWS_*`, `SKY_JANA_SFTP_*`); there is no per-tenant connection table and no encryption anywhere in the codebase                                                                                                                          | Only one hotel group's source systems can be connected per deployment. Tenant database URLs with passwords sit in plain text in the registry (`schema-registry.prisma`, `Tenant.databaseUrl`). |
| ARC-07 | Business rules are source code                     | Report layouts, KPI department rules, currency lists, source-system code tables and decimal rules are constants (section 6)                                                                                                                                                                                                | The product is not user-defined. A hotel with a different chart of accounts gets wrong KPIs and wrong statements until a developer edits code.                                                 |
| ARC-08 | Accounting integrity lives only in the application | No check constraints on `journal_lines`; no trigger protecting posted journals; only `audit_events` has immutability triggers; row-level security covers 55 of 101 tables and skips `journal_lines`; the tenant application role owns its database                                                                         | Any script, raw query or future bug can write an unbalanced or altered posted journal. Database-level isolation between entities is partial.                                                   |
| ARC-09 | Controls fail open                                 | `modules/gl/service.ts:536-542` catches an authorization-check error and continues; auto-post failure in `jobs/transfer-desk-pipeline.ts:356-364` is logged and ignored                                                                                                                                                    | A fault in the approval workflow lets a journal through as a postable draft.                                                                                                                   |
| ARC-10 | The period model is calendar months only           | `Period` has `year` and `month` and no start or end date, no adjustment period (`db/schema-tenant.prisma:524`)                                                                                                                                                                                                             | No 13th or audit-adjustment period, no 4-4-5 calendars, and a date cannot be resolved to a period with a query.                                                                                |
| ARC-11 | Tests do not exercise the real system              | 684 API tests run in about 2 seconds against mocks; 7 integration files are skipped without a database; CI never provides one; 3 of 49 integration tests fail when run                                                                                                                                                     | The two import defects in section 7 (IMP-01, IMP-02) pass every existing test.                                                                                                                 |

## 4. Proposed multi-tenant architecture

Keep one PostgreSQL database per tenant, and fix how those databases are created, connected to, upgraded and secured. The isolation model is sound for financial data; the failures are in the machinery around it.

**Why keep database-per-tenant.** Each hotel group gets its own backup, restore, export and deletion, and one tenant's month-end cannot slow another's. It is already built. The alternative, one shared database with a tenant column, would mean adding that column and new security policies to all 101 tables. Revisit that only if the platform reaches several hundred small tenants.

&#91;embedded content: target multi-tenant architecture · control plane, pooler, data plane\]

API and worker processes hold no tenant state. They look the tenant up in the registry, reach its database through the pooler, and the migration runner is the only thing that changes a tenant's schema.

### Design decisions

| Area                    | Today                                                                     | Target                                                                                                                                                                                                                                                                       | Closes |
| ----------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Tenant location         | Full connection string with password, plain text, in `Tenant.databaseUrl` | Registry stores host, database name and role separately; the password is encrypted with a platform key supplied by the environment or a key service. Decrypted only in memory.                                                                                               | ARC-06 |
| Schema lifecycle        | `prisma db push` at provisioning; broken migration chain                  | One clean baseline migration for tenant databases and one for the registry, in separate folders. Provisioning runs `migrate deploy`. The registry records the schema version of every tenant.                                                                                | ARC-03 |
| Upgrades                | None                                                                      | A migration runner command that walks all tenants, applies pending migrations, records the result per tenant, stops on first failure, and can resume. The API refuses requests for a tenant whose version is behind the running release and reports it as under maintenance. | ARC-03 |
| Connections             | Pool per tenant per process, no pooler                                    | A connection pooler in transaction mode in front of PostgreSQL. Each tenant client is capped at a small configured connection limit. Idle tenant clients are closed only after their in-flight work finishes.                                                                | ARC-04 |
| Request context         | `enterWith`                                                               | Every request and every job runs inside `runWithContext`. Data access throws when no tenant is bound instead of falling back.                                                                                                                                                | ARC-05 |
| Database roles          | Application role owns the tenant database                                 | Two roles per tenant: a migration role that owns the schema, and an application role with data rights only. Row-level security is enabled and forced on every entity-scoped table, including child tables such as `journal_lines`.                                           | ARC-08 |
| Integration credentials | Process environment, one set per deployment                               | A tenant table of integration connections: entity, source system, endpoint, encrypted credentials, schedule. Managed in the UI by a tenant admin.                                                                                                                            | ARC-06 |
| Plan limits             | Mix of code constants and registry columns                                | `TenantEntitlement` is the only source: properties, users, enabled modules, import concurrency, upload size, storage quota. Read through one entitlement service with a short cache.                                                                                         | ARC-07 |
| API processes           | One process under PM2                                                     | Stateless instances behind a reverse proxy, count set by the operator. No in-process state other than caches that can be rebuilt.                                                                                                                                            | ARC-04 |
| Workers                 | One supervisor, concurrency 1                                             | Worker processes scaled separately from the API. Job payloads carry the tenant; per-tenant concurrency comes from entitlements.                                                                                                                                              | ARC-04 |
| Files                   | Local folder or S3, whole file in memory                                  | Object storage with one prefix per tenant; files are streamed, never held whole in memory.                                                                                                                                                                                   | IMP-07 |
| Redis                   | Shared keys                                                               | Every key and queue name is prefixed with the tenant code.                                                                                                                                                                                                                   | ARC-05 |
| Observability           | 224 `console.*` calls                                                     | Structured logging through the Fastify logger with request ID, tenant and entity on every line; a health endpoint per dependency.                                                                                                                                            | OPS-06 |
| Backup                  | Not automated                                                             | Scheduled per-tenant dump plus cluster-level point-in-time recovery; a tested restore procedure per tenant.                                                                                                                                                                  | OPS-07 |

### Tenant lifecycle

1. **Provision.** Create the database and both roles, run `migrate deploy`, apply security policies and constraints from migrations (not from separate SQL scripts), seed templates, record the schema version.
2. **Onboard.** The tenant admin picks a chart-of-accounts template, currencies, fiscal calendar, dimensions and report templates. All of it is stored as tenant data and editable afterwards.
3. **Operate.** Requests and jobs resolve the tenant from the registry cache, connect through the pooler as the application role, and set the entity for row-level security inside each transaction.
4. **Upgrade.** Deploy the new release with migrations, run the migration runner, then switch traffic. A tenant that fails migration stays on maintenance and does not block the others.
5. **Offboard.** Export, final backup, deactivate, drop after the retention period recorded in the registry.

**Implementation note.** Transaction-mode pooling only keeps settings made with `set_config(..., true)` inside a transaction, which is how the code already sets the entity. Confirm the Prisma connection-string options required for the pooler against the Prisma documentation for the version in `package.json` before changing connection handling.

## 5. Proposed integration architecture

Every external system reaches the ledger through one pipeline, and everything specific to a source system is tenant data, not code. Transfer Desk is the right foundation; it becomes the only path, and the other two are folded into it.

### The single pipeline

1. **Acquire.** A file arrives by upload, by scheduled SFTP or folder pickup, by a vendor API pull, or by a push to an inbound API. The raw payload is stored in the tenant's object storage with its content hash, and an import run is recorded.
2. **Parse.** A user-defined format describes the layout. The parser reads the file as a stream and emits records.
3. **Transform.** User-defined rules and lookup tables turn source values into ledger values: source code to account code, department, tax code, dimension values, sign, scale.
4. **Build canonical documents.** Records are grouped into canonical documents (below). From this point nothing knows which source system the data came from.
5. **Validate.** Resolve codes to internal IDs, derive the period from the document date, check balance, dimensions, tax codes and open periods, and check for duplicates.
6. **Stage.** Documents are stored as a batch. The profile decides whether the batch waits for review or commits automatically.
7. **Post.** The batch is posted through the same GL, AP and AR services the screens use, as a named system user, under the normal approval rules.
8. **Record.** The import run holds counts, per-record errors, links to the created documents, and supports reprocessing and reversing the whole batch.

### Canonical document contract

This is the contract every import produces and every posting service accepts. It must be a typed, versioned schema in a shared package, validated with Zod.

| Field                                                    | Rule                                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceSystem`                                           | Code of the source, defined by the tenant (for example a PMS, a POS, a materials system). Not an enum in code.                                       |
| `sourceDocumentRef`                                      | The source's own document or batch reference. Unique per entity and source system; enforced by a database unique index. This is the duplicate check. |
| `documentDate`                                           | The business date of the transaction. Drives the period and the exchange-rate date.                                                                  |
| `entityCode`                                             | Resolved to the entity; a file may carry more than one entity.                                                                                       |
| `journalTypeCode`                                        | Tenant-defined journal type.                                                                                                                         |
| `currency`, `fxRate`                                     | Rate optional; when absent it is looked up for `documentDate` using the rate type set on the profile.                                                |
| `lines[].accountCode`                                    | Account **code**, resolved to the ID during validation. Internal IDs never appear in files.                                                          |
| `lines[].debit` / `credit` or signed `amount`            | Decimal strings. Scale and sign convention are applied in the transform step.                                                                        |
| `lines[].dimensions`                                     | Keyed by the tenant's dimension names, all ten available.                                                                                            |
| `lines[].taxCode`, `statValue`, `description`, `lineRef` | Optional.                                                                                                                                            |

Canonical types needed beyond the GL journal: AP invoice and credit note, AR invoice and credit note, supplier, customer, operating statistic (rooms available, rooms sold, covers), bank statement, budget line, exchange rate.

### What a format definition must be able to describe

| Capability                | Today                                           | Required                                                                                                                             |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Record types per file     | One (`packages/fsd-engine/src/types.ts:124`)    | Header, detail and trailer records, selected by a discriminator field or position; trailer control totals checked against the detail |
| Layouts                   | Delimited, fixed-width, simple XML, XLSX        | Add JSON and nested XML with repeating groups                                                                                        |
| Implied decimals and sign | Hard-coded per connector                        | A field attribute: scale, sign position, negative style, thousands separator                                                         |
| Dates                     | Type `date` only                                | Explicit date pattern and time zone per field                                                                                        |
| Encoding                  | Informational only                              | Applied when reading                                                                                                                 |
| File size                 | Whole file in memory, 10 MB limit (`app.ts:48`) | Streamed, limit taken from tenant entitlement                                                                                        |
| Conditional rows          | None                                            | Skip and filter rules by field value                                                                                                 |

### What happens to the existing code

| Existing                                                                                 | Action                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/fsd-engine`, `packages/tml-engine`, Transfer Desk profiles, lookups, batches   | Keep and extend. This is the pipeline.                                                                                                                                                  |
| `modules/integration/transform-engine.ts`, `routes/interfaces.ts`, `InterfaceDefinition` | Migrate saved definitions to Transfer Desk formats and profiles, then delete.                                                                                                           |
| `connectors/saf`, `connectors/sky-jana` parsers and import services                      | Replace with seeded format and transformation templates. The decimal rules and journal-type tables become template rows. Delete the bespoke posting code.                               |
| `connectors/opera-cloud`, `simphony`, `mews` API clients                                 | Keep only the acquisition part (authenticate, fetch, hand records to the pipeline). Credentials come from the tenant's integration connection. Remove their mappers and direct posting. |
| `connectors/bank`, `connectors/payroll`, `connectors/inbound`                            | Same treatment: acquisition adapter plus template.                                                                                                                                      |
| `ConnectorMapping`                                                                       | Fold into lookup tables, with effective dates.                                                                                                                                          |
| `ImportLog` and `TransferExecution`                                                      | One import-run record for all sources.                                                                                                                                                  |

### Unmapped and rejected data

Each profile carries its own policy, chosen by the tenant: reject the document, hold it for review, or post the unmapped amount to a suspense account the tenant names. No suspense account code or tolerance is fixed in code.

## 6. Hard-coded values register

These are the values found in source that must become configuration. Each row names where it lives now and where it must move, using the placement rule in section 2. API paths are relative to `apps/api/src`; web paths to `apps/web`.

### Business rules in code (highest priority)

| ID    | Hard-coded value                                                                                                                                                                                                  | Where                                                                                                                                         | Move to                                                                                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HC-01 | Balance sheet, P&L and USALI report layouts with fixed account-code ranges (`1000`-`1199` cash, `3000`-`3019` rooms revenue, and so on)                                                                           | `modules/reporting/report-engine.ts:790-1110`                                                                                                 | `ReportDefinition` rows created from a chosen template at onboarding; rows select accounts by account type, tag or tenant-defined range, editable in the UI |
| HC-02 | KPI department logic: account codes starting `300`/`301` are rooms, `31`/`32`/`33` are food and beverage, `42`/`43` are food and beverage cost; department names `Rooms` and `Food & Beverage` as string literals | `modules/kpi/service.ts:204-218`, `:518`, `:615`                                                                                              | Tenant-defined KPI definitions: each KPI names the account groups or dimension values it sums. Departments come from a tenant department list               |
| HC-03 | Opera journal-type table (`RROOM`, `RFNB`, `SALES`, and others)                                                                                                                                                   | `connectors/opera-cloud/opera-sun-parser.ts:58`, `connectors/saf/saf-parser.ts:114`                                                           | Seeded lookup table in the tenant's Opera template                                                                                                          |
| HC-04 | Sky Jana journal-type table                                                                                                                                                                                       | `connectors/sky-jana/sky-jana-parser.ts:69`                                                                                                   | Seeded lookup table in the tenant's Jana template                                                                                                           |
| HC-05 | Implied-decimal rules (divide by 1000; whole numbers for purchasing vouchers)                                                                                                                                     | `connectors/saf/saf-parser.ts:184-240`                                                                                                        | Field `scale` attribute in the format definition                                                                                                            |
| HC-06 | Import tolerances: 0.01 for counts, 0.50 for revenue; balance epsilon 0.0001                                                                                                                                      | `connectors/saf/saf-import-service.ts:885-886`, `connectors/shared/suspense.ts:28`                                                            | Profile setting, default from entity settings                                                                                                               |
| HC-07 | Suspense account identified by the literal code `SUSPENSE`                                                                                                                                                        | `connectors/shared/suspense.ts:25`                                                                                                            | Account chosen by the tenant on each import profile                                                                                                         |
| HC-08 | Allowed currencies `USD, EUR, GBP, TZS, AED, QAR`                                                                                                                                                                 | `modules/fx/service.ts:20`                                                                                                                    | The tenant `Currency` table, seeded from the full ISO 4217 list                                                                                             |
| HC-09 | Zero-decimal currency list; `TZS` special case                                                                                                                                                                    | `shared/currency-decimals.ts:25-44`, `modules/fx/service.ts:148`, `apps/web/lib/format.ts:98`                                                 | `Currency.decimalPlaces`, already a column; read it everywhere                                                                                              |
| HC-10 | `"USD"` as fallback currency, 62 occurrences                                                                                                                                                                      | For example `routes/interfaces.ts:617`, `connectors/*/…-client.ts`, `modules/entity/router.ts:247`, `jobs/transfer-desk-record-mapper.ts:113` | No fallback. Use the entity's functional currency; reject the record when a currency is required and missing                                                |
| HC-11 | Journal sources as a database enum (`PMS`, `POS`, `PAYROLL`, `IMPORT`, …)                                                                                                                                         | `db/schema-tenant.prisma:75`                                                                                                                  | Tenant-defined source-system table; keep a small fixed set only for internally generated journals                                                           |
| HC-12 | Connector types as string literals, 34 occurrences (`OPERA_CLOUD`, `SKY_JANA`, `SIMPHONY`, …)                                                                                                                     | Throughout `modules/integration`                                                                                                              | Rows in the source-system table                                                                                                                             |
| HC-13 | Ledger `"A"`, 21 occurrences; `LedgerSetup` supports A to K but journals carry no ledger                                                                                                                          | For example `modules/gl/service.ts:519`                                                                                                       | Add `ledger` to `Journal`; default from entity settings                                                                                                     |
| HC-14 | Roles as an enum and literals (`ADMIN`, `CONTROLLER`, `VIEWER`, `SUPERADMIN`); setup maps `ACCOUNTANT` to `CONTROLLER`                                                                                            | `db/schema-tenant.prisma:20`, `apps/web/app/t/[code]/(setup)/setup/page.tsx:86`, `:315`, four `requireRole([...])` call sites                 | The existing `Role` and `Permission` tables only. Every route checks a permission, never a role name. Remove `EntityUser.role`                              |
| HC-15 | Dashboard views fixed to GM, Controller, CFO                                                                                                                                                                      | `apps/web/app/t/[code]/(dashboard)/dashboard/page.tsx:655`, `:907`                                                                            | Dashboards chosen by permission and by tenant-defined dashboard definitions                                                                                 |
| HC-16 | Default departments `Rooms`, `Food & Beverage`, `Spa`, `Other`                                                                                                                                                    | `apps/web/app/t/[code]/(setup)/setup/page.tsx:21`, `dashboard/night-audit/page.tsx:211`                                                       | Tenant department list, offered from a template at onboarding                                                                                               |
| HC-17 | USALI chart of accounts and account types as code                                                                                                                                                                 | `modules/setup/usali-template.ts`                                                                                                             | Acceptable as a seed template, but load it from a template library so other charts can be added without code                                                |
| HC-18 | Calendar-month periods; fiscal year start defaults to January                                                                                                                                                     | `Period` model; `modules/period-close/year-end-cleardown.ts:103`                                                                              | Fiscal calendar per entity with period start and end dates and adjustment periods                                                                           |
| HC-19 | Schedules: recurring journals at 06:00, dunning at 08:00, balance view refresh every 15 minutes                                                                                                                   | `jobs/recurring-journal-job.ts:29`, `jobs/dunning-queue.ts:64`, `jobs/mv-refresh-job.ts:117`                                                  | Tenant schedule settings, in the entity's time zone                                                                                                         |
| HC-20 | Time-zone choices listed by hand in four screens; `Africa/Dar_es_Salaam` among a short list                                                                                                                       | `setup/page.tsx:575`, `:730`, `settings/properties/page.tsx:63`, `transfer-desk/automations/new/page.tsx:365`                                 | Full IANA list from the runtime                                                                                                                             |
| HC-21 | Display locale `en-US` for all numbers and dates                                                                                                                                                                  | `apps/web/lib/format.ts:10`, `:31`, `:53`, `:63`                                                                                              | Locale from user or entity settings                                                                                                                         |
| HC-22 | Import targets limited in code to GL journal, AP invoice, AR invoice; only `dimension1` and `dimension2` mapped                                                                                                   | `jobs/transfer-desk-record-mapper.ts:113-116`, `:142`                                                                                         | Canonical document types in section 5; all ten dimensions                                                                                                   |

### Platform and infrastructure values

| ID    | Hard-coded value                                                                                           | Where                                                                                                                                          | Move to                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| HC-30 | API base URL fallback `http://localhost:4500` in 15 files                                                  | `apps/web/lib/gl-api.ts:1` and 14 others                                                                                                       | One web config module; fail the build when unset in production                                         |
| HC-31 | `APP_BASE_URL` fallback with two different ports (3000 and 3001)                                           | `modules/gl/service.ts:547`, `modules/admin/service.ts:435`, `modules/auth/router.ts:239`, `modules/tenant/provisioning-service.ts:346`        | One API config module, required in production                                                          |
| HC-32 | Redis host fallback `127.0.0.1` repeated in 8 files; three different ways of building the Redis connection | `db/redis.ts:29`, `jobs/*-queue.ts`, `jobs/*-worker.ts`, `modules/reporting/queue.ts:23`                                                       | One Redis factory in the config module                                                                 |
| HC-33 | 56 environment variables read ad hoc with `process.env`; 49 documented                                     | Across `src` and `packages`                                                                                                                    | One config module validated with Zod at startup; `docs/ENV-VARIABLES.md` generated from it             |
| HC-34 | Vendor endpoints: OHIP, Mews, ECB rates, a second rate provider, the mail provider                         | `connectors/opera-cloud/opera-cloud-auth.ts:19`, `connectors/mews/mews-client.ts:95`, `modules/fx/service.ts:99`, `:231`, `shared/email.ts:64` | Integration connection rows per tenant for source systems; platform config for mail and rate providers |
| HC-35 | Upload limit 10 MB                                                                                         | `app.ts:48`                                                                                                                                    | Tenant entitlement                                                                                     |
| HC-36 | Tenant pool size 50                                                                                        | `db/tenantPool.ts:23`                                                                                                                          | Platform config, replaced by the pooler design in section 4                                            |
| HC-37 | Import worker concurrency 1, with a to-do to read the plan                                                 | `jobs/transfer-desk-worker.ts:64`                                                                                                              | Tenant entitlement                                                                                     |
| HC-38 | `"system"` used as a user ID when none is present, 15 call sites; the entity ID used as a user ID in two   | `jobs/transfer-desk-pipeline.ts:347`, `:402`, and routers under `modules/`                                                                     | A real system user per tenant, created at provisioning; never a string placeholder                     |
| HC-39 | Page sizes and list limits as literals, 168 occurrences                                                    | Repositories and routers                                                                                                                       | Shared pagination helper with one configured default and maximum                                       |
| HC-40 | Trial plan defaults: 10 properties, 50 users, 10 sessions                                                  | `db/schema-registry.prisma` column defaults                                                                                                    | Plan definitions table in the registry                                                                 |

**How to find the rest.** Add a lint rule set that fails CI on: currency codes, account-code literals, department names, role names and `localhost` in non-test, non-seed source. The register above is from targeted searches and is not guaranteed complete.

## 7. Findings register

There are 51 findings below, on top of the 11 architecture failures and 33 hard-coded items above. The Basis column says how each was established: **Reproduced** means it was run against a real PostgreSQL 16 database, **Measured** means counted or executed, **Read** means found by reading the code. API paths are relative to `apps/api/src`.

### Imports

| ID     | Sev | Finding                                                                                                                                                           | Where                                                                | Basis      | Required change                                                                                                                |
| ------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| IMP-01 | P0  | Direct and scheduled GL imports always fail. The entity ID is passed as the creating user and violates the `journals_created_by_fkey` foreign key.                | `jobs/transfer-desk-pipeline.ts:347`, `:402`                         | Reproduced | Post as the tenant's system user (HC-38). Add an integration test that runs an auto-commit import end to end.                  |
| IMP-02 | P0  | Account codes in a file are accepted at staging and rejected at posting (`journal_lines_account_id_fkey`). The GL service only accepts internal IDs.              | `jobs/transfer-desk-batch-stager.ts:42`, `modules/gl/service.ts:452` | Reproduced | Resolve code to ID in the validate step of the pipeline; the stored batch payload holds IDs.                                   |
| IMP-03 | P0  | Duplicate protection exists only for held batches. The auto-commit path and the hard-coded connectors each do something different or nothing.                     | `jobs/transfer-desk-pipeline.ts:503-520` versus `:328-466`           | Read       | Unique index on entity, source system and source document reference on the posted document (section 5), applied to every path. |
| IMP-04 | P0  | The period is a run parameter or profile setting, not derived from the date in the data.                                                                          | `jobs/transfer-desk-pipeline.ts:258-262`                             | Read       | Derive from `documentDate` using period start and end dates (ACC-01, ACC-02).                                                  |
| IMP-05 | P1  | A failed auto-post is logged and the journal is left as a draft while the record is reported as a success.                                                        | `jobs/transfer-desk-pipeline.ts:356-364`                             | Read       | Report the true state per record; fail the item.                                                                               |
| IMP-06 | P1  | Imports are not atomic. Journals are created one by one; a file can be half-imported.                                                                             | `jobs/transfer-desk-pipeline.ts:350-395`                             | Read       | Profile setting: all-or-nothing per file, or per document, both inside explicit transactions.                                  |
| IMP-07 | P1  | The whole file is read into memory and one log row is inserted per record with a full copy of the source record.                                                  | `jobs/transfer-desk-pipeline.ts:171`, `:367-378`                     | Read       | Stream parsing; batch inserts; store the raw file once in object storage and keep only references and errors per record.       |
| IMP-08 | P1  | Only GL journal, AP invoice and AR invoice can be written; statistics and master data cannot come through a user-defined file.                                    | `jobs/transfer-desk-record-mapper.ts:142`                            | Read       | Canonical types in section 5.                                                                                                  |
| IMP-09 | P1  | AP and AR imports pass the mapped record straight to the service with `as any`; no schema validation.                                                             | `jobs/transfer-desk-pipeline.ts:400-404`, `:430`                     | Read       | Validate against the canonical schema before any write.                                                                        |
| IMP-10 | P1  | User-written transformation functions need the `isolated-vm` native module, which is missing from the committed lockfile. A clean frozen install cannot run them. | `packages/tml-engine/package.json:21`, `pnpm-lock.yaml`              | Measured   | Commit the lockfile; add a startup check that reports whether the sandbox is available; cover it in CI.                        |
| IMP-11 | P2  | The format column is named `fsdXml` but holds JSON.                                                                                                               | `jobs/transfer-desk-pipeline.ts:186`                                 | Read       | Rename to `definition` with a JSON type and a schema version.                                                                  |

### Accounting core

| ID     | Sev | Finding                                                                                                                                                                                                                                                                  | Where                                                                                              | Basis                           | Required change                                                                                                                                                                                                                                                                                                                                                          |
| ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ACC-01 | P0  | Journals have no transaction date. Ledger reports use posted or created time as the journal date.                                                                                                                                                                        | `db/schema-tenant.prisma:710`, `modules/gl/service.ts:836`                                         | Read                            | Add `documentDate` (date) to `Journal`, required; backfill from `posted_at`; use it for period, FX rate and all date-based reports.                                                                                                                                                                                                                                      |
| ACC-02 | P0  | Periods have no start and end date and no adjustment period.                                                                                                                                                                                                             | `db/schema-tenant.prisma:524`                                                                      | Read                            | Add `startDate`, `endDate`, `periodNumber`, `isAdjustment`, and a fiscal calendar per entity; exclusion constraint against overlapping periods.                                                                                                                                                                                                                          |
| ACC-03 | P0  | The database does not enforce double entry. No constraint that a line has a debit or a credit but not both, no check that a posted journal balances, no protection of posted journals from update or delete.                                                             | Verified in the provisioned schema: only `audit_events` has triggers                               | Reproduced                      | Check constraints on lines; a deferred constraint trigger that rejects an unbalanced journal on posting; a trigger that blocks changes to posted journals and their lines. All in migrations.                                                                                                                                                                            |
| ACC-04 | P0  | The authorization check fails open.                                                                                                                                                                                                                                      | `modules/gl/service.ts:536-542`                                                                    | Read                            | Remove the catch; a failure aborts creation.                                                                                                                                                                                                                                                                                                                             |
| ACC-05 | P1  | Journal numbers are not safe. The counter is incremented outside the journal's transaction, the year comes from the server clock, and nothing makes the reference unique.                                                                                                | `modules/gl/repository.ts:673-682`                                                                 | Read                            | Number inside the posting transaction; year from the fiscal calendar; unique index on entity, journal type and number; assign on posting if gap-free numbering is required.                                                                                                                                                                                              |
| ACC-06 | P1  | `LedgerSetup` describes ledgers A to K but journals and balances carry no ledger.                                                                                                                                                                                        | `db/schema-tenant.prisma:2019`                                                                     | Read                            | Add `ledger` to `Journal` and `AccountPeriodBalance`, or remove the multi-ledger settings. Decide once.                                                                                                                                                                                                                                                                  |
| ACC-07 | P1  | Balances are kept only by account and period. There are no balances by dimension, so every departmental report scans journal lines.                                                                                                                                      | `AccountPeriodBalance` model                                                                       | Read                            | Summary table by account, period and the dimensions the tenant marks as reporting dimensions, maintained by the same balance writer.                                                                                                                                                                                                                                     |
| ACC-08 | P1  | Two approval systems run side by side: `ApprovalRule` with email links, and multi-stage `AuthorizationStage`.                                                                                                                                                            | `modules/gl/service.ts:476-545`                                                                    | Read                            | Keep the multi-stage model; migrate rules; delete the other.                                                                                                                                                                                                                                                                                                             |
| ACC-09 | P1  | Reports read two sources: some from the materialized view, some from the base table, refreshed on a 15-minute timer.                                                                                                                                                     | `modules/kpi/service.ts:183`, `:463`; `jobs/mv-refresh-job.ts:117`                                 | Read                            | Read balances from the base table, which is already maintained atomically, and drop the view; or refresh inside the posting flow. One source only.                                                                                                                                                                                                                       |
| ACC-10 | P1  | AR has no credit notes.                                                                                                                                                                                                                                                  | `modules/ar/service.ts`                                                                            | Measured                        | Add AR credit notes with allocation against invoices.                                                                                                                                                                                                                                                                                                                    |
| ACC-11 | P2  | Dimension values on journal lines are free text of up to 50 characters with no foreign key to `AnalysisCode`.                                                                                                                                                            | `db/schema-tenant.prisma:770-779`                                                                  | Read                            | Validate against dimension codes according to each dimension's validation type.                                                                                                                                                                                                                                                                                          |
| ACC-12 | P1  | Two payables control accounts are in use. Payables posting uses account `2000`; FX revaluation and the built-in balance-sheet template use `2100`. Found during the WP-U design.                                                                                         | `modules/ap/service.ts:575`; `modules/fx/service.ts:343`; `modules/reporting/report-engine.ts:892` | Read                            | Revaluation adjustments for payables land on a different account from the invoices they revalue, so neither account agrees with the supplier balances. Until WP-U the services take the account the tenant flagged as control before the literal code (fixed). Removed by WP-U: there are no control accounts, and the migration reports which account each entity used. |
| ACC-13 | P2  | Dunning records the level sent in `ar_invoices.last_dunning_level` with raw SQL, but the column is not in the Prisma schema and does not exist in a database built from it. Found during the WP-U design.                                                                | `modules/ar/service.ts:543-557`                                                                    | Read; column absent in `hfp_db` | The update fails, or the level is never stored and the same reminder is sent again. WP-U keeps the dunning level on the entry document.                                                                                                                                                                                                                                  |
| ACC-14 | P1  | A payables invoice created through the service or API stores its tax code as text only. Posting reads the tax account from the tax-code row, which the line never references, so an invoice with tax created this way cannot be posted. Found while fixing the UAT seed. | `modules/ap/repository.ts` (`createInvoice`); `modules/ap/service.ts:634`                          | Reproduced                      | Resolve the code to the tenant's tax-code row when the invoice is created; refuse an unknown code. Fixed ahead of WP-U.                                                                                                                                                                                                                                                  |

### User-defined capability

| ID     | Sev | Finding                                                                            | Where                                                            | Basis    | Required change                                                                                                      |
| ------ | --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| UDF-01 | P1  | Analysis dimensions and codes have tables but no service, no routes and no screen. | Referenced only in `db/rlsMiddleware.ts` and `db/entityScope.ts` | Measured | CRUD service, routes, permissions and a settings screen; journal entry and reports use the tenant's dimension names. |
| UDF-02 | P1  | No custom fields on accounts, suppliers, customers, journals or assets.            | Schema                                                           | Read     | A custom-field definition table per record type with typed values, exposed to imports and reports.                   |
| UDF-03 | P1  | Source systems are not definable by the tenant (HC-11, HC-12).                     | Schema enum and literals                                         | Read     | Source-system table with integration connections.                                                                    |
| UDF-04 | P1  | Report layouts and KPIs are built in code (HC-01, HC-02).                          | `modules/reporting/report-engine.ts`, `modules/kpi/service.ts`   | Read     | Stored definitions with a template library.                                                                          |
| UDF-05 | P2  | The setup wizard offers a fixed set of roles, departments and time zones.          | `apps/web/app/t/[code]/(setup)/setup/page.tsx`                   | Read     | Drive every choice from tenant or template data.                                                                     |

### Security

| ID     | Sev | Finding                                                                                                                                                                                                                                         | Where                                                                                                                                      | Basis      | Required change                                                                                                                                           |
| ------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-01 | P0  | The web app pins Next.js 15.0.3 and React 19.0.0. Security advisories for middleware authorization bypass and for React Server Components were published after these versions.                                                                  | `apps/web/package.json:38-40`                                                                                                              | Read       | Check the current Next.js and React advisories and upgrade to the latest patched release. Do this first.                                                  |
| SEC-02 | P0  | Tenant context can leak between requests (ARC-05).                                                                                                                                                                                              | `app.ts:104`, `db/requestContext.ts:47`                                                                                                    | Read       | `runWithContext` everywhere; throw when unbound.                                                                                                          |
| SEC-03 | P0  | Tenant database passwords are stored in plain text in the registry, and nothing in the codebase encrypts secrets.                                                                                                                               | `db/schema-registry.prisma`, `db/tenantRegistry.ts`                                                                                        | Measured   | Encrypted secrets as in section 4; rotate every tenant password after the change.                                                                         |
| SEC-04 | P1  | 46 of 101 tables have no row-level security. Some are rightly global (currencies, permissions), but the list includes `journal_lines`, `ap_invoice_lines`, `transfer_batches`, `transfer_profiles`, `intercompany_journals` and `login_audits`. | Queried from the provisioned database                                                                                                      | Reproduced | Policy on every entity-scoped table; child tables get a policy through their parent. Add a test that fails when a table has an entity link and no policy. |
| SEC-05 | P1  | The application role owns the tenant database, so it can alter policies and bypass them wherever security is not forced.                                                                                                                        | `modules/tenant/provisioning-service.ts:218`                                                                                               | Read       | Separate owner and application roles (section 4).                                                                                                         |
| SEC-06 | P1  | Database names are interpolated into `CREATE DATABASE` statements.                                                                                                                                                                              | `modules/tenant/provisioning-service.ts:217`, `scripts/provision-tenant.ts:255`                                                            | Read       | Build the name only from the validated tenant code with a strict pattern, and quote it with a proper identifier-quoting function.                         |
| SEC-07 | P1  | `xlsx` 0.18.5 from the npm registry is used to parse uploaded spreadsheets. That package line is no longer updated on npm.                                                                                                                      | `apps/api/package.json:53`                                                                                                                 | Read       | Check the advisory status; move to a maintained parser.                                                                                                   |
| SEC-08 | P2  | The platform API key is compared with `!==`.                                                                                                                                                                                                    | `modules/tenant/router.ts:31`                                                                                                              | Read       | Constant-time comparison; move platform admin to real user accounts with multi-factor authentication.                                                     |
| SEC-09 | P2  | The dev token bypass and the insecure sandbox switch both depend on `NODE_ENV` being set correctly.                                                                                                                                             | `plugins/auth.ts:259`, `packages/tml-engine/src/sandbox.ts:90`                                                                             | Read       | Remove both from production builds entirely rather than gating at runtime.                                                                                |
| SEC-10 | P2  | The repository contains local tooling state, an archive and a payment-run export.                                                                                                                                                               | `.claude/`, `.superpowers/`, `docs/files.zip`, `apps/api/payment-runs/*.csv` (on main only), `tmp/*.json`, `apps/web/tsconfig.tsbuildinfo` | Measured   | Remove, add to `.gitignore`, and confirm the payment file holds no real bank details.                                                                     |

### Operations and delivery

| ID     | Sev | Finding                                                                                                                                      | Where                                                            | Basis      | Required change                                                                                                                                                                       |
| ------ | --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-01 | P0  | `main` is missing all work done since 11 March 2026.                                                                                         | `main` at `2cb6248`, branch at `03b2b0f`                         | Measured   | Merge (WP-0). Protect `main`; work through pull requests.                                                                                                                             |
| OPS-02 | P0  | `pnpm install --frozen-lockfile` fails: the lockfile does not match `packages/tml-engine/package.json`.                                      | `pnpm-lock.yaml`                                                 | Reproduced | Regenerate and commit; CI uses `--frozen-lockfile`.                                                                                                                                   |
| OPS-03 | P0  | Typecheck fails with two errors, so the CI typecheck step fails.                                                                             | `packages/fsd-engine/tests/schema-validator.test.ts:196`, `:272` | Reproduced | Fix; keep typecheck blocking.                                                                                                                                                         |
| OPS-04 | P0  | The migration chain cannot build a database from empty. Migration 4 uses `app_current_entity_id()` before anything creates it.               | `db/migrations/20260407000001_transfer_desk_tables`              | Reproduced | New baselines as in section 4; security functions and policies live in migrations.                                                                                                    |
| OPS-05 | P1  | CI has no database, runs only on `main` and `feature/**`, and installs with `--no-frozen-lockfile`.                                          | `.github/workflows/ci.yml`                                       | Read       | PostgreSQL and Redis services in CI; run on every pull request; run integration tests and a migrate-from-empty check.                                                                 |
| OPS-06 | P1  | 224 `console.*` calls, no structured logs, no request or tenant IDs in logs.                                                                 | `apps/api/src`                                                   | Measured   | Fastify logger with context fields; remove `console.*` by lint rule.                                                                                                                  |
| OPS-07 | P1  | No automated backup or tested restore.                                                                                                       | `docs/GO-LIVE-RUNBOOK.md`                                        | Read       | Section 4 backup design, with a restore drill in the runbook.                                                                                                                         |
| OPS-08 | P2  | Three integration tests fail because the test builds accounts without a required field, so the row-level security suite does not run.        | `tests/integration/rls-enforcement.test.ts:85`, `:132`           | Reproduced | Fix the fixtures; run the suite as the application role, not a superuser.                                                                                                             |
| OPS-09 | P2  | The UAT seed inserts invoices marked posted or approved straight into the tables, with no journal behind them. Found during the WP-U design. | `scripts/seed-uat.ts:794`, `:846`                                | Read       | Seed invoices, payments and receipts through the services, so that every posted document has ledger lines. Needed before the WP-U reconciliation check can run on seeded data. Fixed. |

### Code quality

| ID     | Sev | Finding                                                                                                                                                     | Where                                                                                                         | Basis    | Required change                                                                  |
| ------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| QLT-01 | P1  | 431 uses of `as any` in API source, concentrated at service boundaries.                                                                                     | `apps/api/src`                                                                                                | Measured | Typed service inputs; lint rule against new `any`.                               |
| QLT-02 | P1  | 64 empty or swallowing `catch` blocks.                                                                                                                      | `apps/api/src`                                                                                                | Measured | Each one either handles a named error or rethrows.                               |
| QLT-03 | P2  | Very large files: `apps/web/lib/gl-api.ts` (3,883 lines), `modules/integration/routes/transfer-desk.ts` (2,313), `modules/intercompany/service.ts` (1,979). | As listed                                                                                                     | Measured | Generate the web API client from `docs/openapi.yaml`; split routers by resource. |
| QLT-04 | P2  | Dead code: `db/schema.prisma`, Keycloak variables in `.env.example`, `docs/KEYCLOAK-SETUP.md`, RabbitMQ event bus that nothing consumes.                    | As listed                                                                                                     | Read     | Delete.                                                                          |
| QLT-05 | P2  | Raw SQL through `$executeRawUnsafe` and `$queryRawUnsafe` in the setup, admin and consolidation services.                                                   | `modules/setup/service.ts:102-300`, `modules/admin/service.ts:307-423`, `modules/consolidation/service.ts:47` | Read     | Tagged-template `Prisma.sql` or the typed client.                                |
| QLT-06 | P2  | The web app has no component or end-to-end tests for posting, approval or import screens.                                                                   | `apps/web`                                                                                                    | Measured | Playwright smoke tests for the core flows against a seeded tenant.               |

## 8. Implementation plan

Nine work packages, in dependency order. Each closes named findings and is done only when its acceptance checks pass in CI. Do not start a package before the ones it depends on are merged.

| WP   | Goal                                                         | Closes                                                                                 | Depends on |
| ---- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ---------- |
| WP-0 | Stabilise the repository                                     | ARC-11, OPS-01, OPS-02, OPS-03, OPS-05, OPS-08, SEC-01, SEC-10, QLT-04                 | None       |
| WP-1 | Central configuration, no infrastructure literals            | HC-30 to HC-40, OPS-06                                                                 | WP-0       |
| WP-2 | Tenant platform: migrations, roles, pooler, secrets, context | ARC-03, ARC-04, ARC-05, ARC-06, OPS-04, OPS-07, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06 | WP-1       |
| WP-3 | Ledger integrity and the posting contract                    | ARC-02, ARC-08, ARC-09, ARC-10, ACC-01 to ACC-06, ACC-08                               | WP-2       |
| WP-4 | One import pipeline                                          | ARC-01, IMP-01 to IMP-11, HC-05, HC-06, HC-07, HC-22                                   | WP-3       |
| WP-5 | Fold the connectors into the pipeline                        | HC-03, HC-04, HC-11, HC-12, HC-34, UDF-03                                              | WP-4       |
| WP-6 | User-defined dimensions, custom fields, roles                | UDF-01, UDF-02, UDF-05, ACC-07, ACC-11, HC-14, HC-15, HC-16, HC-20, HC-21              | WP-3       |
| WP-7 | User-defined reports, KPIs and calendars                     | ARC-07, UDF-04, ACC-09, HC-01, HC-02, HC-08, HC-09, HC-10, HC-13, HC-17, HC-18, HC-19  | WP-6       |
| WP-8 | Scale-out, hardening and remaining quality                   | ACC-10, SEC-07, SEC-08, SEC-09, QLT-01, QLT-02, QLT-03, QLT-05, QLT-06                 | WP-5, WP-7 |

### WP-0 Stabilise the repository

- [ ] Merge `fix/p0-quick-wins` into `main`; delete stale branches after confirming nothing unique remains on `follow-up-task`.
- [ ] Regenerate and commit `pnpm-lock.yaml`; fix the two typecheck errors.
- [ ] Upgrade Next.js and React to the latest patched releases after reading the current advisories.
- [ ] CI: PostgreSQL 16 and Redis services, `--frozen-lockfile`, run on every pull request, run unit and integration suites.
- [ ] Fix the three failing integration tests; run the security suite as the application role.
- [ ] Remove tracked tooling state, scratch files, the docs archive, the dead schema and Keycloak leftovers.

**Accepted when:** a fresh clone passes `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test` with a database, and CI is green on `main`.

### WP-1 Central configuration

- [ ] One `config` module per app, parsed with Zod at startup, exported as a typed object. No other file reads `process.env`.
- [ ] One Redis connection factory and one queue factory used by every job.
- [ ] Replace `console.*` with the Fastify logger; add request ID, tenant and entity to every log line.
- [ ] Lint rules: no `process.env` outside `config`, no `console`, no `localhost` literals outside tests.

**Accepted when:** starting the API with a required variable missing exits with a message naming it, and the lint rules pass.

### WP-2 Tenant platform

- [ ] New baseline migrations: one folder for the registry, one for tenant databases. Security functions, policies, constraints, triggers and indexes are in migrations; delete the separate SQL setup scripts.
- [ ] Provisioning uses `migrate deploy`, creates owner and application roles, creates the tenant system user, and records the schema version in the registry.
- [ ] Migration runner command: all tenants, resumable, per-tenant result recorded, non-zero exit on any failure. The API returns a maintenance response for a tenant behind the required version.
- [ ] Adopt existing tenant databases: a one-time script that baselines each one against the new migration history after a schema diff shows no differences.
- [ ] Encrypt tenant database credentials and integration credentials; rotate existing passwords.
- [ ] Replace `enterWith` with `runWithContext` in the request hook and every worker; data access throws without a bound tenant.
- [ ] Connection pooler in front of PostgreSQL; small per-tenant connection limit; safe idle eviction.
- [ ] Row-level security on every entity-scoped table and its children, forced; test that enumerates tables and fails on a gap.
- [ ] Scheduled per-tenant backups and a documented, tested restore.

**Accepted when:** an empty PostgreSQL instance can be taken to a working tenant by provisioning alone; a second release with a new migration upgrades two tenants through the runner; a test connecting as the application role for entity A cannot read or write any row of entity B in any table; no secret is readable in the registry.

### WP-3 Ledger integrity and posting contract

- [ ] Add `documentDate`, `sourceSystem`, `sourceDocumentRef` and `ledger` to `Journal`, with the unique index from section 5. Backfill existing rows.
- [ ] Add period start and end dates, period numbers, adjustment periods and a fiscal calendar per entity.
- [ ] Database constraints and triggers from ACC-03.
- [ ] Publish the canonical document schema as a shared package; GL, AP and AR services accept only that type.
- [ ] One posting service: validates, resolves codes, derives the period, numbers, posts and updates balances in a single transaction. Screens and imports both call it.
- [ ] Remove fail-open handling; consolidate on the multi-stage authorization model.

**Accepted when:** integration tests prove that an unbalanced journal, an edit to a posted journal, a duplicate source reference and a posting into a closed period are each rejected by the database or the service; and a journal dated in a prior open period lands in that period.

### WP-4 One import pipeline

- [ ] Implement the eight stages in section 5 on top of Transfer Desk; delete the direct-write branch in `transfer-desk-pipeline.ts`.
- [ ] Extend the format engine: multiple record types, JSON, field scale and sign, date patterns, encoding, streaming.
- [ ] Lookup tables with effective dates; per-profile policy for unmapped data.
- [ ] Add canonical targets: statistics, suppliers, customers, credit notes, bank statements, budgets, exchange rates.
- [ ] One import-run record with per-record errors, reprocess and batch reversal.
- [ ] Screens: format designer preview against a sample file, mapping editor, run history with drill-down.

**Accepted when:** using only the UI and no code change, a test defines a new delimited format with header, detail and trailer records, maps account codes and three dimensions through lookups, imports a sample file on a schedule, posts balanced journals into the period of each document date, and a second import of the same file is rejected as a duplicate. A 200 MB file imports without the process exceeding a fixed memory ceiling.

### WP-5 Fold the connectors into the pipeline

- [ ] Source-system and integration-connection tables with encrypted credentials and a settings screen.
- [ ] Convert Opera SAF, Sky Jana, Simphony, Mews, bank and payroll into acquisition adapters plus seeded templates; move their code tables and decimal rules into template data.
- [ ] Migrate saved interface definitions and connector mappings; delete `transform-engine.ts`, the interfaces routes and the bespoke import services.

**Accepted when:** two tenants with different Opera and Jana credentials and different mappings import on the same deployment; the files used by the existing connector tests produce identical journals through the pipeline; the deleted modules are gone.

### WP-6 User-defined dimensions, custom fields and roles

- [ ] Dimension and code management: service, routes, permissions, screen. Journal entry, imports and reports use the tenant's names and validation rules.
- [ ] Balance summary by reporting dimensions, maintained by the balance writer.
- [ ] Custom-field definitions and values for accounts, suppliers, customers, journals and assets.
- [ ] Permissions only: remove the role enum and role-name checks; dashboards and navigation driven by permissions.
- [ ] Department list, time zones and locale from tenant and runtime data.
- [ ] Follow-up from WP-A: add dedicated permission codes for the GL source override (today `GL_APPROVE`) and for reading allocations, fixed assets (today `GL_READ`) and KPIs (today `REPORT_READ`). WP-A reused existing codes because a new code would be missing in tenants already provisioned; add the codes to the catalogue with a migration that grants them to the roles holding the stand-in code, then switch the routes in `tests/route-access.table.txt`.

**Accepted when:** a tenant admin creates a dimension, marks it required, and a journal without it is rejected in the screen and in an import; a new role with a custom permission set works without a deployment.

### WP-7 User-defined reports, KPIs and calendars

- [ ] Move built-in statement layouts into a template library; onboarding copies the chosen templates into `ReportDefinition`.
- [ ] KPI definitions as tenant data; remove account-prefix and department-name logic from `kpi/service.ts`.
- [ ] Currency table as the only source of currency lists and decimal places; remove every `"USD"` fallback.
- [ ] Tenant-configurable schedules in the entity time zone.
- [ ] Single source for balances in reports.

**Accepted when:** a tenant with a chart of accounts that shares no codes with the USALI template gets correct statements and KPIs after configuration alone; a search of non-test, non-seed source finds no currency code, account code or department name literal.

### WP-8 Scale-out and hardening

- [ ] Run the API as several stateless instances and workers as a separate scalable group; per-tenant concurrency from entitlements.
- [ ] Load test: a set number of tenants posting and importing concurrently, with targets agreed by the owner for response time and connection count.
- [ ] AR credit notes.
- [ ] Remove `as any` at service boundaries; resolve swallowed errors; generate the web API client from the OpenAPI document; replace raw unsafe SQL.
- [ ] End-to-end browser tests for journal entry, approval, period close and import.
- [ ] Replace the spreadsheet parser; remove dev-only bypasses from production builds; platform admin accounts with multi-factor authentication.

**Accepted when:** the load test meets the agreed targets with the pooler's connection count staying under the database limit, and the end-to-end suite is green in CI.

### Decisions the owner must make before the affected package starts

| Decision                                | Needed by | Options                                                              |
| --------------------------------------- | --------- | -------------------------------------------------------------------- |
| Multi-ledger: keep or remove            | WP-3      | Add `ledger` to journals and balances, or delete the A to K settings |
| Gap-free journal numbering              | WP-3      | Number on posting (gap-free) or on creation (simpler)                |
| Import atomicity default                | WP-4      | Whole file or per document                                           |
| Where the platform encryption key lives | WP-2      | Environment variable on the server, or a managed key service         |
| Hosting target for scale-out            | WP-8      | Single server with PM2 cluster, or containers                        |
| Load targets                            | WP-8      | Number of tenants, entities per tenant, journals per day             |

## 9. Verification evidence and limits

Everything marked Reproduced or Measured was run on 11 November 2026 in a private copy of the repository against a throwaway PostgreSQL 16 database. Nothing was pushed or changed in GitHub.

### What was run

| Check                                    | Command or method                                                               | Result                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Frozen install                           | `pnpm install --frozen-lockfile`                                                | Failed: lockfile does not include `isolated-vm` for `packages/tml-engine`                                           |
| Typecheck                                | `pnpm -r typecheck`                                                             | Failed: 2 errors in `packages/fsd-engine/tests/schema-validator.test.ts`                                            |
| Unit tests                               | `pnpm -r test`                                                                  | 1,061 passed: API 684 (7 files skipped for lack of a database), format engine 249, transformation engine 72, web 56 |
| Migrations from empty                    | `prisma migrate deploy --schema src/db/schema-tenant.prisma`                    | Failed at `20260407000001_transfer_desk_tables`: `function app_current_entity_id() does not exist`                  |
| Provisioning path                        | `prisma db push`, then `db:setup:rls`, `db:setup:audit`, `db:setup:performance` | Succeeded: 101 tables, 55 with row-level security, 52 forced, balance view created                                  |
| Integration tests                        | `TEST_DATABASE_URL=... vitest run tests/integration`                            | 46 passed, 3 failed, all 3 in `rls-enforcement.test.ts` from a fixture missing `normalBalance`                      |
| Import posting, as the pipeline calls it | `GLService.createJournal(entityId, entityId, input)`                            | Failed: `journals_created_by_fkey`                                                                                  |
| Posting with a real user and account IDs | Same call with a user ID                                                        | Succeeded, journal created as draft                                                                                 |
| Posting with account codes               | Same call with codes in `accountId`                                             | Failed: `journal_lines_account_id_fkey`                                                                             |
| Database constraints and triggers        | Catalog queries on the provisioned database                                     | Journals have foreign keys only; the only triggers are on `audit_events`                                            |

### What the passing integration tests cover

Balance writer, opening-balance carry-forward, year-end cleardown, FX revaluation, AP and AR tax posting, and consolidation currency handling all passed against the real database. Those areas were on the earlier blocker list in `HANDOFF-P0-FIXES.md` and now have real-database coverage.

### What was not tested

- The web screens were not exercised in a browser.
- No live connection was made to Opera, Simphony, Mews or Sky Jana.
- No load or concurrency test was run; the scalability findings come from reading the connection and worker code.
- The dependency findings SEC-01 and SEC-07 are based on the pinned versions. The implementer must read the current advisories before choosing target versions.
- The hard-coded register comes from targeted searches. Expect the lint rules in section 6 to surface more.
- Earlier audit documents in the repository (`INSPECTION-REPORT.md`, `finalv1 findings.md`, `docs/CRITICAL-ASSESSMENT-*.md`) were read for context. Their items were re-checked only where this report cites them.

### How to reproduce

```
git clone https://github.com/Shemandia/hospitalityfinance-pro && cd hospitalityfinance-pro
git checkout fix/p0-quick-wins
pnpm install --frozen-lockfile          # fails (OPS-02)
pnpm install --no-frozen-lockfile
(cd apps/api && pnpm db:generate)
pnpm -r typecheck                       # fails (OPS-03)
pnpm -r test
cd apps/api
export DATABASE_URL=postgresql://USER:PASS@HOST:PORT/hfp_empty
npx prisma migrate deploy --schema src/db/schema-tenant.prisma   # fails (OPS-04)
export DATABASE_URL=postgresql://USER:PASS@HOST:PORT/hfp_test
npx prisma db push --schema src/db/schema-tenant.prisma --skip-generate
pnpm db:setup:rls && pnpm db:setup:audit && pnpm db:setup:performance
TEST_DATABASE_URL=$DATABASE_URL npx vitest run tests/integration
```

## 10. Access control and tenant context redesign (WP-A)

Sign-in itself works; what is broken is everything that happens after it: which roles, permissions, properties and tenant a request runs with. Keep the password, cookie and session mechanism, and replace the authorization and context layer. Run this package straight after WP-0; it supersedes HC-14 and SEC-02 and reduces the scope of WP-2 and WP-6.

Added 11 November 2026 after bringing the project up on the development server. API paths are relative to `apps/api/src`.

### Why roles, permissions and properties load incorrectly

| ID     | Sev | Finding                                                                                                                                                                                                | Where                                                                                                                   | Effect the user sees                                                                                                                                                                                                                                                      |
| ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUT-01 | P0  | Permissions are not per property. At sign-in every permission from every role is merged into one flat list inside the token, and each route checks that list without looking at the selected property. | `services/auth.service.ts:66-82`, `:258-275`; `middleware/requirePermission.ts`                                         | A role granted for one property applies on every property the user can open.                                                                                                                                                                                              |
| AUT-02 | P0  | Two different answers to "what can this user do". The token filters roles by scope; the profile endpoint the screens use returns every role unfiltered.                                                | `services/auth.service.ts:260` versus `:650-655`                                                                        | Menus and buttons appear that the API then rejects, or the reverse.                                                                                                                                                                                                       |
| AUT-03 | P0  | Three sources of roles: the deprecated `EntityUser.role` enum, the `UserRole` table, and role names hard-coded in logic (`SUPERADMIN`, `PLATFORM_ADMIN`, `TENANT_ADMIN`).                              | `db/schema-tenant.prisma` (`EntityUser`, `UserRole`); `services/auth.service.ts:52`; `middleware/requireWriteAccess.ts` | The seeded admin is SUPERADMIN in one table and has no role in the other, so the token carries no permissions.                                                                                                                                                            |
| AUT-04 | P0  | Property access fails open. When a token has no properties listed, the access check is skipped and the helper returns allowed.                                                                         | `plugins/auth.ts:211`, `:437-442`                                                                                       | A user with no property assignment can reach property data on routes outside `/api/v1/`.                                                                                                                                                                                  |
| AUT-05 | P0  | Without a tenant in the request context, queries silently go to the default database from `DATABASE_URL`.                                                                                              | `db/prisma.ts:63-89`                                                                                                    | With more than one tenant, a lost context reads and writes the wrong tenant's data instead of failing. Combined with ARC-05 this is the multi-tenancy fault.                                                                                                              |
| AUT-06 | P1  | Roles and properties are frozen into the token for 15 minutes.                                                                                                                                         | `services/auth.service.ts:24`, `:273-280`                                                                               | An admin changes a user's role or property and nothing happens until the user signs in again.                                                                                                                                                                             |
| AUT-07 | P1  | The rule for "which properties can this user open" is written three times and differs: any depth in the API, one level in the web app, descendants in the admin service.                               | `plugins/auth.ts:207-218`; `apps/web/components/entity-provider.tsx:72-84`; `modules/admin/service.ts:44-96`            | The property switcher shows a different list from what the API allows.                                                                                                                                                                                                    |
| AUT-08 | P1  | The selected property is kept in the browser under one key shared by all tenants.                                                                                                                      | `apps/web/components/entity-provider.tsx:38`                                                                            | After switching tenant in the same browser, requests carry a property from the other tenant and are refused.                                                                                                                                                              |
| AUT-09 | P1  | Any permission that does not end in `_READ` grants write access on every route guarded by the write check.                                                                                             | `middleware/requireWriteAccess.ts`                                                                                      | A user allowed to write budgets can write wherever only this guard is used.                                                                                                                                                                                               |
| AUT-10 | P1  | Any internal failure during the check (Redis, database) is reported as "Token verification failed".                                                                                                    | `plugins/auth.ts:444-448`                                                                                               | Users are signed out by infrastructure faults, and the real cause is hidden.                                                                                                                                                                                              |
| AUT-11 | P1  | The seed fails once row-level security is applied, creates users with no password, and assigns no `UserRole`.                                                                                          | `db/seed.ts:33`, `:112-165`                                                                                             | A fresh environment cannot be signed in to. Reproduced.                                                                                                                                                                                                                   |
| AUT-12 | P2  | The development bypass carries a hand-written list of 46 permissions.                                                                                                                                  | `plugins/auth.ts:290-336`                                                                                               | New permissions are missing in development until someone edits the list.                                                                                                                                                                                                  |
| AUT-13 | P2  | The browser talks to two origins (web and API), which needs allowed-origin settings, matching ports and cross-port cookies. The web middleware also hard-codes `ws://localhost:3001`.                  | `app.ts:52`; `apps/web/middleware.ts:17`                                                                                | Every new environment repeats the port and origin problems.                                                                                                                                                                                                               |
| AUT-14 | P0  | `withBypassRLS` did not bypass when a property was selected. The RLS middleware moved each model query inside it to a second transaction scoped to the selected property. Found during WP-A.           | `db/rls-bypass.ts`; `db/rlsMiddleware.ts:104-136`                                                                       | Admin and sign-in code that reads across properties saw one property on tables under forced row-level security, and its writes were not atomic: they committed even when the operation failed and rolled back. Fixed in WP-A with `tests/integration/rls-bypass.test.ts`. |

### Target design

**One rule: a request is allowed when the user holds the permission at the property it acts on.** Everything below serves that rule.

| Part               | Design                                                                                                                                                                                                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token              | Carries only user ID, tenant ID and session ID. No roles, permissions or properties.                                                                                                                                                                                                                |
| Assignment model   | One table: user, role, scope. Scope is either the whole tenant or one node in the property tree (group or property). An assignment on a group applies to every property under it. Remove `EntityUser.role`; keep `EntityUser` only if membership without a role is needed, otherwise remove it too. |
| Roles              | Tenant-defined, built from permissions. System roles are seeded rows flagged `isSystem`, never names in code.                                                                                                                                                                                       |
| Resolver           | One access service computes, for a user, the set of properties they can open and the permissions they hold at each. It is the only code that reads assignments.                                                                                                                                     |
| Cache              | The resolved result is cached in Redis per tenant and user, and deleted whenever an assignment, role, permission or the property tree changes. Changes take effect on the next request.                                                                                                             |
| API check          | `requirePermission(code)` asks the resolver whether the user holds `code` at the request's property. No property on a property-scoped route is a 400; no access is a 403. Tenant-level routes check tenant-wide assignments.                                                                        |
| Context endpoint   | One endpoint returns the tenant, the property tree the user can open, and the permissions per property. The web app reads only this for menus, buttons and the property switcher.                                                                                                                   |
| Property selection | Stored per tenant and user; validated by the resolver on every request.                                                                                                                                                                                                                             |
| Tenant binding     | No default database. Data access throws when no tenant is bound (ARC-05). The token's tenant must match the tenant in the URL.                                                                                                                                                                      |
| Failure handling   | 401 only for a missing, invalid or revoked session. Infrastructure faults return 503 and are logged with the cause.                                                                                                                                                                                 |
| Same origin        | The web app proxies API calls under its own address. Remove allowed-origin configuration for the browser path.                                                                                                                                                                                      |
| Development        | No bypass token. The setup command creates a real admin with a tenant-wide admin assignment and prints the sign-in address.                                                                                                                                                                         |
| Row-level security | The resolver's property set is what the transaction sets for the database policies, so the application check and the database check cannot disagree.                                                                                                                                                |

### Work items

- [ ] Migration: new assignment table; migrate `UserRole` rows and `EntityUser.role` values; drop the enum and the old column.
- [ ] Access service with unit tests for inheritance down the property tree, tenant-wide grants and revocation.
- [ ] Redis cache with invalidation on every write to assignments, roles, permissions and entities.
- [ ] Replace `requirePermission`, `requireRole` and `requireWriteAccess` with the single property-aware check; remove role-name constants.
- [ ] Slim the token; remove claims handling from `plugins/auth.ts`; fix the error mapping.
- [ ] Context endpoint; rewrite `auth-provider.tsx`, `entity-provider.tsx` and `use-user-role.ts` to consume it.
- [ ] Remove the default-database fallback in `db/prisma.ts`; switch to `runWithContext`.
- [ ] Same-origin proxy in the web app; remove hard-coded ports from the middleware.
- [ ] Fix the seed order, give seeded users a password from an environment variable, assign roles; one `dev:setup` command.
- [ ] Admin screens: assign a role to a user at tenant, group or property level; show effective permissions per property.
- [ ] Remove the development bypass and its permission list.

**Accepted when:** these tests pass against a real database with two tenants and a group of three properties.

1. A user with Accountant on property A and Viewer on property B can post a journal on A, is refused on B, and cannot open property C.
2. A role assigned on the group gives the same permissions on all three properties.
3. Removing a role takes effect on the user's next request without signing in again.
4. The menus shown for a property match exactly what the API allows there, checked for every permission code.
5. A request for tenant 1 with a session from tenant 2 is refused, and no query runs without a bound tenant.
6. Stopping Redis returns 503, not a sign-out.
7. On an empty server, the setup command followed by sign-in reaches the dashboard with full admin permissions.

**Later addition, not part of this package:** sign-in with Microsoft Entra ID as a second way to authenticate. It plugs into the same session and assignment model.

## 11. Unified ledger model (WP-U)

The owner has chosen the full unified-ledger model: suppliers and customers become accounts in the one ledger, and every invoice, payment and receipt is a ledger line. The payables and receivables screens stay, but they become entry forms and views over the ledger. This replaces WP-3 and must be designed before WP-4, so that imports target the final shape.

Decided 12 November 2026. The aim is the capability and data model of a unified-ledger system, not a copy of any vendor's screens, wording or product names. Rename the Transfer Desk module before commercial release.

### Owner decisions on the design (12 November 2026)

The design note is `docs/WP-U-DESIGN-NOTE.md`. Where it differs from the text below, the note is what will be built.

1. Line amounts stay as debit and credit pairs. The functional pair is renamed base and a reporting pair is added.
2. History is moved in place: existing control-account lines are re-pointed to the supplier's or customer's account.
3. Supplier and customer codes become account codes, with a tenant prefix on by default. The migration stops on a collision.
4. Part-allocation splits the line and keeps a link to the original. There is no `part-allocated` marker.
5. Each ledger has a must-balance setting. Ledger A always balances; budget and forecast ledgers need not.
6. A document's approval state is stored once, on its journal.
7. Only posted lines are paid and revalued. An approved, unposted invoice becomes a held posting.
8. ACC-02, ACC-04, ACC-05 and ACC-08 move from WP-3 into WP-U, ACC-02 first.
9. A change to a supplier's bank details needs approval by a second person and is audited.

WP-U code does not start until WP-A and WP-2 are merged. WP-U also closes ACC-12, ACC-13 and OPS-09.

### What changes and why

| Area                           | Today                                                                                                                          | Target                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Supplier and customer balances | Held in `APInvoice`, `APPayment`, `ARInvoice`, `ARReceipt` and their allocation tables; the ledger receives postings from them | Held only as ledger lines on creditor and debtor accounts. Ageing, statements and balances are queries on the ledger. Nothing to reconcile. |
| Suppliers and customers        | `Supplier` and `Customer` master tables separate from the chart                                                                | Each is an account of type creditor, debtor or client, with an address and payment-terms record attached.                                   |
| Matching                       | `APPaymentAllocation`, `ARAllocation`                                                                                          | Allocation on ledger lines: a marker, an allocation reference, date and user.                                                               |
| Ledgers                        | Settings for A to K; journals carry no ledger; budgets in `BudgetDefinition` and `BudgetLine`                                  | Every journal and balance carries a ledger. A is actuals; the others are budgets and forecasts with the same structure.                     |
| Currency amounts per line      | Transaction and functional                                                                                                     | Transaction, base and reporting amounts, each with its rate.                                                                                |
| Analysis                       | Ten free-text columns on lines                                                                                                 | Ten validated transaction dimensions on lines, plus analysis on accounts (including suppliers and customers) and assets.                    |
| Journal types                  | User-defined, no entry rules                                                                                                   | Each type has a preset: default values, which fields are shown, required or locked, and allowed account types.                              |
| Provisional postings           | Draft and posted only                                                                                                          | A held state that affects enquiry but not statements until released, for imports and accruals under review.                                 |
| Data access                    | By property                                                                                                                    | By property and by analysis code, so a department head sees only their department.                                                          |
| Export                         | None                                                                                                                           | Export profiles as the mirror of import profiles.                                                                                           |

### Data model

**Account.** Add `accountKind`: general, creditor, debtor, client, bank, memo. Creditor, debtor and client accounts carry payment terms, credit limit, default currency, tax registration and an allocation-required flag. An address and contact record links to the account. `isControlAccount` is removed: there are no control accounts in this model.

**Journal.** Add `ledger`, `documentDate`, `sourceSystem`, `sourceDocumentRef` (ACC-01, ACC-06, section 5) and `postingState`: held, posted.

**Journal line.** Add or change the following.

| Field                                              | Purpose                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `transactionDate`, `dueDate`                       | Ageing and payment selection are by line                           |
| `transactionReference`, `secondReference`          | Invoice number, payment reference, purchase order                  |
| `baseAmount`, `reportingAmount`, `reportingRate`   | Third currency amount; rename the functional columns to base       |
| `allocationMarker`                                 | Unallocated, allocated, paid, withheld, in dispute, part-allocated |
| `allocationRef`, `allocationDate`, `allocatedById` | Groups the lines that were matched together                        |
| `dimension1` to `dimension10`                      | Foreign keys to analysis codes, validated per dimension rule       |
| `taxCodeId`, `taxBaseAmount`                       | Tax reporting from the ledger                                      |
| `documentId`                                       | Link to the entry document below                                   |

**Entry document.** One light table for invoices, credit notes, payments and receipts as the user entered them: type, number, counterparty account, dates, attachments, approval state. It owns no balances. Its lines are ledger lines.

**Balances.** `AccountPeriodBalance` gains `ledger` and the reporting amount. Add the dimension summary from ACC-07.

**Allocation.** One service: select open lines on an account, check they net to zero or record the difference to a tenant-chosen account, stamp one `allocationRef`. Reversal clears the stamp. Part-allocation splits a line.

### What happens to the existing modules

| Existing                                                            | Action                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `modules/ap`, `modules/ar` services and routes                      | Rewrite as document entry and enquiry over the ledger. Keep URLs and screens where possible.                        |
| `APInvoice`, `APInvoiceLine`, `APPayment`, `ARInvoice`, `ARReceipt` | Migrate to entry documents plus ledger lines, then drop.                                                            |
| `APPaymentAllocation`, `ARAllocation`                               | Migrate to allocation references on lines, then drop.                                                               |
| `Supplier`, `Customer`                                              | Migrate to accounts with attached address records, then drop.                                                       |
| Payment runs                                                        | Select unallocated creditor lines by due date and marker; pay; allocate. Withheld and in-dispute lines are skipped. |
| Dunning and statements                                              | Query unallocated debtor lines.                                                                                     |
| `BudgetDefinition`, `BudgetLine`                                    | Migrate to journals in a budget ledger; budget versions become ledgers. Budget entry screens write to that ledger.  |
| Three-way match, purchase documents                                 | Stay outside the ledger; they produce an entry document when approved.                                              |

### Work items

- [ ] Design note first: final schema, the migration mapping for every existing table, and the list of reports whose source changes. Owner approves before code.
- [ ] Period start and end dates, period numbers, adjustment periods and a fiscal calendar per entity (ACC-02). First, because a document date cannot be mapped to a period without it.
- [ ] Schema migration for accounts, journals, lines, balances and entry documents, with database constraints from ACC-03.
- [ ] Posting service accepts the canonical document (section 5) with ledger, three currency amounts and validated dimensions.
- [ ] Allocation service with reversal and part-allocation.
- [ ] Data migration: suppliers and customers to accounts; open and historical invoices, payments and receipts to ledger lines with allocation references; budgets to budget ledgers. A reconciliation script proves balances before and after are equal per supplier, customer and account.
- [ ] Rewrite payables, receivables, payment runs, dunning, ageing and statements on the ledger.
- [ ] Journal-type presets and held postings.
- [ ] Analysis on accounts and data access by analysis code (with WP-6).
- [ ] Export profiles (with WP-4).
- [ ] Remove the fail-open authorization check (ACC-04); number journals inside the posting transaction (ACC-05); keep the multi-stage authorization model only (ACC-08).
- [ ] Seed the UAT data through the services (OPS-09).
- [ ] Remove the old tables and code.

**Accepted when:**

1. Supplier and customer ageing come from ledger lines only, and the total of open lines on each creditor and debtor account equals the account balance by construction.
2. The reconciliation script shows zero difference per supplier, customer and account between the old tables and the migrated ledger on the seeded demo data.
3. Posting an invoice, paying it and allocating the two leaves both lines marked allocated with one shared reference; reversing the allocation reopens both.
4. A withheld line is skipped by a payment run.
5. Actual versus budget for a department is one query across two ledgers.
6. A line carries three currency amounts, and revaluation updates base and reporting amounts separately.
7. A user restricted to one department's analysis code sees only that department's lines in enquiry and reports.
8. An imported file of supplier invoices lands as entry documents and ledger lines through the single pipeline, with no payables-specific import code.

### Effect on the other work packages

| Package    | Change                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| WP-0, WP-A | None. Continue.                                                                                                    |
| WP-2       | None, but finish it before WP-U so the schema changes ship as real migrations.                                     |
| WP-3       | Replaced by WP-U.                                                                                                  |
| WP-4       | Targets entry documents and ledger lines; the separate AP and AR import targets are dropped. Adds export profiles. |
| WP-6       | Adds analysis on accounts and data access by analysis code.                                                        |
| WP-7       | Reports read ledger A against budget ledgers; ageing and statements become ledger reports.                         |
| ACC-10     | AR credit notes become an entry-document type, with no separate module work.                                       |

**Order:** WP-0, WP-A, WP-2, WP-U, WP-4, WP-5, WP-6, WP-7, WP-8.
