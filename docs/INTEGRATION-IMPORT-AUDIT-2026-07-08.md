# Integration & Import Layer Audit — Remediation Reference

**Date:** 2026-07-08
**Scope audited:** `apps/api/src/modules/integration/**` (Opera SUN + Opera Cloud, Mews, SAF, inbound, transform-engine/interfaces, bank), `apps/api/src/modules/gl/coa-import-service.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/middleware/requirePermission.ts`, `apps/api/src/services/auth.service.ts`, integration jobs.
**Purpose:** Single working reference for fixing the findings one by one. Update the **Status** box (`☐` → `☑`) and add the fixing commit/PR as we close each item.

---

## How to use this document

- Findings are grouped into **waves** by fix priority. Work top-down.
- Each finding has: severity, evidence (`file:line`), failure scenario, and the intended fix.
- Line numbers are as of the audit date; verify before editing (code may have shifted).

## Accepted scope decisions

- **Simphony connector is OUT OF SCOPE.** Micros Simphony POS revenue is consolidated _inside_ Opera and arrives in the Opera night-audit `.SUN` (EZZRV) files. The standalone Simphony connector (`connectors/simphony/*`, `runSimphonyImport`, `/simphony/*` routes) is unused. ⚠️ Running it alongside the Opera SUN import would **double-count F&B revenue** — recommend disabling/removing it (C1 below).
- **Prior-wave issues (already known — NOT re-audited here):** CONTRA_REVENUE missing from the debit-normal sign set (`inbound-service.ts:401`); global Opera token cache not keyed by credentials (`opera-cloud-auth.ts:6`).
- **Naming refactor is a SEPARATE workstream** (frontend routes → kebab-case full words, e.g. `gl/` → `general-ledger/`). Frontend only; API prefixes untouched. To be planned after Wave 1. See appendix.

## Structural root cause (context for Wave 1)

There is **no shared "post-journal" service.** Five independent code paths each create journals and update `accountPeriodBalance` with their own copy of the logic, diverging on sign handling, transaction atomicity, and balance-checking:

1. `inbound-service.ts importJournalBatch` — wraps journal+balance in `$transaction`; **signs `closing_balance` by account type** (only path that does).
2. `saf-import-service.ts executeSAFImport` — balance upsert **outside** any transaction; `closing_balance = debit - credit` (no type sign).
3. `opera-cloud-import-job.ts` — `importOperaSUNFile` (DRAFT only) and legacy `runOperaCloudImport` (POSTED); unsigned; not transactional.
4. `mews-import-job.ts` — POSTED directly; unsigned; wrapped in `$transaction`.
5. `routes/interfaces.ts /interfaces/:id/execute` (Transfer Desk / transform-engine) — unsigned; FX hardcoded to 1.

Recurring gap in paths 2–5: the **file/source is balance-checked as a whole**, but journals are built from **mapped-only lines** (unmapped codes silently dropped) with **no per-journal debit==credit assertion before posting**.

---

## WAVE 1 — GL-corrupting (do first)

### F1 — CRITICAL — SAF dedup reference omits business date

- **Status:** ☑ FIXED 2026-07-08 — `saf-import-service.ts`: journal reference is now `${sourceModule}-${businessDate}-${groupKey}` (business date = the group's transaction date). Distinct night-audit dates post; a genuine same-day re-import is still caught. Restatement handled via the existing `reverseJournal()` primitive + the `status:{not:"REVERSED"}` dedup filter (reverse-then-reimport, auditable). Typecheck clean. Follow-up (separate): content-hash duplicate detection (see F9).
- **Evidence:** `saf-import-service.ts:390–391` (fix), `groupLines:562–586`, dup check `:392–405`.
- **Was:** `groupKey` = `"all"` (single_entry) / Opera tx-code (by_reference) / journal type (by_journal_type) — none carried a date, so day-2+ files matched day-1's reference and were skipped as duplicates.

### F2 — HIGH — File-level balance check, but journals post from mapped-only lines

- **Status:** ☑ FIXED 2026-07-08 — see F6 (shared suspense-plug mechanism). Applied to `executeSAFImport`, `importOperaSUNFile`, and `interfaces.ts /interfaces/:id/execute`. Every built journal now gets any residual imbalance parked in Import Suspense + an `assertBalanced()` safety net before posting.
- **Evidence:** `saf-import-service.ts:152` (file check) vs `:332–337` (drop unmapped) and `:393–420` (create/post), balance upsert `:426–452`. Same shape: `importOperaSUNFile:41` vs `:149–173` (mitigated — posts DRAFT); `interfaces.ts:602–605` vs `:646`.
- **Scenario:** An unmapped settlement/control account (e.g. `12500` guest ledger) is dropped after the file already passed the balance check → **posted, out-of-balance journal**.
- **Fix:** After building each journal's lines, assert `sum(debit) == sum(credit)`; on mismatch fail the group or route the delta to a suspense account (F6).

### F3 — HIGH — Mews posts unbalanced journals when accounts missing / categories unmapped

- **Status:** ☑ FIXED 2026-07-08 — `mews-import-job.ts` now computes the residual after building all lines and parks it in Import Suspense, with `assertBalanced()` before the `$transaction`. (Same shared mechanism as F6.)
- **Evidence:** `mews-import-job.ts:173–188` (debit = `totalRevenue + totalTax`), `:191–208` (revenue credits only for mapped categories), `:211` (tax credit only `if taxPayable && totalTax>0`), created `status:"POSTED"` `:235`.
- **Scenario:** Missing `2300` tax account or any unmapped category → credits < debit, still POSTED with no balance assert.
- **Fix:** Sum credits first, assert equality against the settlement debit, post remainder to suspense or fail. _(Simphony had the same defect but is out of scope.)_

### F6 — HIGH — Unmapped codes silently dropped; no suspense/clearing account

- **Status:** ☑ FIXED 2026-07-08 — new shared module `connectors/shared/suspense.ts` provides `getOrCreateSuspenseAccount()` (per-entity account, code `SUSPENSE`), `computeImbalance()`, `suspensePlugSides()`, and `assertBalanced()`. Wired into `executeSAFImport`, `mews-import-job`, `importOperaSUNFile`, and `interfaces.ts` execute. Unmapped/dropped-line residuals now land in Import Suspense instead of unbalancing (or vanishing from) the journal; finance reclassifies out of suspense during clearing. Typecheck clean (0 errors). **This neutralized F2 and F3's imbalance.**
- **Follow-up (not blocking):** a Suspense-account monitoring view / clearing workflow (list non-zero suspense balances so finance is prompted to reclassify) — track as an enhancement.
- **Evidence (was):** `saf-import-service.ts:334–337`; `opera-cloud-import-job.ts:151–154`; `opera-cloud-mapper.ts:41`; `interfaces.ts:602–605`.

---

## WAVE 2 — Integrity & trust

### F16 — HIGH — Restated PMS data mishandled

- **Status:** ☑ FIXED 2026-07-08 — restatement now follows a uniform reverse-then-reimport model. SAF path: F1's date-scoped reference + `not: REVERSED` filter. Connector paths: new `POST /imports/:id/reverse` (F15) reverses the journal AND flips the `ImportLog` to `REVERSED`, so the connectors' `status: "SUCCESS"` idempotency no longer blocks a corrected re-import for that business date. Silent overwrite of posted financials is never performed (auditable). Typecheck clean.
- **Evidence:** `mews:53–77`; `runOperaCloudImport:270–286` (dedup on `connectorType, businessDate, SUCCESS`); `importOperaSUNFile:52–68` (dedup on **filename**).
- **Scenario:** Same-date corrected re-send → returns old log, correction ignored. Worse: `importOperaSUNFile` keys on filename, so a corrected file with a new name (`_R2`) bypasses dedup and **double-posts** the day.
- **Fix:** Detect restatement (same business date + changed content hash), auto-reverse the prior journal, re-import. Apply the SAF reverse-then-reimport model to the connectors.

### F14 — MEDIUM — Silent "SUCCESS" with nothing posted

- **Status:** ☑ FIXED 2026-07-08 — `mews-import-job.ts` and `opera-cloud-import-job.ts` (legacy `runOperaCloudImport`) now throw an actionable error when there is revenue to post (`mapped.length > 0`) but the cash/settlement account is missing, instead of falling through to the "no journal" branch and marking the import SUCCESS. The existing catch blocks record it as FAILED with the message. Remaining "no journal" branch now only runs for the genuine `mapped.length === 0` (nothing to post) case. Typecheck clean (0 errors). _(Simphony had the same pattern but is out of scope.)_
- **Evidence (was):** `opera-cloud-import-job.ts` `if (mapped.length>0 && cashAccount)`; `mews` `if (mapped.length>0 && cashSettlement)`.

### F15 — MEDIUM — No import-level reverse/correct flow

- **Status:** ☑ FIXED 2026-07-08 — new `POST /api/v1/integration/imports/:id/reverse` (`routes/imports.ts`) loads the `ImportLog`, reverses its posted journal via `GLService.reverseJournal()`, and marks the log `REVERSED`. Guarded by `INTEGRATION_IMPORT`. Enables F16. Typecheck clean.

### F4 — MEDIUM — Inbound journal batch never asserts debit==credit

- **Status:** ☑ FIXED 2026-07-08 — `inbound-service.ts importJournalBatch` now sums debits vs credits per journal and **rejects** (error + skip, no post) any unbalanced journal, since an inbound batch asserts complete self-balancing journals (reject at source, don't plug). Typecheck clean.

### F5 — HIGH — No business-date completeness / missing-day detection

- **Status:** ☑ FIXED 2026-07-08 — new `GET /api/v1/integration/imports/coverage?connectorType=&from=&to=` (`routes/imports.ts`) returns imported days, `missingDays[]`, and a `complete` flag over `ImportLog.businessDate` (SUCCESS only) for the range. Headless for now — a dashboard widget/alert can consume it in the frontend pass. Typecheck clean.

---

## WAVE 3 — Reconciliation, auth, credentials

### F13 — MEDIUM/HIGH — No PMS-ledger → GL control reconciliation; EZZCL folio-AR not implemented

- **Status:** ◑ PARTIAL 2026-07-08 — **Reconciliation report DONE:** new `GET /api/v1/integration/imports/ledger-reconciliation?from=&to=` (`routes/imports.ts`) aggregates POSTED PMS/POS/AR journal movements per account (functional currency) and checks the documented control-vs-detail relationships (city-ledger control 12450 vs AR detail 11750; guest-ledger 12500; deposit 24100 — all overridable). Gives finance the GL side to tie to the Opera guest/city-ledger reports. Typecheck clean. **Still open:** folio-level AR invoice creation for EZZCL (the `createARInvoices/by_folio_reference` behaviour) — separate feature, needs the AR module + likely a UI.
- **Evidence (was):** no control-vs-detail recon; `runOperaCloudImport` collapses revenue to cash `"1000"`.

### F17 — MEDIUM — Cross-entity permission bleed

- **Status:** ☐
- **Evidence:** `auth.service.ts:65–81` (`buildScopedClaims` flattens permissions across all entities); `requirePermission.ts:20–27` checks the flat list, not re-scoped to the active `X-Entity-ID`.
- **Scenario:** User with `INTEGRATION_IMPORT` on entity A but only `INTEGRATION_READ` on B can import into B.
- **Fix:** Evaluate permissions against the requested entity's grants. (Strength: header IS validated against claims — `auth.ts:430–434` — so no cross-tenant IDOR.)

### F18 — MEDIUM — PMS credentials are global env vars, not per-tenant

- **Status:** ☐
- **Evidence:** `opera-cloud-auth.ts:15–22`, `getMewsCredentials` read `process.env`; OHIP failures log raw response body (`:45–46`).
- **Fix:** Per-entity encrypted credential storage keyed by `entityId`; redact error bodies.

### F19 — MEDIUM — Statistics restatement double-counts or is blocked

- **Status:** ☑ ADDRESSED 2026-07-08 by F1 — stats files go through `executeSAFImport`, whose journal reference is now business-date-scoped. Re-importing the same stats date is caught as a duplicate (no double-count in `crossValidateStatistics`); a corrected stats date requires reverse-then-reimport (auditable). No further change needed unless a dedicated per-`(account,businessDate)` stat replace is desired later.
- **Evidence:** `PMSStatistic` upsert by `(entityId, statDate)` is fine (`opera.ts:72–90`), but stat-value journal lines (`saf-import-service.ts:342–350`) have no per-date dedup; `crossValidateStatistics` sums all lines for the date (`:655–669`).
- **Fix:** Dedup stat values by `(account, businessDate)`; replace on restatement.

---

## WAVE 4 — Parser & connector hardening

### F7 — MEDIUM — `autoCreateAccounts` infers wrong account types

- **Status:** ☑ FIXED 2026-07-08 — `saf-import-service.ts` range table corrected to the SAF/Opera/Jana numeric convention: `<20000` ASSET/DEBIT, `20000–29999` LIABILITY/CREDIT, `30000–39999` REVENUE/CREDIT, `40000+` EXPENSE/DEBIT. Previously 1xxxx assets became EXPENSE and 3xxxx/5xxxx fell through to the EXPENSE default (wrong sign + wrong statement classification). Typecheck clean.
- **Evidence:** `saf-import-service.ts:232–266`. `30000–39999` (revenue) and `50000–59999` fall through to default `EXPENSE`/`DEBIT`; `11xxx` assets (`<20000`) classified `EXPENSE`.
- **Fix:** Correct the range table or require explicit mapping for auto-created revenue accounts.

### F8 — MEDIUM — SAF AP-invoice auto-creation over-generates under `single_entry`

- **Status:** ☑ FIXED 2026-07-08 — `saf-import-service.ts` now creates one AP invoice per vendor credit line (voucher), attaching only the expense/tax debits that share that voucher's Transaction Reference (was: every expense line on every vendor). `taxAmount` is now the VAT portion (23xxx debits sharing the reference); `grossAmount` = vendor gross, `netAmount` = gross − VAT; `invoiceNumber` is unique per voucher. Typecheck clean.

### F9 — MEDIUM — No header/trailer/line-count check; no file-hash dedup; SAF writes no ImportLog

- **Status:** ☑ FIXED (audit trail + hash) 2026-07-08 — `executeSAFImport` now writes an `ImportLog` (RUNNING→SUCCESS/FAILED) with `businessDate`, counts, first journal id, and a SHA-256 `contentHash`. An identical file that already imported successfully returns an idempotent no-op (`alreadyImported`). Body wrapped in try/catch so failures are recorded FAILED. Result type gained `alreadyImported`/`importLogId`. Typecheck clean.
- **Note:** the SAF Control Record carries only _highest journal number_ + _cleardown sequence_ — there is **no declared line-count or trailer total** in the format to verify against, so the file-internal `debits == credits` check remains the integrity guard. Nothing further to do on the "trailer total" sub-point.

### F21 — MEDIUM — Interface execute: no idempotency + FX ignored

- **Status:** ◑ PARTIAL 2026-07-08 — **Idempotency FIXED:** `interfaces.ts` now derives the journal reference from `sha256(def.id + fileContent)` and returns the existing journal (200, `alreadyImported`) on re-run instead of creating a duplicate. **FX still open (deferred):** the per-line rate is still 1. A correct multi-currency fix must decide the balancing currency (functional vs transaction) because it interacts with the F2 suspense plug — doing it halfway could unbalance journals. Track FX as its own item.
- **Evidence:** `interfaces.ts` reference/dedup block (fixed); per-line `fxRate` (still 1).

### F10 — LOW/MED — Locale & sign edge cases in amount parsing

- **Status:** ☐
- **Evidence:** `saf-parser.ts:189,223` (`replace(/\D/g,"")` strips comma-decimal/sign); negative guard unreachable (`:294–298,:413–416`).
- **Fix:** Guard/warn on unexpected separators or signs.

### F11 — LOW — BOM & format-detection fragility

- **Status:** ☑ FIXED (BOM) 2026-07-08 — `parseSAFFile` now strips a leading U+FEFF BOM before splitting lines, preventing a one-column shift in fixed-width parsing. (The `detectFormat` first-line-only sampling is left as-is — very low risk.)

### F12 — LOW — Opera file-type detection substring-fragile

- **Status:** ☑ FIXED 2026-07-08 — `detectOperaFileType` now anchors the type code (RV/CL/MS/DS) to the 8-digit business date in the filename (`{PREFIX}{TYPE}{YYYYMMDD}`), robust against a property prefix containing those letters, with the old loose substring match kept as a fallback.

### F20 — LOW — Occupancy inputs unvalidated

- **Status:** ☑ FIXED 2026-07-08 — `opera.ts` statistics route now computes `warnings[]` (roomsSold > available, occupancyPct out of 0–100, negative counts) and returns them alongside the data without silently altering the reported figures. Typecheck clean.

---

## WAVE 5 — COA (Chart of Accounts) import

### F22 — MEDIUM — "Abort" commits partial work instead of rolling back

- **Status:** ☑ FIXED 2026-07-08 — `coa-import-service.ts`: the three `!skipErrors` abort points now `throw new COAImportAbort()` so the `withEntityRLS` transaction rolls back; a try/catch around it resets create/update counts to 0 (nothing persisted) and returns the accumulated errors. Typecheck clean.

### F23 — MEDIUM — Child accounts with unresolved parents silently unlinked

- **Status:** ☑ FIXED 2026-07-08 — `coa-import-service.ts` parent-linking loop now pushes an error ("Parent … not found — account left unlinked") when the parent can't be resolved, instead of silently skipping. Typecheck clean.

### F24 — LOW — normalBalance not validated vs type; Excel numeric-code reformatting

- **Status:** ☐ (deferred — low severity; note: `normalBalance` mismatch vs type is legitimate for contra accounts, so this needs a _warning_ channel rather than a hard error; Excel code-reformat needs a text-forced read of the code column.)
- **Evidence:** `coa-import-service.ts:384–398` (`REVENUE`+`DEBIT` accepted); `parseExcel:186–190` (`raw:false` reformats numeric codes).
- **Fix:** Validate normalBalance vs type; force text reads for the code column.

---

## Cleanup items (non-findings, tracked)

### C1 — Disable/remove the unused Simphony connector

- **Status:** ☑ FIXED 2026-07-08 — `runSimphonyImport` now hard-stops at the top (`SIMPHONY_CONNECTOR_DISABLED`) with a clear error explaining POS posts through Opera and enabling it would double-count F&B revenue. Guard sits in the job itself, so it blocks both the route and any scheduled invocation. Connector files left in place for future re-enable (flip the flag). Typecheck clean.

---

## Strengths to preserve (do not regress)

- `X-Entity-ID` validated against JWT claims with entity lineage (`auth.ts:430–434`, `isEntityAllowedByClaims:205–216`) — no header IDOR.
- `importOperaSUNFile` uses a date-scoped reference + filename `ImportLog` dedup — the idempotency model to copy elsewhere.
- `crossValidateStatistics` EZZDS↔EZZMS same-day reconciliation with tolerances (`saf-import-service.ts:689`).
- Mews balance update wrapped in `$transaction` (`mews-import-job.ts:227`).
- `reverseJournal()` primitive posts a reversing entry and marks the original REVERSED (`gl/service.ts:713`) — reuse for all import corrections.
- All import routes behind `requirePermission` + `requireEntityId`; no unauthenticated webhook.

---

## Appendix — Separate workstream: frontend naming refactor

**Decision (2026-07-08):** rename frontend route directories to full kebab-case words (no abbreviations). **Frontend only**; API URL prefixes (`/api/v1/gl` etc.) untouched. Planned after Wave 1.

Next.js App Router constraint: page files must stay `page.tsx`/`layout.tsx`; the descriptive name lives in the **directory (route segment)**, so renaming a directory changes the URL.

Proposed route renames (under `apps/web/app/t/[code]/(dashboard)/`):

| Current                             | New                                      |
| ----------------------------------- | ---------------------------------------- |
| `gl/`                               | `general-ledger/`                        |
| `ap/`                               | `accounts-payable/`                      |
| `ar/`                               | `accounts-receivable/`                   |
| `fx/`                               | `foreign-exchange/`                      |
| `reports/usali-pl/`                 | `reports/usali-profit-and-loss/`         |
| `settings/integrations/saf-import/` | `settings/integrations/saf-file-import/` |
| `dashboard/gm/`                     | `dashboard/general-manager/`             |
| `dashboard/cfo/`                    | `dashboard/chief-financial-officer/`     |
| `dashboard/ap/`, `dashboard/ar/`    | full names                               |

Each rename must also update: sidebar/nav config, all `<Link href>` / `router.push` references, breadcrumbs, and tests. Domain acronyms (USALI, SAF) kept as tokens. (`t/[code]` → `tenant/[code]` optional.)
