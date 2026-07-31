# DEPLOYMENT READINESS ASSESSMENT

**Project:** HospitalityFinance Pro -- Multi-Tenant Hospitality Financial Management SaaS  
**Assessment Date:** 2026-04-28  
**Previous Assessment:** 2026-04-13 (55 findings, all claimed "FIXED")  
**Methodology:** 5 parallel specialized agents (Security, Financial Logic, API Coverage, UI Finance, Deployment Readiness)  
**Files Inspected:** 300+ source files across API, Web, Workers, and Packages

---

## EXECUTIVE SUMMARY

**VERDICT: NO-GO FOR PRODUCTION DEPLOYMENT**

The application has strong architectural foundations -- dual-database multi-tenancy, PostgreSQL RLS, atomic GL balance updates, role-based dashboards, and proper cookie-based authentication. However, five independent audits uncovered **critical blockers** that prevent deployment: the TypeScript build fails with 72 errors (no production artifact can be produced), two single-line auth bypass vulnerabilities allow unauthenticated access, hardcoded AWS and JWT credentials exist in environment files, the year-end close feature returns HTTP 404 due to an unmounted router, and financial authorization thresholds use floating-point arithmetic that can route journals to wrong approval tiers.

**Estimated time to deployment-ready: 2-3 weeks with a senior developer focused full-time.**

---

## COMPOSITE SCORES

| Audit Dimension                                    | Score  | Verdict     | Findings                               |
| -------------------------------------------------- | ------ | ----------- | -------------------------------------- |
| Deployment Readiness (Build, Config, Architecture) | 42/100 | NO-GO       | 5 blockers, 10 improvements            |
| UI Finance Standards                               | 60/100 | NO-GO       | 4 critical, 8 high, 15 medium, 12 low  |
| Financial Logic Integrity                          | 68/100 | CONDITIONAL | 3 critical, 10 warnings, 7 info        |
| API Endpoint Coverage                              | 67%    | NO-GO       | 4 runtime 404s, 42 uncovered endpoints |
| Security Posture                                   | --     | NO-GO       | 5 critical, 4 high, multiple medium    |

**Total unique findings: 130+**

---

## P0 -- ABSOLUTE BLOCKERS

These must be resolved before any deployment. The system cannot function in production with these issues present.

---

### B1. TypeScript Build Fails With 72 Errors

**Source:** Deployment Readiness Agent  
**Severity:** CRITICAL -- BLOCKER  
**Impact:** No production artifact can be produced. Docker build fails at `RUN pnpm --filter @hfp/api build`.

**Details:**
The last `turbo-build.log` shows 72 TypeScript compilation errors with exit code 2:

- `src/app.ts` -- 30+ errors from `Http2SecureServer` type incompatibility with Fastify's `RawServerDefault` (all router registrations and hook handlers affected)
- `src/modules/ap/service.ts` -- 21 nullable reference errors (`'invoice' is possibly 'null'`)
- `src/modules/integration/connectors/opera-cloud/opera-sun-parser.ts` and `sky-jana-parser.ts` -- type mismatches between `string` and `number` on amount fields
- `src/modules/fx/service.ts` -- `"OPEN_ER_API"` is not assignable to the FX source enum
- `src/scripts/provision-tenant.ts` and `provision-demo-chains.ts` -- `.tenant` does not exist on PrismaClient (wrong client type)

**Effort:** 1-2 days  
**Fix:** Resolve all TypeScript errors. The majority are type annotation fixes and proper null narrowing.

---

### B2. 6 Failing Tests Out of 129

**Source:** Deployment Readiness Agent  
**Severity:** CRITICAL -- BLOCKER  
**Impact:** Test suite cannot validate code correctness; CI pipeline fails.

**Details:**
4 test files with 6 failures:

1. `cross-entity-security.test.ts` (3 failures) -- Tests expect `findUnique`/`update`/`delete` to be entity-scoped with `AND` filters, but `entityScope.ts` deliberately excludes single-record operations (relying on RLS instead). Tests are out of sync with intentional code behavior.
2. `ap.service.test.ts` (1 failure) -- `transaction.$queryRaw is not a function` -- Prisma mock stub is incomplete.
3. `period.service.test.ts` (1 failure) -- `this.prisma.$transaction is not a function` -- same mock incompleteness.
4. `audit.serialization.test.ts` (1 failure) -- Decimal serialization returns a Decimal object instead of a string.

**Effort:** 4-8 hours  
**Fix:** Update test mocks and assertions to match current code behavior.

---

### S1. Authentication Bypass -- Missing `return` in `requireAuth.ts`

**Source:** Security Analyst  
**Severity:** CRITICAL -- SECURITY  
**Location:** `apps/api/src/middleware/requireAuth.ts`, line 23  
**Impact:** Execution continues after sending a 401 response. Unauthenticated requests reach protected route handlers.

**Details:**

```typescript
// CURRENT (vulnerable):
reply.code(401).send({ error: "Unauthorized" });
// Execution continues to the route handler!

// FIXED:
return reply.code(401).send({ error: "Unauthorized" });
```

**Effort:** 5 minutes (single-line fix)  
**Fix:** Add `return` before `reply.code(401)`.

---

### S2. Authentication Bypass -- Missing `return` in `tenant/router.ts`

**Source:** Security Analyst  
**Severity:** CRITICAL -- SECURITY  
**Location:** `apps/api/src/modules/tenant/router.ts`, line 32  
**Impact:** Same pattern as S1 -- execution continues past auth check.

**Effort:** 5 minutes (single-line fix)  
**Fix:** Add `return` before `reply.code(...)`.

---

### S3. Empty `entityIds` Array Bypasses RLS

**Source:** Security Analyst  
**Severity:** CRITICAL -- SECURITY  
**Location:** `apps/api/src/plugins/auth.ts`, line 102  
**Impact:** If a user has no entity assignments, the empty `entityIds` array may bypass Row-Level Security filters, potentially granting access to all entities' data.

**Effort:** 30 minutes  
**Fix:** Check for empty `entityIds` and deny access if no entities are assigned.

---

### S4. AWS SES Credentials Hardcoded in `.env`

**Source:** Security Analyst + Deployment Readiness Agent  
**Severity:** CRITICAL -- SECURITY  
**Location:** `apps/api/.env`, lines 24-25  
**Impact:** Real AWS SES access key (`AKIA6HSUMPP5SCMGTCFL`) and secret key are present on disk. If this file was ever committed to git history, these credentials are compromised.

**Effort:** 1 hour  
**Fix:** Rotate the AWS SES credentials immediately. Use AWS IAM roles or Secrets Manager for production. Verify git history with `git log --all --full-history -- apps/api/.env`.

---

### S5. JWT Secret Hardcoded in `.env`

**Source:** Security Analyst + Deployment Readiness Agent  
**Severity:** CRITICAL -- SECURITY  
**Location:** `.env` (root) and `apps/api/.env`  
**Impact:** The JWT signing secret `19683918a197b4aa...` is present in environment files. If ever in git history, any attacker can forge authentication tokens for any user.

**Effort:** 1 hour  
**Fix:** Rotate the JWT secret. Generate a new cryptographically random secret for production. Use Secrets Manager or environment injection.

---

### A1. Period-Close Router Never Mounted in `app.ts`

**Source:** API Endpoint Coverage Agent  
**Severity:** CRITICAL -- RUNTIME 404  
**Location:** `apps/api/src/app.ts` (missing import/registration)  
**Impact:** `registerPeriodCloseRouter` is defined in `modules/period-close/router.ts` but never imported or called. The frontend year-end page (`periods/year-end/page.tsx`) calls all three endpoints (`getYearEndConfig`, `saveYearEndConfig`, `runYearEndCleardownApi`) -- every call returns HTTP 404. This is a fully built feature (both backend and frontend complete) with a missing one-line registration.

**Effort:** 5 minutes  
**Fix:** Add `import { registerPeriodCloseRouter } from "./modules/period-close/router.js"` and `await registerPeriodCloseRouter(app)` to `app.ts`.

---

### A2. Dead `/api/proxy/` Call in Year-End Page

**Source:** API Endpoint Coverage Agent  
**Severity:** CRITICAL -- RUNTIME 404  
**Location:** `apps/web/app/t/[code]/(dashboard)/periods/year-end/page.tsx`, line 66  
**Impact:** The page fetches `/api/proxy/api/v1/periods?entityId=...` but no `/api/proxy/` Next.js route exists. The period dropdown is permanently empty, preventing users from selecting a period for year-end cleardown.

**Effort:** 10 minutes  
**Fix:** Replace `fetch('/api/proxy/api/v1/periods...')` with `getPeriods(apiContext)` from `lib/gl-api.ts`.

---

### F1. Float Arithmetic for Authorization Thresholds

**Source:** Financial Logic Inspector  
**Severity:** CRITICAL -- FINANCIAL  
**Location:** `apps/api/src/modules/authorization/service.ts`, lines 538 and 1053  
**Impact:** Journal amounts for authorization threshold decisions are computed using JavaScript `Number()` (IEEE 754 float64) with `Math.abs()` and accumulation via `reduce`. A journal of exactly 10,000.00 might compute as 9,999.999999999998, routing to the wrong approval tier. The accumulation pattern compounds rounding errors with each line.

```typescript
// CURRENT (vulnerable):
const journalAmount = journal.lines.reduce(
  (sum: number, l: any) => sum + Math.abs(Number(l.debitFunctional ?? l.debit ?? 0)),
  0
);

// FIXED:
const journalAmount = journal.lines.reduce(
  (sum: Prisma.Decimal, l: any) =>
    sum.add(new Prisma.Decimal(String(l.debitFunctional ?? l.debit ?? 0)).abs()),
  new Prisma.Decimal(0)
);
```

**Effort:** 30 minutes  
**Fix:** Use `Prisma.Decimal` accumulation, matching every other module in the codebase.

---

### F2. Depreciation Balance Updates Bypass Atomic SQL + Wrong Sign Direction

**Source:** Financial Logic Inspector  
**Severity:** CRITICAL -- FINANCIAL  
**Location:** `apps/api/src/modules/fixed-asset/service.ts`, lines 462-484  
**Impact:** Two compounding issues:

1. Uses Prisma ORM-level `upsert` with `{ increment: net }` instead of the atomic SQL `INSERT ON CONFLICT DO UPDATE` used by the GL repository. Under concurrent depreciation runs or simultaneous journal posting, balance updates are lost (classic lost-update race condition).
2. `closingBalance` is incremented by `net = debit - credit` without accounting for the account's normal balance direction. For accumulated depreciation accounts (credit-normal), the closing balance sign is inverted, corrupting balance sheet figures.

**Effort:** 1 hour  
**Fix:** Replace the Prisma upsert with `GLRepository.updateAccountBalance()` (which already exists and handles sign correctly). The allocation service at line 694-703 correctly uses this method -- depreciation should do the same.

---

## P1 -- HIGH PRIORITY

Fix before production users interact with the system.

---

### Security (P1)

#### S6. Path Traversal in Transfer-Desk Storage

**Source:** Security Analyst  
**Severity:** HIGH  
**Location:** `apps/api/src/jobs/transfer-desk-storage.ts`, line 29  
**Impact:** File path constructed from user-controlled input without sanitization. An attacker could read/write files outside the intended directory.  
**Fix:** Validate that resolved path stays within the storage root using `path.resolve()` and prefix checking.

#### S7. Path Traversal in Sky-Jana SFTP Client

**Source:** Security Analyst  
**Severity:** HIGH  
**Location:** `apps/api/src/modules/integration/connectors/sky-jana/sky-jana-sftp-client.ts`, line 69  
**Impact:** Same pattern as S6 for SFTP file paths.  
**Fix:** Sanitize and validate SFTP paths.

#### S8. Temporary Password Returned in API Response

**Source:** Security Analyst  
**Severity:** HIGH  
**Location:** `apps/api/src/modules/admin/service.ts`, line 235  
**Impact:** The `tempPassword` is included in the user-creation API response body. If logged or intercepted, plaintext passwords are exposed.  
**Fix:** Send the temporary password only via email (which the system already does). Remove it from the API response.

#### S9. Unsafe VM Fallback in Template Engine

**Source:** Security Analyst  
**Severity:** HIGH  
**Location:** `packages/tml-engine/src/sandbox.ts`  
**Impact:** The template sandbox falls back to an unsafe evaluation mode if the primary sandbox is unavailable, potentially allowing template injection.  
**Fix:** Fail closed -- throw an error instead of falling back to unsafe evaluation.

#### S10. Access Token in Direct `fetch()` Calls

**Source:** UI Finance Inspector  
**Severity:** HIGH  
**Location:**

- `apps/web/app/t/[code]/(dashboard)/gl/journals/new/page.tsx`, lines 296-299
- `apps/web/app/t/[code]/(dashboard)/reports/usali-pl/page.tsx`, lines 718-721

**Impact:** Two pages bypass the centralized `request()` function in `gl-api.ts`, making direct `fetch()` calls with `Authorization: Bearer ${apiContext.accessToken}`. These bypass centralized error handling, token refresh, and security headers.  
**Fix:** Route all API calls through the centralized `request()` function.

---

### Financial Logic (P1)

#### F3. No Rounding Mode Specified on Decimal Operations

**Source:** Financial Logic Inspector  
**Severity:** HIGH  
**Location:** Multiple files (GL, AP, AR, FX, Allocations, Consolidation)  
**Impact:** `Prisma.Decimal.toDecimalPlaces(4)` is used throughout without specifying a rounding mode. Default is `ROUND_HALF_UP`, which differs from the industry-standard `ROUND_HALF_EVEN` (banker's rounding). Over thousands of transactions per month across dozens of properties, this creates a systematic positive bias that can accumulate to material amounts on consolidated reports. The `RoundingMethod` enum in the schema (`NORMAL`, `TRUNCATE_TO_UNIT`) is defined but never referenced in any calculation logic.  
**Fix:** Set `Decimal.set({ rounding: 6 })` globally (ROUND_HALF_EVEN). Wire the `RoundingMethod` enum from `LedgerSetup` into the calculation engine.

#### F4. Zero-Decimal Currency Handling Incomplete

**Source:** Financial Logic Inspector  
**Severity:** HIGH  
**Location:** `apps/api/src/modules/fx/service.ts`, line 148; schema-tenant.prisma  
**Impact:** The ECB import correctly sets `decimalPlaces: 0` for TZS, and the `Currency` model has a `decimalPlaces` field. However, this field is NEVER consulted when creating journal lines (always `Decimal(18,4)`), formatting amounts for payment files (always `.toFixed(2)`), validating invoice amounts, or computing FX conversions (`.toFixed(8)`). For Tanzanian Shilling (a target market), amounts like TZS 1,000,000.5000 are meaningless and banks may reject payment files.  
**Fix:** Create a utility that reads `Currency.decimalPlaces` and rounds appropriately before storage and payment file generation.

#### F5. Journal Number Sequence Not Concurrency-Safe

**Source:** Financial Logic Inspector  
**Severity:** HIGH  
**Location:** `apps/api/src/modules/gl/repository.ts`, lines 721-730  
**Impact:** `getNextReference` uses Prisma `update` with `{ increment: 1 }` then derives the number from `nextNumber - 1`. This is a read-modify-write at the ORM level. Under concurrent journal creation, two requests could get the same reference number.  
**Fix:** Use a PostgreSQL sequence (`nextval()`) or add a UNIQUE constraint on `(entityId, reference)` with retry.

#### F6. Dead-Code Balance Reversal in `rejectJournal`

**Source:** Financial Logic Inspector  
**Severity:** HIGH  
**Location:** `apps/api/src/modules/gl/service.ts`, lines 688-704  
**Impact:** The rejection handler checks `if (journal.status === "POSTED")` to reverse account balances, but the guard at line 673 already throws if `journal.status !== "PENDING_APPROVAL"`. The balance reversal block is dead code that can never execute.  
**Fix:** Remove the dead block. Rely solely on `reverseJournal` for posted journal corrections.

---

### UI (P1)

#### U1. Duplicate `fmt()` Functions With Inconsistent Behavior

**Source:** UI Finance Inspector  
**Severity:** CRITICAL  
**Locations:**

- `apps/web/lib/format.ts` (lines 7-14) -- centralized, correct
- `apps/web/app/t/[code]/(dashboard)/gl/journals/page.tsx` (lines 71-78) -- 2 decimal places, treats zero as null
- `apps/web/app/t/[code]/(dashboard)/ar/page.tsx` (line 211) -- locale-dependent `toLocaleString(undefined, ...)`
- `apps/web/app/t/[code]/(dashboard)/reports/usali-pl/page.tsx` (lines 31-32) -- 0 decimals, no null handling

**Impact:** Financial amounts rendered inconsistently across the application. The AR page displays numbers differently depending on the user's browser locale. The journals page treats `$0.00` as null, hiding legitimate zero-amount journal lines.  
**Reference:** `lib/format.ts` line 3 states: "Every page should import from here -- no local fmt() definitions."  
**Fix:** Delete all local `fmt()` definitions. Import exclusively from `lib/format.ts`. Estimated: 2-4 hours.

#### U2. Missing Currency Symbols on Dashboard KPIs

**Source:** UI Finance Inspector  
**Severity:** CRITICAL  
**Location:** `apps/web/app/t/[code]/(dashboard)/dashboard/page.tsx` (lines 177-190, 244, 307, 464-476, 943-970, 1161-1183, 1265-1298)  
**Impact:** All KPI cards and most data displays use `fmt()` (plain number) for monetary values. ADR shows as "142" instead of "$142". Total Revenue shows as "1,234,567" instead of "$1,234,567". For a multi-currency hospitality portfolio (USD, EUR, GBP, TZS), users cannot tell what currency values are in.  
**Reference:** IAS 1 para 51(d) -- financial statements must identify the currency.  
**Fix:** Replace `fmt(value)` with `money(value)` from `useCurrencyFormat()`. Estimated: 4-6 hours.

#### U3. Financial Input Fields Accept Non-Numeric Input

**Source:** UI Finance Inspector  
**Severity:** CRITICAL  
**Locations:**

- `apps/web/app/t/[code]/(dashboard)/ap/page.tsx` (lines 387-391) -- grossAmount field
- `apps/web/app/t/[code]/(dashboard)/gl/journals/new/page.tsx` (lines 579-588) -- debit/credit fields
- `apps/web/app/t/[code]/(dashboard)/ar/page.tsx` (line 461) -- amount field (correctly uses `type="number"`)

**Impact:** AP invoice and journal entry amount fields use plain `<Input>` with no `type="number"` or input mask. Users can type "abc" or "12.345.67". `parseFloat("12abc")` returns `12`, silently truncating.  
**Reference:** PCI-DSS Req 6.5 (input validation); SOX Section 404 (financial data integrity controls).  
**Fix:** Add `type="number"` and `step="0.01"` to all currency inputs. Estimated: 3-4 hours.

#### U4. No Confirmation Dialog on Journal Posting

**Source:** UI Finance Inspector  
**Severity:** CRITICAL  
**Location:** `apps/web/app/t/[code]/(dashboard)/gl/journals/page.tsx` (lines 529-549)  
**Impact:** "Post Journal" button fires `postMutation.mutate()` directly on click with no confirmation. Posting is irreversible. By contrast, "Reverse Journal" correctly has a two-step confirmation (lines 577-617). The project already has a `ConfirmDialog` component at `components/confirm-dialog.tsx`.  
**Reference:** SOX Section 302/404 -- approval controls for financial transactions.  
**Fix:** Add `ConfirmDialog` before posting, approving, or rejecting journals. Estimated: 2 hours.

#### U5. Date Formatting Inconsistency (Locale-Dependent)

**Source:** UI Finance Inspector  
**Severity:** HIGH  
**Locations:**

- `apps/web/app/t/[code]/(dashboard)/gl/journals/page.tsx` (line 210)
- `apps/web/app/t/[code]/(dashboard)/ar/page.tsx` (lines 292-295)
- `apps/web/app/t/[code]/(dashboard)/fx/page.tsx` (line 309)
- `apps/web/app/t/[code]/(dashboard)/ap/page.tsx` (line 264)

**Impact:** Multiple pages use `toLocaleDateString()` without specifying a locale. "03/04/2026" could be March 4 or April 3 depending on browser locale. Centralized `fmtDate()` in `lib/format.ts` explicitly uses `"en-US"`.  
**Fix:** Replace all `toLocaleDateString()` calls with `fmtDate()` from `lib/format.ts`.

#### U6. No Timezone Handling for Financial Dates

**Source:** UI Finance Inspector  
**Severity:** HIGH  
**Location:** `apps/web/lib/format.ts` (lines 51-58, 61-69)  
**Impact:** Date-only strings like "2026-04-28" are parsed differently across browsers -- some treat as UTC, others as local time. In a multi-timezone hotel chain, the same journal entry could show different dates.  
**Fix:** Append `T00:00:00` to date-only strings before parsing, or use `date-fns` with `parseISO`.

---

### API Coverage (P1)

#### A3. Authorization Sets -- 5 Endpoints With Zero UI

**Source:** API Endpoint Coverage Agent  
**Severity:** HIGH  
**Endpoints:** `GET/POST /api/v1/authorization/sets`, `POST .../sets/:id/add`, `POST .../sets/:id/approve`, `POST .../sets/:id/reject`  
**Impact:** Batch journal authorization workflow is fully built on the backend but has no frontend page.

#### A4. AR Receipt Allocation -- No UI

**Source:** API Endpoint Coverage Agent  
**Severity:** HIGH  
**Endpoint:** `POST /api/v1/ar/allocations`  
**Impact:** `allocateARReceipt()` exists in `gl-api.ts` but no page calls it. AR receipts cannot be matched to invoices through the UI.

#### A5. AP/AR Invoice Edit/Delete -- 4 Endpoints With No Frontend Form

**Source:** API Endpoint Coverage Agent  
**Severity:** HIGH  
**Endpoints:** `PUT/DELETE /api/v1/ap/invoices/:id`, `PUT /api/v1/ar/invoices/:id`, `PUT /api/v1/ar/customers/:id`  
**Impact:** Users cannot edit or void invoices, or update customer details through the UI.

#### A6. Fixed Assets Edit -- No UI

**Source:** API Endpoint Coverage Agent  
**Severity:** HIGH  
**Endpoint:** `PUT /api/v1/fixed-assets/:id`  
**Impact:** `updateFixedAsset()` in `fixed-assets-api.ts` has no page consumer. Asset form only supports creation, not editing.

#### A7. Recurring Journals -- Full CRUD Backend, Zero Frontend

**Source:** API Endpoint Coverage Agent  
**Severity:** HIGH  
**Endpoints:** 6 endpoints under `/api/v1/gl/recurring-journals/*`  
**Impact:** Recurring journal templates cannot be created, viewed, or generated through the UI.

---

### Operations (P1)

#### O1. Production Docs Reference Keycloak (System Uses Native JWT)

**Source:** Deployment Readiness Agent  
**Severity:** HIGH  
**Locations:**

- `docs/ENV-VARIABLES.md` -- documents Keycloak variables
- `docs/PRODUCTION-CHECKLIST.md` -- lists "Keycloak 24+" as infrastructure requirement
- `docs/GO-LIVE-RUNBOOK.md` -- smoke tests reference Keycloak token endpoint
- `docker-compose.yml` -- still includes a Keycloak service container
- `keycloak-admin.ts` -- module still exists and is called in production provisioning

**Impact:** Operations team will follow incorrect deployment procedures. Keycloak container adds attack surface and resource consumption.  
**Fix:** Update all documentation for native JWT auth. Remove Keycloak from docker-compose.yml.

#### O2. 50+ `console.log`/`console.error` in Production Code

**Source:** Deployment Readiness Agent  
**Severity:** HIGH  
**Locations:** `rabbitmq.ts` (5), `email.ts` (3), `worker-supervisor.ts` (5), `transfer-desk-worker.ts` (2), various others  
**Impact:** Bypasses Fastify's structured pino logger, preventing log aggregation and alerting.  
**Fix:** Replace with `request.log` or `app.log` (Fastify logger).

#### O3. Localhost Fallbacks in 7+ Production-Reachable Code Paths

**Source:** Deployment Readiness Agent  
**Severity:** HIGH  
**Locations:**

- `app.ts:50` -- CORS origins default to `http://localhost:3000,http://localhost:3001`
- 7+ BullMQ/Redis connections default to `127.0.0.1`
- `APP_BASE_URL` defaults to `http://localhost:3001` in 5 locations

**Impact:** Forgetting any environment variable in production silently degrades to dev defaults rather than crashing.  
**Fix:** Add crash-on-missing for critical env vars (`REDIS_URL`, `APP_BASE_URL`, `CORS_ORIGINS`).

#### O4. 407 `as any` Type Casts Across 49 Source Files

**Source:** Deployment Readiness Agent  
**Severity:** HIGH  
**Impact:** The prior assessment claimed 64 `as any` casts were removed from intercompany, but the total rose to 407. The `authorization/service.ts` alone has 68 casts. This defeats TypeScript's safety guarantees on financial and security logic paths.  
**Fix:** Prioritize removing `as any` from authorization (68), GL (45+), and AP (30+) modules.

---

## P2 -- MEDIUM PRIORITY

Should fix within first sprint post-launch.

---

### UI/UX (P2)

#### U7. Color-Only Status Indicators (WCAG 2.1 AA Failure)

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Locations:**

- `gl/accounts/page.tsx` (lines 448-460) -- posting allowed shown as colored dot only
- `dashboard/page.tsx` (lines 108-112) -- `pctColor()` uses only color for performance thresholds
- `dashboard/page.tsx` (lines 324-326) -- bank balance positive/negative shown only as green/red

**Impact:** ~8% of males have color vision deficiency. Fails WCAG 2.1 AA SC 1.4.1 (Use of Color).  
**Fix:** Add visible text or icons alongside color. Use parentheses for negative amounts per financial convention.

#### U8. Missing ARIA Labels on Interactive Charts

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Location:** `dashboard/page.tsx` -- all `<ResponsiveBar>`, `<ResponsiveLine>`, `<ResponsivePie>` components  
**Impact:** None of the Nivo chart components have `aria-label`, `role="img"`, or alternative text. Screen reader users receive zero dashboard data.  
**Reference:** WCAG 2.1 AA SC 1.1.1 (Non-text Content).  
**Fix:** Wrap each chart in a container with `role="img"` and `aria-label`. Add visually hidden data table alternatives.

#### U9. No Pagination on Financial Data Tables

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Locations:**

- `gl/journals/page.tsx` (line 98) -- `limit: 100`
- `ap/page.tsx` (line 722) -- `limit: 200`
- `ar/page.tsx` -- no limit specified (loads all records)

**Impact:** Hotels with high transaction volumes only see the most recent entries. Unlimited AR query could cause performance issues.  
**Fix:** Implement cursor-based pagination with "Load More" or page controls. For 500+ rows, use virtual scrolling.

#### U10. Floating-Point Balance Comparison Inconsistency

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Locations:**

- `gl/journals/page.tsx` (lines 468-476) -- uses `Math.abs(debit - credit) < 0.001`
- `gl/journals/new/page.tsx` (lines 261-268) -- uses integer-cents approach `Math.round(x * 100)`

**Impact:** A journal could appear "Balanced" on one page but "Unbalanced" on another for the same data.  
**Fix:** Standardize on the integer-cents approach. Extract a shared `isBalanced(lines)` utility.

#### U11. CSV Export Lacks UTF-8 BOM

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Locations:** `gl/journals/page.tsx`, `ap/page.tsx`, `reports/usali-pl/page.tsx`, `gl/trial-balance/page.tsx`  
**Impact:** Non-ASCII characters (em-dashes, currency symbols, accented hotel names) display as mojibake in Excel.  
**Fix:** Prepend `"﻿"` (UTF-8 BOM) to all CSV content before creating the Blob.

#### U12. No Stale Data Indicator on Dashboard

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Location:** `dashboard/page.tsx` (entire file)  
**Impact:** No "Last updated" timestamp or "Refresh" button. CFOs may make decisions based on hours-old data.  
**Fix:** Add "Last updated: {time}" indicator and a manual "Refresh" button.

#### U13. Keyboard Navigation Gaps in AccountPicker

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Locations:**

- `gl/journals/new/page.tsx` (lines 126-179) -- AccountPicker
- `ap/page.tsx` (lines 74-165) -- AccountPicker

**Impact:** No keyboard event handlers (Enter to select, Escape to close, arrow keys to navigate). Missing ARIA attributes. Fails WCAG 2.1 AA SC 2.1.1 (Keyboard).  
**Fix:** Add `onKeyDown` handlers and proper ARIA attributes, or use Radix UI Combobox / `cmdk`.

#### U14. Missing Form Validation Error Announcements

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Locations:** `gl/journals/new/page.tsx`, `ap/page.tsx`, `ar/page.tsx`  
**Impact:** Error elements lack `role="alert"` or `aria-live="polite"`. Inputs not linked to errors via `aria-describedby`.  
**Fix:** Add `role="alert"` to error containers. Link inputs via `aria-describedby`.

#### U15. FX Rate Precision Display Inconsistency

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Location:** `fx/page.tsx` (line 302) -- `parseFloat(r.rate).toFixed(6)`  
**Impact:** All FX rates display with exactly 6 decimal places. USD/JPY at ~150 shows "150.123000" with meaningless trailing zeros.  
**Fix:** Use adaptive precision based on currency pair conventions.

#### U16. No Session Timeout Warning

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Location:** `components/auth-provider.tsx` (lines 169-176)  
**Impact:** Token refreshes every 13 minutes. If refresh fails, user is silently set to "unauthenticated" with no notification. Unsaved work on complex financial forms is lost.  
**Fix:** Add session timeout warning dialog 2 minutes before expiry. Persist form state to sessionStorage.

#### U17. Mobile Responsiveness Issues on Financial Tables

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Locations:** Dashboard `grid-cols-2` without responsive fallback, journal detail panel with fixed 420px sidebar, USALI table with 10+ columns  
**Fix:** Add responsive breakpoints. Make journal detail panel slide-in on mobile.

#### U18. No Print Styles Implemented

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Location:** Entire application -- no `@media print` styles found.  
**Impact:** Printing includes sidebar navigation, buttons, and may truncate tables.  
**Fix:** Add `print.css` or Tailwind `print:` variants.

#### U19. Error Message Leaks Server-Side Details

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Locations:** `gl/journals/page.tsx` (line 313), `components/query-error.tsx` (line 15), `error.tsx` (line 28)  
**Impact:** Server API error messages (potentially containing schema names or SQL errors) are rendered directly in the DOM.  
**Reference:** OWASP A09:2021; PCI-DSS Req 6.5.5.  
**Fix:** Sanitize error messages. Map API error codes to user-friendly messages. Log full errors to monitoring service.

#### U20. No Loading Indicator for Mutation Operations

**Source:** UI Finance Inspector  
**Severity:** MEDIUM  
**Locations:** `ap/page.tsx` (lines 757-772), `ar/page.tsx` (lines 161-209)  
**Impact:** Users may double-click actions. No row-level feedback during mutations.  
**Fix:** Add row-level loading indicator (spinner or opacity overlay) while mutation is in flight.

---

### Financial Logic (P2)

#### F7. `parseFloat` Used in SAF Parser for Monetary Amounts

**Source:** Financial Logic Inspector  
**Severity:** MEDIUM  
**Location:** `modules/integration/connectors/saf/saf-parser.ts`, lines 168-177  
**Impact:** `parseFloat(s)` can lose precision for amounts with more than ~15 significant digits. For TZS amounts in billions, precision loss is possible.  
**Fix:** Use string manipulation approach matching `parseAmountJanaDivide1000`.

#### F8. `Number()` Used for Opera Revenue Amounts

**Source:** Financial Logic Inspector  
**Severity:** MEDIUM  
**Location:** `modules/integration/connectors/opera-cloud/opera-sun-parser.ts`, lines 90-95  
**Impact:** Float imprecision accumulates across hundreds of lines per night audit. Could cause balance check to be slightly off.  
**Fix:** Use `Prisma.Decimal` for accumulation.

#### F9. FX Ledger Revaluation Returns `Number` Instead of `Decimal`

**Source:** Financial Logic Inspector  
**Severity:** MEDIUM  
**Location:** `modules/fx/ledger-revaluation.ts`, lines 220-236, 411, 445, 461  
**Impact:** FX rate lookup at line 445 returns `Number(rate.rate)` which loses precision. Downstream multiplication compounds the error.  
**Fix:** Return `Prisma.Decimal` from rate lookup.

#### F10. AP Invoice Tax Validation Is Optional

**Source:** Financial Logic Inspector  
**Severity:** MEDIUM  
**Location:** `modules/ap/service.ts`, lines 294-335  
**Impact:** `grossAmount = netAmount + taxAmount` cross-check only runs when ALL THREE fields are provided. No validation that `taxAmount` matches the referenced `TaxCode.rate`. Incorrect VAT/GST amounts pass without system validation.  
**Fix:** Make all three amounts mandatory. Cross-reference TaxCode rate.

#### F11. Intercompany Service Uses `Number()` for Amount Mapping

**Source:** Financial Logic Inspector  
**Severity:** MEDIUM  
**Location:** `modules/intercompany/service.ts`, line 1451  
**Impact:** `Number(j.amount)` converts Decimal to float. Intercompany journals with large cross-border amounts could have sub-cent discrepancies breaking reconciliation.  
**Fix:** Keep as string or `Prisma.Decimal`.

#### F12. Payment Voucher `amountToWords` Uses Float Arithmetic

**Source:** Financial Logic Inspector  
**Severity:** MEDIUM  
**Location:** `modules/ap/number-to-words.ts`, line 89  
**Impact:** `Math.round((abs - integerPart) * 100)` -- classic float subtraction problem. Edge cases with `.005` amounts could round incorrectly on payment vouchers/cheques.  
**Fix:** Accept string input and parse fractional part via string splitting.

---

### API Coverage (P2)

#### A8. Silent Error Swallowing in Raw `fetch()` Calls

**Source:** API Endpoint Coverage Agent  
**Severity:** MEDIUM  
**Locations:** `bank/reconciliation/page.tsx`, `ap/payment-runs/[id]/page.tsx`, `reports/balance-sheet/page.tsx`, `reports/cashflow/page.tsx`, `reports/usali-pl/page.tsx`  
**Impact:** `if (!res.ok) return` discards errors without user notification. Network or auth errors silently return empty data.  
**Fix:** Show toast or error message on failed requests.

#### A9. ~20 Orphaned Routes in Standalone Transfer-Desk Module

**Source:** API Endpoint Coverage Agent  
**Severity:** MEDIUM  
**Impact:** All routes under `/api/v1/transfer-desk/*` are dead code. Frontend uses `/api/v1/integration/transfer-desk/*` exclusively. Adds unnecessary attack surface.  
**Fix:** Deregister from `app.ts` or document as migration path.

#### A10. Session Management Endpoints With No UI

**Source:** API Endpoint Coverage Agent  
**Severity:** MEDIUM  
**Endpoints:** `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId`  
**Impact:** Users cannot view or revoke active sessions through the UI.

#### A11. `/api/v1/me` Dead Duplicate Endpoint

**Source:** API Endpoint Coverage Agent  
**Severity:** LOW  
**Impact:** Superseded by `/auth/me` -- same data, different path, no callers.  
**Fix:** Remove from entity router.

---

### Infrastructure (P2)

#### O5. Tenant Database URL Stored in Plain Text

**Source:** Deployment Readiness Agent  
**Severity:** MEDIUM  
**Location:** `tenants.database_url` in registry database  
**Impact:** Full PostgreSQL connection strings including passwords stored unencrypted.  
**Fix:** Store encrypted or use AWS Secrets Manager / IAM auth.

#### O6. `prisma db push` Used in Tenant Provisioning

**Source:** Deployment Readiness Agent  
**Severity:** MEDIUM  
**Impact:** New tenants bypass migration history, making schema drift detection harder.  
**Fix:** Use `prisma migrate deploy` for new tenant databases.

#### O7. CI Pipeline Uses `--no-frozen-lockfile`

**Source:** Deployment Readiness Agent  
**Severity:** MEDIUM  
**Impact:** Allows dependency changes during CI builds, permitting dependency drift.  
**Fix:** Change to `--frozen-lockfile`.

#### O8. Stale Code Artifacts

**Source:** Deployment Readiness Agent  
**Severity:** LOW  
**Locations:**

- `apps/api/payment-runs/` -- 4 CSV files from local development
- `keycloak-admin.ts` -- still called in production provisioning path
- `apps/api/package-lock.json` exists alongside `pnpm-lock.yaml`

**Fix:** Gitignore CSV files, remove Keycloak module from provisioning, remove stale lockfile.

---

## P3 -- LOW PRIORITY

Technical debt and polish items.

---

### UI (P3)

| ID  | Issue                                                                  | Location                                      |
| --- | ---------------------------------------------------------------------- | --------------------------------------------- |
| U21 | Journal status `.replace("_", " ")` only replaces first underscore     | `gl/journals/page.tsx`, `ap/page.tsx`         |
| U22 | Missing `<caption>` on all data tables                                 | All `<table>` elements                        |
| U23 | Inefficient chart re-renders (no `useMemo`)                            | `dashboard/page.tsx` (lines 798-864)          |
| U24 | Notification bell has no functionality but shows green dot             | `layout.tsx` (lines 97-107)                   |
| U25 | Search bar has no functionality                                        | `layout.tsx` (lines 76-86)                    |
| U26 | `suppressHydrationWarning` on both `<html>` and `<body>`               | `layout.tsx` (lines 13-14)                    |
| U27 | Hardcoded tenant code regex defined but unused                         | `middleware.ts` (line 3)                      |
| U28 | Index-based `key` in AR ageing table                                   | `ar/page.tsx` (lines 392-401)                 |
| U29 | PDF export error not displayed to user                                 | `reports/usali-pl/page.tsx` (lines 714-731)   |
| U30 | 10+ `eslint-disable` comments for `@typescript-eslint/no-explicit-any` | `dashboard/page.tsx`                          |
| U31 | `hover:bg-accent/3` likely typo for `hover:bg-accent/30`               | `dashboard/page.tsx` (line 447)               |
| U32 | ConfirmDialog closes before mutation error can keep it open            | `components/confirm-dialog.tsx` (lines 49-52) |
| U33 | Inconsistent empty state handling across pages                         | Various                                       |
| U34 | No RTL support (`<html lang="en">` hardcoded)                          | `layout.tsx` (line 12)                        |
| U35 | Number formatting hardcoded to `"en-US"` locale                        | `lib/format.ts`                               |

### Financial Logic (P3)

| ID  | Issue                                                                   | Location                                        |
| --- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| F13 | Transfer desk test service uses `Number()` for debit/credit             | `transfer-desk/test-service.ts` (lines 467-468) |
| F14 | AP posting does not create separate tax journal line                    | `ap/service.ts` (lines 501-522)                 |
| F15 | AR invoice single-amount model limits departmental revenue split        | `ar/service.ts`                                 |
| F16 | Consolidation materialized view has no refresh trigger                  | `consolidation/service.ts` (lines 172-187)      |
| F17 | FX conversion does not round to target currency precision               | `fx/service.ts` (lines 82-88)                   |
| F18 | Audit trail omits before-state on batch financial mutations             | `audit/service.ts`                              |
| F19 | Period SOFT_CLOSE allows system processes but blocks manual corrections | `gl/service.ts` line 296                        |

### API Coverage (P3)

| ID  | Issue                                                                      |
| --- | -------------------------------------------------------------------------- |
| A12 | GL Recurring Journals -- full CRUD backend, zero frontend                  |
| A13 | Opera Cloud statistics/cashier/city-ledger -- 3 gl-api functions, no pages |
| A14 | Intercompany `account-pairs` v1 routes -- legacy, superseded by v2         |
| A15 | KPI `/dashboard` aggregate endpoint -- `getKPIDashboard()` unused          |
| A16 | Periods `soft-close` endpoint -- no gl-api wrapper or page                 |
| A17 | Budget single definition `GET /:id` -- never fetched individually          |

---

## STRENGTHS

Despite the findings above, the application has strong architectural foundations:

1. **Multi-tenant isolation:** Dual-database architecture (registry + tenant), LRU-bounded connection pool (max 50), AsyncLocalStorage-based transparent routing, PostgreSQL Row-Level Security with `app.current_entity_id` session variable.

2. **Core GL engine:** Proper double-entry bookkeeping with journal balance validation, atomic SQL-level balance updates via `INSERT ON CONFLICT DO UPDATE`, conditional status updates preventing race conditions, and debit/credit reversal semantics.

3. **Security fundamentals:** Cookie-only auth tokens (httpOnly, not localStorage), CSRF origin validation on all mutations, rate limiting (200 req/min), account lockout after 5 failed attempts (15-min), log redaction for sensitive fields, non-root Docker user, tini init.

4. **Frontend architecture:** Centralized formatting library (`lib/format.ts`), entity-aware currency hook (`useCurrencyFormat`), Zod validation on all form schemas, skeleton loading states, Content Security Policy with nonce-based scripts.

5. **Financial reporting:** USALI P&L with budget variance/YTD/prior year columns (industry standard), role-based dashboards (GM, Controller, CFO, Directors), balance sheet and cash flow statements, report builder with custom definitions.

6. **Deployment tooling:** Multi-stage Dockerfiles (API, Web, Workers) with `--frozen-lockfile` and non-root user, Go-Live Runbook with timeline and rollback plans, OpenAPI 3.1 spec, CI/CD pipeline (`.github/workflows/ci.yml`).

7. **Financial operations:** IAS 21 foreign currency revaluation, intercompany transactions with reconciliation, fixed-asset depreciation (straight-line, declining balance, units-of-production), multi-stage authorization workflows, allocation engine for cost distribution.

---

## PREVIOUS ASSESSMENT STATUS

The critical assessment from 2026-04-13 claimed all 55 findings were "FIXED." This assessment reveals:

### Genuinely Fixed and Verified

- S1 (JWT secret fallback) -- Confirmed, crashes on missing `JWT_SECRET`
- S2 (RLS race condition) -- Confirmed, uses transaction-scoped `set_config('app.bypass_rls', 'true', true)`
- S4 (COOKIE_SECURE) -- Code confirms production default `true`
- S10 (Dev auth bypass) -- UUID format validation confirmed
- S11 (Refresh token body) -- Cookie-only confirmed
- S12 (CSRF origin) -- Mutation origin validation confirmed
- Q5 (mapError duplication) -- `SharedServiceError` base class confirmed
- Q6 (Entity CRUD in app.ts) -- Extracted to `modules/entity/router.ts`
- Q11 (Dockerfiles) -- API, Web, and Workers Dockerfiles confirmed

### Regressions or Incomplete Fixes

- Q1 (`as any` casts) -- Assessment claimed 64 removed from intercompany, but total **rose to 407 across 49 files**
- Q2 (Integration tests) -- `rls-enforcement.test.ts` exists but `cross-entity-security.test.ts` has 3 failing tests
- **Build is broken** -- 72 TypeScript errors prevent compilation (post-dates prior assessment)

---

## REMEDIATION ROADMAP

```
WEEK 1 -- BLOCKERS (Estimated: 3-4 days)
================================================================
Day 1 (Critical Security + Quick Wins):
  [ ] S1: Add return in requireAuth.ts (5 min)
  [ ] S2: Add return in tenant/router.ts (5 min)
  [ ] S3: Fix empty entityIds bypass (30 min)
  [ ] S4: Rotate AWS SES credentials (1 hr)
  [ ] S5: Rotate JWT secret (1 hr)
  [ ] A1: Mount period-close router in app.ts (5 min)
  [ ] A2: Fix /api/proxy/ dead call in year-end page (10 min)

Day 1-2 (Critical Financial):
  [ ] F1: Fix authorization float arithmetic → Prisma.Decimal (30 min)
  [ ] F2: Fix depreciation → GLRepository.updateAccountBalance() (1 hr)
  [ ] F6: Remove dead-code reversal in rejectJournal (30 min)

Day 2-4 (Build):
  [ ] B1: Fix 72 TypeScript compilation errors (1-2 days)

Day 4-5 (Tests):
  [ ] B2: Fix 6 test failures and establish green baseline (4-8 hrs)

WEEK 2 -- P1 SECURITY & FINANCIAL (Estimated: 3-4 days)
================================================================
  [ ] S6-S7: Path traversal fixes
  [ ] S8: Remove tempPassword from API response
  [ ] S9: Fix VM sandbox fallback
  [ ] S10: Route direct fetch() through centralized request()
  [ ] F3: Set ROUND_HALF_EVEN globally
  [ ] F4: Wire Currency.decimalPlaces into calculations
  [ ] F5: Add PostgreSQL sequence for journal numbers
  [ ] O1: Update all docs for native JWT auth, remove Keycloak
  [ ] O2: Replace console.log with structured logger
  [ ] O3: Add crash-on-missing for critical env vars

WEEK 3 -- P1 UI & FEATURES (Estimated: 4-5 days)
================================================================
  [ ] U1: Delete duplicate fmt() functions (2-4 hrs)
  [ ] U2: Add currency symbols to dashboard KPIs (4-6 hrs)
  [ ] U3: Fix financial input validation (3-4 hrs)
  [ ] U4: Add confirmation dialogs for irreversible actions (2 hrs)
  [ ] U5-U6: Standardize date formatting and timezone handling (4 hrs)
  [ ] A3-A7: Build missing UI for authorization sets, AR allocation,
             AP/AR edit/delete, fixed asset edit (3-5 days)

WEEK 4+ -- P2 ITEMS (Ongoing)
================================================================
  [ ] Accessibility: color-independent indicators, chart ARIA, keyboard nav
  [ ] Table pagination, print styles, CSV BOM
  [ ] Session timeout warning, stale data indicator
  [ ] Remove orphaned routes, clean up 407 as-any casts
  [ ] SAF/Opera/intercompany float-to-Decimal cleanup
```

---

## FINAL VERDICT

| Criterion                           | Status                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| Can produce a build artifact?       | NO (72 TS errors)                                         |
| Can authenticate securely?          | NO (auth bypass)                                          |
| Can process year-end close?         | NO (router not mounted)                                   |
| Are financial calculations correct? | PARTIAL (float in auth thresholds, depreciation sign bug) |
| Are credentials secure?             | NO (hardcoded in .env)                                    |
| Do tests pass?                      | NO (6 failures)                                           |
| Is documentation accurate?          | NO (references Keycloak)                                  |

**DEPLOYMENT READINESS: NO-GO**

The three most impactful fixes are literally three lines of code: two `return` statements in auth middleware and one `import` + `await` for the period-close router. These should be applied immediately regardless of the broader remediation timeline. Full deployment readiness requires completing the Week 1 roadmap (3-4 days of focused effort) to reach a minimally viable production state.

---

_Assessment compiled from 5 parallel agent audits. Total files inspected: 300+. Total findings: 130+._  
_Agents: Security Analyst, Financial Logic Inspector, API Endpoint Coverage Checker, UI Finance Inspector, Deployment Readiness._
