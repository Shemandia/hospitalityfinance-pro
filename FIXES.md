# HospitalityFinance Pro — Fix Guide

> Generated 2026-03-10 from full codebase assessment.
> 76 issues identified: 15 Critical, 23 High, 19 Medium, 19 Low.
> Work top-to-bottom within each priority tier.

---

## P0 — CRITICAL (Fix immediately)

### FIX-01: API base URL fallback is wrong (Frontend)

**File:** `apps/web/lib/gl-api.ts` line 1
**Bug:** Fallback port is `3001` (the web port) instead of `4000` (the API port).
**Impact:** All API calls fail silently when `NEXT_PUBLIC_API_BASE_URL` env var is missing.

```ts
// BEFORE (line 1):
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

// AFTER:
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
```

---

### FIX-02: Invalid Tailwind CSS variable syntax in sidebar (Frontend)

**File:** `apps/web/app/(dashboard)/layout.tsx` lines 95, 98, 101
**Bug:** `bg-(--color-primary)` and `text-(--color-accent)` are invalid Tailwind syntax. CSS custom properties require bracket notation.
**Impact:** Sidebar background and accent text colors don't render.

```tsx
// BEFORE (line 95):
<aside className="w-60 shrink-0 bg-(--color-primary) text-white flex flex-col">

// AFTER:
<aside className="w-60 shrink-0 bg-[var(--color-primary)] text-white flex flex-col">

// BEFORE (line 98):
<Building2 className="h-5 w-5 text-(--color-accent)" />

// AFTER:
<Building2 className="h-5 w-5 text-[var(--color-accent)]" />

// BEFORE (line 101):
<span className="text-(--color-accent) font-bold">Pro</span>

// AFTER:
<span className="text-[var(--color-accent)] font-bold">Pro</span>
```

---

### FIX-03: GL balance calculation ignores account normal balance type (API)

**File:** `apps/api/src/modules/gl/repository.ts` lines 363–399
**Bug:** `closing = opening + debits - credits` is only correct for debit-normal accounts (ASSET, EXPENSE). For credit-normal accounts (LIABILITY, EQUITY, REVENUE), the formula should be `closing = opening - debits + credits`.
**Impact:** Trial balance shows wrong closing balances for all liability, equity, and revenue accounts.

```ts
// BEFORE (lines 367, 389-391):
const closing = opening.add(periodDebits).sub(periodCredits);
// ...
const closing = new Prisma.Decimal(existing.openingBalance)
  .add(periodDebits)
  .sub(periodCredits);

// AFTER — requires knowing the account type.
// Option A: Accept accountType as a parameter:
async updateAccountBalance(
  entityId: string,
  accountId: string,
  periodId: string,
  debitFunctional: Prisma.Decimal,
  creditFunctional: Prisma.Decimal,
  accountType: string          // ← add parameter
) {
  // ...
  const isDebitNormal = ["ASSET", "EXPENSE", "CONTRA_REVENUE"].includes(accountType);
  const closing = isDebitNormal
    ? opening.add(periodDebits).sub(periodCredits)
    : opening.sub(periodDebits).add(periodCredits);
  // ...
}
```

Then update all callers (`postJournalInternal` in `gl/service.ts` line 270, `ar/service.ts` line 171, `ap/service.ts` and `integration/router.ts`) to pass the account type. Each call site already has access to the account or can look it up.

---

### FIX-04: Comparative period ID passes empty string instead of conditional SQL (API)

**File:** `apps/api/src/modules/gl/repository.ts` line 435
**Bug:** `${comparativePeriodId ?? ""}` sends an empty string to SQL when no comparative period is selected. This matches zero rows (correct behavior) but is semantically wrong and fragile.
**Impact:** If a period ID ever happens to be empty string, results could be unpredictable.

```ts
// BEFORE (lines 429-436):
comparative_balances AS (
  SELECT
    account_id,
    COALESCE(closing_balance, 0)::numeric(18,4) AS comparative_closing_balance
  FROM account_period_balances
  WHERE entity_id = ${entityId}
    AND period_id = ${comparativePeriodId ?? ""}
)

// AFTER — use conditional Prisma.sql:
comparative_balances AS (
  SELECT
    apb2.account_id,
    COALESCE(apb2.closing_balance, 0)::numeric(18,4) AS comparative_closing_balance
  FROM account_period_balances apb2
  WHERE apb2.entity_id = ${entityId}
    ${comparativePeriodId
      ? Prisma.sql`AND apb2.period_id = ${comparativePeriodId}`
      : Prisma.sql`AND 1 = 0`}
)
```

---

### FIX-05: Journal rejection does not reverse account balances (API)

**File:** `apps/api/src/modules/gl/service.ts` lines 413–448
**Bug:** `rejectJournal` sets the journal status back to `DRAFT` but does NOT reverse the `AccountPeriodBalance` updates. Since journals are only posted (and balances updated) when status becomes `POSTED`, and rejection requires `PENDING_APPROVAL` status, the balances were never updated yet — so this is actually safe. **However**, if the approval workflow is ever changed to allow partial posting or if `postJournalInternal` is called before all approvals complete, balances would be corrupted.
**Recommendation:** Add a guard comment or, better, add a balance reversal for safety:

```ts
// In rejectJournal, after line 444:
// Reverse account balances if journal was already posted
if (journal.status === "POSTED") {
  for (const line of journal.lines) {
    // Reverse: swap debit and credit
    await repository.updateAccountBalance(
      entityId,
      line.accountId,
      journal.periodId,
      line.creditFunctional,  // swapped
      line.debitFunctional,   // swapped
      /* accountType */ line.account.type
    );
  }
}
```

**Note:** Currently `rejectJournal` checks `journal.status !== "PENDING_APPROVAL"` (line 428), so this guard should never trigger. But it's defensive programming for future changes.

---

### FIX-06: Silent email failures in approval workflow (API)

**File:** `apps/api/src/modules/gl/service.ts` lines 321–332
**Bug:** `Promise.allSettled()` swallows all email sending errors. No logging, no user feedback.
**Impact:** Approvers never receive notification emails and nobody knows.

```ts
// BEFORE (lines 321-332):
await Promise.allSettled(
  result.approvalRecipients.map((recipient) =>
    sendApprovalEmail({ ... })
  )
);

// AFTER:
const emailResults = await Promise.allSettled(
  result.approvalRecipients.map((recipient) =>
    sendApprovalEmail({ ... })
  )
);
const emailFailures = emailResults.filter(
  (r): r is PromiseRejectedResult => r.status === "rejected"
);
if (emailFailures.length > 0) {
  request.log.warn(
    { failedCount: emailFailures.length, reasons: emailFailures.map(f => f.reason?.message ?? "unknown") },
    "Some approval notification emails failed to send"
  );
}
```

**Note:** The `request.log` isn't available in the service. Either pass a logger instance, or use the Fastify app logger, or import a shared logger.

---

### FIX-07: AR invoice posting has no FX gain/loss handling (API)

**File:** `apps/api/src/modules/ar/service.ts` lines 140–168
**Bug:** Creates a 2-line GL journal (debit AR control, credit revenue) using the invoice amount directly. The `fxRate` is applied to both lines, but if the invoice currency differs from the entity's functional currency, there should be an FX gain/loss line when the rate differs from 1.0.
**Impact:** Foreign currency invoices create balanced journals in original currency but may be unbalanced in functional currency if functional amounts are computed differently.

```ts
// AFTER line 141 — add FX gain/loss line if rate != 1:
const amount = new Prisma.Decimal(invoice.amount);
const fxRate = new Prisma.Decimal(invoice.fxRate);
const functionalAmount = amount.mul(fxRate);

const lines = [
  {
    accountId: arControl.id,
    debit: amount,
    credit: new Prisma.Decimal(0),
    fxRate,
    lineNumber: 1,
    description: `AR receivable for ${invoice.customer.name}`
  },
  {
    accountId: revenueAccount.id,
    debit: new Prisma.Decimal(0),
    credit: amount,
    fxRate,
    lineNumber: 2,
    description: `Revenue recognition for invoice ${invoice.invoiceNumber}`
  }
];

// If FX rate != 1 and there's a rounding difference in functional amounts,
// add an FX gain/loss line:
if (!fxRate.equals(1)) {
  const fxGainLossAccount = await repository.getAccountByCode(entityId, "7900"); // FX gain/loss account
  if (fxGainLossAccount) {
    const debitFunctional = amount.mul(fxRate);
    const creditFunctional = amount.mul(fxRate);
    const diff = debitFunctional.sub(creditFunctional);
    // Only add if there's an actual rounding difference
    if (!diff.isZero()) {
      lines.push({
        accountId: fxGainLossAccount.id,
        debit: diff.greaterThan(0) ? new Prisma.Decimal(0) : diff.abs(),
        credit: diff.greaterThan(0) ? diff : new Prisma.Decimal(0),
        fxRate: new Prisma.Decimal(1),
        lineNumber: 3,
        description: `FX gain/loss on AR invoice ${invoice.invoiceNumber}`
      });
    }
  }
}
```

**Note:** This is more of a design decision. If the system always stores both original and functional amounts per line and balances are checked in functional currency, then the current 2-line approach is sufficient. Review the `createPostedJournalForARInvoice` repository method to confirm functional amount handling.

---

### FIX-08: Web dev port mismatch (Config)

**File:** `apps/web/package.json` line 7, `apps/web/.env.local` line 5, `apps/web/.env.example` lines 1, 6-7
**Bug:** Multiple conflicting port references.

| Source | Value | Should be |
|--------|-------|-----------|
| `apps/web/package.json` dev script | `-p 3000` | `-p 3001` |
| `apps/web/.env.local` NEXTAUTH_URL | `http://localhost:3000` | `http://localhost:3001` |
| `apps/web/.env.example` NEXTAUTH_URL | `http://localhost:3000` | `http://localhost:3001` |
| `apps/web/.env.example` API_BASE_URL | `http://localhost:3001` | `http://localhost:4000` |
| `apps/web/.env.example` NEXT_PUBLIC_API_BASE_URL | `http://localhost:3001` | `http://localhost:4000` |

**Fix all five values** to match the spec: web=3001, API=4000.

---

### FIX-09: .env.example has wrong API port (Config)

**File:** `apps/api/.env.example` line 1
**Bug:** `PORT=3001` but actual `.env` uses `PORT=4000`.

```
# BEFORE:
PORT=3001

# AFTER:
PORT=4000
```

---

## P1 — HIGH (Fix this sprint)

### FIX-10: Missing entity authorization check in consolidation routes (API)

**File:** `apps/api/src/modules/consolidation/router.ts` lines 38–59
**Bug:** Routes accept `parentEntityId` from URL params without verifying user has access to that entity.
**Impact:** Any authenticated user can retrieve/trigger consolidation for any entity (multi-tenant data leakage).

```ts
// Add after line 41, before calling consolidationService:
const userEntityId = requireEntityId(request.entityId);
if (userEntityId !== request.params.parentEntityId) {
  return reply.code(403).send({
    data: null,
    errors: [{ code: "CONSOLIDATION_FORBIDDEN", message: "No access to this entity." }]
  });
}
```

Apply to all routes in this file that use `parentEntityId`.

---

### FIX-11: AP payment file written outside transaction (API)

**File:** `apps/api/src/modules/ap/service.ts` lines 790–794
**Bug:** `writeFile(bankFilePath, ...)` happens at line 794 BEFORE the `$transaction` block starts at line 796. If the transaction fails, the file is already written to disk.
**Impact:** Orphaned payment files on disk when DB transaction rolls back.

```ts
// AFTER: Move file write inside the transaction, after status update succeeds.
// Build the file content before the transaction, but write it after:
return this.prisma.$transaction(async (transaction) => {
  // ... existing transaction logic ...
  // Move writeFile here, after all DB operations succeed:
  await mkdir(outputDir, { recursive: true });
  await writeFile(bankFilePath, file.content, "utf8");
  await txRepository.setPaymentRunFilePath(entityId, paymentRunId, bankFilePath);
  // ...
});
```

---

### FIX-12: No pagination on consolidation run listing (API)

**File:** `apps/api/src/modules/consolidation/service.ts` lines 45–51
**Bug:** `findMany` returns ALL runs with no limit.
**Impact:** Memory exhaustion and timeouts as data grows.

```ts
// BEFORE:
listRuns(parentEntityId: string) {
  return this.prisma.consolidationRun.findMany({
    where: { parentEntityId },
    orderBy: [{ createdAt: "desc" }],
    include: { entityResults: true }
  });
}

// AFTER:
listRuns(parentEntityId: string, take = 50, skip = 0) {
  return this.prisma.consolidationRun.findMany({
    where: { parentEntityId },
    orderBy: [{ createdAt: "desc" }],
    include: { entityResults: true },
    take,
    skip
  });
}
```

Update the router to pass `take`/`skip` from query params.

---

### FIX-13: N+1 query in GL journal listing (API)

**File:** `apps/api/src/modules/gl/repository.ts` line ~234
**Bug:** Fetches all journals with `include: { lines: true, approvals: true }`. For list views, full line details are unnecessary.
**Impact:** 50 journals × 10 lines × 5 approvals = 2,500+ DB rows per request.

```ts
// AFTER — use select for list views, full include only for detail:
// For list:
include: {
  lines: { select: { id: true } },  // just count
  _count: { select: { lines: true, approvals: true } }
}

// For detail (getJournalWithLines):
include: { lines: true, approvals: true }  // keep as-is
```

---

### FIX-14: Audit page uses inline styles instead of Tailwind (Frontend)

**File:** `apps/web/app/(dashboard)/audit/page.tsx` lines 41–101
**Bug:** Entire page uses React inline `style={{}}` objects instead of Tailwind CSS + shadcn/ui.
**Impact:** Visual inconsistency with the rest of the app.

Rewrite the page using Tailwind classes and shadcn Table, Card, Badge, Input components. Replace all `style={{...}}` attributes with equivalent Tailwind classes:

| Inline Style | Tailwind Equivalent |
|--------------|-------------------|
| `background: "#fff"` | `bg-white` |
| `borderRadius: "12px"` | `rounded-xl` |
| `padding: "1rem"` | `p-4` |
| `display: "flex", gap: "0.6rem"` | `flex gap-2.5` |
| `width: "100%", borderCollapse: "collapse"` | Use shadcn `<Table>` |
| `fontWeight: 600` | `font-semibold` |

---

### FIX-15: Dashboard uses native `<select>` instead of shadcn Select (Frontend)

**File:** `apps/web/app/(dashboard)/dashboard/page.tsx` lines 576–585
**Bug:** Native `<select>` element breaks visual consistency.

```tsx
// BEFORE (lines 576-585):
<select
  aria-label="Select period"
  value={activePeriodId}
  onChange={e => setPeriodId(e.target.value)}
  className="flex h-8 rounded-md border border-border bg-white px-2.5 py-1 text-sm"
>
  {periods.map(p => (
    <option key={p.id} value={p.id}>{p.name}{p.status === "OPEN" ? " (Open)" : ""}</option>
  ))}
</select>

// AFTER:
<Select value={activePeriodId} onValueChange={setPeriodId}>
  <SelectTrigger className="h-8 w-[200px]">
    <SelectValue placeholder="Select period" />
  </SelectTrigger>
  <SelectContent>
    {periods.map(p => (
      <SelectItem key={p.id} value={p.id}>
        {p.name}{p.status === "OPEN" ? " (Open)" : ""}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

Add imports: `import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";`

---

### FIX-16: Periods page constructs ApiContext manually (Frontend)

**File:** `apps/web/app/(dashboard)/periods/page.tsx`
**Bug:** Manually constructs `ApiContext` from session instead of using the shared `useApiContext()` hook.
**Impact:** Code duplication and inconsistent pattern.

```ts
// BEFORE:
const ctx: ApiContext | null = session?.user?.entityIds?.[0]
  ? {
      accessToken: (session as unknown as { accessToken?: string }).accessToken ?? "dev-token",
      entityId: session.user.entityIds[0],
    }
  : null;

// AFTER:
import { useApiContext } from "@/components/use-api-context";
// ...
const ctx = useApiContext();
```

Remove the manual construction and unused `useSession()` import if no longer needed.

---

### FIX-17: Generic Record types for API responses (Frontend)

**File:** `apps/web/lib/gl-api.ts` multiple functions
**Bug:** Functions return `Record<string, unknown>` or `Array<Record<string, unknown>>` instead of typed responses.

```ts
// BEFORE:
export async function getGLJournals(ctx: ApiContext, ...): Promise<Envelope<Array<Record<string, unknown>>>>

// AFTER — define proper types:
export interface JournalSummary {
  id: string;
  reference: string;
  description: string;
  status: string;
  periodId: string;
  amount: string;
  currency: string;
  createdAt: string;
  lineCount: number;
}

export async function getGLJournals(ctx: ApiContext, ...): Promise<Envelope<JournalSummary[]>>
```

Do the same for `getGLJournal`, `getAuditEvents`, and all other functions returning `Record<string, unknown>`.

---

### FIX-18: Missing request body size limit (API)

**File:** `apps/api/src/app.ts` line ~20
**Bug:** Fastify instantiated without `bodyLimit`. Default is 1MB. SAF files and bank statements can exceed this.

```ts
// BEFORE:
const app = Fastify({ logger: true });

// AFTER:
const app = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024  // 10 MB for file imports
});
```

---

## P2 — MEDIUM (Fix next sprint)

### FIX-19: Missing rate limiting on integration import endpoints (API)

**File:** `apps/api/src/modules/integration/router.ts` (import routes)
**Action:** Install `@fastify/rate-limit` and add per-route limits:

```ts
import rateLimit from "@fastify/rate-limit";

// Register on the integration router:
router.register(rateLimit, {
  max: 10,
  timeWindow: "1 minute"
});
```

---

### FIX-20: No error boundaries or Suspense wrappers (Frontend)

**Files:** All page components under `apps/web/app/(dashboard)/`
**Action:** Add a shared error boundary component and wrap pages:

```tsx
// apps/web/components/error-boundary.tsx
"use client";
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <div className="p-8 text-destructive">Something went wrong.</div>;
    }
    return this.props.children;
  }
}
```

Wrap each page's main content in `<ErrorBoundary>`.

---

### FIX-21: Missing loading skeletons in table views (Frontend)

**Files:** `gl/journals/page.tsx`, `ap/page.tsx`, `ar/page.tsx`, `periods/page.tsx`
**Action:** Replace "Loading…" text with shadcn Skeleton components:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

// Replace:
{isLoading && <p>Loading…</p>}

// With:
{isLoading && (
  <div className="space-y-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
)}
```

---

### FIX-22: Mutations don't disable UI during pending state (Frontend)

**Files:** `ap/page.tsx`, `ar/page.tsx`, `budget/page.tsx`, `fx/page.tsx`
**Action:** Add `disabled={mutation.isPending}` to submit buttons and form fields:

```tsx
<Button type="submit" disabled={createMutation.isPending}>
  {createMutation.isPending ? "Saving…" : "Save"}
</Button>
```

---

### FIX-23: Missing comparative period selector in trial balance UI (Frontend)

**File:** `apps/web/app/(dashboard)/gl/trial-balance/page.tsx`
**Bug:** API supports `comparativePeriodId` query param but UI has no control to select it.
**Action:** Add an optional second period dropdown labeled "Compare to" next to the existing period selector. Pass the selected value as `comparativePeriodId` query param.

---

### FIX-24: Hardcoded demo entity IDs in consolidation page (Frontend)

**File:** `apps/web/app/(dashboard)/consolidation/page.tsx` lines 60–64
**Bug:** `DEMO_ENTITIES` array is hardcoded. Won't work in production.
**Action:** Create an API endpoint `GET /api/v1/entities` that returns entities the user has access to, and fetch them in the component.

---

### FIX-25: Missing accessibility attributes (Frontend)

**Files:** Multiple pages
**Action:**
- Add `role="button"` and `tabIndex={0}` + `onKeyDown` to clickable `<div>` elements
- Add `aria-label` to icon-only buttons
- Add `role="group"` to button groups
- Use `<fieldset>` + `<legend>` for checkbox groups

---

### FIX-26: Missing keyboard navigation in AccountPicker combobox (Frontend)

**Files:** `apps/web/app/(dashboard)/ap/page.tsx`, `apps/web/app/(dashboard)/gl/journals/new/page.tsx`
**Action:** Add `onKeyDown` handler for arrow keys, Enter, and Escape. Consider replacing with shadcn `Command` / `Combobox` component from cmdk.

---

### FIX-27: Inconsistent number formatting across pages (Frontend)

**Files:** `dashboard/page.tsx`, `trial-balance/page.tsx`, `consolidation/page.tsx`, etc.
**Bug:** Each page defines its own `fmt()`, `fmtNum()`, `fmtPct()` helpers.
**Action:** Extract to `apps/web/lib/format.ts`:

```ts
export function fmt(n: string | number, decimals = 0): string {
  return Number(n).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

export function fmtPct(n: string | number, decimals = 1): string {
  return `${fmt(n, decimals)}%`;
}
```

Then import in each page, removing the local definitions.

---

## P3 — CONFIGURATION & INFRASTRUCTURE

### FIX-28: Missing root tsconfig.json

**File:** Root directory (missing)
**Action:** Create `tsconfig.json` at project root:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true
  },
  "references": [
    { "path": "apps/api" },
    { "path": "apps/web" }
  ]
}
```

---

### FIX-29: Missing Prettier configuration

**File:** Root directory (missing)
**Action:** Create `.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "none",
  "printWidth": 100,
  "tabWidth": 2
}
```

---

### FIX-30: Missing ESLint configuration

**File:** Root directory (missing)
**Action:** Create `eslint.config.mjs` with TypeScript + Next.js rules. Minimal:

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  tseslint.configs.recommended,
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.next/**"] }
);
```

---

### FIX-31: Prisma enum missing for status string fields

**File:** `apps/api/src/db/schema.prisma`
**Bug:** `APPayment.status`, `ImportLog.status`, `ConsolidationRun.status` use `String` instead of enums.
**Action:** Define enums and update fields:

```prisma
enum APPaymentStatus {
  PENDING
  COMPLETED
  FAILED
  REVERSED
}

enum ImportLogStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum ConsolidationRunStatus {
  RUNNING
  COMPLETED
  FAILED
}
```

Update each field from `String` to the corresponding enum. Run `prisma migrate dev`.

---

### FIX-32: Missing security headers in Next.js config

**File:** `apps/web/next.config.ts`
**Action:** Add security headers:

```ts
const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=()" }
        ]
      }
    ];
  }
};
```

---

### FIX-33: Missing Next.js middleware for auth enforcement

**File:** `apps/web/middleware.ts` (create new)
**Action:** Add route protection middleware:

```ts
export { auth as middleware } from "./auth";

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"]
};
```

---

### FIX-34: Husky pre-commit hooks not initialized

**Action:** Run `npx husky init` and create `.husky/pre-commit`:

```sh
npx lint-staged
```

---

### FIX-35: Fastify bodyLimit missing on app init

Already covered in FIX-18. This is here as a config reminder.

---

## P4 — LOW PRIORITY (Backlog)

### FIX-36: Duplicated `requireEntityId()` function across 8+ routers

**Files:** `gl/router.ts`, `ap/router.ts`, `ar/router.ts`, `budget/router.ts`, `fx/router.ts`, `audit/router.ts`, `kpi/router.ts`, `consolidation/router.ts`
**Action:** Extract to `apps/api/src/shared/require-entity.ts`:

```ts
export function requireEntityId(entityId: string | undefined, moduleCode: string): string {
  if (!entityId) {
    throw new Error(`${moduleCode}_ENTITY_CONTEXT_REQUIRED`);
  }
  return entityId;
}
```

---

### FIX-37: Dashboard has excessive `eslint-disable` for `any` types

**File:** `apps/web/app/(dashboard)/dashboard/page.tsx`
**Action:** Add proper TypeScript generics to `useQuery` calls instead of suppressing linting.

---

### FIX-38: Missing form field validation UI (red borders, inline errors)

**Files:** AP, AR, Budget form dialogs
**Action:** Integrate react-hook-form with shadcn `Form` components for consistent validation UX.

---

### FIX-39: No token refresh logic for expired sessions

**File:** `apps/web/lib/gl-api.ts`
**Action:** Add 401 response interceptor that triggers session refresh:

```ts
if (res.status === 401) {
  // Trigger NextAuth session refresh
  window.location.href = "/api/auth/signin";
  throw new Error("Session expired");
}
```

---

### FIX-40: Reports page refetch interval has no max duration

**File:** `apps/web/app/(dashboard)/reports/page.tsx` line ~130
**Bug:** 3000ms polling interval with no stop condition.
**Action:** Add `refetchInterval: (query) => query.state.data?.status === "COMPLETED" ? false : 3000`

---

## UNIMPLEMENTED FEATURES (Spec gaps — separate work items)

These are not bugs but missing features per the spec (`CaludeFinancePro.md`):

| Feature | Backend | Frontend | Priority |
|---------|---------|----------|----------|
| Journal approval workflow (ApprovalRule endpoints) | Missing API routes | No UI | P2 |
| USALI P&L report template | Missing `usali-pl.report.ts` | Stub page only | P2 |
| Balance Sheet report | Missing service | Stub page only | P2 |
| Cash Flow report | Missing service | Stub page only | P2 |
| Report PDF generation | `@react-pdf/renderer` installed, no service | — | P3 |
| AR dunning BullMQ jobs | Not implemented | — | P3 |
| Budget Excel import | No endpoint | No UI | P3 |
| Bank reconciliation matching engine | Models exist, no algorithm | No UI | P3 |
| FX revaluation (nightly scheduled job) | Not implemented | — | P3 |
| Dockerfiles for API and Web apps | Missing | — | P3 |
| Database setup automation (RLS, audit, indexes) | Scripts exist but not automated | — | P2 |

---

## CHECKLIST

- [ ] FIX-01: API base URL fallback
- [ ] FIX-02: Tailwind CSS variable syntax
- [ ] FIX-03: GL balance calculation
- [ ] FIX-04: Comparative period SQL
- [ ] FIX-05: Journal rejection balance reversal
- [ ] FIX-06: Email failure logging
- [ ] FIX-07: AR FX gain/loss handling
- [ ] FIX-08: Web dev port standardization
- [ ] FIX-09: .env.example API port
- [ ] FIX-10: Consolidation entity authorization
- [ ] FIX-11: AP payment file outside transaction
- [ ] FIX-12: Consolidation pagination
- [ ] FIX-13: N+1 journal query
- [ ] FIX-14: Audit page Tailwind rewrite
- [ ] FIX-15: Dashboard native select
- [ ] FIX-16: Periods page useApiContext
- [ ] FIX-17: Typed API responses
- [ ] FIX-18: Fastify bodyLimit
- [ ] FIX-19: Rate limiting
- [ ] FIX-20: Error boundaries
- [ ] FIX-21: Loading skeletons
- [ ] FIX-22: Mutation pending states
- [ ] FIX-23: Comparative period selector
- [ ] FIX-24: Dynamic entity list
- [ ] FIX-25: Accessibility attributes
- [ ] FIX-26: AccountPicker keyboard nav
- [ ] FIX-27: Shared number formatting
- [ ] FIX-28: Root tsconfig.json
- [ ] FIX-29: Prettier config
- [ ] FIX-30: ESLint config
- [ ] FIX-31: Prisma status enums
- [ ] FIX-32: Security headers
- [ ] FIX-33: Next.js auth middleware
- [ ] FIX-34: Husky pre-commit hooks
- [ ] FIX-35: bodyLimit (duplicate of 18)
- [ ] FIX-36: Shared requireEntityId
- [ ] FIX-37: Dashboard any types
- [ ] FIX-38: Form validation UI
- [ ] FIX-39: Token refresh logic
- [ ] FIX-40: Report polling max duration
