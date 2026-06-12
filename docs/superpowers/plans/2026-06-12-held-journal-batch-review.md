# Held-Journal Batch Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Interactive Transfer Desk `GL_JOURNAL` imports stage a reviewable batch of held journals; a reviewer rejects/excludes individual journals, then commits the rest through the existing hardened GL posting path.

**Architecture:** Staging-then-materialize — imports write `TransferBatch` + `TransferBatchItem` rows (the mapped `JournalCreateInput` as JSONB) instead of journals. Nothing reaches the `journals` table until commit, which calls `GLService.createJournal` (→ `PENDING_APPROVAL` per rules, or `DRAFT` then `postJournal`). Scheduled/automation imports bypass review (`AUTO_COMMIT`). Full design: `docs/superpowers/specs/2026-06-12-held-journal-batch-review-design.md`.

**Tech Stack:** Fastify 4, Prisma (tenant schema `schema-tenant.prisma`), Prisma.Decimal, vitest (hand-rolled mock-prisma), Next.js (web).

**Repo root for all paths/commands:** `D:\FINANCIAL PROJECT\HospitalityFinance\hospitalityfinance-pro`

---

## Ground rules for the executor

- Working tree has **large pre-existing drift**. NEVER `git add -A`/`git add .`. Stage only the files named in each task.
- Branch first: `git switch -c feat/held-journal-batch-review` (from `main`; dirty tree carries over — fine).
- **Pre-commit hook runs `prettier --check`.** Before every commit: `pnpm exec prettier --write <files you staged>`, or the commit fails silently. (`.prettierignore` already excludes `pnpm-lock.yaml`.)
- API tests run from `apps/api`: `npx vitest run tests/<file>.test.ts`. Typecheck: `cd apps/api && npx tsc --noEmit`.
- Mock-prisma convention: a `mockPrisma` object with `$transaction: vi.fn().mockImplementation(async (fn) => fn(mockPrisma))` so the tx client _is_ the mock. Spy on service prototypes for cross-service calls:
  ```ts
  import { GLService } from "../src/modules/gl/service.js";
  vi.spyOn(GLService.prototype, "createJournal").mockResolvedValue({
    id: "j1",
    status: "DRAFT"
  } as any);
  vi.spyOn(GLService.prototype, "postJournal").mockResolvedValue({
    id: "j1",
    status: "POSTED"
  } as any);
  ```
- The tenant Prisma client is generated to `apps/api/src/db/generated/tenant` and re-exported from `apps/api/src/db/client.ts`. Import `Prisma`/types from `../../db/client.js`.

---

### Task 1: Schema — batch tables, enums, profile reviewMode

**Files:**

- Modify: `apps/api/src/db/schema-tenant.prisma`

This task has no unit test (schema). Verification is a clean client regen + typecheck.

- [ ] **Step 1: Add the enums**

In `apps/api/src/db/schema-tenant.prisma`, near the other enums (e.g. just after `enum JournalStatus { ... }`), add:

```prisma
enum TransferBatchStatus {
  PENDING_REVIEW
  COMMITTED
  DISCARDED
}

enum TransferBatchItemStatus {
  HELD
  COMMITTED
  REJECTED
  ERROR
}

enum TransferValidationStatus {
  OK
  WARNING
  ERROR
}

enum TransferReviewMode {
  HOLD
  AUTO_COMMIT
}
```

- [ ] **Step 2: Add the two models**

Add near the other `transfer_*` models:

```prisma
model TransferBatch {
  id              String              @id @default(uuid())
  entityId        String              @map("entity_id")
  profileId       String              @map("profile_id")
  executionId     String              @map("execution_id")
  targetComponent String              @map("target_component")
  status          TransferBatchStatus @default(PENDING_REVIEW)
  totalItems      Int                 @default(0) @map("total_items")
  heldItems       Int                 @default(0) @map("held_items")
  rejectedItems   Int                 @default(0) @map("rejected_items")
  committedItems  Int                 @default(0) @map("committed_items")
  errorItems      Int                 @default(0) @map("error_items")
  createdById     String              @map("created_by")
  createdAt       DateTime            @default(now()) @map("created_at")
  reviewedById    String?             @map("reviewed_by")
  committedAt     DateTime?           @map("committed_at")

  items TransferBatchItem[]

  @@index([entityId, status])
  @@index([profileId])
  @@map("transfer_batches")
}

model TransferBatchItem {
  id                  String                   @id @default(uuid())
  batchId             String                   @map("batch_id")
  itemIndex           Int                      @map("item_index")
  status              TransferBatchItemStatus  @default(HELD)
  targetComponent     String                   @map("target_component")
  payload             Json
  sourceRecordIndices Int[]                    @map("source_record_indices")
  validationStatus    TransferValidationStatus @default(OK) @map("validation_status")
  validationMessages  Json?                    @map("validation_messages")
  resultJournalId     String?                  @map("result_journal_id")
  rejectedReason      String?                  @map("rejected_reason")
  createdAt           DateTime                 @default(now()) @map("created_at")

  batch TransferBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@index([batchId, status])
  @@map("transfer_batch_items")
}
```

- [ ] **Step 3: Add `reviewMode` to `TransferProfile`**

In `model TransferProfile`, add this field (anywhere among the scalars, e.g. after `savePayload`):

```prisma
  reviewMode       TransferReviewMode @default(HOLD) @map("review_mode")
```

- [ ] **Step 4: Regenerate the tenant client + create the migration**

Run: `cd apps/api && pnpm run db:generate:tenant`
Expected: "Generated Prisma Client" with no errors.

Then create the migration (requires a reachable dev DB + shadow DB):
Run: `cd apps/api && npx prisma migrate dev --schema src/db/schema-tenant.prisma --name held_journal_batches`
Expected: a new folder under `apps/api/prisma/migrations/` (or the configured migrations dir) with the `CREATE TABLE transfer_batches`/`transfer_batch_items` SQL.

> If no dev DB is reachable in this environment: `db:generate:tenant` alone regenerates the client types (all that the mock-based tests need). Note in the commit that the SQL migration must be generated against a real DB before deploy. Do NOT hand-write the migration SQL unless you verify it against the generator output.

- [ ] **Step 5: Verify typecheck still clean**

Run: `cd apps/api && npx tsc --noEmit`
Expected: exit 0 (the new models/enums are now on the generated client).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema-tenant.prisma apps/api/src/db/generated/tenant
# include the migration dir if one was generated:
# git add apps/api/prisma/migrations
git commit -m "feat(transfer-desk): schema for held-journal batches + profile reviewMode"
```

---

### Task 2: Batch stager — map + validate staged items (pure, TDD)

**Files:**

- Create: `apps/api/src/jobs/transfer-desk-batch-stager.ts`
- Test: `apps/api/tests/transfer-desk-batch-stager.test.ts`

Pure functions: given the mapped journals and pre-fetched validation context (valid account keys, period statuses), produce staged items with `validationStatus`. Also a pure `resolveReviewMode`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/transfer-desk-batch-stager.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  stageJournalItems,
  resolveReviewMode,
  type StageContext
} from "../src/jobs/transfer-desk-batch-stager.js";
import type { MappedJournal } from "../src/jobs/transfer-desk-record-mapper.js";

function journal(
  lines: Array<{ accountId: string; debit: string; credit: string; fxRate?: string }>
): MappedJournal {
  return {
    entityId: "e1",
    sourceIndices: [0],
    input: {
      periodId: "p1",
      source: "IMPORT",
      functionalCurrency: "USD",
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        currency: "USD",
        fxRate: l.fxRate ?? "1"
      }))
    } as any
  };
}

const ctx: StageContext = {
  validAccountKeys: new Set(["1000", "2000"]),
  periodStatusById: new Map([["p1", "OPEN"]])
};

describe("stageJournalItems", () => {
  it("marks a balanced, valid journal OK/HELD", () => {
    const items = stageJournalItems(
      [
        journal([
          { accountId: "1000", debit: "100", credit: "0" },
          { accountId: "2000", debit: "0", credit: "100" }
        ])
      ],
      ctx
    );
    expect(items[0].validationStatus).toBe("OK");
    expect(items[0].status).toBe("HELD");
    expect(items[0].itemIndex).toBe(0);
    expect(items[0].sourceRecordIndices).toEqual([0]);
  });

  it("flags an unbalanced functional journal as ERROR (uses debit*fxRate)", () => {
    // DR 100 @1.10 = 110 functional; CR 100 @1.05 = 105 functional → out by 5
    const items = stageJournalItems(
      [
        journal([
          { accountId: "1000", debit: "100", credit: "0", fxRate: "1.10" },
          { accountId: "2000", debit: "0", credit: "100", fxRate: "1.05" }
        ])
      ],
      ctx
    );
    expect(items[0].validationStatus).toBe("ERROR");
    expect(items[0].status).toBe("ERROR");
    expect(items[0].validationMessages.some((m) => m.code === "UNBALANCED_FUNCTIONAL")).toBe(true);
  });

  it("flags a missing account as ERROR", () => {
    const items = stageJournalItems(
      [
        journal([
          { accountId: "9999", debit: "100", credit: "0" },
          { accountId: "2000", debit: "0", credit: "100" }
        ])
      ],
      ctx
    );
    expect(items[0].validationStatus).toBe("ERROR");
    expect(items[0].validationMessages.some((m) => m.code === "ACCOUNT_NOT_FOUND")).toBe(true);
  });

  it("flags a closed/unknown period as WARNING but keeps the item HELD", () => {
    const closedCtx: StageContext = {
      validAccountKeys: new Set(["1000", "2000"]),
      periodStatusById: new Map([["p1", "CLOSED"]])
    };
    const items = stageJournalItems(
      [
        journal([
          { accountId: "1000", debit: "100", credit: "0" },
          { accountId: "2000", debit: "0", credit: "100" }
        ])
      ],
      closedCtx
    );
    expect(items[0].validationStatus).toBe("WARNING");
    expect(items[0].status).toBe("HELD");
  });
});

describe("resolveReviewMode", () => {
  it("forces AUTO_COMMIT for automation executions", () => {
    expect(resolveReviewMode("HOLD", { automationId: "a1", triggeredBy: "u1" })).toBe(
      "AUTO_COMMIT"
    );
  });
  it("forces AUTO_COMMIT when triggered by the scheduler", () => {
    expect(resolveReviewMode("HOLD", { automationId: null, triggeredBy: "scheduler" })).toBe(
      "AUTO_COMMIT"
    );
  });
  it("honors HOLD for interactive runs", () => {
    expect(resolveReviewMode("HOLD", { automationId: null, triggeredBy: "u1" })).toBe("HOLD");
  });
  it("honors AUTO_COMMIT profile setting for interactive runs", () => {
    expect(resolveReviewMode("AUTO_COMMIT", { automationId: null, triggeredBy: "u1" })).toBe(
      "AUTO_COMMIT"
    );
  });
  it("defaults missing profile mode to HOLD for interactive runs", () => {
    expect(resolveReviewMode(null, { automationId: null, triggeredBy: "u1" })).toBe("HOLD");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/transfer-desk-batch-stager.test.ts`
Expected: FAIL — module not found / exports missing.

- [ ] **Step 3: Implement the stager**

Create `apps/api/src/jobs/transfer-desk-batch-stager.ts`:

```ts
/**
 * Transfer Desk — held-batch staging.
 *
 * Pure helpers: turn mapped journals into staged batch items with
 * stage-time validation, and resolve the effective review mode.
 */

import { Prisma } from "../db/client.js";
import type { MappedJournal } from "./transfer-desk-record-mapper.js";
import type { JournalCreateInput } from "../modules/gl/types.js";

const D = (v: unknown): Prisma.Decimal => new Prisma.Decimal(String(v ?? 0));

export type ValidationMessage = {
  code: string;
  severity: "WARNING" | "ERROR";
  message: string;
  line?: number;
};

export type StagedItem = {
  itemIndex: number;
  targetComponent: "GL_JOURNAL";
  payload: JournalCreateInput;
  sourceRecordIndices: number[];
  status: "HELD" | "ERROR";
  validationStatus: "OK" | "WARNING" | "ERROR";
  validationMessages: ValidationMessage[];
};

export type StageContext = {
  /** Valid account identifiers — contains BOTH account ids and codes for active accounts. */
  validAccountKeys: Set<string>;
  /** periodId → status (e.g. "OPEN", "CLOSED"). */
  periodStatusById: Map<string, string>;
};

function validateJournal(input: JournalCreateInput, ctx: StageContext): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  // 1. Account existence (per line)
  input.lines.forEach((line, i) => {
    const key = String((line as any).accountId ?? (line as any).accountCode ?? "");
    if (!key || !ctx.validAccountKeys.has(key)) {
      messages.push({
        code: "ACCOUNT_NOT_FOUND",
        severity: "ERROR",
        message: `Line ${i + 1}: account "${key}" not found or inactive in entity.`,
        line: i + 1
      });
    }
  });

  // 2. Functional balance (debit*fxRate vs credit*fxRate)
  let drFunc = D(0);
  let crFunc = D(0);
  for (const line of input.lines) {
    const rate = D((line as any).fxRate ?? 1);
    drFunc = drFunc.add(D((line as any).debit).mul(rate));
    crFunc = crFunc.add(D((line as any).credit).mul(rate));
  }
  if (!drFunc.toDecimalPlaces(4).equals(crFunc.toDecimalPlaces(4))) {
    messages.push({
      code: "UNBALANCED_FUNCTIONAL",
      severity: "ERROR",
      message: `Journal does not balance in functional currency (DR ${drFunc.toFixed(4)} vs CR ${crFunc.toFixed(4)}).`
    });
  }

  // 3. Period open (WARNING — commit may still DRAFT it)
  const status = ctx.periodStatusById.get(input.periodId);
  if (!status) {
    messages.push({
      code: "PERIOD_NOT_FOUND",
      severity: "WARNING",
      message: `Period "${input.periodId}" not found.`
    });
  } else if (status !== "OPEN") {
    messages.push({
      code: "PERIOD_NOT_OPEN",
      severity: "WARNING",
      message: `Period is ${status}, not OPEN.`
    });
  }

  return messages;
}

function worstSeverity(messages: ValidationMessage[]): "OK" | "WARNING" | "ERROR" {
  if (messages.some((m) => m.severity === "ERROR")) return "ERROR";
  if (messages.some((m) => m.severity === "WARNING")) return "WARNING";
  return "OK";
}

export function stageJournalItems(journals: MappedJournal[], ctx: StageContext): StagedItem[] {
  return journals.map((journal, itemIndex) => {
    const messages = validateJournal(journal.input, ctx);
    const validationStatus = worstSeverity(messages);
    return {
      itemIndex,
      targetComponent: "GL_JOURNAL",
      payload: journal.input,
      sourceRecordIndices: journal.sourceIndices,
      status: validationStatus === "ERROR" ? "ERROR" : "HELD",
      validationStatus,
      validationMessages: messages
    };
  });
}

export function resolveReviewMode(
  profileReviewMode: string | null | undefined,
  execution: { automationId: string | null; triggeredBy: string | null }
): "HOLD" | "AUTO_COMMIT" {
  const scheduled = Boolean(execution.automationId) || execution.triggeredBy === "scheduler";
  if (scheduled) return "AUTO_COMMIT";
  return profileReviewMode === "AUTO_COMMIT" ? "AUTO_COMMIT" : "HOLD";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/transfer-desk-batch-stager.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jobs/transfer-desk-batch-stager.ts apps/api/tests/transfer-desk-batch-stager.test.ts
git commit -m "feat(transfer-desk): batch stager — stage-time validation + reviewMode resolution"
```

---

### Task 3: Pipeline — branch HOLD vs AUTO_COMMIT and persist the batch

**Files:**

- Modify: `apps/api/src/jobs/transfer-desk-pipeline.ts` (add `reviewMode` to `ProfileWithRelations`; new HOLD branch in `executeImport`; add `PipelineDb` members)
- Test: `apps/api/tests/transfer-desk-batch-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/transfer-desk-batch-pipeline.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const createJournalMock = vi.fn().mockResolvedValue({ id: "j1", status: "DRAFT" });
vi.mock("../src/modules/gl/service.js", () => ({
  GLService: class {
    createJournal = createJournalMock;
    postJournal = vi.fn().mockResolvedValue({ id: "j1", status: "POSTED" });
  }
}));
vi.mock("../src/modules/ap/service.js", () => ({
  APService: class {
    createInvoice = vi.fn();
  }
}));
vi.mock("../src/modules/ar/service.js", () => ({
  ARService: class {
    createInvoice = vi.fn();
  }
}));
vi.mock("../src/modules/allocation/service.js", () => ({ AllocationService: class {} }));
vi.mock("../src/modules/fixed-asset/service.js", () => ({ FixedAssetService: class {} }));

import {
  executeImport,
  type ProfileWithRelations,
  type PipelineContext
} from "../src/jobs/transfer-desk-pipeline.js";

const FSD = JSON.stringify({
  version: "1.0",
  format: "DELIMITED",
  delimiter: ",",
  hasHeader: true,
  fields: [
    { name: "accountId", columnIndex: 0, type: "string" },
    { name: "debit", columnIndex: 1, type: "decimal" },
    { name: "credit", columnIndex: 2, type: "decimal" }
  ]
});

const FILE = "accountId,debit,credit\n1000,100,0\n2000,0,100\n";

function makeProfile(reviewMode: string): ProfileWithRelations {
  return {
    id: "prof1",
    name: "GL Import",
    profileType: "IMPORT",
    sourceComponent: "BANK",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: "f1",
    targetFormatId: null,
    transformationId: null,
    sourceParams: { fileName: "in.csv" },
    targetParams: { entityId: "e1", periodId: "p1" },
    savePayload: "NONE",
    sourceFormat: { id: "f1", fsdXml: FSD, classification: "DELIMITED" },
    targetFormat: null,
    transformation: null,
    reviewMode
  } as any;
}

function makeCtx(db: any): PipelineContext {
  return {
    db,
    storage: {
      read: vi.fn().mockResolvedValue(FILE),
      write: vi.fn().mockResolvedValue(undefined)
    } as any,
    tenantSlug: "t1",
    tenantDbUrl: "postgres://x"
  };
}

function makeDb(overrides: Record<string, any> = {}) {
  return {
    transferProfile: { findUnique: vi.fn() },
    transferExecution: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ automationId: null, triggeredBy: "u1" })
    },
    transferExecutionLog: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({})
    },
    account: {
      findMany: vi.fn().mockResolvedValue([
        { id: "1000", code: "1000" },
        { id: "2000", code: "2000" }
      ])
    },
    period: { findMany: vi.fn().mockResolvedValue([{ id: "p1", status: "OPEN" }]) },
    transferBatch: {
      create: vi.fn().mockResolvedValue({ id: "b1" }),
      update: vi.fn().mockResolvedValue({})
    },
    transferBatchItem: { createMany: vi.fn().mockResolvedValue({}) },
    ...overrides
  };
}

beforeEach(() => {
  createJournalMock.mockClear();
});

describe("executeImport HOLD vs AUTO_COMMIT", () => {
  it("HOLD mode stages a batch and does NOT create journals", async () => {
    const db = makeDb();
    const result = await executeImport(makeCtx(db), "exec1", makeProfile("HOLD"), {
      entityId: "e1",
      periodId: "p1"
    });
    expect(db.transferBatch.create).toHaveBeenCalledTimes(1);
    expect(db.transferBatchItem.createMany).toHaveBeenCalledTimes(1);
    expect(createJournalMock).not.toHaveBeenCalled();
    expect(result.recordsTotal).toBeGreaterThan(0);
  });

  it("AUTO_COMMIT mode writes journals directly and stages no batch", async () => {
    const db = makeDb();
    await executeImport(makeCtx(db), "exec1", makeProfile("AUTO_COMMIT"), {
      entityId: "e1",
      periodId: "p1"
    });
    expect(createJournalMock).toHaveBeenCalled();
    expect(db.transferBatch.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/transfer-desk-batch-pipeline.test.ts`
Expected: FAIL — HOLD path not implemented (batch.create never called).

- [ ] **Step 3: Implement the HOLD branch**

In `apps/api/src/jobs/transfer-desk-pipeline.ts`:

(a) Add the import near the top:

```ts
import {
  stageJournalItems,
  resolveReviewMode,
  type StageContext
} from "./transfer-desk-batch-stager.js";
```

(b) Add `reviewMode` to `ProfileWithRelations` (after `savePayload`):

```ts
  reviewMode?: "HOLD" | "AUTO_COMMIT" | null;
```

(c) Extend `PipelineDb` with the members the HOLD path needs:

```ts
transferExecution: {
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  findUnique: (args: { where: { id: string }; select?: Record<string, unknown> }) =>
    Promise<{ automationId: string | null; triggeredBy: string | null } | null>;
}
account: {
  findMany: (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) =>
    Promise<Array<{ id: string; code: string }>>;
}
period: {
  findMany: (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) =>
    Promise<Array<{ id: string; status: string }>>;
}
transferBatch: {
  create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
}
transferBatchItem: {
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>;
}
```

(d) In `executeImport`, after step 5 (`const mapResult = mapRecordsToTarget(...)`) and before step 6 (the `writeToTarget` call), insert the mode resolution + HOLD branch:

```ts
if (!mapResult.ok) {
  return failExecution(ctx, executionId, mapResult.code, mapResult.message);
}

// 5b. Resolve review mode — scheduled/automation runs always AUTO_COMMIT.
const execMeta = await ctx.db.transferExecution.findUnique({
  where: { id: executionId },
  select: { automationId: true, triggeredBy: true }
});
const effectiveMode = resolveReviewMode(profile.reviewMode ?? null, {
  automationId: execMeta?.automationId ?? null,
  triggeredBy: execMeta?.triggeredBy ?? null
});

// HOLD only applies to GL_JOURNAL in v1; other targets keep direct behaviour.
if (effectiveMode === "HOLD" && mapResult.component === "GL_JOURNAL") {
  const createdById = String(runtimeParams.triggeredBy ?? execMeta?.triggeredBy ?? "system");
  return stageHeldBatch(
    ctx,
    executionId,
    profile,
    mapResult,
    parseResult.records,
    targetParams,
    createdById
  );
}
```

(Keep the existing step 6 `writeToTarget` call below for the AUTO_COMMIT / non-GL path.)

(e) Add the `stageHeldBatch` function (place it just after `writeToTarget`):

```ts
async function stageHeldBatch(
  ctx: PipelineContext,
  executionId: string,
  profile: ProfileWithRelations,
  mapResult: Extract<ReturnType<typeof mapRecordsToTarget>, { ok: true; component: "GL_JOURNAL" }>,
  sourceRecords: FsdRecordValue[],
  targetParams: TargetParams,
  createdById: string
): Promise<PipelineResult> {
  const entityId = targetParams.entityId ?? "";

  // Pre-fetch validation context (active accounts + period statuses).
  const accounts = await ctx.db.account.findMany({
    where: { entityId, isActive: true },
    select: { id: true, code: true }
  });
  const validAccountKeys = new Set<string>();
  for (const a of accounts) {
    validAccountKeys.add(a.id);
    validAccountKeys.add(a.code);
  }
  const periodIds = [...new Set(mapResult.journals.map((j) => j.input.periodId).filter(Boolean))];
  const periods = periodIds.length
    ? await ctx.db.period.findMany({
        where: { entityId, id: { in: periodIds } },
        select: { id: true, status: true }
      })
    : [];
  const periodStatusById = new Map(periods.map((p) => [p.id, p.status]));

  const stageCtx: StageContext = { validAccountKeys, periodStatusById };
  const items = stageJournalItems(mapResult.journals, stageCtx);

  const heldItems = items.filter((i) => i.status === "HELD").length;
  const errorItems = items.filter((i) => i.status === "ERROR").length;

  const batch = await ctx.db.transferBatch.create({
    data: {
      entityId,
      profileId: profile.id,
      executionId,
      targetComponent: "GL_JOURNAL",
      status: "PENDING_REVIEW",
      totalItems: items.length,
      heldItems,
      errorItems,
      createdById
    } as any
  });

  await ctx.db.transferBatchItem.createMany({
    data: items.map((item) => ({
      batchId: batch.id,
      itemIndex: item.itemIndex,
      status: item.status,
      targetComponent: item.targetComponent,
      payload: item.payload as any,
      sourceRecordIndices: item.sourceRecordIndices,
      validationStatus: item.validationStatus,
      validationMessages: item.validationMessages as any
    }))
  });

  // Per-source-record success log (held — not yet posted).
  await ctx.db.transferExecutionLog
    .createMany({
      data: items.flatMap((item) =>
        item.sourceRecordIndices.map((idx) => ({
          executionId,
          recordIndex: idx,
          status: item.status === "ERROR" ? "FAILED" : "SUCCESS",
          sourceData: (sourceRecords[idx] ?? null) as any,
          transformedData: item.payload as any,
          errorCode: item.status === "ERROR" ? "STAGE_VALIDATION_ERROR" : null,
          errorMessage:
            item.status === "ERROR"
              ? item.validationMessages.map((m) => m.message).join("; ")
              : null
        }))
      )
    })
    .catch(() => {});

  return {
    recordsTotal: sourceRecords.length,
    recordsSucceeded: heldItems,
    recordsFailed: errorItems
  };
}
```

> NOTE: `createdById` is threaded in from the call site (step d) as `String(runtimeParams.triggeredBy ?? execMeta?.triggeredBy ?? "system")` — interactive runs put the user on `runtimeParams.triggeredBy`; the execution row's `triggeredBy` is the fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/transfer-desk-batch-pipeline.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jobs/transfer-desk-pipeline.ts apps/api/tests/transfer-desk-batch-pipeline.test.ts
git commit -m "feat(transfer-desk): import stages a held batch in HOLD mode (GL journals)"
```

---

### Task 4: BatchReviewService — list / get / reject / restore / discard (TDD)

**Files:**

- Create: `apps/api/src/modules/transfer-desk/batch-service.ts`
- Test: `apps/api/tests/transfer-desk-batch-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/transfer-desk-batch-service.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  BatchReviewService,
  BatchReviewError
} from "../src/modules/transfer-desk/batch-service.js";

function makeDb() {
  return {
    transferBatch: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    transferBatchItem: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({})
    }
  } as any;
}

let db: ReturnType<typeof makeDb>;
let service: BatchReviewService;
beforeEach(() => {
  db = makeDb();
  service = new BatchReviewService(db);
});

describe("rejectItem", () => {
  it("rejects a HELD item and decrements held / increments rejected", async () => {
    db.transferBatch.findFirst.mockResolvedValue({ id: "b1", status: "PENDING_REVIEW" });
    db.transferBatchItem.findFirst.mockResolvedValue({ id: "i1", batchId: "b1", status: "HELD" });

    await service.rejectItem("b1", "i1", "u1", "wrong account");

    expect(db.transferBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({ status: "REJECTED", rejectedReason: "wrong account" })
      })
    );
    expect(db.transferBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          heldItems: { decrement: 1 },
          rejectedItems: { increment: 1 }
        })
      })
    );
  });

  it("refuses to reject when the batch is already COMMITTED", async () => {
    db.transferBatch.findFirst.mockResolvedValue({ id: "b1", status: "COMMITTED" });
    await expect(service.rejectItem("b1", "i1", "u1")).rejects.toMatchObject({
      code: "BATCH_NOT_REVIEWABLE",
      statusCode: 409
    });
  });

  it("refuses to reject an item that is not HELD", async () => {
    db.transferBatch.findFirst.mockResolvedValue({ id: "b1", status: "PENDING_REVIEW" });
    db.transferBatchItem.findFirst.mockResolvedValue({ id: "i1", batchId: "b1", status: "ERROR" });
    await expect(service.rejectItem("b1", "i1", "u1")).rejects.toMatchObject({
      code: "ITEM_NOT_HELD",
      statusCode: 409
    });
  });
});

describe("restoreItem", () => {
  it("moves a REJECTED item back to HELD and adjusts counts", async () => {
    db.transferBatch.findFirst.mockResolvedValue({ id: "b1", status: "PENDING_REVIEW" });
    db.transferBatchItem.findFirst.mockResolvedValue({
      id: "i1",
      batchId: "b1",
      status: "REJECTED"
    });
    await service.restoreItem("b1", "i1");
    expect(db.transferBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "HELD", rejectedReason: null })
      })
    );
    expect(db.transferBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          heldItems: { increment: 1 },
          rejectedItems: { decrement: 1 }
        })
      })
    );
  });
});

describe("discardBatch", () => {
  it("sets a reviewable batch to DISCARDED", async () => {
    db.transferBatch.findFirst.mockResolvedValue({ id: "b1", status: "PENDING_REVIEW" });
    await service.discardBatch("b1", "u1");
    expect(db.transferBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1" },
        data: expect.objectContaining({ status: "DISCARDED" })
      })
    );
  });

  it("refuses to discard a committed batch", async () => {
    db.transferBatch.findFirst.mockResolvedValue({ id: "b1", status: "COMMITTED" });
    await expect(service.discardBatch("b1", "u1")).rejects.toMatchObject({
      code: "BATCH_NOT_REVIEWABLE"
    });
  });
});

describe("getBatch", () => {
  it("throws when not found", async () => {
    db.transferBatch.findFirst.mockResolvedValue(null);
    await expect(service.getBatch("nope")).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND",
      statusCode: 404
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/transfer-desk-batch-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement list/get/reject/restore/discard**

Create `apps/api/src/modules/transfer-desk/batch-service.ts`:

```ts
/**
 * Held-journal batch review service — list/get/reject/restore/discard.
 * Commit lives in commitBatch (Task 5).
 */

import type { PrismaClient } from "../../db/client.js";

export class BatchReviewError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "BatchReviewError";
  }
}

export class BatchReviewService {
  constructor(protected readonly prisma: PrismaClient) {}

  protected get db(): any {
    return this.prisma as any;
  }

  async listBatches(filter: { entityId?: string; status?: string; profileId?: string }) {
    return this.db.transferBatch.findMany({
      where: {
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.profileId ? { profileId: filter.profileId } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  async getBatch(batchId: string) {
    const batch = await this.db.transferBatch.findFirst({
      where: { id: batchId },
      include: { items: { orderBy: { itemIndex: "asc" } } }
    });
    if (!batch) throw new BatchReviewError("BATCH_NOT_FOUND", "Batch not found.", 404);
    return batch;
  }

  private async assertReviewable(batchId: string) {
    const batch = await this.db.transferBatch.findFirst({ where: { id: batchId } });
    if (!batch) throw new BatchReviewError("BATCH_NOT_FOUND", "Batch not found.", 404);
    if (batch.status !== "PENDING_REVIEW") {
      throw new BatchReviewError(
        "BATCH_NOT_REVIEWABLE",
        `Batch is ${batch.status}, not PENDING_REVIEW.`,
        409
      );
    }
    return batch;
  }

  async rejectItem(batchId: string, itemId: string, userId: string, reason?: string) {
    await this.assertReviewable(batchId);
    const item = await this.db.transferBatchItem.findFirst({ where: { id: itemId, batchId } });
    if (!item) throw new BatchReviewError("ITEM_NOT_FOUND", "Batch item not found.", 404);
    if (item.status !== "HELD")
      throw new BatchReviewError("ITEM_NOT_HELD", `Item is ${item.status}, not HELD.`, 409);

    await this.db.transferBatchItem.update({
      where: { id: itemId },
      data: { status: "REJECTED", rejectedReason: reason ?? null }
    });
    await this.db.transferBatch.update({
      where: { id: batchId },
      data: { heldItems: { decrement: 1 }, rejectedItems: { increment: 1 }, reviewedById: userId }
    });
    return { ok: true };
  }

  async restoreItem(batchId: string, itemId: string) {
    await this.assertReviewable(batchId);
    const item = await this.db.transferBatchItem.findFirst({ where: { id: itemId, batchId } });
    if (!item) throw new BatchReviewError("ITEM_NOT_FOUND", "Batch item not found.", 404);
    if (item.status !== "REJECTED")
      throw new BatchReviewError("ITEM_NOT_REJECTED", `Item is ${item.status}, not REJECTED.`, 409);

    await this.db.transferBatchItem.update({
      where: { id: itemId },
      data: { status: "HELD", rejectedReason: null }
    });
    await this.db.transferBatch.update({
      where: { id: batchId },
      data: { heldItems: { increment: 1 }, rejectedItems: { decrement: 1 } }
    });
    return { ok: true };
  }

  async discardBatch(batchId: string, userId: string) {
    await this.assertReviewable(batchId);
    await this.db.transferBatch.update({
      where: { id: batchId },
      data: { status: "DISCARDED", reviewedById: userId }
    });
    return { ok: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/transfer-desk-batch-service.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/transfer-desk/batch-service.ts apps/api/tests/transfer-desk-batch-service.test.ts
git commit -m "feat(transfer-desk): batch review service — list/get/reject/restore/discard"
```

---

### Task 5: BatchReviewService.commitBatch — materialize through GL governance (TDD)

**Files:**

- Modify: `apps/api/src/modules/transfer-desk/batch-service.ts` (add `commitBatch`)
- Test: `apps/api/tests/transfer-desk-batch-commit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/transfer-desk-batch-commit.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BatchReviewService } from "../src/modules/transfer-desk/batch-service.js";
import { GLService } from "../src/modules/gl/service.js";

function item(over: Record<string, any> = {}) {
  return {
    id: "i1",
    batchId: "b1",
    status: "HELD",
    validationStatus: "OK",
    payload: { periodId: "p1", source: "IMPORT", functionalCurrency: "USD", lines: [] },
    ...over
  };
}

function makeDb(items: any[]) {
  return {
    transferBatch: {
      findFirst: vi.fn().mockResolvedValue({ id: "b1", entityId: "e1", status: "PENDING_REVIEW" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({})
    },
    transferBatchItem: {
      findMany: vi.fn().mockResolvedValue(items),
      update: vi.fn().mockResolvedValue({})
    }
  } as any;
}

let createSpy: any;
let postSpy: any;
beforeEach(() => {
  createSpy = vi.spyOn(GLService.prototype, "createJournal");
  postSpy = vi
    .spyOn(GLService.prototype, "postJournal")
    .mockResolvedValue({ id: "j1", status: "POSTED" } as any);
});

describe("commitBatch governance", () => {
  it("posts a journal when createJournal returns DRAFT (no approval rule)", async () => {
    createSpy.mockResolvedValue({ id: "j1", status: "DRAFT" } as any);
    const db = makeDb([item()]);
    const summary = await new BatchReviewService(db).commitBatch("b1", "u1");
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith("e1", "j1", "u1");
    expect(summary.committed).toBe(1);
    expect(summary.pendingApproval).toBe(0);
  });

  it("leaves a journal for approval when createJournal returns PENDING_APPROVAL", async () => {
    createSpy.mockResolvedValue({ id: "j2", status: "PENDING_APPROVAL" } as any);
    const db = makeDb([item()]);
    const summary = await new BatchReviewService(db).commitBatch("b1", "u1");
    expect(postSpy).not.toHaveBeenCalled();
    expect(summary.pendingApproval).toBe(1);
    expect(summary.committed).toBe(0);
  });

  it("skips REJECTED and ERROR items", async () => {
    createSpy.mockResolvedValue({ id: "j1", status: "DRAFT" } as any);
    const db = makeDb([
      item({ id: "ok", status: "HELD", validationStatus: "OK" }),
      item({ id: "rej", status: "REJECTED" }),
      item({ id: "err", status: "ERROR", validationStatus: "ERROR" })
    ]);
    // findMany should be called with a filter that returns only the HELD/non-ERROR item;
    // emulate that the service filters in the query:
    db.transferBatchItem.findMany.mockResolvedValue([item({ id: "ok" })]);
    await new BatchReviewService(db).commitBatch("b1", "u1");
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a non-PENDING_REVIEW batch creates no journals", async () => {
    const db = makeDb([item()]);
    db.transferBatch.updateMany.mockResolvedValue({ count: 0 }); // conditional flip failed → already committed
    const summary = await new BatchReviewService(db).commitBatch("b1", "u1");
    expect(createSpy).not.toHaveBeenCalled();
    expect(summary.alreadyCommitted).toBe(true);
  });

  it("marks an item ERROR when createJournal throws but still commits the batch", async () => {
    createSpy.mockRejectedValueOnce(new Error("account locked"));
    const db = makeDb([item()]);
    const summary = await new BatchReviewService(db).commitBatch("b1", "u1");
    expect(db.transferBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({ status: "ERROR" })
      })
    );
    expect(summary.errors).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/transfer-desk-batch-commit.test.ts`
Expected: FAIL — `commitBatch` does not exist.

- [ ] **Step 3: Implement `commitBatch`**

In `apps/api/src/modules/transfer-desk/batch-service.ts`, add the import at the top:

```ts
import { GLService } from "../gl/service.js";
```

Add the method to `BatchReviewService`:

```ts
  /**
   * Commit a held batch: materialise each HELD, non-ERROR item through
   * GLService.createJournal (honouring approval rules); DRAFT results are
   * posted, PENDING_APPROVAL results are left for approvers. Idempotent.
   */
  async commitBatch(batchId: string, userId: string) {
    const batch = await this.db.transferBatch.findFirst({ where: { id: batchId } });
    if (!batch) throw new BatchReviewError("BATCH_NOT_FOUND", "Batch not found.", 404);

    // Conditional flip — only one caller wins; prevents double-commit.
    const flipped = await this.db.transferBatch.updateMany({
      where: { id: batchId, status: "PENDING_REVIEW" },
      data: { status: "COMMITTED", reviewedById: userId, committedAt: new Date() }
    });
    if (flipped.count === 0) {
      return { alreadyCommitted: true, committed: 0, pendingApproval: 0, rejected: 0, errors: 0 };
    }

    const items = await this.db.transferBatchItem.findMany({
      where: { batchId, status: "HELD", validationStatus: { not: "ERROR" } },
      orderBy: { itemIndex: "asc" }
    });

    const gl = new GLService(this.prisma);
    let committed = 0;
    let pendingApproval = 0;
    let errors = 0;

    for (const item of items) {
      try {
        const created: any = await gl.createJournal(batch.entityId, userId, item.payload as any);
        if (created?.status === "PENDING_APPROVAL") {
          pendingApproval++;
        } else {
          await gl.postJournal(batch.entityId, created.id, userId);
          committed++;
        }
        await this.db.transferBatchItem.update({
          where: { id: item.id },
          data: { status: "COMMITTED", resultJournalId: created?.id ?? null }
        });
      } catch (err) {
        errors++;
        const message = err instanceof Error ? err.message : "Commit failed";
        const existing = Array.isArray(item.validationMessages) ? item.validationMessages : [];
        await this.db.transferBatchItem.update({
          where: { id: item.id },
          data: {
            status: "ERROR",
            validationStatus: "ERROR",
            validationMessages: [...existing, { code: "COMMIT_FAILED", severity: "ERROR", message }] as any
          }
        });
      }
    }

    await this.db.transferBatch.update({
      where: { id: batchId },
      data: {
        committedItems: { increment: committed + pendingApproval },
        heldItems: 0,
        errorItems: { increment: errors }
      }
    });

    return { alreadyCommitted: false, committed, pendingApproval, rejected: batch.rejectedItems ?? 0, errors };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/transfer-desk-batch-commit.test.ts && npx tsc --noEmit`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/transfer-desk/batch-service.ts apps/api/tests/transfer-desk-batch-commit.test.ts
git commit -m "feat(transfer-desk): commit held batch through GL governance (post or route to approval)"
```

---

### Task 6: Batch router + registration

**Files:**

- Create: `apps/api/src/modules/transfer-desk/batch-router.ts`
- Modify: `apps/api/src/app.ts` (import + register)

No new unit test (thin router over the tested service). Verification = typecheck + full suite green.

- [ ] **Step 1: Implement the router**

Create `apps/api/src/modules/transfer-desk/batch-router.ts`:

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PrismaClient } from "../../db/client.js";
import { z, ZodError } from "zod";
import { prisma } from "../../db/prisma.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { BatchReviewService, BatchReviewError } from "./batch-service.js";

const service = new BatchReviewService(prisma as unknown as PrismaClient);

function mapError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      data: null,
      errors: [{ code: "VALIDATION_ERROR", message: error.issues.map((i) => i.message).join("; ") }]
    });
  }
  if (error instanceof BatchReviewError) {
    return reply
      .code(error.statusCode)
      .send({ data: null, errors: [{ code: error.code, message: error.message }] });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return reply.code(500).send({ data: null, errors: [{ code: "INTERNAL_SERVER_ERROR", message }] });
}

const rejectSchema = z.object({ reason: z.string().max(500).optional() });

export async function registerTransferDeskBatchRouter(app: FastifyInstance): Promise<void> {
  app.register(
    async (router) => {
      router.addHook("preHandler", requireAuth);
      router.addHook("preHandler", requirePermission("TRANSFER_DESK_EXECUTE"));

      router.get("/transfer-desk/batches", async (request, reply) => {
        try {
          const q = request.query as { status?: string; profileId?: string };
          const data = await service.listBatches({
            entityId: request.entityId,
            status: q.status,
            profileId: q.profileId
          });
          return reply.send({ data, errors: [] });
        } catch (error) {
          return mapError(reply, error);
        }
      });

      router.get<{ Params: { id: string } }>(
        "/transfer-desk/batches/:id",
        async (request, reply) => {
          try {
            const data = await service.getBatch(request.params.id);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string; itemId: string } }>(
        "/transfer-desk/batches/:id/items/:itemId/reject",
        async (request, reply) => {
          try {
            const { reason } = rejectSchema.parse(request.body ?? {});
            const userId = String((request.user as any)?.sub ?? "system");
            const data = await service.rejectItem(
              request.params.id,
              request.params.itemId,
              userId,
              reason
            );
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string; itemId: string } }>(
        "/transfer-desk/batches/:id/items/:itemId/restore",
        async (request, reply) => {
          try {
            const data = await service.restoreItem(request.params.id, request.params.itemId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/transfer-desk/batches/:id/commit",
        async (request, reply) => {
          try {
            const userId = String((request.user as any)?.sub ?? "system");
            const data = await service.commitBatch(request.params.id, userId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );

      router.post<{ Params: { id: string } }>(
        "/transfer-desk/batches/:id/discard",
        async (request, reply) => {
          try {
            const userId = String((request.user as any)?.sub ?? "system");
            const data = await service.discardBatch(request.params.id, userId);
            return reply.send({ data, errors: [] });
          } catch (error) {
            return mapError(reply, error);
          }
        }
      );
    },
    { prefix: "/api/v1" }
  );
}
```

- [ ] **Step 2: Register in `app.ts`**

In `apps/api/src/app.ts`, add the import alongside the other transfer-desk imports (near line 28-33):

```ts
import { registerTransferDeskBatchRouter } from "./modules/transfer-desk/batch-router.js";
```

And register it next to `registerTransferDeskProfileRouter(app)` (near line 202):

```ts
await registerTransferDeskBatchRouter(app);
```

- [ ] **Step 3: Verify typecheck + full API suite**

Run: `cd apps/api && npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; all tests pass (612 baseline + the new batch tests).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/transfer-desk/batch-router.ts apps/api/src/app.ts
git commit -m "feat(transfer-desk): held-batch review API (list/get/reject/restore/commit/discard)"
```

---

### Task 7: Web API client — batch endpoints

**Files:**

- Modify: `apps/web/lib/transfer-desk/api.ts` (append batch functions)
- Modify: `apps/web/lib/transfer-desk/types.ts` (append batch types)

`lib/transfer-desk/` exists on disk; this task is safe regardless of the dashboard page-tree drift.

- [ ] **Step 1: Add types**

Append to `apps/web/lib/transfer-desk/types.ts`:

```ts
export type BatchItemValidationMessage = {
  code: string;
  severity: "WARNING" | "ERROR";
  message: string;
  line?: number;
};

export type HeldBatchItem = {
  id: string;
  itemIndex: number;
  status: "HELD" | "COMMITTED" | "REJECTED" | "ERROR";
  payload: {
    periodId: string;
    reference?: string;
    description?: string;
    functionalCurrency?: string;
    lines: Array<{
      accountId: string;
      debit: string;
      credit: string;
      currency?: string;
      fxRate?: string;
      description?: string;
    }>;
  };
  sourceRecordIndices: number[];
  validationStatus: "OK" | "WARNING" | "ERROR";
  validationMessages: BatchItemValidationMessage[];
  resultJournalId: string | null;
  rejectedReason: string | null;
};

export type HeldBatchSummary = {
  id: string;
  entityId: string;
  profileId: string;
  executionId: string;
  targetComponent: string;
  status: "PENDING_REVIEW" | "COMMITTED" | "DISCARDED";
  totalItems: number;
  heldItems: number;
  rejectedItems: number;
  committedItems: number;
  errorItems: number;
  createdAt: string;
  committedAt: string | null;
};

export type HeldBatchDetail = HeldBatchSummary & { items: HeldBatchItem[] };

export type CommitSummary = {
  alreadyCommitted: boolean;
  committed: number;
  pendingApproval: number;
  rejected: number;
  errors: number;
};
```

- [ ] **Step 2: Add client functions**

Append to `apps/web/lib/transfer-desk/api.ts` (it already has the `request` helper and imports `ApiContext`):

```ts
import type { HeldBatchSummary, HeldBatchDetail, CommitSummary } from "./types";

export async function listHeldBatches(
  ctx: ApiContext,
  filters?: { status?: string; profileId?: string }
): Promise<HeldBatchSummary[]> {
  const qs = new URLSearchParams();
  if (filters?.status) qs.set("status", filters.status);
  if (filters?.profileId) qs.set("profileId", filters.profileId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await request<HeldBatchSummary[]>(ctx, `/api/v1/transfer-desk/batches${suffix}`);
  return res.data;
}

export async function getHeldBatch(ctx: ApiContext, batchId: string): Promise<HeldBatchDetail> {
  const res = await request<HeldBatchDetail>(ctx, `/api/v1/transfer-desk/batches/${batchId}`);
  return res.data;
}

export async function rejectBatchItem(
  ctx: ApiContext,
  batchId: string,
  itemId: string,
  reason?: string
): Promise<void> {
  await request(ctx, `/api/v1/transfer-desk/batches/${batchId}/items/${itemId}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
}

export async function restoreBatchItem(
  ctx: ApiContext,
  batchId: string,
  itemId: string
): Promise<void> {
  await request(ctx, `/api/v1/transfer-desk/batches/${batchId}/items/${itemId}/restore`, {
    method: "POST"
  });
}

export async function commitHeldBatch(ctx: ApiContext, batchId: string): Promise<CommitSummary> {
  const res = await request<CommitSummary>(ctx, `/api/v1/transfer-desk/batches/${batchId}/commit`, {
    method: "POST"
  });
  return res.data;
}

export async function discardHeldBatch(ctx: ApiContext, batchId: string): Promise<void> {
  await request(ctx, `/api/v1/transfer-desk/batches/${batchId}/discard`, { method: "POST" });
}
```

> If `request` is not exported/usable at the new call sites (it is module-private in `api.ts`, so appending in the same file is correct), keep these functions in `api.ts`. Do not create a second `request` wrapper.

- [ ] **Step 3: Verify web typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: exit 0. (If the web app has unrelated pre-existing drift errors, confirm none are in `lib/transfer-desk/`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/transfer-desk/api.ts apps/web/lib/transfer-desk/types.ts
git commit -m "feat(web): transfer-desk held-batch API client"
```

---

### Task 8: Web pages — Held Batches list + batch review

**PRECONDITION:** The dashboard route tree `apps/web/app/[tenant]/(dashboard)/transfer-desk/` is currently **absent on disk** (working-tree drift). Restore it first (`git checkout origin/main -- "apps/web/app/[tenant]/(dashboard)/transfer-desk"` or however the team restores the drifted web tree) and confirm a sibling page (e.g. `.../transfer-desk/history/page.tsx`) renders, **before** adding these pages. If the web tree cannot be restored in this environment, STOP after Task 7 and report — the backend (Tasks 1–6) is independently shippable and testable.

**Files:**

- Create: `apps/web/app/[tenant]/(dashboard)/transfer-desk/batches/page.tsx`
- Create: `apps/web/app/[tenant]/(dashboard)/transfer-desk/batches/[id]/page.tsx`

- [ ] **Step 1: Read a sibling page for conventions**

Read `apps/web/app/[tenant]/(dashboard)/transfer-desk/history/page.tsx` (or the nearest existing transfer-desk page) to copy: how it obtains `ApiContext` (token/entity/tenant), the table/card components and styling, loading/error states, and `use-tenant-router`/`use-api-context` hooks. Match those exactly — do not introduce a new data-fetching pattern.

- [ ] **Step 2: Held Batches list page**

Create `apps/web/app/[tenant]/(dashboard)/transfer-desk/batches/page.tsx` following the sibling page's structure. Requirements (implement with the existing design-system components found in step 1):

- On mount, call `listHeldBatches(ctx, { status: "PENDING_REVIEW" })` plus recent committed/discarded.
- Table columns: profile (resolve name if available, else `profileId`), created at, status badge, and counts `held / rejected / error / committed`.
- Each row links to `./batches/{id}`.
- Loading + empty + error states matching the sibling page.

- [ ] **Step 3: Batch review page**

Create `apps/web/app/[tenant]/(dashboard)/transfer-desk/batches/[id]/page.tsx`:

- On mount, `getHeldBatch(ctx, id)`.
- Header: profile, status, counts, and an overall "balanced" indicator (every item `validationStatus !== "ERROR"`).
- Item table — one row per staged journal: `payload.reference`, `payload.description`, line count, DR total = Σ `lines[].debit`, CR total = Σ `lines[].credit`, a balance ✓/✗ (DR==CR), and a validation badge (`OK`/`WARNING`/`ERROR` from `validationStatus`). Expand a row to show the lines (`accountId`, debit, credit, description) and `sourceRecordIndices`.
- Row actions: **Reject** (prompt for optional reason → `rejectBatchItem`) on `HELD` items; **Restore** (`restoreBatchItem`) on `REJECTED` items. Disable when batch `status !== "PENDING_REVIEW"`.
- Batch actions: **Discard** (`discardHeldBatch`, confirm) and **Commit** (`commitHeldBatch`). Commit opens a confirm dialog summarizing held/rejected/error counts; on success show the returned `CommitSummary` ("X posted, Y to approval, Z excluded, W errors") and refresh.
- After any mutation, re-fetch the batch.

- [ ] **Step 4: Verify web typecheck/build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: exit 0 for the new files. Optionally `npx next build` if the team builds locally.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[tenant]/(dashboard)/transfer-desk/batches"
git commit -m "feat(web): held-journal batch review pages"
```

---

## Self-review notes

- **Spec coverage:** §3.2 data model → Task 1. §3.3 reviewMode + scheduled-forces-AUTO_COMMIT → Tasks 1, 2 (`resolveReviewMode`), 3. §4.1 import→stage → Task 3. §4.2 stage validation (functional balance / account / period) → Task 2. §4.3 review (reject/restore/discard/list/get) → Task 4. §4.4 commit (idempotent, governance, skip rejected/error, item-throw→ERROR) → Task 5. §5 API → Task 6. §6 UI → Tasks 7–8. §7 testing → Tasks 2,3,4,5. All covered.
- **Deliberate judgment calls:**
  - Account validation checks line keys against a set containing **both** account ids and codes, because `transfer-desk-record-mapper.ts` sets `accountId = accountId ?? accountCode` (can't distinguish). Documented in Task 2/3.
  - `createdById` on the batch is threaded from the call site as `String(runtimeParams.triggeredBy ?? execMeta?.triggeredBy ?? "system")`.
  - Commit counts `committedItems` as posted + pending-approval (both materialized into journals); `committed` vs `pendingApproval` in the summary distinguishes them for the UI.
  - Task 8 is gated on restoring the drifted web route tree; backend (1–6) ships independently.
- **Type consistency:** `StageContext { validAccountKeys, periodStatusById }`, `StagedItem.status ∈ {HELD,ERROR}`, `resolveReviewMode(profileReviewMode, {automationId,triggeredBy})`, `BatchReviewService.commitBatch → { alreadyCommitted, committed, pendingApproval, rejected, errors }` — consistent across tasks 2–8 and the web client (`CommitSummary`).
- **Migration caveat:** Task 1 generates the client (enough for the mock-based tests); the SQL migration must be produced against a real DB before deploy.
