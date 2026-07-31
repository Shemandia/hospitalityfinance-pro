# Tenant Data Isolation Audit — finalv1 findings

**Date:** 2026-04-07
**Scope:** Cross-tenant and cross-entity data exposure in HospitalityFinance Pro
**Method:** 4 parallel security-analyst agents covering DB/RLS layer, auth & tenant routing, API route handlers, and frontend boundary.
**Project:** `D:\FINANCIAL PROJECT\HospitalityFinance\hospitalityfinance-pro`

---

## Executive summary

The **database-per-tenant architecture is intact**. There is no unconditional path where tenant A directly reads from tenant B's Postgres database under normal operation. Per-tenant Prisma clients are isolated in a pool keyed by tenant slug, and `set_config('app.current_entity_id', x, true)` is correctly transaction-local on every call site that uses it.

However, there are several **conditional cross-tenant exposure chains** and a long list of **intra-tenant cross-entity gaps** where one entity in a tenant can read or modify data belonging to another entity in the same tenant DB. The most critical findings are independently corroborated by multiple agents.

**Verdict:**

- 5 findings rated **critical** (active exploit paths, fix immediately)
- 8 findings rated **high** (structural risks, fix this week)
- 11+ findings rated **medium / hardening** (defense-in-depth, fix as time permits)

**The single most exploitable issue:** `GET /api/v1/entities` runs `ALTER TABLE entities DISABLE ROW LEVEL SECURITY` (a global DDL, not transaction-local) whenever the JWT lacks an `entityIds` claim — and this branch has no role check. Three of the four agents independently found this.

---

## Table of contents

1. [Critical findings](#critical-findings)
2. [High findings](#high-findings)
3. [Medium / hardening findings](#medium--hardening-findings)
4. [What was verified safe](#what-was-verified-safe)
5. [Recommended fix order](#recommended-fix-order)
6. [Per-agent full reports](#per-agent-full-reports)
   - [Agent 1: Database / RLS layer](#agent-1-database--rls-layer)
   - [Agent 2: Auth & tenant routing](#agent-2-auth--tenant-routing)
   - [Agent 3: API route handlers & services](#agent-3-api-route-handlers--services)
   - [Agent 4: Frontend boundary](#agent-4-frontend-boundary)
7. [Coverage matrix (RLS tables)](#coverage-matrix-rls-tables)

---

## Critical findings

### CRIT-1. `ALTER TABLE … DISABLE ROW LEVEL SECURITY` in production code paths

**Files:**

- `apps/api/src/app.ts:170,200` (`GET /api/v1/entities` superadmin path)
- `apps/api/src/modules/setup/service.ts:84-122` (`SetupService.complete()` disables RLS on `entities`, `accounts`, `periods`, `account_type_definitions`)

**Found by:** DB agent, Auth agent, Routes agent (3 of 4 independently).

**What's wrong:**

```ts
// app.ts:163-202
const isSuperAdmin = !userEntityIds || userEntityIds.length === 0;
if (isSuperAdmin) {
  await prisma.$executeRawUnsafe("ALTER TABLE entities DISABLE ROW LEVEL SECURITY");
}
try {
  const entities = await prisma.entity.findMany({ where: isSuperAdmin ? {} : { ... } });
  ...
} finally {
  if (isSuperAdmin) {
    await prisma.$executeRawUnsafe("ALTER TABLE entities ENABLE ROW LEVEL SECURITY").catch(() => {});
  }
}
```

Three things are wrong, each compounding the next:

1. **`ALTER TABLE` is DDL, not session-local.** It mutates global table state for the entire Postgres database. While the toggle is open (the entire `findMany` window plus a child `findMany` at line 187), **every other concurrent request on every other connection sees RLS disabled on the `entities` table**. Any concurrent read of `prisma.entity.*` from any other handler bypasses RLS.
2. **The "superadmin" check is structural, not authorized.** It's just `entityIds.length === 0`. There's no `requireRole(["SUPERADMIN"])`. Any token whose JWT happens to lack the `entity_ids` claim trips it: a new user mid-onboarding, a Keycloak claim mapper misconfiguration, a future user not yet assigned to any entity.
3. **The re-enable uses `.catch(() => {})`.** A transient failure (connection drop, timeout, deadlock with a concurrent read) leaves RLS permanently disabled on `entities` until a manual `ALTER TABLE ENABLE` is run.

The setup wizard variant (`setup/service.ts`) is worse: it disables 4 tables at once, opens its own fresh `PrismaClient` outside the middleware-wrapped pool, and the route (`POST /api/v1/setup/complete` at `setup/router.ts:62`) requires only `requireAuth`, not `requireRole(["ADMIN"])`. Any tenant member can trigger it.

**Fix:**

- Replace `ALTER TABLE … DISABLE ROW LEVEL SECURITY` with `SET LOCAL row_security = off` inside an explicit transaction (transaction-local, not global), OR grant the API DB role `BYPASSRLS` and switch role per-tx.
- Add `requireRole(["SUPERADMIN"])` to `/api/v1/entities` superadmin path (and check the role list, not the absence of the claim).
- Add `requireRole(["ADMIN"])` to `/api/v1/setup/complete`.

---

### CRIT-2. AsyncLocalStorage tenant context uses unsafe `enterWith()`

**Files:** `apps/api/src/db/requestContext.ts:47-52` (`enterRequestContext`), `apps/api/src/app.ts:67-81` (global `onRequest` hook).

**Found by:** Auth agent.

**What's wrong:**
The codebase already has the safe `runWithContext()` helper (line 40-42 of `requestContext.ts`) and comments at `requestContext.ts:38` and `prisma.ts:58` explicitly say "enterWith can lose context across Fastify hook boundaries" — but `app.ts` uses `enterRequestContext` (which is `enterWith()`-based) anyway. A `setActiveTenant` "global fallback" was written to mitigate it but later silently neutralized in a refactor: `prisma.ts:59-61` is now a no-op while `auth.ts:105` still calls it expecting it to work.

**Real impact:** Under load, request N for tenant B can briefly observe the previous request's tenant slot in ALS before its own auth hook overwrites it. Combined with CRIT-3 (`/health` running Prisma queries with no auth) and frontend bugs that build wrong-tenant requests (HIGH-4), this becomes a concrete cross-tenant exposure.

**Fix:**

- Wrap each request in `runWithContext({...}, () => ...)` instead of `enterRequestContext`.
- Make `requireAuth` a global preHandler (deny-by-default) with an explicit allowlist for `/health`, `/ready`, `/api/v1/version`.
- Assert tenant context is set before any tenant-scoped Prisma call.

---

### CRIT-3. `/health` and `/ready` execute Prisma queries with no auth and no tenant context

**File:** `apps/api/src/app.ts:87-139`.

**Found by:** Auth agent.

**What's wrong:** Both endpoints are unauthenticated and call `prisma.$queryRaw\`SELECT 1\``. The `prisma`proxy reads`getActiveTenant()` from AsyncLocalStorage. Combined with CRIT-2, the probe lands on whichever tenant DB the previous request bound to the ALS slot. Health probes can confirm arbitrary tenant DB existence and prove the leaky fallback path is reachable.

**Fix:** `/health` and `/ready` must use a dedicated unscoped client (e.g. `registryPrisma`), NEVER the tenant-routed `prisma` proxy.

---

### CRIT-4. Frontend QueryClient + localStorage survive sign-out, leak tenant A data into tenant B's first render

**Files:**

- `apps/web/components/providers.tsx:9` (single `QueryClient` per tab, never torn down)
- `apps/web/components/entity-provider.tsx:38,74,92-96` (localStorage `hfp-selected-entity` with no per-user/per-tenant key)
- `apps/web/app/[tenant]/(dashboard)/layout.tsx:67-70` (`signOut()` doesn't clear cache or localStorage)

**Found by:** Frontend agent.

**Reproduction:**

1. User A logs into Acme, picks property `acme-prop-1`. LocalStorage stores that UUID.
2. User A clicks Sign Out. Session cookie clears. **QueryClient and localStorage do not.**
3. User B logs into Globex (same tab).
4. On the way to `/globex/dashboard`, the QueryClient still has cached `["accounts", "acme-prop-1"]`, `["periods", "acme-prop-1"]`, `["entities", token, "acme"]`, etc. from User A. Components reading these keys hit cached Acme data BEFORE `EntityProvider` re-runs and `switchEntity` is invoked.
5. Even after refetch, `selectedId` is initialised to `acme-prop-1` from localStorage. `useApiContext` returns it as `entityId` to in-flight queries on the first render — so Acme's UUID is sent as `X-Entity-ID` against the Globex API. Backend rejects (foreign UUID), but the cached Acme pages have already rendered under Globex chrome.

**Additional:** `entity-provider.tsx:49` puts the access token in the queryKey (`["entities", accessToken, tenantSlug]`) — every refresh creates a new cache entry without evicting old ones. Stale entries keyed by dead tokens accumulate indefinitely.

**Fix:**

- Clear `queryClient.clear()` and `localStorage.removeItem("hfp-selected-entity")` in a `useEffect` watching `session?.user?.tenantSlug`/`session?.user?.email` transitions, OR
- Re-key the `QueryClient` instance on session identity so React tears down the cache subtree on identity change, OR
- Move `Providers` (or a `<key={tenantSlug+userId}>` boundary) below the `[tenant]` segment.
- Remove the access token from any queryKey.

---

### CRIT-5. Consolidation router accepts arbitrary `childEntityIds` from request body

**Files:**

- `apps/api/src/modules/consolidation/router.ts:81-99`
- `apps/api/src/modules/consolidation/service.ts:112-176, 240`

**Found by:** Routes agent.

**What's wrong:** The router validates `parentEntityId === request.entityId` but takes `childEntityIds` verbatim from the request body. The service then runs `$queryRaw` against `mv_period_account_balances` with the child IDs interpolated:

```ts
SELECT ... FROM mv_period_account_balances
WHERE "entityId" = ${childEntityId} AND "periodId" = ${request.periodId}
```

Prisma RLS middleware does NOT wrap raw queries. The service does NOT use `withEntityRLS`. So `app.current_entity_id` is whatever the previous query left in the connection.

**Result:** An ADMIN of GROUP A in tenant T can pull period balances of any other GROUP's properties in the same tenant DB by listing their UUIDs. The intercompany lookup at `service.ts:240` has the same problem.

Within a single tenant DB this is intra-tenant cross-entity, not cross-tenant — but for a finance product, intra-tenant cross-entity IS the threat model.

**Fix:** In the router, fetch the parent's actual descendant entity IDs from the DB (using `withEntityRLS(prisma, parentEntityId, ...)`) and reject any `childEntityIds` not in that set. Then run consolidation with the verified list.

---

## High findings

### HIGH-1. `/api/v1/entities` superadmin path inferred from empty `entityIds` claim, no role check

**File:** `apps/api/src/app.ts:163-181`.

Superadmin status is inferred purely from `!userEntityIds || userEntityIds.length === 0`. There is no role check. Combined with CRIT-1, any user whose JWT lacks the claim triggers the RLS bypass.

**Fix:** Check `request.user.roles.includes("SUPERADMIN")` explicitly, not the absence of the claim.

---

### HIGH-2. Setup wizard `complete` lacks role gate

**File:** `apps/api/src/modules/setup/router.ts:62`.

`POST /api/v1/setup/complete` has only `requireAuth` — no `requireRole(["ADMIN"])`. Any tenant member can trigger materialization (and the multi-table RLS-disable window in CRIT-1).

**Fix:** Add `requireRole(["ADMIN"])`.

---

### HIGH-3. Admin user-invite silently links existing users to inviter's entity

**File:** `apps/api/src/modules/admin/router.ts:305-334`.

`POST /admin/users/invite` upserts on email. If a user with that email already belongs to another entity in the same tenant DB, the call silently grants the inviter's entity access to that existing user — without notification, without validating the user belongs to a related entity. The `keycloakId: pending-${Date.now()}` placeholder also opens an account-takeover vector if the wrong Keycloak account later resolves to that row.

**Fix:** Require explicit "user is mine to invite" check, OR send an invite email and require acceptance, OR refuse to upsert when a row already exists for that email outside the inviter's subtree.

---

### HIGH-4. Frontend middleware doesn't bind URL tenant to session tenant

**Files:**

- `apps/web/middleware.ts:40-96`
- `apps/web/app/[tenant]/(dashboard)/layout.tsx:18` (server component)
- `apps/web/components/use-api-context.ts:13-14`

A user signed into Acme who manually navigates to `/globex/dashboard` gets the dashboard rendered with their **Acme JWT + `X-Tenant-Slug: globex` header mismatch**. `useApiContext` prefers URL slug over session slug:

```ts
const tenantSlug = urlTenantSlug ?? session?.user?.tenantSlug;
```

Same pattern in `use-import-api-context.ts:19-20` and `entity-provider.tsx:44-45`.

This is mitigated by backend audience enforcement IF backend is correct — but Agent 2 found the backend tenant resolution has a fragile fallback chain (CRIT-2 + the realm-from-iss design at `auth.ts:189-199` is currently safe but designed to fall through to attacker-controlled `X-Tenant-Slug` if anyone touches it).

**Fix:**

- In `(dashboard)/layout.tsx` (server component), `if (session?.user?.tenantSlug && session.user.tenantSlug !== params.tenant) signOut/redirect`.
- Flip precedence in `useApiContext`/`useImportApiContext`/`SetupGuard` so session is authoritative, URL is fallback. Refuse to issue context when they disagree.

---

### HIGH-5. Models with `entity_id` but NO RLS policy

**Found by:** DB agent.

| Table                      | Risk                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `account_type_definitions` | Custom JournalType added by entity A is visible (and writable) to entity B in same tenant DB                                 |
| `recurring_journals`       | Auto-generates Journal rows on a schedule. Entity B can create a recurring journal that posts into accounts entity A can see |
| `consolidation_runs`       | Has `parent_entity_id` but no policy. Property-level user can query consolidation runs for unrelated parent groups           |
| `login_audits`             | Entity-scoped column but no policy. Cross-entity user activity visible to other entities                                     |

None are in `entity-rls.sql`, none are in `RLS_MODELS`.

**Fix:** Add policies to `entity-rls.sql` and add to `RLS_MODELS` in `rlsMiddleware.ts`. For `consolidation_runs`, the policy needs the `parent_entity_id = app_current_entity_id()` variant.

---

### HIGH-6. Child line tables have no `entity_id` column → no row-level defense

**Found by:** DB agent.

Tables affected: `journal_lines`, `ap_invoice_lines`, `purchase_order_lines`, `goods_received_note_lines`, `ap_payment_allocations`, `ar_allocations`, `budget_lines`, `bank_transactions`, `recurring_journal_lines`, `payment_run_items`, `payment_run_invoices`.

These are child tables of entity-scoped headers but have no `entity_id` FK of their own, so a row-level policy is impossible without schema change. Currently, isolation depends entirely on app-level joins through the parent. `tx.journalLine.findMany({})` with no `where` returns lines from every entity in the same tenant DB. There is **no defense-in-depth**.

**Fix:** Two options:

1. (Recommended) Denormalize `entity_id` onto each child table. Add policies. Add models to `RLS_MODELS`.
2. Document explicitly that callers MUST always join through the parent header, and add lint/CI checks.

---

### HIGH-7. AR dunning UPDATE bypasses entity filter

**File:** `apps/api/src/modules/ar/service.ts:387-389`.

```ts
await this.prisma
  .$executeRaw`UPDATE ar_invoices SET last_dunning_level = ${dunningLevel} WHERE id = ${invoice.id}::uuid`;
```

Raw `$executeRaw` UPDATE matches by id only, outside `withEntityRLS`. `app.current_entity_id` is whatever the previous query in the same connection set. RLS on `ar_invoices` is the only defense.

**Fix:** Add `AND entity_id = ${entityId}::uuid` to the WHERE clause.

---

### HIGH-8. Approval rule update/delete by id only

**File:** `apps/api/src/modules/gl/repository.ts:422,428`.

`delete({ where: { id: ruleId } })` and `update` similarly — caller passes `entityId` but it's unused. RLS via the middleware mostly saves us (ApprovalRule IS in `RLS_MODELS`), but if `app.current_entity_id` is missing for any reason, the delete falls through to a raw delete-by-id.

**Fix:** Add entity to where clause in both methods.

---

## Medium / hardening findings

### MED-1. `withRLSBypassed` is dead code but still exported

**File:** `apps/api/src/db/tenantContext.ts:74-113`.

Zero callers in the codebase. The router comment at `gl/router.ts:228` referencing it is stale; the COA import actually uses `withEntityRLS`. The dead helper issues `ALTER TABLE … DISABLE ROW LEVEL SECURITY` inside a transaction — a footgun if anyone ever imports it by mistake.

**Fix:** Delete it.

---

### MED-2. `setEntityDbContext` has unpaired increments

**File:** `apps/api/src/db/tenantContext.ts:13-20`.

Caller must remember to call `clearEntityDbContext`. If they forget after an exception, `_rlsDepth > 0` lingers in the request's AsyncLocalStorage and the rest of that request silently bypasses RLS via the middleware skip. AsyncLocalStorage is per-request so it doesn't bleed across requests, but it bleeds within one.

**Fix:** Delete the manual API in favor of `withEntityRLS` only.

---

### MED-3. Audit middleware fire-and-forget

**File:** `apps/api/src/db/auditMiddleware.ts:91-115`.

Audit writes are `.catch(()=>{})` after the parent operation. If the parent transaction later rolls back, the audit row claims a state change happened that never persisted. Integrity gap, not isolation. Also: errors are silently swallowed in production — you lose audit trail with no signal.

**Fix:** Either await the audit write inside the parent transaction, or add a structured-log/metric so failures are observable.

---

### MED-4. Entity policy `WITH CHECK` allows property creating child entities

**File:** `apps/api/src/db/sql/entity-rls.sql:38-44`.

Policy is `id = current OR parent_id = current` for both USING and WITH CHECK. A request scoped to a PROPERTY (`current = propertyId`) can INSERT a row with `parent_id = propertyId` — i.e. **a property can create child entities under itself**, which is not part of the documented two-level hierarchy.

**Fix:** Tighten WITH CHECK so only GROUP-scoped contexts can create child PROPERTYs.

---

### MED-5. 8 frontend fetch sites bypass `request()` and forget `X-Tenant-Slug`

These call `fetch()` directly with hand-built headers, sending only `Authorization` + `X-Entity-ID`:

| File                                                                | Line | Purpose                   |
| ------------------------------------------------------------------- | ---- | ------------------------- |
| `apps/web/app/[tenant]/(dashboard)/bank/reconciliation/page.tsx`    | 91   | Bank transactions list    |
| `apps/web/app/[tenant]/(dashboard)/gl/journals/new/page.tsx`        | 277  | Journal create            |
| `apps/web/app/[tenant]/(dashboard)/reports/balance-sheet/page.tsx`  | 184  | PDF download              |
| `apps/web/app/[tenant]/(dashboard)/reports/cashflow/page.tsx`       | 186  | PDF download              |
| `apps/web/app/[tenant]/(dashboard)/reports/usali-pl/page.tsx`       | 718  | PDF download              |
| `apps/web/app/[tenant]/(dashboard)/settings/journal-types/page.tsx` | 64   | All CRUD on journal types |
| `apps/web/app/[tenant]/(dashboard)/ap/payment-runs/[id]/page.tsx`   | 146  | File download             |
| `apps/web/app/[tenant]/(dashboard)/ap/payment-runs/[id]/page.tsx`   | 162  | File download             |

**Fix:** Refactor all 8 to use `request()` from `lib/gl-api.ts`. The central helper sets all three headers and is the only place we want to audit for header construction.

---

### MED-6. TanStack Query keys include access token (secrets in keys)

**File:** `apps/web/components/entity-provider.tsx:49`.

`queryKey: ["entities", accessToken, tenantSlug]`. The bearer token ends up in devtools, error logs, and potentially in any error reporter. Plus every refresh creates a new cache entry without evicting old ones.

**Fix:** Use a stable identifier — `["entities", tenantSlug, session.user.id]` — and rely on `staleTime` for freshness.

---

### MED-7. Most query keys use only `entityId`, NOT `tenantSlug`

Examples: `gl/journals/new/page.tsx:262,272`, `bank/reconciliation/page.tsx:77,87,107`. Entity UUIDs are globally unique with UUIDv4, so collisions are unlikely — but two safety properties depend on it:

- Entity UUIDs of two tenants must never collide. They won't with random UUIDv4, but a future switch to deterministic IDs would instantly create cross-tenant cache hits.
- An "entityId-less" query (like `getEntities`, `setup`) collides across tenants.

**Fix:** Add `tenantSlug` to every queryKey as a defensive prefix.

---

### MED-8. Tenant create endpoint accepts arbitrary `databaseUrl`

**File:** `apps/api/src/modules/tenant/router.ts:93-144`.

`POST /api/v1/platform/tenants` lets a caller with `X-Platform-Key` register a tenant pointing at any Postgres URL — no validation that the host matches a configured `TENANT_DB_HOST` allowlist. A leaked platform key plus this endpoint lets an attacker register a "tenant" pointing at the registry DB or another tenant's DB.

**Fix:** Add a host allowlist check based on `TENANT_DB_HOST` env.

---

### MED-9. Account-type CRUD has no scope check

**File:** `apps/api/src/modules/account-type/router.ts:120-215`.

Any ADMIN can update or delete tenant-wide `AccountTypeDefinition` rows. Cross-entity within a tenant.

**Fix:** Add entity scoping.

---

### MED-10. Audit log POST endpoint accepts user-supplied `userId`/`email`/`entityId`

**File:** `apps/api/src/modules/admin/router.ts:617-643`.

Body is taken verbatim. An attacker can forge LOGIN_SUCCESS records for any user/entity combination, polluting audit trail and incrementing other users' `loginCount`/`lastLoginAt`.

**Fix:** Source `userId`/`email` from the verified JWT, not the body.

---

### MED-11. Admin module — additional intra-tenant cross-entity reads

- `/admin/all-users` (`admin/router.ts:338-354`): exposes every user in the tenant DB. Gated by SUPERADMIN role, but vulnerable to the empty-claim escalation in CRIT-1/HIGH-1.
- `/admin/users/:userId/detail` and `/users/:userId/entities` (`admin/router.ts:498-523, 688-724`): no entity-ownership check. Any ADMIN can pass any user UUID and read full entity list + last 10 login audits.
- `/admin/login-audit` GET (`admin/router.ts:645-665`): no entity scope. Any ADMIN can list any user's login attempts by email.

**Fix:** Add entity-ownership checks; LoginAudit needs to be added to RLS (HIGH-5).

---

## What was verified safe

### Database / RLS layer

- **Entity model RLS gap from previous turn is fixed.** `Entity` is in `RLS_MODELS` and the `entities` table has its policy + `FORCE ROW LEVEL SECURITY`.
- **`set_config(..., true)` is transaction-local** and used inside `$transaction` everywhere it appears. Concurrent requests cannot leak `app.current_entity_id` between connections at the SQL level.
- **FORCE RLS is set on every table** that has `ENABLE ROW LEVEL SECURITY`. No gaps in the loop or for the `entities` table.
- **All policies have both `USING` and `WITH CHECK`** — INSERTs/UPDATEs are blocked from cross-entity writes at the DB level (with the `WITH CHECK` caveat at MED-4).
- **Tenant pool isolation:** each tenant gets its own `PrismaClient` instance keyed by `tenantSlug`. Two concurrent requests to different tenants get different `PrismaClient`s, different connection pools, different DBs. No cross-tenant client sharing.

### Auth & tenant routing

- **JWT issuer drives realm/tenant selection** at `auth.ts:163-174`. The token is decoded once for the issuer, then re-verified against that realm's JWKS. An attacker cannot supply `X-Tenant-Slug: tenant-b` and have a tenant-A token verified by tenant-B's keys — the realm comes from `iss`, not the header. (See CRIT-2 + the fragile fallback chain at `auth.ts:189-199` for the latent risk.)
- **JWT signature validation includes issuer match** (`auth.ts:175-177`).
- **`audience`/`azp` enforcement** prevents tokens from other Keycloak clients in the same realm being accepted.
- **Cross-tenant entity ID guess** — `findUnique` against the wrong tenant DB returns null, lineage walk yields empty, `isEntityAllowedByClaims` returns `false` (assuming claims are non-empty), 403. Works as designed when tenant binding is correct.
- **Refresh token replay across realms** — Keycloak rejects, and the application code doesn't store the refresh token under a swappable tenant slug.
- **`request.user.sub`** is sourced from verified JWT only. No header path.
- **Dev auth bypass** is correctly gated on `NODE_ENV !== 'production'`.

### API route handlers

- **gl, period, ap, ar, fx, budget, audit, kpi, reporting, integration** modules all call `requireEntityId(request.entityId)` on every handler and pass it to services.
- **Raw SQL in those modules** consistently binds `entity_id = ${entityId}` in the WHERE clause:
  - `gl/repository.ts` trial balance, balance upserts
  - `period/service.ts` raw queries
  - `ar/repository.ts` ageing report
  - `ap/repository.ts` row-locking SELECTs
  - `fx/repository.ts` balance upserts
  - `budget/service.ts` variance query
  - `kpi/service.ts` every $queryRaw
  - `inbound-service.ts` raw INSERT
- **KPI router** wraps every call in `withEntityRLS`, correct given the heavy `$queryRaw` usage.
- **Integration connectors** (mews, opera-cloud, simphony, sky-jana, saf, payroll, inbound, bank) accept `entityId` as a parameter and use it on every Prisma call. Only invoked from request handlers, not background workers.
- **Tenant provisioning** is protected by `X-Platform-Key`. CREATE DATABASE name is validated against an identifier regex.

### Frontend

- **Refresh-token flow** correctly binds `tenantSlug` at JWT issuance and reads it from the server-side JWT, not request input. User cannot swap realms via refresh.
- **`useTenantHref` / `useTenantRouter`** correctly derive slug from `useParams().tenant` first, falling back to pathname segment. Skip already-prefixed paths and platform routes.
- **`request()` helper** sets all three headers from a single `ApiContext`.
- **`import-entity-selector.tsx`** correctly filters to PROPERTY entities the user has access to. Override entityId in `useImportApiContext` cannot be a foreign-tenant UUID unless CRIT-4 contaminates the entity list.
- **`entity-provider.tsx:62-71`** filters returned entities to those in `session.user.entityIds` (or all for superadmin). Defense in depth against backend entity-list leak.
- **Login page** sends `tenantSlug` from URL to credentials. Middleware redirects authenticated users away from login, preventing accidental re-auth into another realm without explicit signOut.

---

## Recommended fix order

**Phase 1 (1 day) — close actively exploitable cross-tenant paths:**

1. CRIT-1: replace both `ALTER TABLE` calls with `SET LOCAL row_security = off` inside a transaction. Add real role checks.
2. CRIT-3: switch `/health` + `/ready` to a registry-only client.
3. HIGH-1: explicit role check on `/api/v1/entities` superadmin path.
4. HIGH-2: add `requireRole(["ADMIN"])` to `/setup/complete`.

**Phase 2 (1-2 days) — close the AsyncLocalStorage + frontend sign-out path:** 5. CRIT-2: convert `enterRequestContext` to `runWithContext`-based hook; make `requireAuth` a global preHandler with allowlist; assert tenant context before any tenant-routed Prisma call. 6. CRIT-4: clear QueryClient + localStorage on session change in the dashboard layout. 7. HIGH-4: add server-side `session.tenantSlug === params.tenant` check in `(dashboard)/layout.tsx`; flip URL/session precedence in `useApiContext`.

**Phase 3 (2-3 days) — close intra-tenant cross-entity gaps:** 8. CRIT-5: validate `childEntityIds` in consolidation router against parent's actual descendants. 9. HIGH-3: harden admin user-invite (require acceptance OR refuse cross-entity upsert). 10. HIGH-5: add `account_type_definitions`, `recurring_journals`, `consolidation_runs`, `login_audits` to RLS. 11. HIGH-7: add `entity_id` to AR dunning UPDATE. 12. HIGH-8: add entity to approval-rule update/delete.

**Phase 4 (defense in depth, ongoing):** 13. HIGH-6: denormalize `entity_id` onto child line tables. 14. MED-1, MED-2: delete `withRLSBypassed` and `setEntityDbContext` exports. 15. MED-5: refactor 8 frontend bypass sites to use `request()`. 16. MED-6: stop putting access token in TanStack Query keys. 17. MED-7: add `tenantSlug` to every queryKey. 18. MED-8: tenant create host allowlist. 19. MED-3, MED-4, MED-9, MED-10, MED-11: as time permits.

---

## Per-agent full reports

### Agent 1: Database / RLS layer

**Scope:** Schema, RLS policies, middleware coverage, RLS bypass safety, FORCE RLS coverage, policy correctness, model coverage gaps.

**Files inspected:** `apps/api/src/db/sql/entity-rls.sql`, `apps/api/src/db/rlsMiddleware.ts`, `apps/api/src/db/tenantContext.ts`, `apps/api/src/db/tenantPool.ts`, `apps/api/src/db/prisma.ts`, `apps/api/src/db/auditMiddleware.ts`, `apps/api/src/db/requestContext.ts`, `apps/api/src/db/schema-tenant.prisma`, `apps/api/src/modules/gl/coa-import-service.ts`, `apps/api/src/modules/gl/router.ts`.

**Critical findings:** None confirmed actively leaking across tenants. The DB-per-tenant boundary plus the AsyncLocalStorage-scoped tenant pool routing means the worst gap at this layer is intra-tenant cross-entity, not cross-tenant.

**High findings:**

- Models with `entity_id` but no RLS policy or RLS_MODELS coverage: `account_type_definitions`, `recurring_journals`, `consolidation_runs`, `login_audits`. (See HIGH-5 above.)
- `JournalLine` and other child tables have no `entity_id` column at all → no row-level defense. (See HIGH-6 above.)
- `audit_events` policy uses `entity_id = current` but the audit middleware writes whatever `entityId` it receives. If a route handler temporarily changed entity context, audit row will be written under the _current_ entity, not the entity the operation actually mutated.
- `withRLSBypassed` is dead code but still dangerous (exported, footgun, uses ALTER TABLE inside transaction).
- Audit middleware double-fires audit on retry/error (fire-and-forget pattern).

**Medium / hardening:**

- `_rlsDepth` leak via AsyncLocalStorage carryover within a single request via `setEntityDbContext`. (See MED-2.)
- Entity policy correctness for GROUP→PROPERTY hierarchy. (See MED-4.)
- Audit middleware swallows errors silently in production.
- Pool eviction is fire-and-forget under load.
- `schema.prisma` and `schema-tenant.prisma` are different files; tenant client uses `generated/tenant` (built from `schema-tenant.prisma`). The unused `schema.prisma` is confusing.

**Verified safe:** Entity model fix in place; `set_config(..., true)` is transaction-local; FORCE RLS coverage; all policies have both USING and WITH CHECK; tenant pool isolation; `runWithContext` uses `AsyncLocalStorage.run()` not `enterWith()`.

---

### Agent 2: Auth & tenant routing

**Scope:** JWT verification, tenant routing, entity validation, refresh flow.

**Files inspected:** `apps/api/src/plugins/auth.ts`, `apps/api/src/middleware/requireAuth.ts`, `apps/api/src/db/requestContext.ts`, `apps/api/src/db/prisma.ts`, `apps/api/src/db/tenantRegistry.ts`, `apps/api/src/app.ts`, `apps/web/auth.ts`.

**Critical findings:**

- **C1 — Tenant context survives across requests on the same worker.** Documented in CRIT-2 above. The codebase's own comments admit `enterWith()` is unsafe; the safe `runWithContext()` exists but isn't used by `app.ts`. The `setActiveTenant` "global fallback" was silently neutralized.
- **C2 — `/health` and `/ready` execute Prisma queries** with leftover tenant context. Documented in CRIT-3.
- **C3 — `/api/v1/entities` superadmin path** disables RLS globally. Documented in CRIT-1.
- **C4 — `ALTER TABLE … DISABLE ROW LEVEL SECURITY` is DDL, not transaction-local.** This converts the entire RLS layer into a no-op on demand. Documented in CRIT-1.
- **C5 — Tenant slug fallback chain** at `auth.ts:189-199` is currently safe (realm short-circuits) but designed fragile-by-design. Future refactor that lets realm be empty silently falls through to attacker-controlled `X-Tenant-Slug` header. **Fix:** Make realm the only source. Cross-check `X-Tenant-Slug` if present and reject mismatches.

**High findings:**

- **H1 — `isEntityAllowedByClaims` returns true for empty `entityIds`** without any tenant check. Combined with C1, a superadmin token from tenant A authenticates as superadmin against whichever tenant DB the request happens to be routed to.
- **H2 — `chainId` resolution uses tenant-routed `prisma`** but the tenant may not be set yet. If tenant resolution fails, lineage walk silently runs against the dev fallback DB (`baseClient` with `DATABASE_URL`).
- **H3 — `isEntityAllowedByClaims` parent walk** can be tricked via grafting. POST /entities (line 253) requires ADMIN/SUPERADMIN role but does NOT verify the supplied `parentId` is one the user has claims to. An ADMIN can create a property under any GROUP in the tenant.
- **H4 — `requireAuth` is opt-in per-route.** No global preHandler enforcing auth. If a route forgets `requireAuth`, the request executes with whatever tenant binding the ALS slot already holds.

**Medium / hardening:**

- M1: `audience` check accepts `azp` OR `aud` (acceptable but tightenable).
- M2: JWKS cache has no eviction (bounded, OK).
- M3: Realm regex requires lowercase (cosmetic, not security).
- M4: Dev auth gate is correct, but no startup assertion warning if `NODE_ENV` is unset + `ENABLE_DEV_AUTH=true` could activate dev auth in prod.
- M5: `authPlugin` is registered but only decorates `verifyAccessToken` — does not install a global auth hook. Recommend deny-by-default global hook.
- M6: Refresh token replay across tenants — currently safe (Keycloak rejects, app code doesn't swap tenantSlug), but defensive tightening recommended.
- M7: Origin check skipped when `Origin` header is absent. CSRF protection only works for browser flows.
- M8: Rate limit is global (200 req/min per IP), not per-tenant.
- M9: `request.user` is the raw JWT payload merged with roles/entityIds — verified safe.

**Verified safe:** JWT issuer drives realm; signature validation; audience enforcement; cross-tenant entity ID guess returns null; refresh token replay blocked; `request.user.sub` is from JWT only.

**Attack scenarios constructed:**

1. **Tenant-A superadmin reads tenant-B entities via `X-Tenant-Slug` header.** Blocked by `auth.ts:189-199` because `realm` is from `iss` and `??` short-circuits. C5 flags as fragile-by-design.
2. **Stale tenant context from prior request leaks across to unauthenticated `/health` Prisma query.** Plausible under realistic Fastify/Node load. The combination of C1+C2+C3+C4 is the most concerning chain.
3. **Tenant-A admin grafts an entity onto a parent in tenant A they don't own** → intra-tenant privilege escalation, possible per H3.

---

### Agent 3: API route handlers & services

**Scope:** Per-route handlers and services in `apps/api/src/modules/`.

**Critical findings:**

- **C1 — Global RLS disable on `entities` table** (`app.ts:170,200`). Documented in CRIT-1.
- **C2 — `/api/v1/entities` superadmin path returns all entities** (`app.ts:163-181`). Documented in HIGH-1.
- **C3 — Consolidation accepts arbitrary `childEntityIds`** (`consolidation/router.ts:81-99`, `service.ts:112-176, 240`). Documented in CRIT-5.
- **C4 — Setup wizard disables RLS on 4 tables** (`setup/service.ts:84-122`). Documented in CRIT-1.
- **C5 — Setup `complete` lacks role gate** (`setup/router.ts:62`). Documented in HIGH-2.
- **C6 — Admin role/permission CRUD has no entity scoping** (`admin/router.ts:88-235`). Cross-entity privilege escalation within tenant.
- **C7 — Admin user-invite leaks user existence and silently links cross-entity users** (`admin/router.ts:305-334`). Documented in HIGH-3.
- **C8 — Admin `assign-scope` / `revoke-scope`** allow assigning users to ANY entity (`admin/router.ts:401-493`).

**High findings:**

- **H1 — `entity-tree` returns the entire tenant DB hierarchy** (`admin/router.ts:357-391`).
- **H2 — `/admin/all-users`** exposes every user (`admin/router.ts:338-354`).
- **H3 — `/admin/users/:userId/detail`** has no entity-ownership check (`admin/router.ts:498-523, 688-724`).
- **H4 — `/admin/login-audit`** GET filters only by query params (`admin/router.ts:645-665`).
- **H5 — AR dunning UPDATE bypasses entity filter** (`ar/service.ts:387-389`). Documented in HIGH-7.
- **H6 — `gl/repository.ts:428` `deleteApprovalRule`** deletes by id only. Documented in HIGH-8.
- **H7 — Trial balance raw SQL** filters on caller-supplied `comparativePeriodId` without ownership check (`gl/repository.ts:507-510`).

**Medium / hardening:**

- M1: Tenant create endpoint accepts arbitrary `databaseUrl` (`tenant/router.ts:93-144`). Documented in MED-8.
- M2: Provisioning runs `npx prisma db push` via `execSync` (`tenant/provisioning-service.ts:137-143`).
- M3: Account-type CRUD has no scope check (`account-type/router.ts:120-215`). Documented in MED-9.
- M4: Audit log writes accept user-supplied `userId`, `email`, `entityId` (`admin/router.ts:617-643`). Documented in MED-10.
- M5: Setup wizard read of registry by slug uses `slug == tenantId` mapping (`setup/service.ts:33-37`).
- M6: `recurring-service.ts:227` raw `$executeRaw` not reviewed in detail.
- M7: `entity-tree` is built without filtering by user lineage.

**Per-module summary:**

| Module        | Raw SQL?                | requireEntityId?               | Findings                  |
| ------------- | ----------------------- | ------------------------------ | ------------------------- |
| gl            | yes                     | yes                            | 2 (H6, H7)                |
| period        | yes                     | yes                            | 0                         |
| audit         | no                      | yes                            | 1 (M4 in admin)           |
| reporting     | no                      | yes                            | 0                         |
| ap            | yes                     | yes                            | 0                         |
| ar            | yes                     | yes                            | 1 (H5)                    |
| fx            | yes                     | partial (revaluation only)     | 0                         |
| budget        | yes                     | yes                            | 0                         |
| consolidation | yes                     | partial (parentEntityId only)  | 1 critical (C3)           |
| integration   | yes                     | yes                            | 0                         |
| kpi           | yes, heavy              | yes (wrapped in withEntityRLS) | 0                         |
| admin         | no                      | partial                        | 5 (C6, C7, C8, H1-H4, M4) |
| tenant        | yes                     | n/a (platform key)             | 1 (M1)                    |
| account-type  | no                      | partial                        | 1 (M3)                    |
| setup         | yes ($executeRawUnsafe) | n/a (tenantSlug)               | 2 critical (C4, C5)       |
| app.ts inline | yes (ALTER TABLE)       | n/a                            | 2 critical (C1, C2)       |

**Top attack scenarios:**

1. **Cross-GROUP financial data theft via consolidation.** ADMIN of GROUP A in tenant T calls `POST /api/v1/consolidation/run` with arbitrary `childEntityIds` from another GROUP. Service runs raw `$queryRaw` against `mv_period_account_balances` for each child UUID without lineage check.
2. **Tenant-wide RLS bypass via `/api/v1/entities`.** Triggers `ALTER TABLE entities DISABLE ROW LEVEL SECURITY` for the duration of the query. Concurrent requests bypass RLS on entities. A failure to re-enable leaves it off until deploy.
3. **Cross-entity privilege escalation via admin user invite.** Property-level ADMIN invites email of an existing GROUP-level admin from another property. EntityUser link is silently created.

---

### Agent 4: Frontend boundary

**Scope:** `apps/web/` only.

**Critical findings:**

- **C1 — Stale tenant data leaks across logins** via shared QueryClient + LocalStorage. Documented in CRIT-4.
- **C2 — Middleware does not bind URL tenant to session tenant** (`middleware.ts:40-96`, `[tenant]/layout.tsx:12-28`). Documented in HIGH-4.
- **C3 — `useApiContext` prefers URL slug over session slug** (`use-api-context.ts:13-14`, `use-import-api-context.ts:19-20`, `entity-provider.tsx:44-45`). Same pattern in three places. Documented in HIGH-4.

**High findings:**

- **H1 — `setup-guard.tsx` accepts URL tenant slug**, no bind to session (`setup-guard.tsx:14,22-34`). Same problem class as C3.
- **H2 — Bare `router.push` to non-tenant-prefixed paths.** Currently caught by middleware (404), but a footgun. (Note: I converted these in a previous turn — verify the agent's snapshot.)
- **H3 — `entities` query keyed on the access token string**, not stable identity (`entity-provider.tsx:49`). Documented in MED-6.
- **H4 — Refresh-token flow uses `token.tenantSlug` from JWT** — currently safe, but worth a comment in code so future devs don't break it.
- **H5 — `setup/page.tsx` builds API context purely from session**, ignoring entity. Fine for `/setup/*` by design.

**Medium / hardening:**

- M1: `entity-provider.tsx:92-96` only writes localStorage when `entityId` is truthy. Stale UUID lingers across signOut.
- M2: Access token in queryKey ends up in devtools and error reporters. Documented in MED-6.
- M3: Most query keys use only `apiContext?.entityId`, not tenantSlug. Documented in MED-7.
- M4: `setup-guard.tsx:30` and `entity-provider.tsx` fetch on render but never re-validate session.tenantSlug == URL.
- M5: Server component `(dashboard)/layout.tsx:18` calls `await auth()` but doesn't enforce session.tenantSlug == params.tenant. Same as C2 from server side.
- M6: Dev mode banner only via `process.env.ENABLE_DEV_AUTH`. Verify this env is not set in prod.
- M7: NextAuth session cookie scope — currently host-bound (correct for slug-in-path). Document for future subdomain-per-tenant.
- M8: `middleware.ts:34-37` returns true (allow) when platform API is unreachable. Fail-open in dev. Recommend fail-closed in prod.

**Verified safe:** Refresh-token flow correctly binds tenantSlug; `useTenantHref` / `useTenantRouter` correctly derive slug; `request()` helper sets all three headers; `import-entity-selector.tsx` filters to PROPERTY entities; `entity-provider.tsx` filters returned entities; login page redirects authenticated users away from login.

**API call sites that bypass `request()`:** Documented in MED-5 above (8 sites).

---

## Coverage matrix (RLS tables)

| Model (table)                                        | entityId in schema   | in entity-rls.sql | in RLS_MODELS                                    | FORCE RLS |
| ---------------------------------------------------- | -------------------- | ----------------- | ------------------------------------------------ | --------- |
| Entity (entities)                                    | n/a (id)             | yes               | yes (just added)                                 | yes       |
| EntityUser (entity_users)                            | yes                  | yes               | yes                                              | yes       |
| UserRole (user_roles)                                | yes (nullable)       | yes               | yes                                              | yes       |
| **LoginAudit (login_audits)**                        | **yes (nullable)**   | **NO**            | **NO**                                           | **NO**    |
| Period (periods)                                     | yes                  | yes               | yes                                              | yes       |
| **AccountTypeDefinition (account_type_definitions)** | **yes (nullable)**   | **NO**            | **NO**                                           | **NO**    |
| Account (accounts)                                   | yes                  | yes               | yes                                              | yes       |
| JournalType (journal_types)                          | yes                  | yes               | yes                                              | yes       |
| **RecurringJournal (recurring_journals)**            | **yes**              | **NO**            | **NO**                                           | **NO**    |
| Journal (journals)                                   | yes                  | yes               | yes                                              | yes       |
| JournalLine (journal_lines)                          | no (parent FK only)  | no                | no                                               | no        |
| AccountPeriodBalance (account_period_balances)       | yes                  | yes               | yes                                              | yes       |
| ApprovalRule (approval_rules)                        | yes                  | yes               | yes                                              | yes       |
| JournalApproval (journal_approvals)                  | yes                  | yes               | yes                                              | yes       |
| Supplier (suppliers)                                 | yes                  | yes               | yes                                              | yes       |
| APInvoice (ap_invoices)                              | yes                  | yes               | yes                                              | yes       |
| APInvoiceLine (ap_invoice_lines)                     | no                   | no                | no                                               | no        |
| PurchaseOrder (purchase_orders)                      | yes                  | yes               | yes                                              | yes       |
| PurchaseOrderLine (purchase_order_lines)             | no                   | no                | no                                               | no        |
| GoodsReceivedNote (goods_received_notes)             | yes                  | yes               | yes                                              | yes       |
| GoodsReceivedNoteLine                                | no                   | no                | no                                               | no        |
| APPayment (ap_payments)                              | yes                  | yes               | yes                                              | yes       |
| PaymentRun (payment_runs)                            | yes                  | yes               | yes                                              | yes       |
| **PaymentRunItem (payment_run_items)**               | **no**               | **no**            | **no**                                           | **no**    |
| **PaymentRunInvoice (payment_run_invoices)**         | **no**               | **no**            | **no**                                           | **no**    |
| APPaymentAllocation                                  | no                   | no                | no                                               | no        |
| Customer (customers)                                 | yes                  | yes               | yes                                              | yes       |
| ARInvoice (ar_invoices)                              | yes                  | yes               | yes                                              | yes       |
| ARReceipt (ar_receipts)                              | yes                  | yes               | yes                                              | yes       |
| ARAllocation                                         | no                   | no                | no                                               | no        |
| AuditEvent (audit_events)                            | yes                  | yes               | NO (intentionally — handled by audit middleware) | yes       |
| ReportDefinition                                     | yes                  | yes               | yes                                              | yes       |
| BudgetDefinition                                     | yes                  | yes               | yes                                              | yes       |
| BudgetLine                                           | no                   | no                | no                                               | no        |
| **ConsolidationRun (consolidation_runs)**            | **parent_entity_id** | **NO**            | **NO**                                           | **NO**    |
| ConsolidationRunEntity                               | yes                  | yes               | yes                                              | yes       |
| InterfaceDefinition                                  | yes                  | yes               | yes                                              | yes       |
| ConnectorMapping                                     | yes                  | yes               | yes                                              | yes       |
| ImportLog                                            | yes                  | yes               | yes                                              | yes       |
| PMSStatistic                                         | yes                  | yes               | yes                                              | yes       |
| BankStatement                                        | yes                  | yes               | yes                                              | yes       |
| BankTransaction                                      | no                   | no                | no                                               | no        |

**Bold rows:** missing coverage that should be added.

---

## Notes for future audits

- This audit was static-only. CRIT-2's exploitability depends on Node's async resource reuse semantics and Fastify's hook scheduling. Recommend a load test that interleaves two tenants' requests and asserts the tenant slug observed inside route handlers matches the JWT.
- Production env files were not inspected. The user asserted `ENABLE_DEV_AUTH=false`. Verify deployment manifests.
- The DB layer audit assumed `schema-tenant.prisma` is the active schema (the tenant pool loads `generated/tenant`); `schema.prisma` exists but appears unused. Confirm before deleting.
- Whether `mv_period_account_balances` (the materialized view used by consolidation) has its own RLS policy was not verified — if it doesn't, CRIT-5 is unconditional.
- The Routes agent flagged that some bare `router.push` calls were still present in its snapshot. A previous turn converted most of these to `useTenantRouter` — verify the current state.
