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
- Existing journals: `document_date` is backfilled from `posted_at`, or else `created_at`, then made `NOT NULL`.
- New table `source_systems` (`code`, `name`, `is_active`): tenant-wide, with codes defined by the tenant. Templates add `OPERA`, `SIMPHONY` and `JANA` when they are installed, never in code.
- `entities.code`: required and unique per tenant (a backfill check refuses the migration while any entity has no code or a duplicate code, and names them).
- `transfer_profiles`: add `atomicity` (`PER_DOCUMENT` default, or `WHOLE_FILE`), `unmapped_policy` (`REJECT`, `HOLD` or `SUSPENSE`), `suspense_account_code`, `fx_rate_type` and `source_system_code`.
- `transfer_execution_logs`: add `document_ref` and `journal_id`, so that a run's history shows each document and links to the journal it created.

The WP-2 runner applies this migration to every tenant. On the owner's `hfp_db` it can only run after the adoption in WP-2 item 4.

## 4. The pipeline (Transfer Desk only)

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

## 7. Delivery steps (each one committed and pushed, gated on its tests)

1. Migration for section 3, with integration tests:
   - an unbalanced document is refused;
   - a duplicate is refused by the database even when two posts run concurrently;
   - a document with no period for its month is refused, and so is one whose period is closed;
   - a document dated in a prior open period lands in that period.
2. The `@hfp/posting-contract` package: schema, types, and unit tests on valid and invalid documents.
3. The posting service (validate, resolve, post in one transaction) and the audited reverse-and-replace action, with integration tests on real Postgres with row security, as the application role.
4. The pipeline stages from section 4; the direct-write branch is removed; the old tests are migrated.
5. Unmapped policies and the profile fields, with tests for each policy.
6. Templates, the install command and provisioning hook, sample files and parity tests: Opera, then Jana, then Simphony.
7. Deletion of the SAF and Jana file-import paths, after their parity tests pass.
8. Screens: a minimal pass. The profile screen gets source system, unmapped policy, suspense account and rate type. The run history shows each document with its error or journal link. The full designer and mapping editor stay in WP-4.

The accepted test for the phase: a sample Opera night-audit file imports through the Opera template into two periods by document date, with ten dimensions on the lines. Importing it a second time posts nothing and reports every document as a duplicate.

## 8. Owner's decisions (21 November 2026)

1. **Order:** this phase runs before WP-U, against today's `Journal`. Held postings, entry documents and ledgers stay in WP-U.
2. **Atomicity:** per document by default, with a whole-file option on the profile. The Opera night-audit template defaults to whole file.
3. **Old connectors:** the SAF and Jana file imports are deleted, but only after parity on real EZZ (and Jana) files. The Simphony, Opera Cloud and Mews API clients stay for acquisition only (WP-5).
4. **Simphony:** a file template only now; the API pull stays in WP-5.
5. **References:** every template's `sourceDocumentRef` includes the property. Duplicates are refused by default. An explicit reverse-and-replace action, which is audited, replaces a posted document.
6. **Entities:** both. `entities.code` becomes required and unique per tenant, and each template has a source-property-to-entity lookup.
7. **Journal numbering and multi-ledger:** left for WP-U.

**Before step 1:** the RLS bypass (finding SEC-11, P0) is fixed first; see `REMEDIATION-BRIEF.md`.

## 9. Not in this phase

- Bank statements, statistics as a separate target, suppliers, customers, budgets and rates.
- Streaming of 200 MB files.
- JSON and nested XML formats.
- The full format designer.
- Effective-dated lookups.
- Reversing a whole batch.

All of these stay in WP-4 and WP-5.
