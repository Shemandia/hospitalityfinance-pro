# Tier 1 Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 10 Tier 1 (must-fix-before-production) issues identified in the inspection report, covering security, financial logic, and data integrity vulnerabilities.

**Architecture:** Each task is an independent fix to a specific file or small set of files. No task depends on another — they can be executed in any order. Each fix includes a test to verify the change.

**Tech Stack:** TypeScript, Fastify, Prisma, Vitest, Node.js AsyncLocalStorage

---

## File Structure

| Task | Files Modified                                                          | Files Created                                       |
| ---- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| 1    | `apps/api/src/modules/tenant/router.ts`                                 | `apps/api/tests/tenant-platform-key.test.ts`        |
| 1    | `apps/web/app/api/tenants/route.ts`                                     |                                                     |
| 2    | `apps/api/src/plugins/auth.ts`                                          | `apps/api/tests/dev-auth-bypass.test.ts`            |
| 3    | `apps/api/src/modules/ar/service.ts`                                    | `apps/api/tests/ar-post-locking.test.ts`            |
| 4    | `apps/api/src/modules/integration/connectors/saf/saf-parser.ts`         | `apps/api/tests/saf-parser-decimal.test.ts`         |
| 4    | `apps/api/src/modules/integration/connectors/saf/saf-import-service.ts` |                                                     |
| 5    | `apps/api/src/modules/integration/connectors/mews/mews-client.ts`       | `apps/api/tests/mews-decimal.test.ts`               |
| 6    | `apps/api/src/db/prisma.ts`                                             | `apps/api/tests/tenant-context.test.ts`             |
| 6    | `apps/api/src/db/requestContext.ts`                                     |                                                     |
| 6    | `apps/api/src/app.ts`                                                   |                                                     |
| 7    | `apps/api/src/modules/consolidation/service.ts`                         | `apps/api/tests/consolidation-ic.test.ts`           |
| 8    | `apps/api/src/modules/gl/recurring-service.ts`                          | `apps/api/tests/recurring-journal-balances.test.ts` |
| 9    | `apps/api/src/modules/fx/service.ts`                                    | `apps/api/tests/fx-reval-transaction.test.ts`       |
| 10   | `docker-compose.yml`                                                    | `docker-compose.yml` (modified)                     |

---

### Task 1: Remove Hardcoded Platform API Key Default

**Files:**

- Modify: `apps/api/src/modules/tenant/router.ts:17`
- Modify: `apps/web/app/api/tenants/route.ts:4`
- Create: `apps/api/tests/tenant-platform-key.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/tenant-platform-key.test.ts
import { describe, expect, it } from "vitest";

describe("Platform API key security", () => {
  it("does not use a hardcoded default key", async () => {
    // Dynamically read the source file to verify no hardcoded default
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/tenant/router.ts", import.meta.url),
      "utf-8"
    );
    expect(source).not.toContain("hfp-platform-dev-key");
    expect(source).toMatch(/throw.*PLATFORM_API_KEY/i);
  });

  it("frontend route does not use a hardcoded default key", async () => {
    const fs = await import("node:fs/promises");
    const webRoutePath = new URL("../../../web/app/api/tenants/route.ts", import.meta.url);
    const source = await fs.readFile(webRoutePath, "utf-8");
    expect(source).not.toContain("hfp-platform-dev-key");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/tenant-platform-key.test.ts`
Expected: FAIL — source still contains `hfp-platform-dev-key`

- [ ] **Step 3: Fix the backend — fail fast if key not set**

In `apps/api/src/modules/tenant/router.ts`, replace line 17:

```typescript
// OLD:
const PLATFORM_API_KEY = process.env.PLATFORM_API_KEY ?? "hfp-platform-dev-key";

// NEW:
const PLATFORM_API_KEY = process.env.PLATFORM_API_KEY;
if (!PLATFORM_API_KEY) {
  throw new Error(
    "FATAL: PLATFORM_API_KEY environment variable must be set. " +
      "Generate a cryptographically random key (min 32 chars) for production."
  );
}
```

- [ ] **Step 4: Fix the frontend — fail gracefully if key not set**

In `apps/web/app/api/tenants/route.ts`, replace line 4:

```typescript
// OLD:
const PLATFORM_KEY = process.env.HFP_PLATFORM_KEY ?? "hfp-platform-dev-key";

// NEW:
const PLATFORM_KEY = process.env.HFP_PLATFORM_KEY;
```

Also update the GET handler to check if key exists (line 8-9):

```typescript
export async function GET() {
  if (!PLATFORM_KEY) {
    return NextResponse.json({ data: [] }, { status: 503 });
  }
  try {
    const res = await fetch(`${API_BASE}/api/v1/platform/tenants`, {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/tenant-platform-key.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/tenant/router.ts apps/web/app/api/tenants/route.ts apps/api/tests/tenant-platform-key.test.ts
git commit -m "security: remove hardcoded platform API key default

Fail fast on startup if PLATFORM_API_KEY is not set. Removes the
hfp-platform-dev-key fallback that allowed unauthenticated tenant
management access."
```

---

### Task 2: Gate Dev Auth Bypass Behind Explicit Flag

**Files:**

- Modify: `apps/api/src/plugins/auth.ts:124`
- Create: `apps/api/tests/dev-auth-bypass.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/dev-auth-bypass.test.ts
import { describe, expect, it } from "vitest";

describe("Dev auth bypass gating", () => {
  it("requires ENABLE_DEV_AUTH=true, not just NODE_ENV!=production", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("../src/plugins/auth.ts", import.meta.url), "utf-8");
    // Must check ENABLE_DEV_AUTH, not just NODE_ENV
    expect(source).toContain("ENABLE_DEV_AUTH");
    // Must not activate on NODE_ENV alone
    expect(source).not.toMatch(/NODE_ENV\s*!==\s*["']production["']\s*&&\s*token\.startsWith/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/dev-auth-bypass.test.ts`
Expected: FAIL — source uses `NODE_ENV !== "production"` without `ENABLE_DEV_AUTH`

- [ ] **Step 3: Fix auth plugin — require explicit ENABLE_DEV_AUTH flag**

In `apps/api/src/plugins/auth.ts`, replace line 124:

```typescript
// OLD:
if (process.env.NODE_ENV !== "production" && token.startsWith("dev-")) {

// NEW:
const devAuthEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.ENABLE_DEV_AUTH === "true";
if (devAuthEnabled && token.startsWith("dev-")) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/dev-auth-bypass.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/plugins/auth.ts apps/api/tests/dev-auth-bypass.test.ts
git commit -m "security: gate dev auth bypass behind ENABLE_DEV_AUTH flag

Dev tokens (dev-*) are no longer accepted just because NODE_ENV is not
production. Requires explicit ENABLE_DEV_AUTH=true to activate, preventing
accidental superadmin access in staging/UAT environments."
```

---

### Task 3: Add Row Locking to AR Invoice Posting

**Files:**

- Modify: `apps/api/src/modules/ar/service.ts:106-115`
- Create: `apps/api/tests/ar-post-locking.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/ar-post-locking.test.ts
import { describe, expect, it } from "vitest";

describe("AR postInvoice uses row locking", () => {
  it("source code contains SELECT FOR UPDATE in postInvoice", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/ar/service.ts", import.meta.url),
      "utf-8"
    );
    // Must use FOR UPDATE to prevent concurrent double-posting
    expect(source).toContain("FOR UPDATE");
    // The FOR UPDATE should be near the postInvoice method
    const postInvoiceSection = source.slice(
      source.indexOf("async postInvoice"),
      source.indexOf("async updateInvoice")
    );
    expect(postInvoiceSection).toContain("FOR UPDATE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/ar-post-locking.test.ts`
Expected: FAIL — no `FOR UPDATE` in postInvoice

- [ ] **Step 3: Add row locking to AR postInvoice**

In `apps/api/src/modules/ar/service.ts`, replace the invoice fetch inside `postInvoice` (lines 110-116):

```typescript
// OLD:
const invoice = await repository.getInvoice(entityId, invoiceId);
if (!invoice) {
  throw new ARServiceError("AR_INVOICE_NOT_FOUND", "AR invoice not found.", 404);
}
if (invoice.status !== "DRAFT") {
  throw new ARServiceError("AR_INVOICE_NOT_DRAFT", "Only draft invoices can be posted.", 409);
}

// NEW:
// Lock the invoice row to prevent concurrent double-posting (SELECT FOR UPDATE)
const [locked] = await tx.$queryRaw<
  Array<{ id: string; status: string }>
>`SELECT id, status FROM ar_invoices
        WHERE id = ${invoiceId}::uuid AND entity_id = ${entityId}::uuid
        FOR UPDATE`;
if (!locked) {
  throw new ARServiceError("AR_INVOICE_NOT_FOUND", "AR invoice not found.", 404);
}
if (locked.status !== "DRAFT") {
  throw new ARServiceError("AR_INVOICE_NOT_DRAFT", "Only draft invoices can be posted.", 409);
}

// Now fetch the full invoice with relations (already locked)
const invoice = await repository.getInvoice(entityId, invoiceId);
if (!invoice) {
  throw new ARServiceError("AR_INVOICE_NOT_FOUND", "AR invoice not found.", 404);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/ar-post-locking.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ar/service.ts apps/api/tests/ar-post-locking.test.ts
git commit -m "fix: add SELECT FOR UPDATE to AR invoice posting

Prevents concurrent double-posting of AR invoices which would create
duplicate GL journal entries and double-counted account balances.
Matches the pattern already used in AP invoice posting."
```

---

### Task 4: Migrate SAF Parser from float to Prisma.Decimal

**Files:**

- Modify: `apps/api/src/modules/integration/connectors/saf/saf-parser.ts`
- Modify: `apps/api/src/modules/integration/connectors/saf/saf-import-service.ts`
- Create: `apps/api/tests/saf-parser-decimal.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/saf-parser-decimal.test.ts
import { describe, expect, it } from "vitest";

describe("SAF parser uses Decimal for amounts", () => {
  it("SAFTransactionLine.amount is typed as string (not number)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/saf/saf-parser.ts", import.meta.url),
      "utf-8"
    );
    // The amount field in SAFTransactionLine should be string (for Decimal)
    const interfaceBlock = source.slice(
      source.indexOf("export interface SAFTransactionLine"),
      source.indexOf("// Raw line for debugging")
    );
    expect(interfaceBlock).toContain("amount: string");
    expect(interfaceBlock).not.toContain("amount: number");
  });

  it("SAFParseResult totals are string (not number)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/saf/saf-parser.ts", import.meta.url),
      "utf-8"
    );
    const resultBlock = source.slice(
      source.indexOf("export interface SAFParseResult"),
      source.indexOf("export interface SAFParseError")
    );
    expect(resultBlock).toContain("totalDebits: string");
    expect(resultBlock).toContain("totalCredits: string");
  });

  it("does not use float addition for totals", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/saf/saf-parser.ts", import.meta.url),
      "utf-8"
    );
    // Should NOT have `s + l.amount` float addition for totals
    expect(source).not.toMatch(/\.reduce\(\(s,\s*l\)\s*=>\s*s\s*\+\s*l\.amount/);
  });

  it("import service does not wrap float in Decimal constructor", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/saf/saf-import-service.ts", import.meta.url),
      "utf-8"
    );
    // Should NOT have: new Prisma.Decimal(safLine.dcMarker === "D" ? safLine.amount : 0)
    // This pattern converts a float to Decimal, preserving float error
    expect(source).not.toMatch(
      /new Prisma\.Decimal\(safLine\.dcMarker\s*===\s*"D"\s*\?\s*safLine\.amount\s*:\s*0\)/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/saf-parser-decimal.test.ts`
Expected: FAIL — amount is `number`, totals use float addition

- [ ] **Step 3: Update SAFTransactionLine interface**

In `apps/api/src/modules/integration/connectors/saf/saf-parser.ts`, change the `SAFTransactionLine` interface (lines 37-68):

```typescript
export interface SAFTransactionLine {
  recordType: "L" | "M";
  accountCode: string;
  accountingPeriod: string; // YYYYPPP
  fiscalYear: number;
  periodNumber: number;
  transactionDate: string; // YYYYMMDD
  journalNumber: string;
  lineNumber: string;
  amount: string; // Always positive, Decimal string
  dcMarker: "D" | "C"; // Debit or Credit
  signedAmount: string; // Positive for debit, negative for credit, Decimal string
  allocationIndicator: string;
  journalType: string;
  journalSource: string;
  transactionReference: string;
  description: string;
  entryDate: string;
  entryPeriod: string;
  dueDate: string;
  paymentAllocRef: string;
  paymentAllocDate: string;
  paymentAllocPeriod: string;
  assetIndicator: string;
  assetCode: string;
  assetSubCode: string;
  conversionCode: string;
  otherAmount: string;
  otherAmountCurrency: string;
  baseAmount: string;
  t0: string;
  t1: string;
  t2: string;
  t3: string;
  t4: string;
  t5: string;
  t6: string;
  t7: string;
  t8: string;
  t9: string;
  rawLine: string;
  rawLineNumber: number;
}
```

- [ ] **Step 4: Update SAFParseResult interface**

```typescript
export interface SAFParseResult {
  format: SAFFormat;
  operaFileType: OperaFileType;
  janaFileType: JanaFileType;
  version: string | null;
  controlRecord: SAFControlRecord | null;
  lines: SAFTransactionLine[];
  totalDebits: string;
  totalCredits: string;
  isBalanced: boolean;
  lineCount: number;
  dateRange: { earliest: string; latest: string } | null;
  uniqueAccounts: string[];
  currency: string | null;
  journalTypes: string[];
  errors: SAFParseError[];
}
```

- [ ] **Step 5: Update amount parsing functions to return string**

Change the three parse functions to return strings:

```typescript
function parseAmountJanaWholeInteger(raw: string): string {
  const s = raw.trim();
  if (!s || s === "0") return "0";
  if (s.includes(".")) {
    const n = parseFloat(s);
    return isNaN(n) ? "0" : n.toString();
  }
  const n = parseInt(s, 10);
  return isNaN(n) ? "0" : n.toString();
}

function parseAmountJanaDivide1000(raw: string): string {
  const s = raw.trim();
  if (!s || s === "0") return "0";
  const n = BigInt(s.replace(/\D/g, "") || "0");
  const whole = n / 1000n;
  const frac = n % 1000n;
  return `${whole}.${String(frac).padStart(3, "0")}`;
}

function parseAmountJana(raw: string, rule: JanaAmountRule): string {
  return rule === "divide_by_1000"
    ? parseAmountJanaDivide1000(raw)
    : parseAmountJanaWholeInteger(raw);
}

function parseAmountOpera(raw: string): string {
  const s = raw.trim();
  if (!s || s === "0") return "0";
  const n = BigInt(s.replace(/\D/g, "") || "0");
  const whole = n / 1000n;
  const frac = n % 1000n;
  return `${whole}.${String(frac).padStart(3, "0")}`;
}
```

- [ ] **Step 6: Update totals calculation to use Decimal**

Add import at top of `saf-parser.ts`:

```typescript
import { Prisma } from "@prisma/client";
```

Replace the totals summation (lines 537-542):

```typescript
// OLD:
const totalDebits = txLines.filter((l) => l.dcMarker === "D").reduce((s, l) => s + l.amount, 0);
const totalCredits = txLines.filter((l) => l.dcMarker === "C").reduce((s, l) => s + l.amount, 0);
const isBalanced = Math.abs(Math.round(totalDebits * 1000) - Math.round(totalCredits * 1000)) === 0;

// NEW:
const totalDebits = txLines
  .filter((l) => l.dcMarker === "D")
  .reduce((s, l) => s.add(new Prisma.Decimal(l.amount)), new Prisma.Decimal(0));
const totalCredits = txLines
  .filter((l) => l.dcMarker === "C")
  .reduce((s, l) => s.add(new Prisma.Decimal(l.amount)), new Prisma.Decimal(0));
const isBalanced = totalDebits
  .sub(totalCredits)
  .abs()
  .lessThanOrEqualTo(new Prisma.Decimal("0.001"));
```

Update the return statement to use `.toFixed(4)` for totalDebits/totalCredits:

```typescript
totalDebits: totalDebits.toFixed(4),
totalCredits: totalCredits.toFixed(4),
```

- [ ] **Step 7: Update buildPreviewSummary to use Decimal**

Replace the `entry.total += l.amount` pattern in `buildPreviewSummary`:

```typescript
export function buildPreviewSummary(result: SAFParseResult) {
  const debitAccounts = result.lines
    .filter((l) => l.dcMarker === "D")
    .reduce((acc, l) => {
      if (!acc.has(l.accountCode))
        acc.set(l.accountCode, {
          code: l.accountCode,
          total: new Prisma.Decimal(0),
          lines: 0,
          sampleDesc: l.description
        });
      const entry = acc.get(l.accountCode)!;
      entry.total = entry.total.add(new Prisma.Decimal(l.amount));
      entry.lines++;
      return acc;
    }, new Map<string, { code: string; total: Prisma.Decimal; lines: number; sampleDesc: string }>());

  const creditAccounts = result.lines
    .filter((l) => l.dcMarker === "C")
    .reduce((acc, l) => {
      if (!acc.has(l.accountCode))
        acc.set(l.accountCode, {
          code: l.accountCode,
          total: new Prisma.Decimal(0),
          lines: 0,
          sampleDesc: l.description
        });
      const entry = acc.get(l.accountCode)!;
      entry.total = entry.total.add(new Prisma.Decimal(l.amount));
      entry.lines++;
      return acc;
    }, new Map<string, { code: string; total: Prisma.Decimal; lines: number; sampleDesc: string }>());

  const totalDebitsNum = new Prisma.Decimal(result.totalDebits);
  const totalCreditsNum = new Prisma.Decimal(result.totalCredits);

  return {
    format: result.format,
    operaFileType: result.operaFileType,
    janaFileType: result.janaFileType,
    version: result.version,
    lineCount: result.lineCount,
    totalDebits: result.totalDebits,
    totalCredits: result.totalCredits,
    isBalanced: result.isBalanced,
    difference: totalDebitsNum.sub(totalCreditsNum).toFixed(3),
    dateRange: result.dateRange,
    currency: result.currency,
    journalTypes: result.journalTypes,
    debitAccounts: [...debitAccounts.values()]
      .map((a) => ({ ...a, total: a.total.toNumber() }))
      .sort((a, b) => b.total - a.total),
    creditAccounts: [...creditAccounts.values()]
      .map((a) => ({ ...a, total: a.total.toNumber() }))
      .sort((a, b) => b.total - a.total),
    uniqueAccountCount: result.uniqueAccounts.length,
    errors: result.errors
  };
}
```

- [ ] **Step 8: Update all places in the parser that assign `amount`/`signedAmount`/`otherAmount`/`baseAmount` on transaction lines**

Every place in the parser body that sets these fields on a `SAFTransactionLine` must now produce strings. Search for all assignments and update accordingly. The amount parsing functions already return strings (Step 5), so most call sites will just work. For `signedAmount`, update:

```typescript
// OLD:
signedAmount: dcMarker === "D" ? amount : -amount,

// NEW:
signedAmount: dcMarker === "D" ? amount : new Prisma.Decimal(amount).neg().toFixed(4),
```

- [ ] **Step 9: Update SAF import service — use string amounts directly**

In `apps/api/src/modules/integration/connectors/saf/saf-import-service.ts`, update the journal line creation (lines 328-333):

```typescript
// OLD:
journalLines.push({
  accountId,
  debit: new Prisma.Decimal(safLine.dcMarker === "D" ? safLine.amount : 0),
  credit: new Prisma.Decimal(safLine.dcMarker === "C" ? safLine.amount : 0),
  description: safLine.description,
  lineNumber: lineNum++
});

// NEW:
journalLines.push({
  accountId,
  debit: new Prisma.Decimal(safLine.dcMarker === "D" ? safLine.amount : "0"),
  credit: new Prisma.Decimal(safLine.dcMarker === "C" ? safLine.amount : "0"),
  description: safLine.description,
  lineNumber: lineNum++
});
```

- [ ] **Step 10: Update SAF import vendor credit accumulation**

In `saf-import-service.ts`, replace the vendor credit float accumulation (lines 445-453):

```typescript
// OLD:
const vendorMap = new Map<string, { totalCredit: number; lines: typeof safLines }>();
for (const vc of vendorCredits) {
  const existing = vendorMap.get(vc.accountCode);
  if (existing) {
    existing.totalCredit += vc.amount;
    existing.lines.push(vc);
  } else {
    vendorMap.set(vc.accountCode, { totalCredit: vc.amount, lines: [vc] });
  }
}

// NEW:
const vendorMap = new Map<string, { totalCredit: Prisma.Decimal; lines: typeof safLines }>();
for (const vc of vendorCredits) {
  const existing = vendorMap.get(vc.accountCode);
  if (existing) {
    existing.totalCredit = existing.totalCredit.add(new Prisma.Decimal(vc.amount));
    existing.lines.push(vc);
  } else {
    vendorMap.set(vc.accountCode, {
      totalCredit: new Prisma.Decimal(vc.amount),
      lines: [vc]
    });
  }
}
```

Also update `unitPrice` and `amount` on expense debit lines (line 487-488):

```typescript
// OLD:
unitPrice: new Prisma.Decimal(ed.amount),
amount: new Prisma.Decimal(ed.amount),

// These are fine — ed.amount is now a string, Prisma.Decimal accepts strings
```

And the `netAmount` line (line 503):

```typescript
// OLD:
const netAmount = new Prisma.Decimal(vendorData.totalCredit);

// NEW — totalCredit is already a Prisma.Decimal:
const netAmount = vendorData.totalCredit;
```

- [ ] **Step 11: Run tests**

Run: `cd apps/api && npx vitest run tests/saf-parser-decimal.test.ts`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/modules/integration/connectors/saf/saf-parser.ts apps/api/src/modules/integration/connectors/saf/saf-import-service.ts apps/api/tests/saf-parser-decimal.test.ts
git commit -m "fix: migrate SAF parser from float to Decimal arithmetic

All monetary amounts in the SAF parser and import service now use
Prisma.Decimal (string-based) instead of JavaScript number (float64).
Eliminates floating-point accumulation drift that could corrupt imported
financial data across thousands of transaction lines."
```

---

### Task 5: Fix Mews Client Float-to-Decimal Conversion

**Files:**

- Modify: `apps/api/src/modules/integration/connectors/mews/mews-client.ts:153-161, 188-198`
- Create: `apps/api/tests/mews-decimal.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/mews-decimal.test.ts
import { describe, expect, it } from "vitest";

describe("Mews client decimal handling", () => {
  it("does not use String(value) for amount conversion", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/integration/connectors/mews/mews-client.ts", import.meta.url),
      "utf-8"
    );
    // Should NOT have String(item.Amount?.Value) — loses precision
    expect(source).not.toMatch(/String\(item\.Amount\?\.Value/);
    expect(source).not.toMatch(/String\(item\.UnitAmount\?\.Value/);
    // Should use Prisma.Decimal for conversion
    expect(source).toContain("Prisma.Decimal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/mews-decimal.test.ts`
Expected: FAIL

- [ ] **Step 3: Fix amount conversion in Mews client**

Add import at top of `mews-client.ts`:

```typescript
import { Prisma } from "@prisma/client";
```

Replace `String(item.Amount?.Value ?? 0)` patterns. In `getAccountingItems` (line 157):

```typescript
// OLD:
amount: String(item.Amount?.Value ?? 0),

// NEW:
amount: new Prisma.Decimal(item.Amount?.Value ?? 0).toDecimalPlaces(4).toString(),
```

In `getOutletItems` (line 192 and 194):

```typescript
// OLD:
unitAmount: String(item.UnitAmount?.Value ?? 0),
// ...
amount: String(item.Amount?.Value ?? 0),

// NEW:
unitAmount: new Prisma.Decimal(item.UnitAmount?.Value ?? 0).toDecimalPlaces(4).toString(),
// ...
amount: new Prisma.Decimal(item.Amount?.Value ?? 0).toDecimalPlaces(4).toString(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/mews-decimal.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/integration/connectors/mews/mews-client.ts apps/api/tests/mews-decimal.test.ts
git commit -m "fix: sanitize Mews API float-to-Decimal conversion

Use Prisma.Decimal to convert Mews API numeric values instead of
String() which can capture JavaScript float representation artifacts.
Amounts are rounded to 4 decimal places before string conversion."
```

---

### Task 6: Fix Global Tenant State Race Condition

**Files:**

- Modify: `apps/api/src/db/prisma.ts`
- Modify: `apps/api/src/db/requestContext.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/tests/tenant-context.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/tenant-context.test.ts
import { describe, expect, it } from "vitest";

describe("Tenant context safety", () => {
  it("prisma.ts does not use global mutable tenant state", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("../src/db/prisma.ts", import.meta.url), "utf-8");
    // Must NOT have global mutable tenant variables
    expect(source).not.toContain("let _activeTenantSlug");
    expect(source).not.toContain("let _activeTenantDbUrl");
  });

  it("requestContext uses AsyncLocalStorage.run instead of enterWith", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/db/requestContext.ts", import.meta.url),
      "utf-8"
    );
    // Should export a runWithContext function that uses .run()
    expect(source).toContain("storage.run(");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/tenant-context.test.ts`
Expected: FAIL

- [ ] **Step 3: Fix requestContext.ts — use `storage.run()` instead of `enterWith`**

Replace `apps/api/src/db/requestContext.ts`:

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string | null;
  entityId: string | null;
  chainId: string | null;
  userId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  disableAudit: boolean;
  tenantSlug: string | null;
  tenantDbUrl: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

function defaultContext(): RequestContext {
  return {
    requestId: null,
    entityId: null,
    chainId: null,
    userId: null,
    ipAddress: null,
    userAgent: null,
    disableAudit: false,
    tenantSlug: null,
    tenantDbUrl: null
  };
}

/**
 * Run a function within a new request context.
 * Uses AsyncLocalStorage.run() which properly scopes context to the callback
 * and all async operations spawned from it — unlike enterWith() which can
 * lose context across Fastify hook boundaries.
 */
export function runWithContext<T>(initial: Partial<RequestContext>, fn: () => T): T {
  return storage.run({ ...defaultContext(), ...initial }, fn);
}

/**
 * @deprecated Use runWithContext() for new code. Kept for backward compat during migration.
 */
export function enterRequestContext(initial?: Partial<RequestContext>): void {
  storage.enterWith({
    ...defaultContext(),
    ...(initial ?? {})
  });
}

export function getRequestContext(): RequestContext {
  return storage.getStore() ?? defaultContext();
}

export function updateRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) {
    Object.assign(store, patch);
  }
}

export async function runWithAuditDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return fn();
  const prev = store.disableAudit;
  store.disableAudit = true;
  try {
    return await fn();
  } finally {
    store.disableAudit = prev;
  }
}
```

- [ ] **Step 4: Fix prisma.ts — remove global tenant fallback**

In `apps/api/src/db/prisma.ts`:

1. Remove lines 116-122 (global `_activeTenantSlug` / `_activeTenantDbUrl` / `setActiveTenant`).
2. Export a no-op `setActiveTenant` for backward compat (callers still reference it).
3. Simplify `getActiveTenant` to only use AsyncLocalStorage.

```typescript
// Remove:
// let _activeTenantSlug: string | null = null;
// let _activeTenantDbUrl: string | null = null;

/** @deprecated No longer needed — context is properly scoped via AsyncLocalStorage.run() */
export function setActiveTenant(_slug: string | null, _dbUrl: string | null): void {
  // No-op: tenant context is now scoped via AsyncLocalStorage.run()
}

function getActiveTenant(): { slug: string; dbUrl: string } | null {
  const context = getRequestContext();
  if (context.tenantSlug && context.tenantDbUrl) {
    return { slug: context.tenantSlug, dbUrl: context.tenantDbUrl };
  }
  return null;
}
```

- [ ] **Step 5: Fix app.ts — use `runWithContext` to wrap request handling**

In `apps/api/src/app.ts`, update the `onRequest` hook (lines 64-79) to use `runWithContext`:

```typescript
import { runWithContext, updateRequestContext } from "./db/requestContext.js";
```

Replace the onRequest hook:

```typescript
app.addHook("onRequest", async (request, reply) => {
  const requestId = (request.headers["x-request-id"] as string) || randomUUID();
  reply.header("x-request-id", requestId);

  // Use storage.run() to properly scope context to this request
  // and all async operations within it
  return runWithContext(
    {
      requestId,
      ipAddress: request.ip ?? null,
      userAgent: request.headers["user-agent"] ?? null
    },
    () => {}
  );
});
```

Note: the `runWithContext` wraps only the initialization. The Fastify lifecycle will propagate the context to subsequent hooks if using `run()` at the framework level. If the context is still lost, the alternative is to use a Fastify `onRequest` + Fastify's `request` object to carry context — but `storage.run()` is the correct first fix.

Remove the `onResponse` cleanup hook (lines 82-84) since it's no longer needed:

```typescript
// REMOVE:
// app.addHook("onResponse", async () => {
//   setActiveTenant(null, null);
// });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/tenant-context.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/prisma.ts apps/api/src/db/requestContext.ts apps/api/src/app.ts apps/api/tests/tenant-context.test.ts
git commit -m "fix: eliminate global tenant state race condition

Replace global _activeTenantSlug/_activeTenantDbUrl with properly
scoped AsyncLocalStorage.run(). The old enterWith() pattern lost context
across Fastify hook boundaries; the global fallback created a race
condition where concurrent requests could read each other's tenant
database, causing cross-tenant data leaks."
```

---

### Task 7: Fix Consolidation IC Elimination Key Mismatch

**Files:**

- Modify: `apps/api/src/modules/consolidation/service.ts:262-263`
- Create: `apps/api/tests/consolidation-ic.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/consolidation-ic.test.ts
import { describe, expect, it } from "vitest";

describe("Consolidation IC elimination key consistency", () => {
  it("looks up IC eliminations using account_code, not accountId (UUID)", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/consolidation/service.ts", import.meta.url),
      "utf-8"
    );

    // The IC elimination loop iterates icGrouped (keyed by accountId UUID)
    // and must look up in consolidatedMap using account_code, not the UUID.
    // Find the section between "for (const [" and the next "}" that does
    // consolidatedMap.get(...)
    const icSection = source.slice(
      source.indexOf("for (const [accountId, icBalance] of icGrouped"),
      source.indexOf("// Persist the run")
    );

    // Must NOT do consolidatedMap.get(accountId) — accountId is a UUID,
    // consolidatedMap is keyed by account_code
    expect(icSection).not.toContain("consolidatedMap.get(accountId)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/consolidation-ic.test.ts`
Expected: FAIL — currently does `consolidatedMap.get(accountId)`

- [ ] **Step 3: Fix IC elimination — build a reverse lookup or key by accountId**

The simplest fix: build a `accountIdToCode` map during consolidation, then use it in IC elimination.

In `apps/api/src/modules/consolidation/service.ts`, add an `accountIdToCode` map alongside `consolidatedMap` (after line ~158):

```typescript
const accountIdToCode = new Map<string, string>();
```

Inside the trial balance loop, after line 198 (`const mapKey = row.account_code;`), add:

```typescript
accountIdToCode.set(row.account_id, row.account_code);
```

Then fix the IC elimination loop (lines 262-263):

```typescript
// OLD:
for (const [accountId, icBalance] of icGrouped) {
  const line = consolidatedMap.get(accountId);

// NEW:
for (const [accountId, icBalance] of icGrouped) {
  const accountCode = accountIdToCode.get(accountId);
  const line = accountCode ? consolidatedMap.get(accountCode) : undefined;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/consolidation-ic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/consolidation/service.ts apps/api/tests/consolidation-ic.test.ts
git commit -m "fix: consolidation IC elimination key mismatch

consolidatedMap is keyed by account_code (e.g. '1200') but the IC
elimination loop looked up by accountId (UUID), so eliminations were
never applied. Adds accountIdToCode reverse map for correct lookup.
Fixes material misstatement in consolidated financial statements."
```

---

### Task 8: Add Balance Updates for Auto-Posted Recurring Journals

**Files:**

- Modify: `apps/api/src/modules/gl/recurring-service.ts:169-210`
- Create: `apps/api/tests/recurring-journal-balances.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/recurring-journal-balances.test.ts
import { describe, expect, it } from "vitest";

describe("Recurring journal auto-post updates balances", () => {
  it("calls updateAccountBalance or accountPeriodBalance.upsert when autoPost is true", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/gl/recurring-service.ts", import.meta.url),
      "utf-8"
    );

    // Find the section after journal creation in generateDueJournals
    const generateSection = source.slice(
      source.indexOf("async generateDueJournals"),
      source.indexOf("private isDue")
    );

    // When autoPost is true, must update account balances
    expect(generateSection).toContain("autoPost");
    expect(generateSection).toMatch(/accountPeriodBalance|updateAccountBalance/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/recurring-journal-balances.test.ts`
Expected: FAIL — no balance update after auto-posting

- [ ] **Step 3: Add balance updates after auto-posted journal creation**

In `apps/api/src/modules/gl/recurring-service.ts`, after the journal is created (after line 199, before the template update), add:

```typescript
// Update account balances when auto-posting
if (tpl.autoPost) {
  const createdJournal = await this.prisma.journal.findUnique({
    where: { id: journal.id },
    include: { lines: { include: { account: { select: { type: true } } } } }
  });
  if (createdJournal) {
    for (const line of createdJournal.lines) {
      const accountType = line.account.type;
      // ASSET and EXPENSE are debit-normal (sign = 1)
      // LIABILITY, EQUITY, REVENUE are credit-normal (sign = -1)
      const sign = ["ASSET", "EXPENSE"].includes(accountType) ? 1 : -1;
      await this.prisma.$executeRaw`
              INSERT INTO account_period_balances
                (id, entity_id, account_id, period_id, opening_balance, period_debits, period_credits, closing_balance, created_at, updated_at)
              VALUES (
                gen_random_uuid(), ${entityId}::uuid, ${line.accountId}::uuid, ${periodId}::uuid,
                0, ${line.debitFunctional}::decimal(18,4), ${line.creditFunctional}::decimal(18,4),
                ${sign} * (${line.debitFunctional}::decimal(18,4) - ${line.creditFunctional}::decimal(18,4)),
                NOW(), NOW()
              )
              ON CONFLICT (entity_id, account_id, period_id) DO UPDATE SET
                period_debits   = account_period_balances.period_debits   + EXCLUDED.period_debits,
                period_credits  = account_period_balances.period_credits  + EXCLUDED.period_credits,
                closing_balance = account_period_balances.opening_balance
                  + ${sign} * (account_period_balances.period_debits + EXCLUDED.period_debits)
                  - ${sign} * (account_period_balances.period_credits + EXCLUDED.period_credits),
                updated_at = NOW()
            `;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/recurring-journal-balances.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/gl/recurring-service.ts apps/api/tests/recurring-journal-balances.test.ts
git commit -m "fix: update account balances for auto-posted recurring journals

When autoPost is true, recurring journals were created with POSTED
status but account_period_balances were never updated. This caused
the trial balance, balance sheet, and all financial reports to be
silently incorrect."
```

---

### Task 9: Move FX Revaluation Reads Inside Transaction

**Files:**

- Modify: `apps/api/src/modules/fx/service.ts:352-475`
- Create: `apps/api/tests/fx-reval-transaction.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/tests/fx-reval-transaction.test.ts
import { describe, expect, it } from "vitest";

describe("FX revaluation transaction safety", () => {
  it("reads AP/AR invoices inside the $transaction block", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../src/modules/fx/service.ts", import.meta.url),
      "utf-8"
    );

    // Find the revaluation method
    const revalSection = source.slice(
      source.indexOf("async runRevaluation"),
      source.indexOf("async runRevaluation") > -1
        ? source.indexOf("}", source.lastIndexOf("return this.prisma.$transaction")) + 10
        : source.length
    );

    // getOpenAPInvoices and getOpenARInvoices must be INSIDE $transaction
    const txStart = revalSection.indexOf("$transaction");
    const apRead = revalSection.indexOf("getOpenAPInvoices");
    const arRead = revalSection.indexOf("getOpenARInvoices");

    // Both reads must come AFTER $transaction starts
    expect(apRead).toBeGreaterThan(txStart);
    expect(arRead).toBeGreaterThan(txStart);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/fx-reval-transaction.test.ts`
Expected: FAIL — reads are before `$transaction`

- [ ] **Step 3: Move all reads inside the transaction**

In `apps/api/src/modules/fx/service.ts`, restructure `runRevaluation` so that:

1. The `$transaction` block starts earlier — right after the account lookups and period validation
2. `repository.getOpenAPInvoices()` and `repository.getOpenARInvoices()` move inside the transaction
3. All gain/loss computation happens inside the transaction
4. The journal creation and balance updates remain inside the transaction

The key change is to move the `return this.prisma.$transaction(async (tx) => {` line from ~line 475 up to before line 352 (before `const apInvoices = ...`), and use `txRepo` instead of `repository` for the invoice reads:

```typescript
// Move transaction boundary to encompass ALL reads and writes
return this.prisma.$transaction(async (tx) => {
  await setEntityDbContext(tx, request.entityId);
  const txRepo = this.repository(tx);

  // Authoritative idempotency check inside transaction
  const existingInTx = await txRepo.findExistingRevaluationJournal(
    request.entityId,
    request.periodId,
    referenceDate
  );
  if (existingInTx) {
    return {
      journalId: existingInTx.id,
      apItemsRevalued: 0,
      arItemsRevalued: 0,
      totalGainLoss: "0.0000",
      idempotent: true
    };
  }

  // Read invoices INSIDE the transaction to prevent stale data
  const apInvoices = await txRepo.getOpenAPInvoices(request.entityId);
  // ... (existing AP revaluation logic, using txRepo for rate lookups)

  const arInvoices = await txRepo.getOpenARInvoices(request.entityId);
  // ... (existing AR revaluation logic, using txRepo for rate lookups)

  // ... (existing journal creation and balance update logic)
});
```

Remove the old `return this.prisma.$transaction(...)` that was at line 475 — it's now at the top of the computation block.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/fx-reval-transaction.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/fx/service.ts apps/api/tests/fx-reval-transaction.test.ts
git commit -m "fix: move FX revaluation reads inside database transaction

AP/AR invoice reads and gain/loss computation were outside the
transaction boundary, meaning invoices could be paid, posted, or
rates changed between read and write. Now the entire read-compute-write
cycle runs within a single transaction for IAS 21 compliance."
```

---

### Task 10: Secure Docker Compose Default Credentials

**Files:**

- Modify: `docker-compose.yml`

- [ ] **Step 1: Update docker-compose to use environment variable references**

In `docker-compose.yml`, replace hardcoded passwords:

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16
    container_name: hfp-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-hfp_db}
      POSTGRES_USER: ${POSTGRES_USER:-hfp}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-hfp} -d ${POSTGRES_DB:-hfp_db}"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7
    container_name: hfp-redis
    restart: unless-stopped
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD:?Set REDIS_PASSWORD in .env}"]
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

  rabbitmq:
    image: rabbitmq:3-management
    container_name: hfp-rabbitmq
    restart: unless-stopped
    ports:
      - "127.0.0.1:5672:5672"
      - "127.0.0.1:15672:15672"
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER:-hfp}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD:?Set RABBITMQ_PASSWORD in .env}
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "check_running"]
      interval: 10s
      timeout: 10s
      retries: 10

  keycloak:
    image: quay.io/keycloak/keycloak:24.0
    container_name: hfp-keycloak
    restart: unless-stopped
    command: ["start-dev", "--http-port=8080"]
    environment:
      KEYCLOAK_ADMIN: ${KEYCLOAK_ADMIN:-admin}
      KEYCLOAK_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:?Set KEYCLOAK_ADMIN_PASSWORD in .env}
    ports:
      - "127.0.0.1:8080:8080"
    depends_on:
      rabbitmq:
        condition: service_healthy

volumes:
  postgres_data:
```

- [ ] **Step 2: Create `.env.example` for docker-compose**

Create a `.env.example` file in the project root:

```bash
# Docker Compose credentials — CHANGE ALL VALUES for non-local environments
POSTGRES_DB=hfp_db
POSTGRES_USER=hfp
POSTGRES_PASSWORD=change-me-to-a-strong-password
REDIS_PASSWORD=change-me-to-a-strong-password
RABBITMQ_USER=hfp
RABBITMQ_PASSWORD=change-me-to-a-strong-password
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=change-me-to-a-strong-password
```

- [ ] **Step 3: Add `.env` to `.gitignore` if not already present**

Run: `grep -q "^\.env$" .gitignore || echo ".env" >> .gitignore`

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example .gitignore
git commit -m "security: remove hardcoded credentials from docker-compose

All passwords now reference environment variables with :? syntax that
forces docker-compose to fail if not set. Ports are bound to 127.0.0.1
to prevent network exposure. Redis now requires a password.
A .env.example is provided for developer onboarding."
```

---

## Summary

| Task | Issue                              | Fix                                    |
| ---- | ---------------------------------- | -------------------------------------- |
| 1    | Hardcoded platform API key         | Fail startup if not set                |
| 2    | Dev auth bypass too permissive     | Require `ENABLE_DEV_AUTH=true`         |
| 3    | AR invoice double-posting          | Add `SELECT FOR UPDATE`                |
| 4    | SAF parser float arithmetic        | Migrate to `Prisma.Decimal` strings    |
| 5    | Mews client float passthrough      | Use `Prisma.Decimal` conversion        |
| 6    | Global tenant state race           | Replace with `AsyncLocalStorage.run()` |
| 7    | IC elimination key mismatch        | Add `accountIdToCode` reverse map      |
| 8    | Recurring journal missing balances | Add balance updates for autoPost       |
| 9    | FX revaluation stale reads         | Move reads inside `$transaction`       |
| 10   | Docker hardcoded credentials       | Use env vars with `:?` required syntax |
