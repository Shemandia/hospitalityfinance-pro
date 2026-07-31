# HFP — P0 Fix Campaign · Session Handoff

**Created:** 2026-07-26
**Context:** Follows the deep audit in `HFP-Feature-Readiness-Study.html` (same folder — open it for the full picture).
**Goal:** Production-readiness for the owner's own hotels. Fix financial correctness first.
**Working agreement:** work on a branch, run `pnpm test` before and after each fix, one blocker per commit.

---

## Why this file exists

The audit ran in a cloud session where git and the test suite were unreachable through the folder mount
(stale worktree registrations + `.git/index.lock` that couldn't be deleted; pnpm symlinks didn't resolve).
This campaign is being restarted **on the user's own machine** so git and vitest work.

Housekeeping before starting:

```bash
git worktree prune                 # clears stale .claude/worktrees registrations
rm -f .git/index.lock .git/index.lock.stale   # the .stale copy was left by the cloud session
git status                         # should be clean on main
git checkout -b fix/p0-kpi-materialized-view
```

---

## The nine P0 blockers (fix in this order)

| #     | Blocker                                                           | Core location                                                                           |
| ----- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **1** | **Materialized view never created → all KPI/BS/CF endpoints 500** | `db/sql/performance.sql`, `db/sqlRunner.ts`                                             |
| 2     | Opening balances never carry forward between periods              | `modules/period/service.ts`, `modules/gl/repository.ts`                                 |
| 3     | Year-end cleardown sums final period only                         | `modules/period/year-end-cleardown.ts:149-172`                                          |
| 4     | AP/AR post and pay net of tax — no VAT                            | `modules/ap/service.ts:584-625,702`, `modules/ar/service.ts:170`                        |
| 5     | Two balance writers with opposite sign conventions                | `modules/fx/repository.ts:218`, `modules/fixed-asset/service.ts:498`                    |
| 6     | FX revaluation double-posts on re-run                             | `modules/fx/service.ts:297-310`                                                         |
| 7     | TZS zero-decimal unhandled (display + payment files)              | `apps/web/lib/format.ts:74`, `modules/ap/service.ts:187,216,269`                        |
| 8     | Consolidation eliminations mix functional/reporting currency      | `modules/consolidation/service.ts:314,209`                                              |
| 9     | Generic imports duplicate journals on re-run                      | `jobs/transfer-desk-record-mapper.ts:122`, `modules/transfer-desk/batch-service.ts:116` |

**Start with #1.** It is small, contained, carries no schema risk, and fixes the 500-error flood the user
actually sees in the browser console. It also unblocks meaningful verification of #2, because the balance
sheet and trial balance reports read through the same view.

---

## FIX #1 — Materialized view / KPI 500s

### Root cause (verified in code)

`apps/api/src/db/sql/performance.sql` addresses tables and columns in **PascalCase / camelCase**:

```sql
CREATE INDEX IF NOT EXISTS idx_apb_entity_period
  ON "AccountPeriodBalance" ("entityId", "periodId");     -- line 11-12
```

But Prisma maps every model to **snake_case** via `@@map` / `@map`:

| Prisma model           | Real table                |
| ---------------------- | ------------------------- |
| `AccountPeriodBalance` | `account_period_balances` |
| `Journal`              | `journals`                |
| `JournalLine`          | `journal_lines`           |
| `ARInvoice`            | `ar_invoices`             |
| `APInvoice`            | `ap_invoices`             |
| `FXRate`               | `fx_rates`                |
| `ImportLog`            | `import_logs`             |
| `Account`              | `accounts`                |
| `PMSStatistic`         | `pms_statistics`          |

Columns are snake_case too (`entity_id`, `period_id`, `account_id`, `opening_balance`, `closing_balance`) —
confirmed by the working raw SQL in `modules/gl/repository.ts:492` and its
`ON CONFLICT (entity_id, account_id, period_id)`.

The double-quoted PascalCase identifiers therefore **do not exist**. Postgres raises `42P01`
(undefined_table) on the very first statement. And `executeSqlFile` in `db/sqlRunner.ts:116-124`
runs statements sequentially with **no error handling**, so that first failure aborts the whole file —
meaning `CREATE MATERIALIZED VIEW ... mv_period_account_balances` at line 73 is **never reached**.

Downstream 500s (raw PG error is not a `ServiceError`, so `shared/router-utils.ts:28-31` maps it to
`INTERNAL_SERVER_ERROR`):

- `getRevPAR` — `modules/kpi/service.ts:183-188` → route `/kpi/revpar`
- `getBalanceSheet` — `modules/kpi/service.ts:279-287`
- `getCashFlow` — `modules/kpi/service.ts:356-363`

Corroboration that this is the real cause: `getUSALI` (`modules/kpi/service.ts:463-471`) queries the
**base table** `account_period_balances` directly rather than the view — and `/usali` works while
`/revpar` 500s.

The same PascalCase bug exists in `db/migrations/20260322000000_performance_indexes/migration.sql:7-8`,
so `prisma migrate deploy` would abort there too.

Also broken: the `pms_statistics` index at `performance.sql:62` names columns `periodId` / `metric`
which do not exist on that model (it has `stat_date`, `occupied_rooms`, …), so it could never apply
even after the table name is fixed.

Note `modules/tenant/provisioning-service.ts:230-248` swallows `42P01`/`42P07`, which is why freshly
provisioned tenants _do_ get the MV — but then silently get **none** of the performance indexes.

### The fix

1. **Rewrite `apps/api/src/db/sql/performance.sql`** — snake*case for every table \_and* column.
   Verify each name against `apps/api/src/db/schema-tenant.prisma` rather than guessing.
2. **Fix the `pms_statistics` index** to use real columns (`entity_id`, `stat_date`).
3. **Apply the identical corrections** to `db/migrations/20260322000000_performance_indexes/migration.sql`.
   Do not edit an already-applied migration in place if it has run anywhere — add a new corrective
   migration instead and check `_prisma_migrations` first.
4. **Harden `executeSqlFile`** (`db/sqlRunner.ts:116-124`) to catch and log `42P01` / `42P07` per statement
   and continue, matching what `provisioning-service.ts:230-248` already does — so one bad statement can
   never again silently cost you the view.
5. **Backfill existing tenant databases** — they are missing both the MV and the indexes. Needs a small
   idempotent repair script run per tenant DB (`CREATE MATERIALIZED VIEW IF NOT EXISTS` + indexes +
   an initial `REFRESH`).
6. **Make sure the view actually refreshes.** `jobs/mv-refresh-job.ts` is a 15-minute cron whose
   `enqueueMVRefresh` uses a singleton `jobId` that can drop a refresh requested while one is running.
   At minimum, trigger a refresh after posting/import so month-end numbers aren't stale.
7. **Resolve the MV-vs-base-table split** in `modules/kpi/service.ts` — `getUSALI` reads the base table
   while RevPAR/BS/CF read the view. Pick one source so the two can never disagree.

### Verification

- `pnpm test` green before and after.
- Add a regression test asserting `mv_period_account_balances` exists and returns rows after a posting.
- Manually: `GET /api/v1/kpi/revpar` returns 200; browser console no longer floods with 500s
  (this is the symptom seen at `localhost:3001/<tenant>/gl/accounts/import`).
- `\d+ account_period_balances` in psql shows the new indexes present.

### Watch out for

- `CREATE INDEX` on a large live table locks writes — use `CREATE INDEX CONCURRENTLY` outside a
  transaction for the production tenant DBs.
- `REFRESH MATERIALIZED VIEW` without `CONCURRENTLY` takes an exclusive lock; `CONCURRENTLY` needs a
  unique index on the view.
- This runs against **live hotel data** (multiple tenant databases). Back up before the repair script.

---

## After #1

Next is **#2, the balance carry-forward engine** — the deepest fix and the one that makes the trial
balance and balance sheet correct. Do it on its own branch with its own tests; it touches posting,
period close, and every report. Re-read the audit's GL section before starting.
