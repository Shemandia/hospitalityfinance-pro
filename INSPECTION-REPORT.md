# HospitalityFinance Pro — Full Inspection Report

**Date**: 2026-04-04
**Inspected by**: 6 parallel Claude agents (Explorer, Security Analyst, Financial Logic Inspector, Code Reviewer, UI Finance Inspector, API Endpoint Coverage Checker)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Security Analysis](#2-security-analysis)
3. [Financial Logic Audit](#3-financial-logic-audit)
4. [Code Review](#4-code-review)
5. [UI Finance Inspection](#5-ui-finance-inspection)
6. [API Endpoint Coverage](#6-api-endpoint-coverage)
7. [Consolidated Priority List](#7-consolidated-priority-list)

---

## 1. Project Overview

**Architecture**: pnpm monorepo (Turborepo) — modular monolith backend + Next.js frontend

| Layer      | Stack                                                                        |
| ---------- | ---------------------------------------------------------------------------- |
| Frontend   | Next.js 15, React 19, TailwindCSS 4, Radix UI, TanStack Query/Table, Zustand |
| Backend    | Fastify 4, TypeScript, Prisma 5 (PostgreSQL 16)                              |
| Auth       | Keycloak + NextAuth.js + JWT                                                 |
| Async Jobs | BullMQ (Redis) for reports, dunning, recurring journals                      |
| Messaging  | RabbitMQ for event-driven communication                                      |
| Infra      | Docker Compose (Postgres, Redis, RabbitMQ, Keycloak)                         |

**Key Modules**: GL, AP, AR, FX, Budget, Consolidation, Reporting, KPI Dashboards, Audit Trail, and integrations with Opera Cloud, Mews, Simphony, Sky Jana, SAF, Bank, and Payroll.

**Multi-tenancy**: Entity-based with PostgreSQL RLS + application-level enforcement (Corporate > Group > Cluster > Property hierarchy).

---

## 2. Security Analysis

### CRITICAL

#### F1: Hardcoded Default Platform API Key Enables Tenant Takeover

- **Location**: `apps/api/src/modules/tenant/router.ts:17` and `apps/web/app/api/tenants/route.ts:4`
- **Issue**: The platform tenant management API uses a static API key. The default fallback value `hfp-platform-dev-key` is hardcoded in both the API server and the Next.js frontend. If `PLATFORM_API_KEY` / `HFP_PLATFORM_KEY` environment variables are not set in production, this default key grants full platform-level access.
- **Impact**: An attacker can list all tenants, register rogue tenants, deactivate legitimate tenants, or modify any tenant's plan/admin email.
- **Fix**: Remove the hardcoded default. Fail startup if `PLATFORM_API_KEY` is not set. Use a cryptographically random key (minimum 256 bits).

#### F2: Dev Authentication Bypass Active Unless NODE_ENV=production

- **Location**: `apps/api/src/plugins/auth.ts:124`
- **Issue**: Any token starting with `dev-` is accepted without cryptographic verification when `NODE_ENV !== "production"`. Grants `admin` + `superadmin` roles with full access. Activates in staging, test, UAT, or undefined environments.
- **Impact**: Any deployment that forgets to set `NODE_ENV=production` is fully compromised.
- **Fix**: Gate the dev bypass behind an explicit `ENABLE_DEV_AUTH=true` flag.

#### F3: Hardcoded Credentials in Docker Compose and Seed Files

- **Location**: `docker-compose.yml` and `apps/api/src/db/seed.ts:45`
- **Issue**: Default/weak passwords: PostgreSQL (`password`), RabbitMQ (`guest/guest`), Keycloak (`admin/admin`).
- **Fix**: Use Docker secrets or `.env` files. Add startup check that rejects default passwords in non-development environments.

### HIGH

#### F4: $executeRawUnsafe in Provisioning Scripts — SQL Injection Risk

- **Location**: `apps/api/src/scripts/provision-tenant.ts:130-131`, `provision-demo-chains.ts:102`
- **Issue**: String interpolation inside `$executeRawUnsafe` for `CREATE DATABASE` statements.
- **Fix**: Use parameterized `$executeRaw` with `Prisma.sql` template tags, or strict allowlist validation.

#### F5: Redis and PostgreSQL Exposed Without Authentication

- **Location**: `docker-compose.yml:26,33`
- **Issue**: Redis on port 6379 with no password. PostgreSQL on port 5432. Both bound to all interfaces.
- **Fix**: Add `requirepass` to Redis. Restrict port mappings to `127.0.0.1`.

#### F6: Content Security Policy Allows unsafe-inline and unsafe-eval

- **Location**: `apps/web/next.config.ts:21`
- **Issue**: CSP `script-src` includes both `'unsafe-inline'` and `'unsafe-eval'`, negating XSS protection.
- **Fix**: Replace with nonce-based CSP or hashes.

#### F7: HTML Injection in Email Templates

- **Location**: `apps/api/src/shared/email.ts:46-51`
- **Issue**: Approval email template directly interpolates user-controlled values into HTML without escaping.
- **Fix**: HTML-encode all interpolated values or use a templating engine with auto-escaping.

#### F8: next-auth 5.0.0-beta.25 — Pre-Release Dependency

- **Location**: `apps/web/package.json:38`
- **Issue**: Pre-release beta version for primary authentication. May contain unfixed vulnerabilities.
- **Fix**: Upgrade to stable release when available or monitor changelog closely.

### MEDIUM

#### F9: SFTP Path Traversal in Sky Jana Integration

- **Location**: `apps/api/src/modules/integration/connectors/sky-jana/sky-jana-sftp-client.ts:69,75`
- **Issue**: `downloadFile` and `uploadFile` methods concatenate user-provided filenames without sanitization.
- **Fix**: Use `path.basename()` to strip directory components.

#### F10: Entity Scope Bypass When entityId Is Null

- **Location**: `apps/api/src/db/entityScope.ts:108-110`
- **Issue**: Returns unscoped results when `getEntityId()` returns null.
- **Fix**: Deny by default — throw an error or return empty results when no entity context exists.

#### F11: No Input Validation on Admin Scope Assignment Endpoints

- **Location**: `apps/api/src/modules/admin/router.ts:394-397`
- **Issue**: `request.body` cast directly without Zod schema validation.
- **Fix**: Add Zod schema validation.

#### F12: Recurring Journal Endpoints Use `request.body as any`

- **Location**: `apps/api/src/modules/gl/router.ts:519,541`
- **Fix**: Define and apply Zod schemas for recurring journal payloads.

#### F13: CORS Origin Validation Inconsistency

- **Location**: `apps/api/src/app.ts:45-54`
- **Issue**: Requests without an `Origin` header bypass CSRF check.
- **Fix**: Also check `Referer` header as fallback.

#### F14: Tenant Database URLs Stored in Memory Cache

- **Location**: `apps/api/src/db/tenantRegistry.ts:53`, `requestContext.ts:11`
- **Issue**: Full PostgreSQL connection strings (including credentials) cached and propagated through AsyncLocalStorage.
- **Fix**: Encrypt at rest, use tenant slugs as lookup keys instead of passing full URLs.

### LOW

#### F15: CI Pipeline Uses `--no-frozen-lockfile`

- **Location**: `.github/workflows/ci.yml:30`
- **Fix**: Change to `pnpm install --frozen-lockfile`.

#### F16: Health Endpoint Leaks Environment Metadata

- **Location**: `apps/api/src/app.ts:138-143`
- **Fix**: Remove sensitive fields or put behind authentication.

#### F17: AsyncLocalStorage Context Can Be Lost Across Fastify Hooks

- **Location**: `apps/api/src/plugins/auth.ts:107-108`
- **Fix**: Investigate and fix propagation issue rather than relying on global fallback.

---

## 3. Financial Logic Audit

**Overall Risk: MODERATE-HIGH** — Core GL/AP/AR use `Prisma.Decimal` correctly, but the integration layer has serious float-precision problems.

### CRITICAL

#### C1: SAF Parser Uses `number` (float64) for All Monetary Amounts

- **Location**: `apps/api/src/modules/integration/connectors/saf/saf-parser.ts:93-98, 165-219, 537-538`
- **Issue**: JavaScript `number` (IEEE 754 float64) for all parsed amounts. Float accumulation drift over hundreds/thousands of lines can corrupt imports.
- **Fix**: Use `Prisma.Decimal` for all amount fields.

#### C2: SAF Import Service Creates Journal Lines from Float Amounts

- **Location**: `apps/api/src/modules/integration/connectors/saf/saf-import-service.ts:329-333`
- **Issue**: Converts float `safLine.amount` to `Prisma.Decimal` at the last moment — float error already present.
- **Fix**: Parse amounts directly to `Prisma.Decimal` strings in the SAF parser.

#### C3: SAF Import AP Invoice Uses Float for `totalCredit`

- **Location**: `apps/api/src/modules/integration/connectors/saf/saf-import-service.ts:444-449`
- **Issue**: Vendor credit totals accumulated using JavaScript `number` addition.
- **Fix**: Use `Prisma.Decimal` for `totalCredit` accumulation.

#### C4: Mews Client Converts API Amounts Through `number` Type

- **Location**: `apps/api/src/modules/integration/connectors/mews/mews-client.ts:140-162`
- **Issue**: `String(item.Amount?.Value ?? 0)` can capture float artifacts.
- **Fix**: Round to currency's decimal places before converting: `new Prisma.Decimal(value).toDecimalPlaces(decimalPlaces).toString()`.

#### C5: AR Invoice Posting Lacks Row Locking

- **Location**: `apps/api/src/modules/ar/service.ts:106-199`
- **Issue**: No `SELECT ... FOR UPDATE`. Two concurrent `postInvoice` calls can both read status="DRAFT", creating duplicate GL journals and double-counted balances.
- **Fix**: Add `SELECT ... FOR UPDATE` as done in the AP module.

#### C6: FX Revaluation Calculates Outside Transaction, Posts Inside

- **Location**: `apps/api/src/modules/fx/service.ts:353-475`
- **Issue**: Reads AP/AR invoices and computes gain/loss outside `$transaction`, then creates journals inside. Invoices may change between read and write.
- **Fix**: Move entire read + computation inside `$transaction`.

### WARNING

#### W1: GL `rejectJournal` Has Dead-Code Reversal Logic

- **Location**: `apps/api/src/modules/gl/service.ts:589-606`
- **Issue**: Checks `if (journal.status === "POSTED")` but unreachable due to prior `PENDING_APPROVAL` guard.
- **Fix**: Remove dead code or replace with proper reversal journal creation.

#### W2: Mews Import Does Not Run Inside a Database Transaction

- **Location**: `apps/api/src/modules/integration/connectors/mews/mews-import-job.ts:227-269`
- **Issue**: Journal creation, balance updates, and import log update are separate operations with no wrapping transaction.
- **Fix**: Wrap in `prisma.$transaction()`.

#### W3: SAF Import Does Not Run Inside a Database Transaction

- **Location**: `apps/api/src/modules/integration/connectors/saf/saf-import-service.ts:311-535`
- **Fix**: Wrap entire import execution in `$transaction()`.

#### W4: Recurring Journal Generation Lacks Balance Updates for Auto-Posted Journals

- **Location**: `apps/api/src/modules/gl/recurring-service.ts:169-199`
- **Issue**: When `autoPost` is true, journal is created as `POSTED` but **no account balance updates are performed**. Trial balance, balance sheet, and all reports are silently wrong.
- **Fix**: After creating journal with `autoPost`, call `updateAccountBalance` for each line.

#### W5: AP Invoice Validation Does Not Verify `grossAmount = netAmount + taxAmount`

- **Location**: `apps/api/src/modules/ap/service.ts:250-268`, `ap/types.ts:33-49`
- **Fix**: Add cross-field validation.

#### W6: Consolidation IC Elimination Key Mismatch

- **Location**: `apps/api/src/modules/consolidation/service.ts:198-199, 262-274`
- **Issue**: `consolidatedMap` keyed by `account_code` (short string like "1200"), but IC elimination looks up by `accountId` (UUID). IC eliminations are **never applied**.
- **Fix**: Key `consolidatedMap` by `accountId` or look up IC eliminations by `account_code`.

#### W7: FX Fallback API Source Labeled as "ECB"

- **Location**: `apps/api/src/modules/fx/service.ts:256-258`
- **Fix**: Use distinct source value like `"OPEN_ER_API"` or `"FALLBACK"`.

#### W8: Zero-Decimal Currencies Not Handled in Payment Files

- **Location**: `apps/api/src/modules/fx/service.ts:153`
- **Issue**: TZS configured with `decimalPlaces: 0` but SWIFT MT103 always uses `toDecimalPlaces(2)`.
- **Fix**: Look up currency's `decimalPlaces` when formatting for external systems.

### INFORMATIONAL

#### I1: Approval Rule `minAmount`/`maxAmount` Uses JavaScript `number` Type

- **Location**: `apps/api/src/modules/gl/types.ts:119-120`
- **Fix**: Use `decimalStringSchema` for consistency.

#### I2: No Rounding Mode Specified on Decimal Operations

- **Fix**: Explicitly pass `Prisma.Decimal.ROUND_HALF_UP`.

#### I3: `trevpac` KPI Is Actually `trevpar`

- **Location**: `apps/api/src/modules/kpi/service.ts:266`
- **Fix**: Calculate TREVPAC using actual guest count data, or rename.

#### I4: Payment Run Deletion Uses Cascading Deletes Without Transaction

- **Location**: `apps/api/src/modules/ap/service.ts:641-645`
- **Fix**: Wrap in `prisma.$transaction()`.

#### I5: Log Redactor Does Not Cover Mews API Tokens In Request Bodies

- **Fix**: Add PascalCase keys to `SENSITIVE_KEYS` or normalize key comparison.

---

## 4. Code Review

### CRITICAL

#### CR1: Global Mutable State for Tenant Routing Creates Race Conditions

- **Location**: `apps/api/src/db/prisma.ts:119-123`
- **Issue**: Uses global variables `_activeTenantSlug` / `_activeTenantDbUrl` as fallback when AsyncLocalStorage loses context. Concurrent requests can overwrite each other's tenant context — **cross-tenant data leak**.
- **Fix**: Diagnose and fix AsyncLocalStorage propagation (`enterWith` vs `run`).

#### CR2: Health Check Creates and Disconnects Redis Clients on Every Call

- **Location**: `apps/api/src/app.ts:99-115`
- **Issue**: Creates new Redis client per invocation. References `redis` package not in dependencies.
- **Fix**: Use persistent health-check connection or existing BullMQ Redis connection.

#### CR3: Duplicate Audit Middleware Logic Between Default and Tenant Clients

- **Location**: `apps/api/src/db/prisma.ts:70-98` and `tenantPool.ts:73-105`
- **Issue**: 78 lines of identical audit logic copy-pasted. Divergence could cause inconsistent audit behavior.
- **Fix**: Extract into shared `createAuditMiddleware()` factory.

#### CR4: Silent Error Swallowing in Entity Auto-Assignment

- **Location**: `apps/api/src/app.ts:307`
- **Issue**: `.catch(() => {})` silently catches all errors. Entity created but creator may have no access.
- **Fix**: Include in transaction or log the failure.

### IMPORTANT

#### CR5: `mapError` Function Duplicated Across All Router Files

- **Fix**: Extract into shared Fastify error handler plugin.

#### CR6: Redis Connection Configuration Duplicated 6 Times

- **Fix**: Single `shared/redis.ts` utility.

#### CR7: Excessive `as any` Casts (78 Occurrences)

- **Fix**: Run `prisma generate` to update types.

#### CR8: `requireWriteAccess` Middleware Does Not Terminate Request

- **Location**: `apps/api/src/middleware/requireWriteAccess.ts:40-50`
- **Issue**: Calls `reply.code(403).send()` but does not `return` or `throw`.
- **Fix**: Return the reply or throw.

#### CR9: `rejectJournal` Contains Dead Code Branch

- **Location**: `apps/api/src/modules/gl/service.ts:589-604`
- Same as Financial W1.

#### CR10: Email HTML Content Not Sanitized

- Same as Security F7.

#### CR11: `deleteApprovalRule` Ignores entityId in WHERE Clause

- **Location**: `apps/api/src/modules/gl/repository.ts:428-432`
- **Fix**: Include `entityId` in WHERE clause.

#### CR12: No Input Validation on Entity CRUD Routes in `app.ts`

- **Location**: `apps/api/src/app.ts:237-375`
- **Fix**: Add Zod schemas.

#### CR13: Dual State Management for Entity Context on Frontend

- **Location**: `components/entity-provider.tsx` and `store/useAppStore.ts`
- **Fix**: Consolidate into one source of truth.

### SUGGESTIONS

- Use structured logger (Pino) instead of `console.info` in service layer
- `getNextReference` sequence: use raw SQL `UPDATE ... RETURNING` for race safety
- docker-compose credentials should reference `.env` variables
- `decimalRegex` duplicated across type files — extract to shared module
- Frontend test coverage is minimal (2 test files for 40+ pages)

---

## 5. UI Finance Inspection

### CRITICAL

#### UI-C1: Inconsistent Number Formatting Across Pages

- **Location**: 12+ files with local `fmt()` definitions
- **Issue**: USALI P&L rounds to 0 decimals, Trial Balance shows 2 decimals. Same data shows different numbers on different pages.
- **Fix**: Eliminate all local `fmt()` definitions. Import from `lib/format.ts`.

#### UI-C2: AR Page Uses Non-Deterministic Locale for Currency Formatting

- **Location**: `apps/web/app/(dashboard)/ar/page.tsx:211`
- **Issue**: `toLocaleString(undefined, ...)` — format depends on browser locale. Only page that does this.
- **Fix**: Use shared `fmtDecimal` from `lib/format.ts`.

#### UI-C3: Journal Entry Debit/Credit Inputs Accept Arbitrary Text

- **Location**: `apps/web/app/(dashboard)/gl/journals/new/page.tsx:194-201`
- **Issue**: `z.string()` with no numeric validation. NaN silently passes balance check.
- **Fix**: Add Zod refinements, `inputMode="decimal"`, and NaN guard in totals memo.

#### UI-C4: AP Invoice Form Lacks Client-Side Validation

- **Location**: `apps/web/app/(dashboard)/ap/page.tsx:244-286`
- **Issue**: Blank gross amount silently becomes $0.00 via `Number()` coercion.
- **Fix**: Add Zod schema, `type="number" step="0.01" min="0"`.

#### UI-C5: ConfirmDialog Closes Before Async Operation Completes

- **Location**: `apps/web/components/confirm-dialog.tsx:50-51`
- **Issue**: `onConfirm()` called then dialog immediately closed. Used for payment approvals and journal posting.
- **Fix**: Make handler async-aware: `await onConfirm()` before closing.

### HIGH

#### UI-H1: No Currency Symbol on Financial Amounts in Most Pages

- **Issue**: Multi-currency system shows bare numbers without currency indicators.
- **Fix**: Use `useCurrencyFormat().money()` hook.

#### UI-H2: Financial Tables Lack Proper WCAG Semantic Structure

- **Issue**: No `<caption>`, no `scope` on `<th>`, no keyboard navigation on AccountPicker.
- **Fix**: Add semantic attributes and ARIA roles.

#### UI-H3: Color-Only Status Indication for Variance

- **Issue**: Red/green only — 8% of males are colorblind.
- **Fix**: Add `+`/`-` prefix and directional arrows.

#### UI-H4: No Stale Data Indicator on Real-Time Financial Data

- **Fix**: Add "Last updated" indicator and `refetchInterval`.

#### UI-H5: Error Messages Leak Raw Exception Details

- **Fix**: Create error sanitization utility.

#### UI-H6: Entity ID Stored in localStorage Without Encryption

- **Fix**: Consider `sessionStorage` instead.

### MEDIUM

- M-01: AP Invoice gross amount field accepts free text
- M-02: Duplicate AccountPicker components
- M-03: FX Rate input precision limited to 6 decimals (should be 8)
- M-04: Date formatting inconsistency across pages
- M-05: No loading skeleton on Controller Dashboard
- M-06: No pagination or virtualization on transaction lists
- M-07: Missing `<label>` associations on form inputs
- M-08: No disclosure/disclaimer on financial reports

### LOW

- L-01: Delete button invisible until hover on journal lines (keyboard inaccessible)
- L-02: Hardcoded "USD" default currency (should use entity's functional currency)
- L-03: USALI P&L helpers should be promoted to shared `lib/format.ts`
- L-04: CSV/Excel export lacks BOM for Unicode support
- L-05: Mobile responsiveness gaps on journal entry form

---

## 6. API Endpoint Coverage

**~125 total endpoints | ~79 covered | ~33 genuine UI gaps | ~13 intentionally backend-only**

### Priority UI Gaps

| Priority | Feature                          | Endpoints                                       | Impact                                    |
| -------- | -------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| 1        | **Recurring Journals**           | 6 endpoints (CRUD + generate)                   | Complete backend feature with zero UI     |
| 2        | **FX Revaluation**               | `POST /fx/revaluation`                          | Critical period-end workflow, no UI       |
| 3        | **AP Invoice Edit/Delete**       | `PUT` + `DELETE /ap/invoices/:id`               | Cannot edit/delete draft invoices         |
| 4        | **AR Invoice + Customer Edit**   | `PUT /ar/invoices/:id`, `PUT /ar/customers/:id` | No edit capability                        |
| 5        | **Opera PMS Enhanced Stats**     | 3 endpoints                                     | gl-api wrappers exist, no page imports    |
| 6        | **Report Scheduling**            | `POST/DELETE /reports/.../schedule`             | Backend implemented, inaccessible from UI |
| 7        | **User Status Management**       | `PUT /admin/users/:userId/status`               | Cannot activate/deactivate users          |
| 8        | **AR Receipt Listing**           | `GET /ar/receipts`                              | Receipts created but never listed         |
| 9        | **Opera SUN Import**             | `POST /integration/opera-sun/import`            | No upload UI                              |
| 10       | **FX Convert + Currency Upsert** | 2 endpoints                                     | Utility/admin with no UI surface          |

### Full Uncovered Endpoint List

| Endpoint                                      | Module        | Notes                                       |
| --------------------------------------------- | ------------- | ------------------------------------------- |
| `GET /account-types/all`                      | Account Types | Admin-only list including inactive          |
| `POST /fx/currencies`                         | FX            | Currency upsert — no UI                     |
| `GET /fx/convert`                             | FX            | Conversion utility — no UI                  |
| `POST /fx/revaluation`                        | FX            | Revaluation run — no UI                     |
| `GET /gl/recurring-journals`                  | GL            | Full CRUD — no UI                           |
| `GET /gl/recurring-journals/:id`              | GL            | No UI                                       |
| `POST /gl/recurring-journals`                 | GL            | No UI                                       |
| `PUT /gl/recurring-journals/:id`              | GL            | No UI                                       |
| `DELETE /gl/recurring-journals/:id`           | GL            | No UI                                       |
| `POST /gl/recurring-journals/:id/generate`    | GL            | No UI                                       |
| `PUT /ap/invoices/:id`                        | AP            | Invoice edit — no UI                        |
| `DELETE /ap/invoices/:id`                     | AP            | Invoice delete — no UI                      |
| `POST /ap/portal/invoices`                    | AP            | Supplier portal — no UI                     |
| `DELETE /ap/suppliers/:id`                    | AP            | Supplier delete — no UI                     |
| `PUT /ar/invoices/:id`                        | AR            | Invoice edit — no UI                        |
| `PUT /ar/customers/:id`                       | AR            | Customer edit — no UI                       |
| `GET /ar/customers/:id`                       | AR            | Customer detail — no UI                     |
| `GET /ar/invoices/:id`                        | AR            | Invoice detail — no UI                      |
| `GET /ar/receipts`                            | AR            | Receipt list — no UI                        |
| `POST /ar/dunning/enqueue`                    | AR            | Async dunning (UI uses sync `/run`)         |
| `GET /consolidation/:id/runs/:runId`          | Consolidation | Single run detail — wrapper exists, no page |
| `GET /budget/definitions/:id`                 | Budget        | Single definition detail — no UI            |
| `GET /reports/types`                          | Reporting     | Report type metadata — no UI                |
| `POST /reports/definitions/:id/schedule`      | Reporting     | Report scheduling — no UI                   |
| `DELETE /reports/definitions/:id/schedule`    | Reporting     | Schedule delete — no UI                     |
| `GET /admin/all-users`                        | Admin         | SUPERADMIN user list — no UI                |
| `POST /admin/users`                           | Admin         | Direct user create — no UI                  |
| `PUT /admin/users/:userId/status`             | Admin         | User activate/deactivate — no UI            |
| `GET /admin/users/:userId/detail`             | Admin         | User detail — no UI                         |
| `POST /admin/permissions`                     | Admin         | Create permission — no UI                   |
| `DELETE /admin/permissions/:id`               | Admin         | Delete permission — no UI                   |
| `POST /admin/login-audit`                     | Admin         | Login event recording (system use)          |
| `GET /admin/login-audit`                      | Admin         | Login audit log — no UI                     |
| `GET /integration/opera-cloud/statistics`     | Integration   | Opera stats — no UI                         |
| `GET /integration/opera-cloud/cashier-report` | Integration   | Opera cashier — no UI                       |
| `GET /integration/opera-cloud/city-ledger`    | Integration   | Opera city ledger — no UI                   |
| `POST /integration/opera-sun/import`          | Integration   | Opera SUN import — no UI                    |

---

## 7. Consolidated Priority List

### Tier 1 — Must Fix Before Production

| #   | Issue                                                        | Source          | Severity |
| --- | ------------------------------------------------------------ | --------------- | -------- |
| 1   | Hardcoded platform API key (`hfp-platform-dev-key`)          | Security F1     | CRITICAL |
| 2   | Dev auth bypass in non-production environments               | Security F2     | CRITICAL |
| 3   | AR invoice double-posting — no row locking                   | Financial C5    | CRITICAL |
| 4   | SAF parser float arithmetic corrupts imports                 | Financial C1-C3 | CRITICAL |
| 5   | Global tenant state race condition — cross-tenant data leaks | Code Review CR1 | CRITICAL |
| 6   | Consolidation IC elimination key mismatch — never applied    | Financial W6    | CRITICAL |
| 7   | Auto-posted recurring journals don't update balances         | Financial W4    | CRITICAL |
| 8   | FX revaluation reads outside transaction — IAS 21 risk       | Financial C6    | CRITICAL |
| 9   | Hardcoded credentials in docker-compose                      | Security F3     | CRITICAL |
| 10  | Mews client float passthrough                                | Financial C4    | CRITICAL |

### Tier 2 — High Priority

| #   | Issue                                                  | Source          | Severity |
| --- | ------------------------------------------------------ | --------------- | -------- |
| 11  | `$executeRawUnsafe` SQL injection in provisioning      | Security F4     | HIGH     |
| 12  | Redis/PostgreSQL exposed without auth                  | Security F5     | HIGH     |
| 13  | CSP allows unsafe-inline/unsafe-eval                   | Security F6     | HIGH     |
| 14  | HTML injection in email templates                      | Security F7     | HIGH     |
| 15  | Journal entry accepts arbitrary text (NaN bypass)      | UI C-03         | HIGH     |
| 16  | AP invoice form lacks client-side validation           | UI C-04         | HIGH     |
| 17  | ConfirmDialog closes before async completes            | UI C-05         | HIGH     |
| 18  | Inconsistent number formatting across 12+ pages        | UI C-01         | HIGH     |
| 19  | `requireWriteAccess` middleware doesn't halt execution | Code Review CR8 | HIGH     |
| 20  | Entity scope bypass when entityId is null              | Security F10    | HIGH     |

### Tier 3 — Important

| #   | Issue                                                 | Source          | Severity |
| --- | ----------------------------------------------------- | --------------- | -------- |
| 21  | Mews/SAF imports not wrapped in DB transactions       | Financial W2-W3 | MEDIUM   |
| 22  | AP invoice missing gross=net+tax validation           | Financial W5    | MEDIUM   |
| 23  | FX source mislabeling (fallback labeled "ECB")        | Financial W7    | MEDIUM   |
| 24  | Zero-decimal currencies not handled in payments       | Financial W8    | MEDIUM   |
| 25  | No currency symbols on financial displays             | UI H-01         | MEDIUM   |
| 26  | WCAG accessibility gaps in financial tables           | UI H-02         | MEDIUM   |
| 27  | Color-only variance indicators                        | UI H-03         | MEDIUM   |
| 28  | No input validation on admin scope endpoints          | Security F11    | MEDIUM   |
| 29  | Recurring journal endpoints use `request.body as any` | Security F12    | MEDIUM   |
| 30  | Duplicate audit middleware logic                      | Code Review CR3 | MEDIUM   |

### Tier 4 — Feature Gaps (API Coverage)

| #   | Feature                       | Endpoints   |
| --- | ----------------------------- | ----------- |
| 31  | Recurring Journals UI         | 6 endpoints |
| 32  | FX Revaluation UI             | 1 endpoint  |
| 33  | AP Invoice Edit/Delete UI     | 2 endpoints |
| 34  | AR Invoice + Customer Edit UI | 2 endpoints |
| 35  | Report Scheduling UI          | 2 endpoints |
| 36  | User Status Management UI     | 1 endpoint  |
| 37  | AR Receipt Listing UI         | 1 endpoint  |

---

_Report generated by Claude Opus 4.6 (1M context) — 6 parallel inspection agents_
