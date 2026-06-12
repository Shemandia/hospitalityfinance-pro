# Held-Journal Batch Review — Design Spec

**Date:** 2026-06-12
**Status:** Approved (brainstorming complete)
**Feature:** SunSystems-style "held journals" for the Transfer Desk — imports stage a reviewable batch of journals that a human inspects (and rejects line items from) before committing them to the ledger.

**Relationship to other work:** This is feature **(B)** of a two-part Transfer Desk uplift. Feature **(A)** — user-defined mappings to _any_ target (replacing the hardcoded `transfer-desk-record-mapper.ts` switch) — is a separate later effort. (B) is built first because the held-batch review is the human checkpoint that makes (A) safe to ship: arbitrary user-defined mappings must not post straight to the ledger. The data model here is deliberately target-agnostic so (A) reuses the same review/commit flow.

---

## 1. Background — current state

The Transfer Desk faithfully mirrors Infor SunSystems (FSD parsing, TML transformation, profiles, lookup tables, scheduled automations, per-record run logs). Two gaps versus SunSystems motivated this work; this spec addresses the second:

- Today an interactive import calls `GLService.createJournal` **per group immediately** (`apps/api/src/jobs/transfer-desk-pipeline.ts` → `writeToTarget`). Journals land in `DRAFT` (or `PENDING_APPROVAL` if an approval rule matches), with an optional `autoPost` flag.
- A **dry-run** (`apps/api/src/modules/transfer-desk/test-service.ts`) computes a throwaway journal preview but persists no journals.
- There is **no reviewable import batch**: you cannot import a file, see "here are the N journals this will produce," reject individual ones, and then commit the remainder to posting as a reviewed set. The `JournalStatus` enum (`DRAFT, PENDING_APPROVAL, POSTED, REVERSED, RETURNED, VOIDED`) has no batch/hold grouping.

SunSystems produces **held journals** on import: they sit in a hold area, a person reviews them, then posts them as a set. This spec adds that.

---

## 2. Goals / non-goals

**Goals (v1):**

- Interactive `GL_JOURNAL` imports produce a **held batch** of staged journals instead of writing to the ledger directly.
- A reviewer can inspect every staged journal (header + lines + DR/CR totals + balance + validation status), **reject/exclude** individual journals (or discard the whole batch), then **commit** the remainder.
- Staging runs **validation up front** (functional-currency balance, account existence) so problems surface before anything posts.
- Committing **honors existing governance**: each journal is created through `GLService.createJournal`, so matched approval rules route to `PENDING_APPROVAL`; otherwise it posts directly with period-open + functional-balance checks.
- Scheduled/automated profiles can **bypass review** (`AUTO_COMMIT`) since they have no human in the loop.
- The ledger (`journals`, `account_period_balances`) remains **completely unaware of any "held" state**.

**Non-goals (v1) — explicitly out of scope:**

- Line-level editing of staged journals (fix the mapping/lookup and re-import instead).
- Held batches for `AP_INVOICE` / `AR_INVOICE` targets (data model supports them; flow not wired in v1).
- Held batches for **export** profiles.
- Partial / incremental commit (review once, exclude, commit the remainder in one action).
- A commit retry loop (items that throw during commit are marked `ERROR`; re-import to retry).
- Changes to the `JournalStatus` enum.

---

## 3. Architecture

### 3.1 Staging model (the key decision)

Held journals are **staged as a batch, not written into the `journals` table**. Real journals materialize only at commit, via the existing `GLService.createJournal`. Consequences:

- The `journals` table and `account_period_balances` only ever receive **committed** journals — zero awareness of "held," so the trial-balance tie-out hardening (NF1–NF3) needs no changes.
- **Rejected** journals never become journal rows at all.
- Commit reuses the **already-hardened posting path** (createJournal → approval routing → `batchUpdateAccountBalances`), so we don't create a parallel posting path that could bypass governance (the NF6 lesson).
- The staged batch is a target-agnostic container (a `targetComponent` discriminator + a JSONB payload), so feature (A) plugs new targets into the same review/commit flow.

### 3.2 Data model

Two new tables in the tenant schema (`apps/api/src/db/schema-tenant.prisma`). **No change to `JournalStatus`.**

```prisma
enum TransferBatchStatus {
  PENDING_REVIEW
  COMMITTED
  DISCARDED
}

enum TransferBatchItemStatus {
  HELD        // awaiting review
  COMMITTED   // materialised into a real journal
  REJECTED    // excluded by the reviewer
  ERROR       // failed stage-time validation or commit; cannot post
}

enum TransferValidationStatus {
  OK
  WARNING
  ERROR
}

model TransferBatch {
  id              String              @id @default(uuid())
  entityId        String
  profileId       String
  executionId     String              // the TransferExecution that produced this batch
  targetComponent String              // "GL_JOURNAL" in v1
  status          TransferBatchStatus @default(PENDING_REVIEW)
  totalItems      Int                 @default(0)
  heldItems       Int                 @default(0)
  rejectedItems   Int                 @default(0)
  committedItems  Int                 @default(0)
  errorItems      Int                 @default(0)
  createdById     String
  createdAt       DateTime            @default(now())
  reviewedById    String?
  committedAt     DateTime?
  items           TransferBatchItem[]

  @@index([entityId, status])
  @@index([profileId])
  @@map("transfer_batches")
}

model TransferBatchItem {
  id                 String                   @id @default(uuid())
  batchId            String
  batch              TransferBatch            @relation(fields: [batchId], references: [id], onDelete: Cascade)
  itemIndex          Int                      // ordinal within the batch
  status             TransferBatchItemStatus  @default(HELD)
  targetComponent    String
  payload            Json                     // the fully-mapped JournalCreateInput
  sourceRecordIndices Int[]                   // which parsed source rows produced this journal
  validationStatus   TransferValidationStatus @default(OK)
  validationMessages Json?                    // [{ code, severity, message, line? }]
  resultJournalId    String?                  // set when COMMITTED
  rejectedReason     String?
  createdAt          DateTime                 @default(now())

  @@index([batchId, status])
  @@map("transfer_batch_items")
}
```

> Migration note: per `project_db_split`, the tenant schema is `schema-tenant.prisma` with its own generated client. Add the models there and run the tenant migration; do **not** touch the registry schema.

### 3.3 Profile setting

Add a per-profile review mode (drives whether an import stages a batch or writes directly):

```prisma
enum TransferReviewMode {
  HOLD          // default — interactive imports produce a held batch
  AUTO_COMMIT   // write to the ledger directly (today's behaviour; required for scheduled automations)
}
// on TransferProfile:
//   reviewMode TransferReviewMode @default(HOLD)
```

Scheduled/cron-triggered executions force `AUTO_COMMIT` regardless of the profile setting (no human in the loop). Interactive (manual "Run") executions honor the profile's `reviewMode`.

### 3.4 Lifecycles

```
Batch:  PENDING_REVIEW ──commit──▶ COMMITTED
                        └─discard─▶ DISCARDED

Item:   HELD ──commit (validation != ERROR)──▶ COMMITTED (resultJournalId set)
        HELD ──reviewer reject────────────────▶ REJECTED
        HELD ──stage/commit validation fails──▶ ERROR
        REJECTED ──reviewer restore───────────▶ HELD
```

---

## 4. Flows

### 4.1 Import → stage

In `apps/api/src/jobs/transfer-desk-pipeline.ts`, `executeImport` resolves the effective review mode:

```
effectiveMode = isScheduledTrigger ? AUTO_COMMIT : (profile.reviewMode ?? HOLD)
```

- `AUTO_COMMIT` → existing `writeToTarget` path, unchanged.
- `HOLD` and `targetComponent === "GL_JOURNAL"` → new `stageBatch` path:
  1. Parse (FSD) → transform (TML) → `mapRecordsToTarget` produce `MappedJournal[]` — all existing code, unchanged.
  2. For each mapped journal, run **stage-time validation** (§4.2) to compute `validationStatus` + messages.
  3. Create one `TransferBatch` (status `PENDING_REVIEW`) and one `TransferBatchItem` per mapped journal (status `HELD`, or `ERROR` if validation is ERROR), storing the `JournalCreateInput` as `payload` and the `sourceIndices` as `sourceRecordIndices`.
  4. Roll counts onto the batch. The `TransferExecution` finishes as `COMPLETED` with a note that it produced a held batch (link via `executionId`).
- `HOLD` but `targetComponent !== "GL_JOURNAL"` (AP/AR) → falls back to the existing direct path in v1 (out of scope), with a log note.

### 4.2 Stage-time validation (per mapped journal)

Reuse the GL service/repository read helpers (account lookup, period lookup) under the tenant context:

| Check                                                                                   | Severity    | Rationale                                                              |
| --------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| Every line `accountId`/`accountCode` resolves to an active account in the entity        | **ERROR**   | Cannot post to a non-existent account                                  |
| Journal balances in **functional currency** (`Σ debitFunctional == Σ creditFunctional`) | **ERROR**   | Applies the NF5 lesson — validate functional, not transaction, balance |
| Target period resolves and is `OPEN`                                                    | **WARNING** | Commit may still create a DRAFT; posting later errors clearly          |
| Unknown analysis dimension value                                                        | **WARNING** | Informational; does not block                                          |

`validationStatus` = worst severity across checks. `ERROR` items cannot be committed.

### 4.3 Review

New `BatchReviewService` + router (`apps/api/src/modules/transfer-desk/batch-*.ts`), gated by `TRANSFER_DESK_EXECUTE`:

- **List** batches (filter by status/profile/entity).
- **Get** a batch with its items (each item returns a preview: header fields, lines, DR/CR totals, balance flag, validation status + messages, the source row indices).
- **Reject** an item (`HELD → REJECTED`, with `rejectedReason`); **restore** (`REJECTED → HELD`). Both only while the batch is `PENDING_REVIEW`; both update batch counts.
- **Discard** the whole batch (`PENDING_REVIEW → DISCARDED`).

### 4.4 Commit

`POST /batches/:id/commit` — idempotent and governance-respecting:

1. Conditionally flip batch `PENDING_REVIEW → COMMITTED` (a guarded update that only succeeds from `PENDING_REVIEW`); if it was already `COMMITTED`/`DISCARDED`, return the current state (no double-post). Mirrors the `setJournalStatusConditional` pattern.
2. Under the committing user's tenant/entity context, for each item with `status === HELD` and `validationStatus !== ERROR`:
   - Call `GLService.createJournal(entityId, userId, payload)`. This returns a journal in `PENDING_APPROVAL` (a matched approval rule) **or** `DRAFT` (no rule).
   - If the created journal is `DRAFT`, immediately call `GLService.postJournal(entityId, journalId, userId)` — the hardened post path (period-open + functional-balance checks + `batchUpdateAccountBalances`). If it is `PENDING_APPROVAL`, leave it for the normal approvers.
   - On success: item → `COMMITTED`, `resultJournalId` set (counts toward `committed` if posted, `pendingApproval` if left for approval).
   - On throw (at create or post): item → `ERROR`, append the message to `validationMessages` (re-import to retry).
3. `HELD`+`ERROR` items and `REJECTED` items are skipped (left `ERROR`/`REJECTED`).
4. Recompute batch counts; set `committedAt`, `reviewedById`.
5. Response summary: `{ committed, pendingApproval, rejected, errors }` for the UI confirm/result.

> Governance note: commit never bypasses approval rules — it goes through the same `createJournal` an interactive user would. This is the explicit answer to the NF6-class concern.

---

## 5. API surface

Under `/api/v1/transfer-desk`, `preHandler: requireAuth` + `requirePermission("TRANSFER_DESK_EXECUTE")`:

| Method | Path                                 | Purpose                                                    |
| ------ | ------------------------------------ | ---------------------------------------------------------- |
| GET    | `/batches`                           | List batches (`?status=&profileId=`) for the active entity |
| GET    | `/batches/:id`                       | Batch + items with per-item preview                        |
| POST   | `/batches/:id/items/:itemId/reject`  | Body `{ reason }` → exclude item                           |
| POST   | `/batches/:id/items/:itemId/restore` | Un-reject item                                             |
| POST   | `/batches/:id/commit`                | Materialise eligible items; returns summary                |
| POST   | `/batches/:id/discard`               | Discard whole batch                                        |

All responses use the project's `{ data, errors }` envelope and route errors through `mapError`.

---

## 6. UI

Two pages under the tenant dashboard (`apps/web/app/[tenant]/(dashboard)/transfer-desk/`):

- **Held Batches list** (`batches/page.tsx`): table of `PENDING_REVIEW` (and recent `COMMITTED`/`DISCARDED`) batches — profile name, created at/by, item counts (held / rejected / error), status badge. Row → detail.
- **Batch detail / review** (`batches/[id]/page.tsx`):
  - Header: profile, source execution, counts, overall balance status.
  - Item table: one row per staged journal — reference, description, line count, DR total, CR total, balance ✓/✗, validation badge (OK/WARNING/ERROR). Expand → journal lines + the source rows that produced them.
  - Row actions: **Reject** (with reason) / **Restore**.
  - Batch actions: **Discard**, **Commit**. Commit opens a confirm dialog: "X journals will post, Y go to approval, Z excluded, W errors skipped."

Add a web API client wrapper alongside the existing transfer-desk client (`apps/web/lib/` or the existing `transfer-desk/api.ts`).

---

## 7. Testing

Vitest, following the existing mock-prisma conventions (hand-rolled `mockPrisma`, `$transaction` returns the mock; spy on `GLService.prototype.createJournal`).

**Stage-time validation** (`stageBatch` / validation unit):

- Balanced functional journal → `OK`.
- Unbalanced functional (DR≠CR in functional) → `ERROR`.
- Missing/inactive account on a line → `ERROR`.
- Closed target period → `WARNING` (still HELD, committable).

**Commit:** (spy on `GLService.prototype.createJournal` and `.postJournal`)

- Honors governance: when `createJournal` returns `PENDING_APPROVAL`, `postJournal` is **not** called (left for approvers); when it returns `DRAFT`, `postJournal` **is** called.
- Idempotent: a second `commit` on a `COMMITTED` batch creates no new journals (no `createJournal` calls).
- `REJECTED` items are skipped (not passed to `createJournal`).
- `ERROR` items are skipped.
- An item whose `createJournal` throws → item `ERROR`, batch still flips `COMMITTED`, other items still commit.

**Review:**

- Reject moves `HELD → REJECTED` and updates counts; restore reverses it; both blocked once batch is `COMMITTED`.

**Mode routing:**

- Scheduled trigger forces `AUTO_COMMIT` (uses existing `writeToTarget`, no batch created).
- Interactive `HOLD` profile produces a batch and writes no journals until commit.

---

## 8. Affected files (orientation for the plan)

**API**

- `apps/api/src/db/schema-tenant.prisma` — new enums + `TransferBatch`/`TransferBatchItem`, `reviewMode` on `TransferProfile`; tenant migration.
- `apps/api/src/jobs/transfer-desk-pipeline.ts` — mode resolution + `stageBatch` branch.
- `apps/api/src/jobs/transfer-desk-batch-stager.ts` _(new)_ — build + validate items from `MappedJournal[]`.
- `apps/api/src/modules/transfer-desk/batch-service.ts` _(new)_ — list/get/reject/restore/discard/commit.
- `apps/api/src/modules/transfer-desk/batch-router.ts` _(new)_ — routes above; register in the transfer-desk module.
- `apps/api/tests/transfer-desk-batch.test.ts` _(new)_.

**Web**

- `apps/web/app/[tenant]/(dashboard)/transfer-desk/batches/page.tsx` _(new)_.
- `apps/web/app/[tenant]/(dashboard)/transfer-desk/batches/[id]/page.tsx` _(new)_.
- transfer-desk web API client — add batch endpoints.

---

## 9. Open items deferred to feature (A)

- Generalised, config-driven mapping to arbitrary targets (replace the hardcoded `transfer-desk-record-mapper.ts` switch).
- Held batches for AP/AR and the new (A) targets, reusing this batch/review/commit flow.
