# HospitalityFinance Pro — Critical Re-Assessment

**Date:** 2026-06-11
**Assessed by:** 4 parallel agents (Security Analyst, Financial Logic Inspector, Code Quality Reviewer, API Coverage Checker)
**Prior assessment:** `docs/CRITICAL-ASSESSMENT-2026-04-13.md` (55 findings, all marked FIXED, verdict "PRODUCTION-READY")

---

## Executive Summary

The April remediation work was real: every spot-checked fix from the original 55 findings genuinely holds in current code (JWT secret, RLS race, Decimal conversions, FX counter-entries, CSRF, cookie security, etc.).

However, the **"PRODUCTION-READY" verdict does not hold**. This re-audit found:

- **2 new CRITICAL security findings** (RCE via TML sandbox; privilege escalation via role management)
- **4 new CRITICAL financial-correctness findings** (posting engines that never update account balances; depreciation double-posting)
- **5 prior fix claims that fail verification** (A3 sets, A5 AR, A6 soft-close, A8 sessions, Q2 integration tests)
- Multiple high-severity supporting issues

**RISK LEVEL: HIGH — NOT production-ready.**

---

## 1. SECURITY — 2 Critical, 3 High, 1 Medium, 2 Low

### CRITICAL

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Location                                                                                                                            | Status             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| NS1 | **TML sandbox executes user code in `node:vm` (escape → RCE).** `createSandbox` tries `require("isolated-vm")`, but `isolated-vm` is not declared in any package.json, so the require always throws and the code silently falls back to Node's `vm` module — which is not a security boundary. Any user who can author a TML user-function (transfer-desk mapping logic) achieves arbitrary code execution on the API host via `this.constructor.constructor("return process")()`. Additionally, `fn.name`/`fn.params`/`fn.body` are interpolated raw into the generated source (code-injection sink before execution). **Fix:** make `isolated-vm` a hard dependency, fail closed if it can't load, validate function names/params against `^[A-Za-z_$][\w$]*$`. | `packages/tml-engine/src/sandbox.ts:42-48,104-120`                                                                                  | FIXED (2026-06-12) |
| NS2 | **Privilege escalation via role management.** The JWT `roles` claim is built from ALL `UserRole` rows while ignoring their `entity_id` scope (`user.roles.map(ur => ur.role.code)`), and role-assignment routes have no privilege ceiling. A property-level admin with `ADMIN_ROLES_MANAGE` can assign SUPERADMIN to their own user (scoped to their property), re-login, and receive a **global** SUPERADMIN claim → full cross-entity access over the entire tenant. **Fix:** (1) privilege ceiling — actor may only grant roles/permissions that are a subset of their own; (2) restrict role/permission definition CRUD to SUPERADMIN; (3) only flatten roles into the JWT when `entity_id` is null or matches active entity context.                         | `apps/api/src/services/auth.service.ts:232,389`; `apps/api/src/modules/admin/router.ts:116,126,202,258`; `admin/service.ts:268-295` | FIXED (2026-06-12) |

### HIGH

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Location                                                                              | Status                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| NS3 | **Consolidation cross-entity IDOR via RLS-bypassing materialized view.** `runConsolidation` accepts arbitrary `childEntityIds[]` and queries `mv_period_account_balances` (MVs ignore RLS) with no check that the caller can access those children or that they are subsidiaries of the parent. A parent-scoped user can pull any sibling entity's full trial balance. **Fix:** validate every childEntityId is a descendant of the parent AND within the caller's accessible set; apply same to getRun/listRuns and other MV consumers (KPI, budget variance, TB PDF). | `apps/api/src/modules/consolidation/router.ts:66-84`; `service.ts:106-187`            | FIXED (2026-06-12)                                                                    |
| NS4 | **Live cloud credentials & secrets in on-disk `.env`.** Real-format AWS SES access key + secret, JWT signing secret, and placeholder platform API key in `apps/api/.env`; Keycloak admin password + duplicated JWT secret in root `.env`. Gitignored, but treat as compromised. **Fix:** rotate AWS SES key, JWT secret, platform key immediately; move to a secrets manager.                                                                                                                                                                                           | `apps/api/.env:6,13,24-25`; root `.env:9-10`                                          | PARTIAL (2026-06-12) — runbook in docs/SECRETS-ROTATION.md; rotation pending operator |
| NS5 | **Opera Cloud OAuth token cache is process-global.** Module-level `tokenCache` returns the cached token before comparing the supplied creds. Latent cross-tenant credential/data bleed the day per-tenant Opera credentials are introduced. **Fix:** key the cache by hash of creds.                                                                                                                                                                                                                                                                                    | `apps/api/src/modules/integration/connectors/opera-cloud/opera-cloud-auth.ts:6,24-28` | OPEN                                                                                  |

### MEDIUM

| #   | Finding                                                                                           | Location | Status                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---- |
| NS6 | **`GET /api/v1/entities` treats empty `entityIds` as superadmin.** `isSuperAdmin = !userEntityIds |          | userEntityIds.length === 0`→ an unscoped, non-superadmin token enumerates the full entity tree (route is in`ENTITY_CONTEXT_EXEMPT_PREFIXES`, so the auth plugin's guard doesn't apply). **Fix:** use explicit `hasExplicitCrossEntityAccess(roles)` check. | `apps/api/src/modules/entity/router.ts:89-124`; `plugins/auth.ts:88` | OPEN |

### LOW

| #   | Finding                                                                                                                                                                                                      | Location                                                                         | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------ |
| NS7 | Missing `return` after `reply.send()` in `requireAuth` / `requirePlatformKey` failure paths. Not exploitable on Fastify 4 (lifecycle short-circuits), but fragile and inconsistent with `requirePermission`. | `apps/api/src/middleware/requireAuth.ts:23-31`; `modules/tenant/router.ts:29-37` | OPEN   |
| NS8 | `/webhooks/` CSRF exemption exists but no webhook routes do — any future webhook mounted there is CSRF-exempt and unauthenticated unless it verifies an HMAC signature itself.                               | `app.ts:68`                                                                      | OPEN   |

### Verified fixed from April (spot-checked, all hold)

S1 (JWT fallback), S2 (RLS race — `withBypassRLS` transaction-local), S4 (COOKIE_SECURE), S6 (platform key in httpOnly cookie), S10 (dev auth gated on NODE_ENV + ENABLE_DEV_AUTH + uuid format), S11 (refresh cookie-only), S12 (CSRF origin enforced). Also clean: SQL injection (parameterized throughout), path traversal (`assertSafeStorageKey`), XXE (no XML in API), XSS (no `dangerouslySetInnerHTML`), refresh-token rotation re-reads claims from DB.

---

## 2. FINANCIAL LOGIC — 4 Critical, 6 Warning, 5 Info

### CRITICAL — posting engines that break trial-balance tie-out

Root cause pattern: the April fixes converted secondary posting engines to Decimal but missed that several **never write to `account_period_balances`** — the table every report and trial balance reads from. Journals exist; balances don't move. No error is thrown.

| #   | Finding                                                                                                                                                                                                                                                                                  | Impact                                                                                                                                                       | Location                                                                          | Status                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| NF1 | **Ledger Revaluation (LER) posts journals but never updates account balances.** Journal created `POSTED`, no `updateAccountBalance`/`batchUpdateAccountBalances` call (the other FX reval in `fx/service.ts` does it correctly).                                                         | Unrealized FX gain/loss invisible to TB; ledger and journal detail permanently disagree.                                                                     | `apps/api/src/modules/fx/ledger-revaluation.ts:329-399`; route `fx/router.ts:313` | FIXED (2026-06-12)                                                                                                             |
| NF2 | **Year-end cleardown posts journal but never updates account balances.**                                                                                                                                                                                                                 | P&L accounts NOT zeroed in the balance table, Retained Earnings never credited — new year opens with prior-year P&L still in TB. Most damaging close defect. | `apps/api/src/modules/period-close/year-end-cleardown.ts:250-281`                 | FIXED (2026-06-12) — also fixed inverted cleardown direction for credit-normal accounts under the canonical balance convention |
| NF3 | **Intercompany posts both entities' journals but never updates account balances** (both `doCreateTransaction` and `approveTransaction`).                                                                                                                                                 | IC receivables/payables and IC P&L never hit either entity's TB; IC control accounts never reconcile.                                                        | `apps/api/src/modules/intercompany/service.ts:440-581,684+`                       | FIXED (2026-06-12) — incl. reverseTransaction                                                                                  |
| NF4 | **Depreciation can double-post — no idempotency guard.** Process lock prevents concurrent runs only; no completed-run check (no `DEPRC-{year}-{month}` journal guard, unlike LER/year-end). Sequential second run posts a second journal AND increments `accumulatedDepreciation` again. | Run twice for a month → assets depreciate 2×, expense doubled.                                                                                               | `apps/api/src/modules/fixed-asset/service.ts:332-519` (esp. 492,500)              | FIXED (2026-06-12)                                                                                                             |

### WARNING

| #    | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Location                                                             | Status |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| NF5  | **Double-entry validated in transaction currency, not functional.** `validateBalance` sums raw `line.debit/credit` ignoring `fxRate`; what posts is `debitFunctional/creditFunctional`. DR 100 EUR @1.10 / CR 100 EUR @1.05 passes validation but posts $110 vs $105 → TB out by $5.                                                                                                                                                                                                                                                                                                                                                    | `apps/api/src/modules/gl/service.ts:218-251`                         | OPEN   |
| NF6  | **Authorization final-stage posting skips period check, balance validation, and conditional status update.** Can post into CLOSED periods (submitted while open, approved after close); can post unbalanced (returned → edited → re-approved); concurrent bulkApprove can post twice (findFirst + unconditional update instead of `setJournalStatusConditional`). **Fix:** route through GL service's `postJournalInternal`.                                                                                                                                                                                                            | `apps/api/src/modules/authorization/service.ts:1169-1206`            | OPEN   |
| NF7  | **FX revaluation idempotency key mismatch → double-post.** Stores reference `FX-REVAL-{today}` but looks up `FX-REVAL-{closingRateDate}` — never matches when run on a different day than the closing date (the normal case).                                                                                                                                                                                                                                                                                                                                                                                                           | `apps/api/src/modules/fx/repository.ts:182`; `fx/service.ts:286,349` | OPEN   |
| NF8  | **Inconsistent debit-normal sign sets corrupt closing balances.** Canonical set is `["ASSET","EXPENSE","CONTRA_REVENUE"]` (`gl/repository.ts:485,530`). Divergent: `gl/recurring-service.ts:219` and `inbound-service.ts:402` omit CONTRA_REVENUE; `fixed-asset/service.ts:460-482` uses no per-type sign (Accumulated Depreciation stored with opposite sign); `fx/repository.ts:211` hardcodes debit-normal (used against credit-normal AP control 2100). Silent corruption — period_debits/credits stay correct, closing_balance drifts. **Fix:** centralize the sign set; route all paths through canonical `updateAccountBalance`. | multiple (see finding)                                               | OPEN   |
| NF9  | **AR receipt allocation accepts negative amounts.** `decimalStringSchema` permits negatives and there is no `> 0` check; a negative `allocatedAmount` passes the over-application guard, reduces `amountPaid`, and can flip a PAID invoice back to PARTIALLY_PAID — unauthorized un-application.                                                                                                                                                                                                                                                                                                                                        | `apps/api/src/modules/ar/service.ts:290-318`; `ar/types.ts:5-8`      | OPEN   |
| NF10 | **Recurring journals post into any period status** (no OPEN check in `generateDueJournals`) — period-close bypass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `apps/api/src/modules/gl/recurring-service.ts:151-206`               | OPEN   |

### INFO

| #    | Finding                                                                                                                                                                                                           | Status |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| NF11 | Consolidation has no inverse/triangulated FX rate fallback — entity silently translated 1:1 with only a warning (`consolidation/service.ts:124-168`).                                                             | OPEN   |
| NF12 | Consolidation reads `mv_period_account_balances` which may be stale (async refresh job; no refresh-before-consolidate guard).                                                                                     | OPEN   |
| NF13 | `Number()`/`parseFloat` in reporting display rows (`reporting/router.ts:525-527`) and integration parsers (bank-statement, saf, sky-jana, opera-sun) — display/ingestion only, convert to Decimal before GL math. | OPEN   |
| NF14 | `rejectJournal` POSTED-reversal block is dead code (guard above already restricts to PENDING_APPROVAL) — `gl/service.ts:691-702`.                                                                                 | OPEN   |
| NF15 | Allocation remainder not absorbed when a FIXED_AMOUNT target is present — sub-cent residual can break "splits sum to source" (`allocation/service.ts:438-449`).                                                   | OPEN   |

### Verified fixed from April (hold)

F6 (cleardown 4dp), F7 (FX reval AP/AR counter-entries), F11 (day-28 hardcode), allocation Decimal pipeline + GLRepository routing, F1-F5 float→Decimal conversions in core GL/AP/AR/FX paths.

---

## 3. CODE QUALITY — prior claims re-verified

| Claim                  | April doc says           | Reality (2026-06-11)                                                                                                                                                                                                                                                             | Status  |
| ---------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Q1 `as any`            | PARTIAL (378 / 37 files) | **Worse: 408 / 49 files in API + 22 / 17 in web.** Hotspots: `authorization/service.ts` (68), `jobs/transfer-desk-pipeline.ts` (47), `integration/routes/transfer-desk.ts` (46). 212 of 408 are `(prisma as any)` casts disabling Prisma type checking on financial paths.       | OPEN    |
| Q2 integration tests   | FIXED                    | **Overstated: exactly 1 file** (`tests/integration/rls-enforcement.test.ts`), gated on `TEST_DATABASE_URL`, **skips itself by default**, entity-level only (no tenant-level isolation tests), no testcontainers/CI wiring.                                                       | OPEN    |
| Q3 frontend tests      | FIXED                    | 47 tests / 8 files vs **94 pages + 44 components** — shared components only, zero page coverage.                                                                                                                                                                                 | OPEN    |
| Q9 RabbitMQ reconnect  | FIXED                    | Verified (backoff 1s→30s) — **but `publishEvent` silently drops events while disconnected** (no outbox/retry); `period.closed`, `allocation.executed` can vanish.                                                                                                                | PARTIAL |
| Q12 worker supervision | FIXED                    | PM2 covers workers, BUT supervisor forks `transfer-desk-worker.js` which **has no standalone entrypoint → permanent no-op crash loop**; actual transfer-desk processing runs inside the API process. No workers service in docker-compose despite `Dockerfile.workers` existing. | OPEN    |

### New quality/ops findings

| #   | Finding                                                                                                                                                                                                                                                                                     | Severity                      | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------ |
| NQ1 | **docker-compose web misconfiguration:** `NEXT_PUBLIC_API_BASE_URL: http://api:4500` is a build-time-inlined var supplied at runtime (no effect on client bundle) AND a Docker-internal hostname unreachable from browsers. Browser traffic falls back to baked-in `http://localhost:4500`. | Critical (for docker deploys) | OPEN   |
| NQ2 | **RLS does not cover child line tables** (`journal_lines`, `ap_invoice_lines`, AR allocations — no entity_id column, no policy in `db/sql/entity-rls.sql`). Isolation for these tables is app-level only.                                                                                   | Important                     | OPEN   |
| NQ3 | **Unbounded AP/AR list endpoints** — suppliers/invoices `findMany` with no `take` (`ap/repository.ts:17-20,74-81`); GL is properly paginated.                                                                                                                                               | Important                     | OPEN   |
| NQ4 | **Stale pre-DB-split `src/db/schema.prisma` still tracked** (54 models, contains Tenant models, lacks Transfer\* models) — invites wrong-schema migrations.                                                                                                                                 | Important                     | OPEN   |
| NQ5 | **ENV docs drift:** `docs/ENV-VARIABLES.md` missing `REGISTRY_DATABASE_URL` (required since DB split), `PLATFORM_API_KEY`, `TENANT_DB_*`, `ENABLE_DEV_AUTH`, `AWS_SES_*`, `MEWS_*`, `ECB_RATES_URL`; documents `JANA_SFTP_*` while code reads `SKY_JANA_SFTP_*`.                            | Important                     | OPEN   |
| NQ6 | No migration step on deploy (nothing runs `prisma migrate deploy`); api/web compose services have no healthchecks despite `/health` and `/ready` existing.                                                                                                                                  | Important                     | OPEN   |
| NQ7 | 9 copy-pasted `mapError` implementations; 6 duplicated `request()` fetch wrappers in web with 10 `API_BASE_URL` definitions.                                                                                                                                                                | Minor                         | OPEN   |
| NQ8 | Repo hygiene: `tmp/*.json` data dumps tracked; generated `payment-runs/*.csv` in git index/history; `docs/files.zip` + empty `docs/files/`; 9 stray markdown specs at repo root (incl. typo `CaludeFinancePro.md`); large uncommitted working-tree drift.                                   | Minor                         | OPEN   |
| NQ9 | `gl-api.ts` is 3,844 lines and contains AP/AR/FX/transfer-desk/reporting clients; `integration/routes/transfer-desk.ts` is 2,313 lines.                                                                                                                                                     | Minor                         | OPEN   |

Build health (verified by execution): `tsc --noEmit` clean in both apps; 592 API + 47 web tests pass; no circular dependencies.

---

## 4. API ENDPOINT COVERAGE

Totals: **~240 backend endpoints, ~155 covered, ~68 uncovered, 7 ambiguous.**

### Frontend calls to NON-EXISTENT backend endpoints (runtime 404s)

| #   | Frontend call                                                                                                                                                                                    | Problem                                                                       | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------ |
| NA1 | `PUT /api/v1/admin/users/:userId/role` (`gl-api.ts:2003`)                                                                                                                                        | Backend has `POST /users/:userId/roles` — wrong method, path, AND body shape. | OPEN   |
| NA2 | 6 transfer-desk stubs (`gl-api.ts:2639-2740`): functions/library, functions/test, transformations/:id/auto-map, profiles/:id/validate-full, executions/stats, `GET /api/v1/license/entitlements` | Knowingly pre-wired to 404 (inline comment admits it).                        | OPEN   |
| NA3 | SSE URL `/transfer-desk/profiles/:id/test/:testId/stream` (`transfer-desk/api.ts:260`)                                                                                                           | Backend test router only exposes `/results`; no `/stream`.                    | OPEN   |

### April fix claims that FAIL verification

| Claim                                                               | Verdict     | Evidence                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A3 authorization sets UI                                            | **FAILED**  | 5 `/authorization/sets*` endpoints exist; no wrapper, no page.                                                                                                                               |
| A5 AP/AR edit-delete                                                | **PARTIAL** | `updateSupplier` wired; `deleteAPInvoice`/`updateAPInvoice` are dead exports; `deleteSupplier` has no wrapper; AR has NO PUT/DELETE wrappers (and no AR DELETE endpoints in backend either). |
| A6 soft-close                                                       | **FAILED**  | `softClosePeriod()` exists in `gl-api.ts:300`; no page imports it.                                                                                                                           |
| A8 session management                                               | **FAILED**  | `listSessions`/`revokeSession` exist; no page imports them; no UI page exists.                                                                                                               |
| A2 recurring journals, A3 fixed-asset lifecycle, A7 FX reval dialog | VERIFIED    | Pages wired correctly.                                                                                                                                                                       |

### Transfer-desk duplication (A1/T2.7 — still open, picture inverted)

Both module trees are mounted in `app.ts`: standalone `/api/v1/transfer-desk/*` (~7 router files) receives **zero frontend traffic** — 100% dead code. The integration module `/api/v1/integration/transfer-desk/*` is the sole live implementation and is a superset. **Action: deregister the standalone module.**

### OpenAPI spec out of sync

`docs/openapi.yaml` covers ~40-45% of endpoints with at least 5 wrong paths (e.g. `POST /api/v1/fx/revaluation` vs actual `/api/v1/fx/ledger-revaluation`; bank/opera/interfaces missing the `/integration` prefix). Entire modules absent (authorization, allocation, intercompany, period-close, transfer-desk, fixed-asset, setup, auth sessions). Not usable as a source of truth.

---

## 5. PRIORITY ACTION PLAN

### Tier 1 — Fix immediately

| #    | Action                                                                                           | Fixes   | Status                                                       |
| ---- | ------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------ |
| R1.1 | TML sandbox: make `isolated-vm` a hard dependency, fail closed, validate fn names/params         | NS1     | FIXED (2026-06-12)                                           |
| R1.2 | Rotate AWS SES key, JWT secret, platform API key; move to secrets manager                        | NS4     | PARTIAL (2026-06-12) — runbook written; operator must rotate |
| R1.3 | Scope-aware JWT role claims + privilege ceiling on role/permission grants                        | NS2     | FIXED (2026-06-12)                                           |
| R1.4 | Add `batchUpdateAccountBalances` to LER, year-end cleardown, and both intercompany posting paths | NF1-NF3 | FIXED (2026-06-12)                                           |
| R1.5 | Depreciation idempotency guard (completed-run / `DEPRC-{y}-{m}` journal check)                   | NF4     | FIXED (2026-06-12)                                           |
| R1.6 | Consolidation: validate childEntityIds against caller access + parent lineage                    | NS3     | FIXED (2026-06-12)                                           |

### Tier 2 — Fix before production

| #    | Action                                                                                                                         | Fixes     | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | --------- | ------ |
| R2.1 | Route authorization final-stage posting through GL `postJournalInternal` (period check + validateBalance + conditional status) | NF6       | OPEN   |
| R2.2 | Validate functional debits = credits in `validateBalance`                                                                      | NF5       | OPEN   |
| R2.3 | Align FX reval idempotency key to `closingRateDate`                                                                            | NF7       | OPEN   |
| R2.4 | Centralize debit-normal sign set; route all balance updates through canonical GLRepository                                     | NF8       | OPEN   |
| R2.5 | `> 0` guard on AR allocation amounts; OPEN-period check in recurring generation                                                | NF9, NF10 | OPEN   |
| R2.6 | Fix entity-list superadmin heuristic; Opera token cache keying                                                                 | NS6, NS5  | OPEN   |
| R2.7 | Fix docker-compose `NEXT_PUBLIC_API_BASE_URL` (build-arg or runtime config); add healthchecks + migrate step                   | NQ1, NQ6  | OPEN   |
| R2.8 | Fix phantom frontend endpoints (admin role PUT; remove/implement transfer-desk stubs)                                          | NA1-NA3   | OPEN   |

### Tier 3 — Fix before scale

| #    | Action                                                                                                    | Fixes          | Status |
| ---- | --------------------------------------------------------------------------------------------------------- | -------------- | ------ |
| R3.1 | Fix transfer-desk worker no-op fork; add compose workers service                                          | Q12            | OPEN   |
| R3.2 | Deregister dead standalone transfer-desk module                                                           | A1             | OPEN   |
| R3.3 | Pagination on AP/AR list endpoints                                                                        | NQ3            | OPEN   |
| R3.4 | RLS (or app-level defense-in-depth review) for line tables                                                | NQ2            | OPEN   |
| R3.5 | RabbitMQ outbox/retry for dropped events                                                                  | Q9             | OPEN   |
| R3.6 | Make RLS integration test run in CI (testcontainers + TEST_DATABASE_URL); add tenant-level isolation test | Q2             | OPEN   |
| R3.7 | Wire up dead UI: auth sets page, soft-close button, session management, AR edit/delete                    | A3, A5, A6, A8 | OPEN   |
| R3.8 | Burn down `as any` (start: authorization/service.ts 68, transfer-desk files 93)                           | Q1             | OPEN   |

### Tier 4 — Hygiene

| #    | Action                                                                                               | Fixes    | Status |
| ---- | ---------------------------------------------------------------------------------------------------- | -------- | ------ |
| R4.1 | Delete stale `src/db/schema.prisma`; untrack `tmp/` dumps + payment CSVs; move root specs into docs/ | NQ4, NQ8 | OPEN   |
| R4.2 | Correct ENV-VARIABLES.md (`REGISTRY_DATABASE_URL`, `SKY_JANA_SFTP_*`, missing vars)                  | NQ5      | OPEN   |
| R4.3 | Regenerate/replace openapi.yaml or mark non-authoritative                                            | —        | OPEN   |
| R4.4 | Consolidate mapError + web request() wrappers; split gl-api.ts                                       | NQ7, NQ9 | OPEN   |

---

## 6. Transfer Desk / Integration Scalability Assessment (2026-06-12 addendum)

Conceptual fidelity to Infor SunSystems Transfer Desk is **high**: profiles (with version snapshots + runtime overrides), FSD format classifications, TML XML with CDATA user functions, alpha-collated lookup tables, ordered automations with cron schedules, per-record execution logs with error-correction + rerun. Multi-tenant (per-tenant DB, queue `transfer-{tenantSlug}`, prefixed storage) and async (BullMQ) — ahead of Sun there.

**Gaps before the "onboard new systems by configuration" claim is real:**

1. **fsd-engine is only Phase A** — DELIMITED, SINGLE_FIXED, SIMPLE_XML implemented; MULTI_FIXED / OTHER_FLAT / USER_XML are stubs. Multi-record fixed-width is the most common hotel interface format. Excel support is documented in TRANSFER_DESK.md but not implemented.
2. **Every shipped connector bypasses the Transfer Desk** — Opera Cloud, Opera Sun, Mews, Simphony, Sky Jana, bank, payroll are bespoke 500-1000-line TypeScript importers calling GL/AP services directly. The scalable configuration track has never been exercised. Refactor connectors into thin acquisition adapters that drop files into transfer-desk storage and enqueue profile executions (Opera Sun first — `.SUN` parsing already exists in the engine).
3. **No generic acquisition layer** — profiles consume already-stored files only; per-profile SFTP polling / watched folders / webhook triggers are planned, not coded.
4. **Demo-grade limits:** whole-file-in-memory parsing (50 MB limit documented, not enforced), EXPORT capped at 100 records, per-tenant concurrency hardcoded to 1, no job retry, no duplicate-file dedup at pipeline level (double-posting risk), no batch transaction (partial imports rely on error-correction workflow).
5. **Targets limited** to GL_JOURNAL / AP_INVOICE / AR_INVOICE (+ process stubs) — budgets, master data, fixed assets import via separate bespoke endpoints.
6. **NS1 (TML sandbox RCE) is the prerequisite** for opening transformation authoring to anyone outside the core team.

---

## Overall Assessment

**RISK LEVEL: HIGH — NOT production-ready.**

The April remediation was genuine but the "all fixed / production-ready" conclusion was premature: the re-audit surfaced a parallel class of financial defects in the secondary posting engines (journals posted without balance updates — silent trial-balance corruption), two critical security holes (sandbox RCE, role-scope privilege escalation), several fix claims that counted dead code as coverage, and a deployment configuration that does not work as written. Tier 1 items block any production deployment with real financial data.
