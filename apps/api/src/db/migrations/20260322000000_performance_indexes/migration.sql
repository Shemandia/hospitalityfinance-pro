-- Performance indexes, materialized view, and GIN indexes for audit JSONB
-- Sprint 17: Performance & Security Hardening
--
-- CORRECTED: the original revision of this migration addressed tables and
-- columns as quoted PascalCase ("AccountPeriodBalance", "entityId", …). Prisma
-- maps every model to snake_case via @@map / @map, so those relations do not
-- exist: Postgres raised 42P01 on the first statement and aborted the whole
-- migration, meaning mv_period_account_balances below was never created.
-- All identifiers are now snake_case, verified against schema-tenant.prisma.
--
-- Indexes that Prisma already builds from the schema have been removed rather
-- than merely re-cased — re-declaring them under a different name creates a
-- second physical index on every tenant database for no read benefit. See the
-- comment block in db/sql/performance.sql for the full list.

-- ── Composite indexes ────────────────────────────────────────────────────────
-- Only indexes with no Prisma equivalent.

-- Journals filtered by origin (import reconciliation, source-scoped reports).
CREATE INDEX IF NOT EXISTS idx_journal_entity_source
  ON journals (entity_id, source);

-- Outstanding-invoice scans. Partial indexes: far smaller than the full
-- (entity_id, status, due_date) index Prisma builds, because settled invoices
-- dominate the table over time. Used by ageing, dunning and payment runs.
CREATE INDEX IF NOT EXISTS idx_arinvoice_due_date_outstanding
  ON ar_invoices (entity_id, due_date)
  WHERE status NOT IN ('PAID', 'CANCELLED');

CREATE INDEX IF NOT EXISTS idx_apinvoice_due_date_outstanding
  ON ap_invoices (entity_id, due_date)
  WHERE status NOT IN ('PAID', 'CANCELLED');

-- ── GIN indexes on audit_events JSONB columns ────────────────────────────────
-- Enables fast JSON key/value searches on audit before/after state.

CREATE INDEX IF NOT EXISTS idx_audit_before_state_gin
  ON audit_events USING GIN (before_state jsonb_path_ops);

CREATE INDEX IF NOT EXISTS idx_audit_after_state_gin
  ON audit_events USING GIN (after_state jsonb_path_ops);

-- ── audit_events: event type + timestamp for compliance queries ──────────────
-- Prisma indexes (entity_id, resource_type, resource_id, created_at); this
-- serves the different "what happened of type X, most recent first" pattern.

CREATE INDEX IF NOT EXISTS idx_audit_entity_event_type
  ON audit_events (entity_id, event_type, created_at DESC);

-- ── journal_lines: dimension-based queries (USALI reporting, IC elimination) ─

CREATE INDEX IF NOT EXISTS idx_journalline_dimension1
  ON journal_lines (dimension1) WHERE dimension1 IS NOT NULL;

-- ── Materialized View: Period Account Balances ───────────────────────────────
-- Pre-joins Account + AccountPeriodBalance + Period for fast reporting.
-- Used by Trial Balance, USALI, KPI, Balance Sheet and Cash Flow queries.
--
-- Column-name convention is load-bearing: the three id columns are aliased to
-- quoted camelCase ("entityId", "periodId", "accountId") and every other column
-- is unquoted snake_case. All consumers depend on exactly this shape —
-- kpi/service.ts, consolidation/service.ts, budget/service.ts and
-- jobs/report-generation-job.ts. Do not "normalise" these aliases.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_period_account_balances AS
SELECT
  apb.entity_id                       AS "entityId",
  apb.period_id                       AS "periodId",
  apb.account_id                      AS "accountId",
  p.year,
  p.month,
  p.name                              AS period_name,
  p.status                            AS period_status,
  a.code                              AS account_code,
  a.name                              AS account_name,
  a.type                              AS account_type,
  a.normal_balance                    AS normal_balance,
  a.usali_category                    AS usali_category,
  a.usali_department                  AS usali_department,
  a.level                             AS account_level,
  a.is_active                         AS is_active,
  apb.opening_balance,
  apb.period_debits,
  apb.period_credits,
  apb.closing_balance
FROM account_period_balances apb
JOIN accounts a ON a.id = apb.account_id
JOIN periods  p ON p.id = apb.period_id;

-- Indexes on materialized view.
-- The unique index is REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY
-- (jobs/mv-refresh-job.ts). Without it the refresh takes an exclusive lock.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pab_pk
  ON mv_period_account_balances ("entityId", "periodId", "accountId");

CREATE INDEX IF NOT EXISTS idx_mv_pab_entity_period
  ON mv_period_account_balances ("entityId", "periodId");

CREATE INDEX IF NOT EXISTS idx_mv_pab_entity_type
  ON mv_period_account_balances ("entityId", "account_type");

CREATE INDEX IF NOT EXISTS idx_mv_pab_entity_period_active
  ON mv_period_account_balances ("entityId", "periodId")
  WHERE is_active = true;
