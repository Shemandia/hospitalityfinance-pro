# Architecture Audit — Multi-Tenancy, Clusters/Properties, Inter-Property Journals

> **Date:** 2026-07-08 · **Scope:** apps/api (Fastify + Prisma + Postgres), consolidation of five parallel deep-audits
> **Dimensions:** multi-tenancy isolation · cluster/property hierarchy · intercompany/inter-property journals · GL core integrity · fit as a modern hospitality accounting product
> **Baseline:** builds on CRITICAL-ASSESSMENT-2026-04-13.md, DEPLOYMENT-READINESS-ASSESSMENT.md (2026-04-28), CRITICAL-ASSESSMENT-2026-06-11.md

---

## Executive verdict

The **architecture is sound; the execution has critical gaps.** The three structural pillars are genuinely well-designed and largely well-built:

1. **DB-per-tenant + entity-level RLS** (registry DB holds only tenant metadata; each tenant DB has `FORCE ROW LEVEL SECURITY` on ~50 tables, transaction-local `app.current_entity_id`, plus app-level Prisma scoping) — three independent isolation layers.
2. **Entity hierarchy** (self-referential `Entity` with CORPORATE/GROUP/CLUSTER/PROPERTY, lineage-aware access checks, per-entity periods/currencies/ledger setup).
3. **Atomic intercompany dual-posting** (both entity journals + balances + IC transaction row in one `$transaction` — the single-action improvement over SunSystems' two-step model actually works).

But each pillar is undermined by implementation defects: background jobs still run against a single shared database instead of iterating tenants; **consolidation returns zero rows for every child** (parent-period key mismatch); the IC **approval workflow is dead code** (any amount posts instantly to two ledgers); per-property **roles flatten tenant-wide** (a Controller at property A can post at property B); and multi-currency journals can post **functionally unbalanced**. Several "must-fix" items from the June assessment remain open.

**Overall: NOT production-ready for real financial data.** The fixes are mostly localized (days, not months) because the underlying design is right.

---

## 1. Multi-tenancy (registry + DB-per-tenant)

### What's right

- True DB-per-tenant: registry (`schema-registry.prisma`) holds only `tenants`/`entitlements`/`provisioning_steps`; all financial data in per-tenant DBs routed via a Prisma proxy + LRU pool (`db/prisma.ts`, `tenantPool.ts`).
- Tenant resolved from the **signed JWT claim**, not spoofable headers; `X-Tenant-Slug` header is cross-checked against the claim when present (`plugins/auth.ts:146-169, 384-397`).
- RLS session vars are **transaction-local** (`set_config(..., true)`), so pooled-connection GUC leakage — the classic pitfall — is avoided. `withBypassRLS` is transaction-scoped (the old global `ALTER TABLE ... DISABLE RLS` race is gone).
- Transfer Desk is the reference implementation: per-tenant queues, per-tenant workers, no DB credentials in Redis payloads.
- Registry API responses strip `databaseUrl`; Redis sessions are tenant-namespaced.

### Critical / High findings

| #       | Finding                                                                                                                                                                                                                                              | Evidence                                                      | Impact                                                                                                                                                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MT-1 🔴 | **Legacy background jobs run against the wrong (default) DB.** `mv-refresh-job.ts:62`, `recurring-journal-job.ts:37`, `dunning-job.ts:31` use the global proxy with no tenant context → fall back to `DATABASE_URL`.                                 | `db/prisma.ts:82-88`                                          | No tenant ever gets MV refreshes (stale trial balance/KPI/consolidation reads), recurring journals, or dunning. If `DATABASE_URL` points at a real tenant, journals post to the **wrong tenant's ledger**. Fix: iterate `listTenants()` + `runWithContext` per tenant (the Transfer Desk pattern). |
| MT-2 🔴 | **Prisma proxy fails open.** Missing tenant context silently returns the shared default client instead of throwing.                                                                                                                                  | `db/prisma.ts:63-89`                                          | Any context-loss bug becomes a cross-DB data event instead of a loud error. Fix: throw when multi-tenant mode is on and context is absent.                                                                                                                                                         |
| MT-3 🟠 | **AsyncLocalStorage context set via `enterWith` in an onRequest hook; the acknowledged fallback (`setActiveTenant`) is now a no-op.**                                                                                                                | `app.ts:103`, `db/prisma.ts:59-61`, `requestContext.ts:34-42` | The codebase's own comments say ALS can lose context across Fastify hooks; combined with MT-2 that lands on the default DB. Fix: wrap the request lifecycle in `storage.run()`; add a concurrent two-tenant integration test.                                                                      |
| MT-4 🟠 | **Tenant DB connection strings (incl. passwords) stored plaintext in the registry.**                                                                                                                                                                 | `schema-registry.prisma:42`, `provisioning-service.ts:134`    | Registry compromise yields every tenant's DB credentials. Store DB name only and compose from env creds, or encrypt with KMS.                                                                                                                                                                      |
| MT-5 🟠 | **Runtime DB role may bypass FORCE RLS — verify.** Provisioning makes one powerful role the owner of every tenant DB; if the runtime role is superuser/BYPASSRLS, the entire RLS layer is inert and every `$queryRaw` path has no entity protection. | `provisioning-service.ts:182-188`, `sql/entity-rls.sql:6,128` | Verify with `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;` on a tenant connection; run app traffic as a dedicated least-privilege role.                                                                                                                               |
| MT-6 🟡 | Single global `JWT_SECRET` for all tenants; deactivated tenants resolvable for up to 60s (registry cache TTL) with sessions not revoked.                                                                                                             | `auth.ts:51-56`, `tenantRegistry.ts:45`                       | One secret leak forges tokens for every tenant. Move to `kid`-based rotation / per-tenant keys; revoke Redis sessions on deactivation.                                                                                                                                                             |
| MT-7 🟡 | Platform key compared non-constant-time on the highest-value surface (tenant CRUD, CREATE DATABASE).                                                                                                                                                 | `tenant/router.ts:29-37`                                      | Use `crypto.timingSafeEqual`; put platform routes behind allowlist/mTLS.                                                                                                                                                                                                                           |
| MT-8 🟡 | Supervised Transfer Desk worker process is inert (no bootstrap enumerating tenants) — queued jobs strand after API restart.                                                                                                                          | `jobs/worker-supervisor.ts:42-47`                             | Give the worker a real main that starts per-tenant workers from the registry.                                                                                                                                                                                                                      |

---

## 2. Cluster / property hierarchy & authorization

### What's right

- **Entity scoping is genuinely server-side and layered**: validated `X-Entity-ID` with full-lineage claim checks (`plugins/auth.ts:430-435`), Prisma scope injection (`db/entityScope.ts`), forced Postgres RLS. Financial routers consistently use the validated `request.entityId`, never a raw client param; the two payload-entityId endpoints (FX reval, consolidation) cross-check it.
- Per-entity periods, functional currencies, timezones, ledger setups — properties in one cluster can be in different close states and currencies. This is a real strength.
- Entity-scoped SUPERADMIN rows can never become global claims (`auth.service.ts:70-74`).

### Critical / High findings

| #       | Finding                                                                                                                                                                                                   | Evidence                                                         | Impact                                                                                                                                                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HI-1 🔴 | **Per-property roles are not enforced.** `buildScopedClaims` unions role/permission codes from ALL accessible entities into flat claims; `requirePermission` never checks `(permission, entityId)` pairs. | `auth.service.ts:65-81`, `middleware/requirePermission.ts:20-27` | A Controller at Property A + Viewer at Property B can switch the selector to B and **post journals / approve invoices there**. Cross-property privilege escalation. Fix: per-entity claim maps or re-resolve roles for `request.entityId`. |
| HI-2 🟠 | **CLUSTER (and CORPORATE) are schema-only** — no API path creates them; the setup wizard builds exactly GROUP + properties, while the web UI renders a 3-level tree that can never exist.                 | `entity/router.ts:180`, `setup/service.ts:142-189`               | A real hotel group's cluster office cannot be modeled without hand-inserted rows. Multi-cluster support is advertised in the UI but absent in the API.                                                                                     |
| HI-3 🟠 | **No hierarchy integrity rules**: any parent type accepted (PROPERTY-under-PROPERTY etc.); `maxProperties` licensing counts only direct GROUP children so cluster-nested properties bypass licensing.     | `entity/router.ts:216-256`                                       | Enforce allowed parent-child type pairs; license across the subtree.                                                                                                                                                                       |
| HI-4 🟠 | **No ownership/management semantics**: no ownership %, no owner-vs-HMC distinction, no JV/NCI support; consolidation assumes 100% ownership of everything.                                                | `schema-tenant.prisma:304-325`                                   | Common structures (60/40 JV, management company recharges) can't be represented.                                                                                                                                                           |
| HI-5 🟡 | Three different descendant-scope semantics coexist: full lineage (auth header), one level (entity list/read), materialized snapshot that goes stale (`assignScope --cascade`).                            | `entity/router.ts:104-147`, `admin/service.ts:550-567`           | Corporate users can transact on grandchild properties they can't see in the selector; cascade grants miss later-added properties. Use one recursive resolver.                                                                              |
| HI-6 🟡 | Full tenant entity tree disclosed to any single-property user holding ADMIN_USERS (compounded by HI-1).                                                                                                   | `admin/router.ts:410-417`                                        | Filter to the actor's subtrees.                                                                                                                                                                                                            |

### Product gaps (hierarchy)

- **New-property onboarding is bare**: `POST /entities` creates only the row — no COA copy, no periods, no journal types, no dimensions. A property added mid-year is unusable without manual imports. No clone-from-template flow.
- **No cluster/portfolio reporting**: every reporting/KPI endpoint is single-entity; there is no side-by-side property comparison or cluster P&L other than the (broken, §3) consolidation run.
- **No inter-property allocations**: allocation definitions are single-entity; central cluster-office costs can't be spread across properties except via manual IC journals.

---

## 3. Consolidation

| #       | Finding                                                                                                                                                                                                                                                                                                                       | Evidence                                                                         | Impact                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CO-1 🔴 | **Consolidation is non-functional: child balances queried with the PARENT's periodId.** Periods are per-entity, so the MV lookup `entityId = child AND periodId = parent's` matches nothing; the setup wizard also creates periods only for properties, never the corporate parent, so the parent-period lookup itself fails. | `consolidation/service.ts:125-127, 220-235, 299-305`, `setup/service.ts:260-282` | Every run either 404s or "completes" with empty child trial balances — a silent misstatement. Fix: resolve parent period to (year, month) and join each child's own period. |
| CO-2 🟠 | Equity translated at closing rate; CTA computed by a proxy formula, not IAS 21 (no historical-rate tracking).                                                                                                                                                                                                                 | `service.ts:245-255`                                                             | Translated equity/CTA are wrong for any group with FX movement.                                                                                                             |
| CO-3 🟠 | Missing FX rate silently falls back to **1:1** and the run still persists as COMPLETE.                                                                                                                                                                                                                                        | `service.ts:207-217, 344`                                                        | An AED property consolidates into USD 3.67× overstated. Hard-fail on missing rates.                                                                                         |
| CO-4 🟠 | Eliminations driven by free-text `dimension1="INTERCOMPANY"` tags, netted per account with no counterparty matching, no NCI, no multi-level (cluster→corporate) roll-up, results stored as JSON not postable journals; uniform-COA assumed via account-code string equality with no mapping layer.                            | `service.ts:257-334`                                                             | See also IC-5 (over-elimination).                                                                                                                                           |

Strength: `assertChildrenAreSubsidiaries` is a proper server-side boundary (strict-descendant check) — a genuine fix since the April IDOR finding.

---

## 4. Intercompany / inter-property journals

### What's right (verify-and-keep)

- **True atomic dual-posting**: create/approve/reverse each wrap both entity journals + balance updates + the `ICTransaction` row in one `$transaction` (`intercompany/service.ts:591-754, 786-996, 1121-1299`). Schema-per-tenant makes this genuinely atomic — the SunSystems orphaned-one-side problem is solved.
- The prior "IC never updates balances" regression is **fixed** — `updateICBalances` routes through the canonical `GLRepository.batchUpdateAccountBalances` with real account types.
- Decimal arithmetic throughout the v2 path; reversal never deletes (flip + link + double-reversal guard); posted IC transactions have no edit/delete endpoints; self-approval guard exists.

### Critical findings

| #       | Finding                                                                                                                                                                                                                                                                                                                                                                                                                         | Evidence                                               | Impact                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IC-1 🔴 | **Approval workflow is dead code.** `createTransaction` unconditionally posts (`status:"POSTED"`); nothing reads `autoApproveThreshold`; `requiresApproval` was dropped from the mapping model; `approveTransaction`/`rejectTransaction` are unreachable via normal creation.                                                                                                                                                   | `service.ts:736`, `schema-tenant.prisma:2664`          | Anyone with `IC_CREATE` posts an unlimited-value recharge to **two ledgers instantly** — no dual control. Spec §5.2 requires HELD → dual approval.      |
| IC-2 🔴 | **Reconciliation double-counts reversals.** Balances recomputed from `ic_transactions` rows with `status="POSTED"`; a reversal row is itself POSTED with positive amounts while the original flips to REVERSED — so the reversal is added instead of cancelling.                                                                                                                                                                | `service.ts:1311-1455, 1283-1288`                      | GL is flat but the recon dashboard and period-end snapshot show a phantom outstanding balance; the close variance gate blocks on it.                    |
| IC-3 🔴 | **Reconciliation is blind to out-of-band entries and currency-nonsensical cross-currency.** It derives from the IC transaction table, not GL IC-account balances (spec §7.1), so manual journals hitting IC control accounts are invisible; cross-currency pairs subtract initiator-currency from counterparty-currency amounts with no translation — and `intercompany-v2.test.ts:737` asserts the bogus variance as expected. | `service.ts:1350`                                      | The recon can't do the one thing recons are for. Re-base on GL balances, translate both sides to reporting currency.                                    |
| IC-4 🔴 | **Legacy IC endpoint posts economically-null journals**: `postLegacyICJournals` puts BOTH legs of each journal on the same account (source journal: both lines on receivable; mirror: both on payable), ignores the supplied debit/credit account codes, and never updates balances — yet returns success.                                                                                                                      | `service.ts:1815-1977` (routed at `router.ts:378-423`) | "Head office pays vendor for property" books **nothing** in either entity — silent loss of a liability. Remove or disable the legacy `/journals` route. |

### Warnings

| #        | Finding                                                                                                                                                                                                                                                                                                                                                                                              | Evidence                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| IC-5 🟠  | **Consolidation over-eliminates**: both IC legs (control account AND the expense/revenue/cash offset) are tagged `dimension1:"INTERCOMPANY"`, so genuinely external P&L (e.g. head-office-paid vendor expense) is eliminated → group expense understated. No per-pair due-from=due-to netting check, no FX translation, hard-coded 100 warning threshold.                                            | `service.ts:652-703`; `consolidation/service.ts:298-336` |
| IC-6 🟠  | **Approve/reverse period handling**: approval loads the initiator period without an OPEN filter (counterparty side does check); reversal picks the latest OPEN period independently per entity → the two sides of a reversal can land in different months.                                                                                                                                           | `service.ts:835-845, 1123-1130`                          |
| IC-7 🟠  | **Cross-currency corrupts the transaction-currency amount**: journal lines store the functional amount in `debit/credit` while also carrying `fxRate`, so `debit × fxRate ≠ debitFunctional`. Functional balances are right, but FX revaluation of IC balances and original-currency drill-downs are wrong.                                                                                          | `service.ts:645-650, 686-691`                            |
| IC-8 🟡  | Period-end recon snapshot isn't period-scoped (`postedAt ≤ now`, ignores `periodId`).                                                                                                                                                                                                                                                                                                                | `service.ts:1401-1403`                                   |
| IC-9 🟡  | Mapping accounts are free-text codes with no IC-control-account restriction and no payable↔receivable pairing validation; entity-pair uniqueness is direction-sensitive at the DB (`(A,B)` unique but `(B,A)` guard is app-level, race-prone).                                                                                                                                                       | `types.ts:26-29`, `schema-tenant.prisma:2675`            |
| IC-10 🔵 | IC journals bypass `GLService.createJournal` (its balance check, numbering, approval). Balanced only by construction. Cross-tenant IC is (correctly) unsupported — must stay that way unless a saga design is added, given the DB split. Transfer Desk batch commit is per-item non-atomic and its `committedItems` counter counts pending-approval items as committed (`batch-service.ts:111-181`). |

---

## 5. GL core integrity

### What's right

- All money is `Decimal(18,4)` / `fxRate Decimal(14,8)`; no floats in the posting path.
- Balance math is race-safe (`INSERT ... ON CONFLICT` with SQL-level addition); posting is idempotent via status-guarded `updateMany`; period close/reopen use `SELECT FOR UPDATE` + advisory locks.
- Period lifecycle is real: soft-close → hard-close (validates functional balance) → LOCKED → SUPERADMIN reopen; year-end P&L cleardown to retained earnings exists, is idempotent and lock-protected, and now uses the canonical balance updater.
- Statistical accounts correctly excluded from balance validation and TB.
- `audit_events` has DB-level immutability triggers.

### Critical findings

| #       | Finding                                                                                                                                                                                                                                                                                                                                  | Evidence                                              | Impact                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| GL-1 🔴 | **Multi-currency journals validate on transaction amounts but post functional amounts.** `validateBalance` ignores `fxRate`; DR 100 EUR @1.10 / CR 100 USD @1.00 passes, writes a 10-unit functional imbalance — which hard-close then detects and **refuses to close the period**, with no in-app remediation (journal already POSTED). | `gl/service.ts:218-251`, `gl/repository.ts:177-178`   | Validate `Σ(debit×fxRate) = Σ(credit×fxRate)`; still open from June (NF5).                                                      |
| GL-2 🔴 | **FX revaluation has its own wrong-signed balance updater** — hardcoded debit-normal for ALL accounts, and its `ON CONFLICT` recompute **flips the sign of the entire previously-correct balance** on credit-normal accounts (AP Control 2100).                                                                                          | `fx/repository.ts:211-240`                            | AP liability silently inverts after a revaluation run. Route through `batchUpdateAccountBalances`.                              |
| GL-3 🔴 | **Depreciation balance updater still wrong** (open since April): ORM upsert with `net = debit − credit`, no sign flip → Accumulated Depreciation stored negative; non-atomic increment races with the canonical SQL path.                                                                                                                | `fixed-asset/service.ts:498-520`                      | Balance-sheet corruption; net book value drifts. (Run-level idempotency WAS fixed — `DEPRC-{year}-{month}` guard.)              |
| GL-4 🔴 | **Night-audit/PMS inbound + recurring journal engines omit CONTRA_REVENUE from the debit-normal set** — room allowances/comps/discounts stored wrong-signed; mixing paths corrupts shared rows.                                                                                                                                          | `inbound-service.ts:~401`, `recurring-service.ts:218` | Net revenue misstated on USALI reports. One canonical balance updater, everywhere.                                              |
| GL-5 🔴 | **No opening-balance roll-forward.** Every writer inserts `opening_balance = 0`; nothing carries period N closing into N+1; TB/FAL read a single period row.                                                                                                                                                                             | `gl/repository.ts:498`, `report-engine.ts:98-158`     | Balance sheets show **period movement, not cumulative balances**; after year-end, BS accounts lose all prior-year accumulation. |
| GL-6 🟠 | FX revaluation idempotency: the main path's key mismatch was fixed, but the generic `createRevaluationJournal` still stamps `FX-REVAL-${today}` and there's no unique constraint backing the `findFirst` guard — concurrent/double runs can still double-post.                                                                           | `fx/repository.ts:182, 257-266`                       | Add a DB unique constraint on the revaluation reference.                                                                        |

### Warnings

- **GL-7** Double-entry & posted-journal immutability are app-level only: no DB trigger blocks UPDATE/DELETE of posted `journals`/`journal_lines` (lines even cascade-delete); no DB constraint on debits=credits. Add posted-status triggers.
- **GL-8** Journal numbering is gappy and non-unique: `reference` not `@unique`, sequence incremented outside the posting transaction. Auditors expect gapless per-type sequences.
- **GL-9** Authorization final-stage posting (`_postJournalInternal`) skips period-status and balance re-checks; `bulkApprove` uses unconditional update — can post into CLOSED periods (June NF6, still open).
- **GL-10** Recurring journals have no OPEN-period check before creating POSTED journals (June NF10, still open).
- **GL-11** AP revaluation revalues the full invoice, not the outstanding balance (AR does it right) — unrealized FX overstated on partially-paid payables (`fx/service.ts:393`).
- **GL-12** Negative debit/credit line amounts accepted; 8-dp inputs silently rounded to 4-dp storage with no explicit rounding policy; `rejectJournal` contains dead reversal code.
- **GL-13** AR receipt allocation lacks a `> 0` lower bound — negative allocation can un-apply a paid invoice (June NF9, still open) (`ar/service.ts:290-298`).

---

## 6. Prior-assessment remediation status

**Genuinely fixed since June:** TML sandbox RCE (NS1); role-scope privilege escalation to global SUPERADMIN (NS2); consolidation cross-entity IDOR (NS3/CRIT-5 — descendant check); global RLS-disable race (CRIT-1); phantom-balance engines LER/year-end/IC (NF1–NF3); depreciation double-posting (NF4); FX reval key mismatch on the main path (NF7); dunning entity filter (HIGH-7); RLS coverage for most flagged tables (HIGH-5).

**Still OPEN from prior "must fix before production" lists:**

1. **Period-close router never mounted** — year-end endpoints 404; the frontend year-end page is dead. One-line fix (`app.ts` never imports `registerPeriodCloseRouter`). Open since 2026-04-28.
2. Depreciation balance sign/atomicity (GL-3).
3. Functional-currency balance validation (GL-1).
4. Authorization final-stage guards (GL-9).
5. Divergent debit-normal sign sets (GL-2/GL-4).
6. AR negative allocation (GL-13).
7. Recurring journals period bypass (GL-10).
8. Credential rotation — `apps/api/.env` still holds a live `AKIA…` AWS key + hardcoded JWT secret (operator action).
9. Opera Cloud token cache is process-global, not keyed by credentials — latent cross-tenant bleed once per-tenant PMS creds exist.
10. Child line tables (`journal_lines`, `ap_invoice_lines`, allocations) have no `entity_id`/RLS — app-level isolation only.

Note: the 2026-04-13 "PRODUCTION-READY / all 55 fixed" verdict remains contradicted by code; treat the June NO-GO as the accurate baseline.

---

## 7. Fit as a modern hospitality accounting product — gap map

| Capability                                              | Status                                                                                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chain → cluster → property hierarchy                    | Schema yes; **API cannot create clusters** (HI-2); no ownership %/JV/NCI (HI-4)                                                                                 |
| Property-restricted users                               | Entity access ✔ but **roles not property-scoped** (HI-1)                                                                                                        |
| Per-property fiscal calendar/currency/close             | ✔ Strong (per-entity periods & currencies) — but calendar-months only, no 4-4-5, no period 13                                                                   |
| Intercompany journals                                   | Atomic dual-posting ✔; approval, reconciliation, elimination all defective (IC-1..5)                                                                            |
| Inter-property allocations (cluster office cost spread) | ✖ Missing — allocations are single-entity                                                                                                                       |
| Group consolidation                                     | ✖ Non-functional (CO-1); no NCI, no multi-level, non-IAS-21 CTA                                                                                                 |
| Cluster/portfolio reporting                             | ✖ Missing — all reporting endpoints single-entity                                                                                                               |
| USALI                                                   | Skeleton: free-text usali columns, ~12-account template, one system report; **AnalysisDimension model is dead code** — departments/outlets/segments unvalidated |
| PMS integration (night audit)                           | Exists (Opera/inbound) but its balance updater mis-signs contra-revenue (GL-4); Opera token cache not tenant-safe                                               |
| New property onboarding                                 | ✖ Bare entity row only — no COA/period/dimension templating                                                                                                     |
| Audit trail                                             | `audit_events` immutable ✔; posted journals not DB-immutable (GL-7); journal numbering gappy (GL-8)                                                             |
| Opening balances / cumulative BS                        | ✖ No roll-forward (GL-5)                                                                                                                                        |

---

## 8. Prioritized remediation plan

**P0 — correctness of money already flowing (days):**

1. Mount the period-close router (one line).
2. Disable/remove the legacy IC `/journals` path (IC-4).
3. Fix consolidation child-period resolution (CO-1) + create parent periods at setup.
4. Functional-currency balance validation (GL-1).
5. Kill every ad-hoc balance updater — FX reval, depreciation, inbound, recurring — route all through `GLRepository.batchUpdateAccountBalances` (GL-2/3/4).
6. Convert the three legacy jobs to per-tenant iteration; make the Prisma proxy fail closed (MT-1/MT-2).

**P1 — control integrity (1–2 weeks):** 7. Implement the IC approval/threshold gate (IC-1); period filters on approve/reverse (IC-6). 8. Per-entity role/permission enforcement (HI-1). 9. Re-base IC reconciliation on GL balances with FX translation + reversal handling (IC-2/3); fix the test that blesses the variance. 10. Fix IC/consolidation elimination tagging + per-pair netting (IC-5/CO-4). 11. Opening-balance roll-forward at hard close (GL-5). 12. Verify the runtime DB role is not superuser/BYPASSRLS (MT-5); wrap requests in `storage.run()` (MT-3).

**P2 — product completeness (weeks):** 13. Make CLUSTER/CORPORATE creatable + hierarchy type rules + subtree licensing (HI-2/3). 14. Property onboarding templating (COA/periods/journal types/dimensions clone). 15. Wire up AnalysisDimension validation + full USALI departmental template; cluster/portfolio reporting fan-out. 16. Inter-property allocation engine (cluster-office cost spread generating IC pairs). 17. Ownership %/NCI + IAS 21 CTA + FX hard-fail in consolidation (HI-4/CO-2/CO-3). 18. DB-level posted-journal immutability + gapless journal numbering (GL-7/8); encrypt registry DB URLs (MT-4); per-tenant JWT keys/session revocation (MT-6).

---

---

# Wave 2 — Subledgers, Reporting, Integrations, Frontend, API Surface

> **Added:** 2026-07-08 (same day, second five-agent wave) · **Scope:** AP/AR subledgers · reporting/KPI/budget/allocation engines · PMS/SAF integration layer · web frontend · general API security. These are NEW findings; Wave 1 areas (GL core, tenant isolation, IC, consolidation, hierarchy) were not re-audited.

## Wave-2 executive summary

Wave 1 found the _structural_ pillars sound but their controls hollow. Wave 2 went one layer down into the day-to-day money flows and found the situation is worse than Wave 1 implied, because **the two most-used posting paths in a hotel — customer receipts and the nightly PMS import — are broken at the core:**

- **AR cash receipts post NO general-ledger entry at all.** The AR control account is debited on every invoice and never credited; cash is never debited. The entire receivables and cash position is structurally misstated (AR-C1).
- **The nightly PMS/SAF import silently stops posting after day one** — its duplicate-detection key omits the business date, so every subsequent day's file is discarded as a "duplicate" (INT-F1).
- **The primary financial statements render with the wrong sign** — the FSL report engine reads balances with the opposite sign convention to how the GL stores them, so a profitable hotel's Income Statement shows a loss and the Balance Sheet doesn't balance (RPT-C1). Unit tests pass only because their fixtures encode the same wrong convention.

Taken with Wave 1, the picture is consistent: **Decimal-clean arithmetic sitting on top of structurally untrustworthy posting and reporting.** The money primitives are right; what they add up to is not.

---

## 9. AP / AR subledgers

### Critical

| #        | Finding                                                                                                                                                                                                    | Evidence                                            | Impact                                                                                                                                                                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AR-C1 🔴 | **AR cash receipts post no GL journal.** `createReceipt`/`allocateReceipt` only insert `ar_receipts`/`ar_allocations` rows and bump `amount_paid`; `ARReceipt.glJournalId` is defined but never populated. | `ar/service.ts:249-322`, `ar/repository.ts:183-197` | AR control (1200) debited on every invoice, never relieved → grows unbounded; cash never debited for collections. TB/BS/USALI all materially wrong; subledger says PAID, GL says outstanding. Fix: post `DR bank / CR 1200` in the allocation transaction; add a subledger↔control reconciliation report (none exists). |
| AR-C2 🔴 | **Receipt over-allocation** — allocation is capped at the invoice's outstanding but never at the receipt's own unallocated balance; `ARReceipt` has no status/allocated field.                             | `ar/service.ts:261-322`                             | One $100 receipt can be applied $100 each to unlimited invoices, writing down AR against cash received once. Lock the receipt row; check `amount − Σ allocations`.                                                                                                                                                      |

### High

| #        | Finding                                                                                                                                                                                                                  | Evidence                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| AR-H1 🟠 | Negative allocation un-applies paid invoices (no `> 0` lower bound; zod allows leading `-`); no idempotency key so replaying a positive allocation double-reduces.                                                       | `ar/service.ts:290-318`, `ar/types.ts:65-69`     |
| AP-H2 🟠 | **No realized FX gain/loss on settlement.** Payment debits AP control at a fresh spot rate; functional residual (invoice rate vs pay rate) is stranded on the control account forever, no realized-FX account booked.    | `ap/service.ts:1047-1105`                        |
| H3 🟠    | Invoice `status` is a free-form field in both AP and AR update DTOs — write `{"status":"PAID"}`/`{"status":"POSTED"}` straight through, skipping the journal and the state machine.                                      | `ar/service.ts:210-233`, `ap/service.ts:434-451` |
| AP-H4 🟠 | **Supplier bank-detail changes have no approval, audit, or dual control** — same `AP_WRITE` used to create an invoice; `confirmPaymentRun` reads live bank details at execution. Classic payment-diversion fraud vector. | `ap/service.ts:337-356, 916`                     |
| AR-H5 🟠 | AR invoices book gross to revenue — no `taxAmount`/`netAmount` on `ARInvoice`; output VAT never separated.                                                                                                               | `ar/service.ts:163-189`                          |

### Medium

As-of aging uses current `amount_paid` not point-in-time balances and can't be reproduced for audit (AR-M1); aging drops the not-yet-due "current" bucket so buckets don't foot to the total (AR-M2); receipt currency/customer never validated against the invoice — a USD receipt can settle an EUR invoice for customer B (AR-M3); no void/reversal path for posted invoices or processed payments (M4); `deletePaymentRun` not atomic, can permanently strand invoices as "in a run" (AP-M5); dunning sends email before updating level, swallows the de-dup guard error, and races under concurrency (AR-M6); AP uses UTC and AR uses local time for period resolution — cross-subledger cutoff mismatch (M7).

**Strengths:** Decimal throughout; `SELECT FOR UPDATE` on posts/allocations/payment-run confirm; DB-level duplicate-invoice and duplicate-master prevention; duplicate-payment prevention (a run can't execute twice); AP posting asserts debit==credit; payment-file storage keys have path-traversal protection; AP/AR balance updates use the canonical updater with the correct sign list. **Note:** these AP/AR strengths make the AR-side GL gap (AR-C1) stand out as an omission, not a systemic sloppiness.

## 10. Reporting / KPI / budget / allocation

### Critical

| #         | Finding                                                                                                                                                                                                                                  | Evidence                                                                                             | Impact                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPT-C1 🔴 | **FSL report engine sign convention is inverted vs the GL write path.** GL stores credit-normal accounts as positive magnitudes (`sign=-1` → `credits−debits`); `report-engine.ts` and its test fixtures assume they're stored negative. | `gl/repository.ts:485-509` (write) vs `report-engine.ts:628` + `tests/report-engine.test.ts:119-146` | Seeded Income Statement shows −80000 for a +20000 profit; Balance Sheet renders liabilities/equity negative. Served live via `/reports/execute`. Tests pass only because mocks encode the wrong sign, masking it. |

### Warnings (all wrong-number-on-a-statement class)

- **RPT-W2** Cash-flow net income **adds** expenses instead of subtracting (`kpi/service.ts:365-373`).
- **RPT-W3** Cash-flow capex/inventory `.neg()` is applied to the running sum each iteration — correct only for a single-account range (`kpi/service.ts:384-396`).
- **RPT-W6** Balance Sheet never balances — no current-year-earnings line; intra-year net income included nowhere (`kpi/service.ts:263-337`, `report-engine.ts:756-915`).
- **RPT-W7/W8** FSL equity range `3000-3999` collides with the revenue range and classifies by 4-digit code only, while the real COA is 5-digit — silent mis-bucketing (`report-engine.ts:589-603, 896-946`).
- **RPT-W9** Allocation runs are **not idempotent** — no existing-journal check, ref `ALLOC-{name}` not period-scoped; re-run double-charges targets (`allocation/service.ts:596-750`).
- **RPT-W10** SPLIT allocation offset credits only `sources[0]` even when the pool spans several accounts (`allocation/service.ts:474-485`).
- **RPT-W11** No validation that FIXED_PERCENTAGE targets sum to 100% — the last target silently absorbs the shortfall (`allocation/service.ts:552-577`).
- **RPT-W4/W5** RevPAR fabricates a denominator of 100 rooms when PMS stats are missing, and reads room revenue from the never-refreshed MV while occupancy comes from live tables — sibling reports for the same period disagree (`kpi/service.ts:174, 183-188`).
- **RPT-W12/W13** Budget has no currency dimension (variance mixes currencies) and bulk upsert doesn't scope `accountId` to the entity (`budget/service.ts:58-92, 123-149`).
- **RPT-W1** Two parallel report engines (async PDF via KPIService vs sync `/reports/execute` via FSL) produce different numbers/signs for the same "Balance Sheet."

**Info:** `performance.sql` index DDL uses PascalCase table names while the MV/queries use snake_case — if the DDL errors the MV is never created (verify, B1); USALI EBITDA == GOP (mgmt fees hardcoded 0, B2); USALI drops misclassified revenue from totals (B3); RevPAR trend spreads revenue evenly across days (B4); PDF exports lack thousands separators/parens/currency symbol (B6). **Note:** `packages/fsd-engine` is a file-format import engine, not a statement-definition engine — no financial logic there to audit.

**Strengths:** Decimal throughout with precision tests; ADR/RevPAR/occupancy formulas are correct with zero-denominator guards; allocation journals self-balance via the canonical updater; KPI USALI/RevPAR sidestep the sign trap by recomputing from debits/credits with `.abs()`; budget variance % guards divide-by-zero.

## 11. PMS / SAF integration layer

**Structural theme:** there is **no shared post-journal service** — five independent import paths each create journals + update balances with their own copy of the logic, diverging on sign, atomicity, and balance-checking. Most balance-check the _file as a whole_ but then build journals from _mapped-only_ lines with no per-journal debit==credit assertion.

### Critical / High

| #             | Finding                                                                                                                                                                                                | Evidence                                                       | Impact                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INT-F1 🔴     | **SAF dedup key omits the business date** (`journalRef = ${sourceModule}-${groupKey}`, groupKey has no date).                                                                                          | `saf-import-service.ts:377, 562-586`                           | Day 2's file matches day 1's ref → entire file skipped as duplicate. **Night audits silently stop posting after day one.** (Contrast: `importOperaSUNFile` correctly uses `PMS-OPERA-${date}`.) |
| INT-F2 🟠     | File-level balance check, then unmapped lines dropped before posting → **posted, unbalanced journals** when a control/settlement account is unmapped. Same shape in Opera SUN and the interfaces path. | `saf-import-service.ts:152, 332-420`                           |
| INT-F3 🟠     | Mews & Simphony debit the full PMS/POS total but credit only mapped/existing accounts → unbalanced POSTED journals on any missing account.                                                             | `mews-import-job.ts:173-235`, `simphony-import-job.ts:198-325` |
| INT-F5 🟠     | No business-date completeness / missing-day detection anywhere.                                                                                                                                        | (grep — none)                                                  |
| INT-F6 🟠     | Unmapped codes silently dropped, no suspense account or clearing workflow (the single fix that would neutralize F2/F3).                                                                                | `saf-import-service.ts:334-337` et al.                         |
| INT-F15/16 🟠 | No import correction/reversal path; a restated same-date file is ignored, but `importOperaSUNFile` keys on filename so a renamed corrected file **double-posts**.                                      | `mews:53-77`, `opera-cloud-import-job.ts:52-68`                |

### Medium

False "SUCCESS" — a missing settlement account marks the ImportLog SUCCESS with `recordsImported=N` while posting no journal (INT-F14); `autoCreateAccounts` mis-classifies ranges (revenue 30000-39999 and 11xxx assets fall through to EXPENSE/DEBIT — wrong sign, F7); SAF AP-invoice auto-creation over-generates under `single_entry` (every vendor gets all expense lines, VAT zeroed, F8); no header/trailer total or line-count verification, no file-hash dedup, and SAF writes no ImportLog at all (F9); cross-entity permission bleed — `INTEGRATION_IMPORT` on entity A lets a user import into entity B (F17, same root as HI-1); PMS credentials are global env vars, not per-tenant (F18); statistics restatement double-counts or is blocked (F19); `/interfaces/:id/execute` has no idempotency and hardcodes fxRate=1 (F21); COA import "abort" returns instead of throwing, committing partial work (F22).

**Strengths:** all import routes behind `requirePermission` + validated `X-Entity-ID`; no unauthenticated webhook; parsers use no raw SQL with file data; `importOperaSUNFile` demonstrates the correct date-scoped dedup pattern the others should copy; `PMSStatistic` upsert by `(entityId, statDate)` is correct.

## 12. Web frontend (apps/web)

### Critical

| #         | Finding                                                                                                                                                                                                                                              | Evidence                                               | Impact                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| WEB-C1 🔴 | **Year-End Cleardown page is fully dead** — calls `/api/v1/period-close/*` (router never mounted, Wave-1 item). The initial 404 is swallowed, so the page renders "No year-end configuration set" — the broken feature masquerades as un-configured. | `periods/year-end/page.tsx`, `lib/gl-api.ts:3559-3576` | The fiscal-year P&L→retained-earnings close cannot be run from the UI, and the failure is invisible.                                     |
| WEB-C2 🔴 | **Report API errors render as empty tables.** Trial balance (and ~⅔ of pages) have no `isError` branch; a 500/network/403 shows "No data for the selected period."                                                                                   | `gl/trial-balance/page.tsx:414-424`                    | During an outage a user sees a clean empty TB and concludes the period has no activity. `QueryError` component exists but isn't applied. |
| WEB-C3 🔴 | **Journal "Balanced" check ignores currency/fxRate** — sums raw debit/credit across lines; 100 USD debit vs 100 TZS credit shows "Balanced" and enables submit.                                                                                      | `gl/journals/new/page.tsx:261-270, 688`                | Mirror of GL-1 on the client; the green badge actively misleads.                                                                         |

### High

Core GL post/approve/reject/reverse buttons are **not permission-gated** in the UI (SoD invisible; a creator sees Approve on their own journal — WEB-H1); journal Functional Currency defaults to hardcoded "USD" not the entity's currency, and is free-text (WEB-H2); amount inputs use `parseFloat` on free text with no numeric mode — "1,250.00" silently books **1.00** (WEB-H3); no reason captured on journal rejection (audit gap, WEB-H4); year-end/USALI pages bypass the shared formatter — currency-less figures with ragged decimals on the numbers used to close the year (WEB-H5).

**Medium:** no currency code shown on the TB (M1); date-only strings shift a day west of UTC (M2); report tables not virtualized (M3); CSV export formula-injection (M4, same as the API-side export finding); color-only variance signaling + green debits (M5); amount inputs/account picker lack accessible labels and keyboard selection (M6).

**Strengths:** httpOnly-cookie auth with no token in web storage, silent refresh; journal posting actions all behind confirm dialogs with buttons disabled during mutations and **no optimistic updates** (exactly right for finance); shared format library with zero-decimal-currency handling; reusable `QueryError` + permission hook already exist (fixes are about applying them consistently); entity switcher has solid ARIA; query keys are entity-scoped (no cross-entity cache leak found).

## 13. General API security & surface

### High

| #        | Finding                                                                                                                                                                                                                      | Evidence                                                                   | Impact                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-1 🟠 | **Live AWS SES key + hardcoded JWT secret still in `.env`** (AKIA…, unrotated since April); JWT_SECRET duplicated across `apps/api/.env`, root `.env`, and `docker-compose.yml`.                                             | `apps/api/.env`, `docker-compose.yml:10`                                   | Leaked JWT secret forges tokens for any user/tenant/role. Rotate in IAM now; move to a secrets manager.                                                                 |
| SEC-2 🟠 | **Privileged operations produce no audit trail** — `AUDIT_MODELS` excludes User/UserRole/Role/Permission/Entity, and admin role grant/revoke/invite use `$executeRawUnsafe` which Prisma `$use` middleware never intercepts. | `db/auditMiddleware.ts:5-20`, `admin/service.ts:307,325,423`               | The June privilege-escalation path (binding ADMIN\_*/SUPERADMIN) is invisible to forensics. (Supplier bank-detail changes *are\* audited — but see AP-H4: no approval.) |
| SEC-3 🟠 | **`xlsx@0.18.5` (SheetJS) with known CVEs** (prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363) parses user-uploaded Excel; the patched build isn't on npm.                                                           | `package.json`; `coa-import-service.ts:176,243`, `transform-engine.ts:364` | Any user with import permission can DoS a worker or pollute `Object.prototype`. Migrate to a maintained parser / CDN-pinned build; parse in a worker with a timeout.    |

### Medium

No security headers (helmet absent — SEC-4); CSV formula-injection into bank payment files (`ap/service.ts:207-222`, SEC-5); `trustProxy` unset so the login rate-limiter and audit IP key on the proxy IP (SEC-6); rate-limit store is in-memory not Redis-backed — defeated on scale-out (SEC-7); no global error handler, so some 500s serialize raw Prisma/internal messages (SEC-8).

**Low:** login user-enumeration via distinct 423-vs-401 and skipped bcrypt timing oracle; `changePassword` doesn't revoke other sessions; no refresh-token-reuse family revocation; no MFA; OpenAPI spec documents ~54 paths vs ~28 mounted (admin/tenant/setup/intercompany/authorization/transfer-desk largely undocumented).

**Strengths:** bcrypt cost 12, 12-char policy, lockout after 5 fails, new sessionId per login, refresh rotation, Redis session check per request, httpOnly+SameSite=strict+secure cookies, tokens no longer in the login body; **every** `$queryRawUnsafe`/`$executeRawUnsafe` in the request path is parameterized (no user data concatenated into SQL); Origin enforced on all mutations with an allowlist; setup seeding is idempotent; Keycloak fully removed, native auth only.

---

## Consolidated severity roll-up (both waves)

| Area                      | 🔴 Critical | 🟠 High | Notes                                                                        |
| ------------------------- | ----------- | ------- | ---------------------------------------------------------------------------- |
| Multi-tenancy             | 2           | 3       | Jobs → wrong DB; proxy fails open                                            |
| Hierarchy / consolidation | 1 (CO-1)    | 6       | Roles flatten; clusters uncreatable; consolidation returns empty             |
| Intercompany              | 4           | 5       | Approval dead; recon double-counts; legacy path null-posts                   |
| GL core                   | 5           | —       | Functional-balance gap; wrong-signed updaters; no roll-forward               |
| **AP/AR**                 | **2**       | **5**   | **AR receipts never hit GL; receipt over-allocation**                        |
| **Reporting**             | **1**       | **~12** | **Statements sign-inverted; BS doesn't balance; allocation double-posts**    |
| **Integrations**          | **1**       | **~6**  | **Night audit stops after day 1; unbalanced import postings**                |
| **Frontend**              | **3**       | **5**   | **Dead year-end page; errors as empty tables; balance check currency-blind** |
| **API security**          | **0**       | **3**   | **Live secrets; no privileged-op audit; vulnerable xlsx**                    |

## Revised top-10 P0 list (both waves, ranked by money-impact × reachability)

1. **AR-C1** — AR receipts post no GL entry. The receivables/cash position is wrong for every tenant that collects money. _(highest impact, happens on every receipt)_
   ☑ FIXED 2026-07-08 — `ar/service.ts createReceipt` now creates the receipt and a POSTED GL journal atomically (debit bank-linked GL account or code 1000, credit AR control 1200/fallback) via `createPostedJournalForARReceipt` + the canonical `updateAccountBalance`, sets `glJournalId`, resolves fxRate (input > same-currency 1 > latest SPOT, else 422). Router passes actor. Typecheck + suite clean.
2. **INT-F1** — Night-audit import stops posting after day one. _(silent, daily, affects the primary revenue feed)_
   ☑ FIXED 2026-07-08 — see `docs/INTEGRATION-IMPORT-AUDIT-2026-07-08.md` F1 (business-date-scoped journal reference + reverse-then-reimport restatement).
3. **RPT-C1** — Financial statements render sign-inverted / don't balance. _(every P&L and BS view)_
   ☑ FIXED 2026-07-08 — `report-engine.ts`: new exported `storedBalanceToNatural(stored, accountType)` helper; both FSL balance loaders now convert stored positive-magnitude balances to natural sign before template signs apply, so REVERSE rows render credit-normal accounts positive as designed. Test fixtures re-encoded to the real write-path convention (they previously encoded the inverted sign and masked the bug); 38 report-engine tests pass. FAL/Trial Balance intentionally still shows stored magnitudes. RPT-W1/W6 (KPI PDF engine parity, current-year-earnings line) remain open.
4. **GL-1 / WEB-C3** — Multi-currency journals validate on transaction amount, post functional → imbalanced ledger + deadlocked close.
   ◑ PARTIAL 2026-07-08 — API side FIXED: `gl/service.ts validateBalance` now sums debit/credit × fxRate (functional) with 4dp tolerance; multi-currency tests added. WEB-C3 (frontend journal balance check ignores currency) still open — blocked on the web page-tree restore.
5. **Mount the period-close router** (one line) — unblocks year-end close (Wave 1 + WEB-C1).
   ☑ FIXED 2026-07-08 — `registerPeriodCloseRouter` imported and mounted in `app.ts` after the period router; serves `/api/v1/period-close/*`.
6. **Disable the legacy IC `/journals` path** (IC-4) — silent liability loss.
   ☑ FIXED 2026-07-08 — legacy `POST /intercompany/journals` and `POST /journals/:id/approve` now return 410 `IC_LEGACY_JOURNALS_GONE` pointing to `POST /v2/transactions` (atomic dual-posting). `GET /journals` + reject kept for read access / draft cleanup.
7. **Kill the ad-hoc balance updaters** (GL-2/3/4, INT-F2/F3) — route everything through the canonical updater + per-journal balance assert; add a suspense account (INT-F6).
   ◑ PARTIAL 2026-07-08 — import-side suspense plug + `assertBalanced()` done (INT-F2/F3/F6, see integration doc); FX reval / depreciation / recurring ad-hoc updaters still open.
8. **IC approval gate** (IC-1) + **AR receipt over-allocation / negative-allocation guards** (AR-C2/H1).
   ◑ PARTIAL 2026-07-08 — AR guards FIXED: `allocateReceipt` rejects amounts ≤ 0 and locks the receipt row (`FOR UPDATE`) to cap total allocations at the receipt amount, in addition to the existing invoice-outstanding cap. IC approval gate (IC-1) still open.
9. **Convert legacy jobs to per-tenant iteration + fail-closed proxy** (MT-1/2); **fix consolidation period resolution** (CO-1). ☐ open
10. **Rotate the AWS/JWT secrets** (SEC-1) and **audit privileged operations** (SEC-2); **supplier bank-change approval** (AP-H4). ☐ open

## Cross-cutting root causes (fix the cause, not just the symptom)

Several criticals share four underlying causes — fixing these retires many findings at once:

1. **No single canonical posting service.** GL, IC, AP, AR, FX reval, depreciation, and five import paths each hand-roll journal creation + balance update. Every divergence (wrong sign, no balance assert, functional-vs-transaction confusion, AR receipts skipping GL entirely) traces here. **One `postJournal(tx, lines)` that asserts functional balance and owns the canonical balance updater** would fix GL-1/2/3/4, IC-4, AR-C1, INT-F2/F3/F4, and RPT sign issues at the source.
2. **Read/write sign convention isn't shared.** The write path stores credit-normal as positive magnitude; readers variously assume positive or negative. Centralize sign handling in one presentation helper driven by `account_type` (fixes RPT-C1/W6/W7, and the tests that encode the wrong convention).
3. **Permissions are unioned across entities, not evaluated against the active entity.** One root (`buildScopedClaims` flattening) surfaces as HI-1, INT-F17, and the frontend SoD gaps.
4. **Idempotency/dedup keys omit their scoping dimension.** Business date (INT-F1), period (RPT-W9 allocation, IC-8 snapshot), and content-hash (INT-F16) are missing from keys that need them. Establish a keying convention for every re-runnable posting job.

## Bottom line

Nothing here changes the Wave-1 verdict — it sharpens it. The **architecture remains sound and worth building on**, and the security fundamentals (auth, RLS design, Decimal money, SQL parameterization) are genuinely good. But **as of this audit the system cannot be trusted to produce correct financial statements**: customer cash doesn't reach the ledger, the nightly revenue feed stops after one day, and the statements that would reveal these problems are themselves sign-inverted and don't balance. These are not edge cases — they are the main paths. The good news is the concentration: four root causes (above) sit under most of the criticals, and the fixes are localized because the foundations don't need to change.
