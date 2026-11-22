# Import feature: plan for approval

Status: **approved 21 November 2026, with the owner's decisions in section 8.** Work proceeds step by step (section 7), with a report after each step. It covers the import feature that the owner moved ahead of WP-U on 21 November:

- the canonical posting contract;
- one Transfer Desk pipeline that posts GL journals through that contract;
- seeded templates for Opera night audit, Simphony sales and Jana movements.

It takes the relevant parts of WP-3 (posting contract), WP-4 (one pipeline) and WP-5 (templates) from `REMEDIATION-BRIEF.md`. Everything else in those packages stays where it is.

The branch is `feat/import-pipeline`, built on `wp-2/tenant-platform`, because the schema change ships as a tenant migration through the WP-2 runner.

## 1. What is there today

| Area                 | Today                                                                                                                                                                                                                                                                      | Consequence                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Journal              | No `documentDate`, `sourceSystem` or `sourceDocumentRef`. `reference` (50 characters) is the only identifier.                                                                                                                                                              | No database duplicate check; the period cannot be derived from a date.                                               |
| Period               | `year` and `month` only; posting requires `OPEN`.                                                                                                                                                                                                                          | Deriving the period by calendar month is possible now; fiscal calendars are WP-3.                                    |
| Dimensions           | `journal_lines` has `dimension1` to `dimension10`. `AnalysisDimension` names them per entity, with required and list validation. The GL API schema accepts only 1 to 6. The Transfer Desk mapper fills only 1 and 2.                                                       | Dimensions 3 to 10 cannot be imported; names and validation are never applied.                                       |
| Transfer Desk mapper | `transfer-desk-record-mapper.ts` passes `accountCode` through as `accountId`. The period comes from a runtime parameter or the profile.                                                                                                                                    | Imports only work when the file carries internal IDs, which the brief forbids. Every row lands in one chosen period. |
| Pipeline             | `executeImport` either stages a batch (HOLD) or writes directly with `GLService.createJournal` and then `postJournal`. A failed post leaves a draft. Duplicates are checked only per file (`transfer_batches` unique on profile and file hash), and only for HOLD.         | Not atomic per document; the same document in a second file posts twice.                                             |
| Connectors           | `saf-import-service.ts` (Opera and Jana SAF), `sky-jana-sync-job.ts`, `simphony-import-job.ts` and `opera-cloud-import-job.ts` each parse, map (`ConnectorMapping`), find the period and post with their own code. The decimal rules and journal-type tables live in code. | Three more posting paths beside Transfer Desk.                                                                       |
| Seeded templates     | `seed-transfer-desk.ts` seeds Opera EZZRV, EZZCL, EZZDS and EZZMS, Jana purchasing, internal movements and inventory differences, Simphony and MT940, but only in the demo seed. They depend on the mapper above.                                                          | Not installed for real tenants; they cannot post without internal IDs.                                               |

## 2. The contract (package `@hfp/posting-contract`, v1)

A new workspace package exports Zod schemas and types. The pipeline produces this type and the posting service accepts only it. Screens move to it in WP-3 or WP-U; this phase does not change the screens.

```ts
GlJournalDocumentV1 = {
  contractVersion: 1,
  sourceSystem: string,        // tenant-defined code, e.g. "OPERA"; must exist and be active in source_systems
  sourceDocumentRef: string,   // 1–100 chars; unique per entity + sourceSystem (database index)
  documentDate: "YYYY-MM-DD",  // business date; drives the period and the FX rate date
  entityCode: string,          // resolved to the entity
  journalTypeCode?: string,    // tenant journal type, resolved by code
  description?: string,
  currency: "XXX",             // transaction currency
  fxRate?: decimal string,     // optional; otherwise looked up for documentDate (rate type from the profile)
  lines: [{                    // at least one line
    accountCode: string,       // resolved to the account of that entity; IDs never appear in files
    debit?: decimal string, credit?: decimal string,  // exactly one, or:
    amount?: decimal string,   // signed: positive = debit
    statValue?: decimal string,// statistical accounts only
    dimensions?: { [dimensionName]: code },  // keyed by the entity's dimension names, all ten available
    taxCode?: string, description?: string, lineRef?: string
  }]
}
```

Rules enforced by the posting service, each with a stable error code:

1. **Resolve.** Each code (entity, source system, journal type, account, dimension name and value, tax code) must exist and be active. Dimension values are checked against `AnalysisCode` when the dimension's validation is `LIST`. A dimension marked required must be present.
2. **Period.** The period is the entity's period with the same year and month as `documentDate`. If there is none, or it is not `OPEN`, the document is refused. No other period is ever substituted.
3. **Balance.** Debits must equal credits, both in transaction currency and in functional currency after the rate is applied. The existing GL check applies, and statistical lines are excluded from it.
4. **Duplicate.** If `(entity, sourceSystem, sourceDocumentRef)` already exists, the document is refused as a duplicate. A database unique index enforces this, so two runs at the same time cannot both post it. Every template's reference includes the source property. Duplicates are refused by default; replacing a posted document is a separate, explicit **reverse-and-replace** action: it needs its own permission, takes a reason, posts a reversal of the original journal and then the new document in one transaction, and writes an audit event linking the original, the reversal and the replacement.
5. **Post.** Create, post and update balances in **one transaction**, as the tenant's system user, under the normal approval rules: a rule that requires approval leaves the journal pending. Nothing is left half-written.

## 3. Schema change (one tenant migration)

- `journals`: add `document_date date`, `source_system varchar(20)`, `source_document_ref varchar(100)`.
- Add a partial unique index on `(entity_id, source_system, source_document_ref)`, where both are set.
- Existing journals: `document_date` is backfilled from `posted_at`, or else `created_at`, kept inside the journal's period (the period's last day when the date falls outside it). The database requires it (a `NOT NULL` check) and a trigger refuses a date outside the journal's period. Prisma keeps the field optional for now: about 30 places create journals (AP, AR, FX, intercompany, assets, allocation, year-end, the connectors), and WP-U gives each its own business date; until then the trigger fills the date when a caller leaves it out. The posting service always sets it.
- New table `source_systems` (`code`, `name`, `is_active`): tenant-wide, with codes defined by the tenant. Templates add `OPERA`, `SIMPHONY` and `JANA` when they are installed, never in code.
- `entities.code`: required and unique per tenant (a backfill check refuses the migration while any entity has no code or a duplicate code, and names them).
- `transfer_profiles`: add `atomicity` (`PER_DOCUMENT` default, or `WHOLE_FILE`), `unmapped_policy` (`REJECT`, `HOLD` or `SUSPENSE`), `suspense_account_code`, `fx_rate_type` and `source_system_code`.
- `transfer_execution_logs`: add `document_ref` and `journal_id`, so that a run's history shows each document and links to the journal it created.

The WP-2 runner applies this migration to every tenant. On the owner's `hfp_db` it can only run after the adoption in WP-2 item 4.

## 4. The pipeline (Integrations only)

`executeImport` becomes these stages. Each is a separate function with its own tests.

1. **Acquire:** read the file as today; store the raw payload and its hash on the run.
2. **Parse:** the FSD format, as today.
3. **Transform:** TML rules and lookup tables turn source codes into ledger codes. A lookup miss is handled by the profile's unmapped policy (section 5).
4. **Build documents:** the new `documentBuilder` stage groups records into `GlJournalDocumentV1`. The template's profile names:
   - the grouping key;
   - how `sourceDocumentRef` is formed, for example `{property}-{businessDate}-{journalType}`;
   - how `documentDate` is read;
   - the sign and scale convention;
   - which output fields are the ten dimensions, by name.
5. **Validate:** every document is passed through the posting service's validation, which checks without writing.
6. **Stage:** HOLD writes a `transfer_batch` holding the canonical documents, and a person commits it later. AUTO_COMMIT goes straight to posting. Scheduled runs stay AUTO_COMMIT, as today.
7. **Post:** each document is posted through the posting service in its own transaction (`PER_DOCUMENT`, the default), or all documents of the file in one transaction that posts nothing if any document fails (`WHOLE_FILE`).
8. **Record:** per document: posted (with the journal ID), refused with the error code, or duplicate. The run's counts cover documents and records.

What is removed from the pipeline:

- the direct-write GL branch in `transfer-desk-pipeline.ts`;
- the account-code-as-ID shortcut and the period runtime parameter in the mapper;
- the "auto-post failed, leave a draft" path.

AP and AR import targets are left as they are; WP-U replaces them.

## 5. Unmapped data

The tenant chooses a policy on each profile; nothing is fixed in code.

- `REJECT`: the document is refused with the missing codes listed.
- `HOLD`: the whole run is staged for review even when it would otherwise auto-commit.
- `SUSPENSE`: the unmapped amount goes to the profile's suspense account code, and the line keeps the original source code in its description.

## 6. Templates

The templates are installed per tenant as system templates (`isSystem`). They are added by a command, `db:install-templates <slug>`, and automatically at provisioning. They are no longer only in the demo seed. A tenant copies a template to adapt it, and an update to the system copy never overwrites the tenant's copy.

| Template                                  | File                                                                                | Format                                                                           | Grouping and `sourceDocumentRef`                                                            | Notes                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Opera night audit (whole file by default) | SUN exports: EZZRV (revenue), EZZCL (city ledger), and EZZDS and EZZMS (statistics) | Pipe-delimited; ÷1000 is a field attribute on the format rather than a TML rule. | One journal per property, business date and file type: `{property}-{yyyy-mm-dd}-{fileType}` | Statistics post `statValue` to statistical accounts. The property code is resolved to the entity by a lookup. |
| Simphony sales                            | Daily sales export file by revenue centre and major group                           | Delimited, from the existing seeded layout                                       | One journal per location and business date: `{property}-{location}-{yyyy-mm-dd}`            | File only; the API pull is WP-5 acquisition. Revenue class to account comes from a lookup.                    |
| Jana internal movements                   | SAF fixed-width, 512 characters, MCTRF                                              | Fixed-width; ÷1000 per the existing rule                                         | One journal per SAF journal number: `{property}-{journalNumber}`                            | Store and cost-centre codes go to dimensions by name through a lookup.                                        |

Each template ships with:

- a source-property-to-entity lookup (the property code in the file to the tenant's entity code), so files keep their own property codes;
- empty lookup tables (source code to account code, property to entity, store to dimension), which the tenant fills in;
- a sample file;
- a parity test: real files (EZZ exports for Opera) run through the old connector and through the template must give the same journals (accounts, amounts, period and dimensions).

The old SAF and Jana file-import routes and services are deleted only after their parity tests pass on real EZZ and Jana files. Simphony's and Opera Cloud's API clients keep only acquisition, which is WP-5.

## 6a. No hard-coded source logic (owner, 21 November 2026)

Everything specific to a source system becomes tenant data: formats, transformations, lookup tables and profiles. What stays in code is only what is not specific to any source: the format and transformation engines, the pipeline, the posting contract and posting service, and **fetch adapters**. A fetch adapter only fetches a file or records: an SFTP folder, the Opera Cloud, Simphony or Mews API, or the inbound push endpoint. It uses credentials from the source system's settings, which are sealed with the platform key. It maps nothing and posts nothing.

Each source's code is deleted as soon as its template produces the same journals from **real files** (accounts, amounts, period, dimensions).

| Hard-coded today                                                                                     | Replaced by                                                                                                                                                       | Deleted                                  |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `connectors/saf` (parser, import service), `routes/saf.ts`                                           | Opera night-audit and Jana templates                                                                                                                              | after Opera and Jana parity              |
| `connectors/sky-jana` (parser, sync job)                                                             | Jana template; the SFTP client becomes a fetch adapter                                                                                                            | after Jana parity                        |
| `connectors/opera-cloud` (mapper, SUN parser, import job), `routes/opera.ts`                         | Opera template; the client and auth become a fetch adapter                                                                                                        | after Opera parity                       |
| `connectors/simphony` (mapper, import job), `routes/simphony.ts`                                     | Simphony template; the client becomes a fetch adapter                                                                                                             | after Simphony parity                    |
| `connectors/mews` (mapper, import job), `routes/mews.ts`                                             | Mews template; the client becomes a fetch adapter                                                                                                                 | after Mews parity                        |
| `connectors/payroll`, `routes/payroll.ts`                                                            | Payroll template                                                                                                                                                  | after payroll parity                     |
| `connectors/bank/bank-statement-importer.ts`                                                         | MT940 template and a canonical bank-statement target (moved into this phase from section 9). Bank reconciliation is not an import and stays.                      | after MT940 parity                       |
| `connectors/inbound`                                                                                 | The inbound push endpoint becomes a fetch adapter that hands its payload to the pipeline, plus a template                                                         | after inbound parity                     |
| `connectors/shared/suspense.ts`                                                                      | The profile's unmapped policy (section 5)                                                                                                                         | with the last connector that uses it     |
| `transform-engine.ts`, `routes/interfaces.ts`, `InterfaceDefinition`                                 | Saved definitions migrated to formats, transformations and profiles                                                                                               | after the migration of saved definitions |
| `ConnectorMapping`                                                                                   | Lookup tables                                                                                                                                                     | after its data is migrated               |
| `ImportLog`                                                                                          | The integration run record                                                                                                                                        | with the last import path that writes it |
| `seed-transfer-desk.ts` (Opera, Jana, Simphony, MT940 formats in TypeScript)                         | Template data files installed per tenant (section 6)                                                                                                              | when the templates ship                  |
| The mapper's built-in targets and hand-written field lists (`GL_JOURNAL_TARGET_FIELDS` and the rest) | Targets and fields read from the posting contract package, the one place the ledger's own document types are defined. The AP and AR invoice targets go with WP-U. | in the pipeline step                     |

**Consequence for decision 4.** Deleting the Simphony, Opera Cloud and Mews import jobs would also remove their scheduled API pulls. So their fetch adapters are wired into the pipeline in this phase, and no scheduled import stops working.

## 6b. Transfer Desk becomes Integrations (owner, 21 November 2026)

The rename is complete; no "transfer desk" is left anywhere:

- **Screens and URLs:** a top-level **Integrations** area (`/integrations`) with Sources, Formats, Transformations, Lookups, Profiles, Schedules, Runs and Files. The separate Settings → Integrations page (connector credentials) moves into Sources.
- **API:** `/api/v1/integrations/...`. The old `/api/v1/transfer-desk/...` paths and old screen URLs redirect for one release, then they are removed.
- **Code:** `transfer-desk-*` jobs, queue names and modules are renamed. A queue rename drains the old queue first.
- **Database:** one tenant migration renames the 20 `transfer_*` tables, their indexes, constraints, sequences and row-security policies. Grants and policies are checked by the existing security tests. Permission codes keep working: they are renamed in the same migration, and role assignments follow.
- **Docs:** the brief, runbooks and help text.

## 7. Delivery steps (each one committed and pushed, gated on its tests and CI, with a report after each)

1. ~~Migration for section 3~~: done (95ee625).
2. ~~**Rename to Integrations**~~: done. Tenant migration `4_rename_transfer_to_integration`, the code, the API (`/api/v1/integrations/...`), the screens (`/integrations/...`) and the docs. Old API paths answer 308 and old screen addresses redirect, for one release. Notes from this step:
   - The permission codes became `INTEGRATIONS_READ`, `INTEGRATIONS_RUN` and `INTEGRATIONS_CONFIG`, renamed in place so that roles keep exactly what they had. The older connector permissions (`INTEGRATION_READ`, `INTEGRATION_IMPORT`, `INTEGRATION_CONFIG`) stay separate until step 9; merging the two families would widen some roles' access, so that is left to the owner.
   - Two profile APIs exist side by side: the profile builder (now `/api/v1/integrations/builder/...`) and the profile screens (`/api/v1/integrations/profiles...`). They are merged in step 10.
   - The web calls three routes that do not exist (`profiles/:id/validate-full`, `profiles/:id/dry-run`, `functions`); these are fixed or removed in step 10.
   - The settings `TD_LOCAL_UPLOADS_PATH`, `TD_S3_BUCKET` and `TRANSFER_DESK_TENANT_POLL_MS` became `INTEGRATION_UPLOADS_PATH`, `INTEGRATION_S3_BUCKET` and `INTEGRATION_TENANT_POLL_MS`. The old names still work for one release, with a warning in the log.
   - The per-tenant job queues are now named `integration-{slug}`. Jobs waiting in an old `transfer-{slug}` queue at deploy time are not picked up, so drain them first.
3. ~~The `@hfp/posting-contract` package~~: done. It defines the GL journal and bank statement documents (v1) as Zod schemas, plus a field catalogue for mapping, stable error codes and exact decimal arithmetic (no floating point). The checks that need no database (shape, dates, amounts, line rules, balance, statement totals) happen here; resolving codes, the period, the rate and duplicates is the posting service's.
4. ~~The posting service and the audited reverse-and-replace action~~: done (`modules/posting`). It takes a document, checks it against the contract, resolves every code (collecting all problems before refusing), takes the period from the date, finds the rate, refuses duplicates and writes and posts in one transaction through the GL's own rules (journal types, source restrictions, approval rules, multi-stage authorization). Tenant migration `5_reverse_and_replace` adds `source_revision` (the duplicate key is now entity, source system, reference and revision) and `replaces_journal_id`, and the permission `INTEGRATIONS_REPLACE`, which ADMIN holds in existing tenants too. Reverse-and-replace refuses when the reversal itself would need approval, because the original and its reversal must post together. Notes:
   - Journal lines have no tax code column, so a document line with `taxCode` is refused (`TAX_CODE_NOT_SUPPORTED`) rather than having the code silently dropped. WP-U adds the column.
   - Imports name the ledger's journal source (`PMS`, `POS`, `IMPORT`, ...) on the profile, because revenue accounts accept only `PMS` and `POS` unless the account allows more.
   - Tested as a real login role with application rights only, through the API's tenant client.
5. ~~The pipeline stages from section 4~~: done. A ledger import's transformation writes the contract's fields (the keys in `DOCUMENT_FIELDS`, with `journalDescription` for the journal and `dimensions.<name>` per dimension). `jobs/integration-documents.ts` groups records into documents by entity and reference, and `jobs/integration-import-documents.ts` dry-runs them for HOLD (the batch stores the documents), or posts them per document or the whole file at once. Every record is logged with its document and journal. Committing a held batch posts through the posting service too. Removed: the direct GL write, the mapper's GL mapping (account codes passed as IDs), the stager's own checks, and the `autoPost` option. The target field lists for ledger imports (the builder's, the metadata endpoint's, and the web wizard's copy) come from the contract. Notes:
   - An interactive run posts only to the entity it was started at (`ENTITY_OUTSIDE_RUN`); a scheduled run may post to any entity the file names. Whether a person may run an import for several properties at once is for the owner to decide.
   - The demo profiles in `seed-integrations.ts` name no source system and use field maps, so they import nothing until step 8 replaces them with templates; the run says why.
   - Batches staged before this step are refused at commit (`STAGED_BEFORE_RELEASE`); discard them and import again.
6. ~~Unmapped policies and the profile fields~~: done. The policy acts on lookup misses, which the transformation engine now reports as unmapped, with the table, the value and the target field. `REJECT` refuses the whole document, naming the missing codes; `HOLD` also stages the run for review; `SUSPENSE` sends an unmapped account to the profile's suspense account, keeping the source code in the line description (other unmapped values are rejected). Any other transformation error refuses its document too, so no document posts with a line missing. Found and fixed on the way: **lookup tables never worked at run time.** The pipeline gave the transformation no tables, so every lookup rule failed; the profile test screen's loader read columns that do not exist and swallowed the error. Lookups now resolve against the tenant's tables (`modules/integrations/lookup-resolver.ts`): key ranges, rows for one business unit (the record's entity), output columns, value types (constant, copy, omit, reverse sign) and a default value.
7. Source systems with sealed credentials, and fetch adapters (SFTP, Opera Cloud, Simphony, Mews, inbound push) feeding the pipeline on schedules.
   - **Part 1, done:** source systems are managed through the API (`GET`, `POST`, `PUT /api/v1/integrations/source-systems`; codes unique and fixed, deactivated rather than deleted), and both profile APIs take the import settings (source system, review mode, atomicity, unmapped policy with its suspense account, rate type), refusing an unknown source system or a suspense policy without an account. Until then no tenant could configure a ledger import.
   - **Part 2, waiting for the owner:** the fetch adapters and their sealed credentials (see the decisions in the run report). The Opera Cloud, Simphony and Mews APIs return JSON, which the format engine cannot read (JSON formats are WP-4, section 9); either JSON formats move into this phase, or each adapter writes its records as a delimited file for its template.
   - Found: the integrations API allows 10 calls a minute per client address for the whole route group (`modules/integration/router.ts`), which the Integrations screens can exceed on their own; to revisit with the screens (step 10).
8. Templates with real-file parity, deleting each source's hard-coded code as it passes: Opera, Jana, Simphony, Mews, payroll, MT940, inbound.
9. Migrating saved interface definitions and connector mappings, then deleting `transform-engine.ts`, the interfaces routes, `ConnectorMapping`, `ImportLog` writes and `seed-transfer-desk.ts`.
10. Screens: the Integrations area. Sources with their settings, profile policies, and the run history per document with errors and journal links.
    - **Part 1, done:** a Sources page (list, add, deactivate; only `INTEGRATIONS_CONFIG` may change), in the sidebar and on the Integrations overview, and a "Posting to the ledger" card on a ledger import profile (source system, journal source, review, whole file or per document, unmapped policy with its suspense account, rate type).
    - **Part 2, done:** a run's records show their document and a link to the journal it posted, or the error code and message. The web client's calls to routes that never existed (function library, function test, full validation, dry run, auto-map, execution stats) were used nowhere and are removed.
    - Still to do: merging the two profile APIs, and the rate limit on the integrations routes (step 7 notes; the owner's decision).

**Needed from the owner for step 8:** real sample files for each source:

- Opera EZZ exports (revenue, city ledger, statistics);
- Jana internal movements;
- a Simphony sales export;
- a Mews export;
- a payroll file;
- an MT940 statement;
- an inbound payload.

They are kept out of the repository unless anonymised.

The accepted test for the phase: a sample Opera night-audit file imports through the Opera template into two periods by document date, with ten dimensions on the lines. Importing it a second time posts nothing and reports every document as a duplicate.

## 8. Owner's decisions (21 November 2026)

1. **Order:** this phase runs before WP-U, against today's `Journal`. Held postings, entry documents and ledgers stay in WP-U.
2. **Atomicity:** per document by default, with a whole-file option on the profile. The Opera night-audit template defaults to whole file.
3. **Old connectors:** the SAF and Jana file imports are deleted, but only after parity on real EZZ (and Jana) files. The Simphony, Opera Cloud and Mews API clients stay for acquisition only (WP-5).
4. **Simphony:** a file template only now; the API pull stays in WP-5.
5. **References:** every template's `sourceDocumentRef` includes the property. Duplicates are refused by default. An explicit reverse-and-replace action, which is audited, replaces a posted document.
6. **Entities:** both. `entities.code` becomes required and unique per tenant, and each template has a source-property-to-entity lookup.
7. **Journal numbering and multi-ledger:** left for WP-U.
8. **Name:** Transfer Desk becomes **Integrations**, and Settings → Integrations folds into it.
9. **Rename depth:** everything, the database tables included. Old URLs and API paths redirect for one release.
10. **Hard-coded source logic** is removed per source, after parity on real files. Network clients stay only as fetch adapters.
11. **CI:** a draft PR from `feat/import-pipeline` into `wp-2/tenant-platform` checks every step.

**Before step 1:** the RLS bypass (finding SEC-11, P0) is fixed first; see `REMEDIATION-BRIEF.md`.

## 9. Not in this phase

- Statistics as a separate target, suppliers, customers, budgets and rates (bank statements moved into this phase, section 6a).
- Streaming of 200 MB files.
- JSON and nested XML formats.
- The full format designer.
- Effective-dated lookups.
- Reversing a whole batch.

All of these stay in WP-4 and WP-5.
