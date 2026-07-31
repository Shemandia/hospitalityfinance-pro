-- ============================================================================
-- HospitalityFinance Pro — Performance SQL
-- Materialized view + composite indexes for reporting and KPI queries
-- Apply once after initial schema migration.
-- Re-run refresh as a scheduled job or after period close.
-- ============================================================================
--
-- IDENTIFIER CONVENTION
-- ---------------------
-- Prisma maps every model to snake_case via @@map / @map. Table and column
-- names here MUST be snake_case and unquoted. Quoting a PascalCase identifier
-- (e.g. "AccountPeriodBalance") addresses a relation that does not exist and
-- raises 42P01 — which previously aborted this entire file before the
-- materialized view below was ever created. Verify names against
-- schema-tenant.prisma before adding anything.
--
-- The materialized view is the payload of this file. Everything above it is
-- supplementary; nothing here may be allowed to prevent it being created.
--
-- INDEXES DELIBERATELY NOT DEFINED HERE
-- -------------------------------------
-- Prisma already creates the following from schema-tenant.prisma. Re-declaring
-- them under a different name would build a second, redundant physical index
-- on every tenant database — extra disk and slower writes for no read benefit.
--
--   account_period_balances (entity_id, period_id)               @@index
--   account_period_balances (entity_id, account_id, period_id)   @@unique
--   journals   (entity_id, period_id, status)                    @@index
--   journal_lines (journal_id, line_number)                      @@index
--   journal_lines (account_id)                                   @@index
--   ar_invoices (entity_id, status, due_date)                    @@index
--   ar_invoices (entity_id, customer_id, invoice_number)         @@unique
--   ap_invoices (entity_id, status, due_date)                    @@index
--   fx_rates (from_currency, to_currency, rate_type, effective_date) @@unique
--   bank_transactions (bank_statement_id, value_date)            @@index
--   import_logs (entity_id, connector_type, business_date)       @@index
--   accounts (entity_id, code)                                   @@unique
--   pms_statistics (entity_id, stat_date)                        @@index
--
-- Note on pms_statistics: an earlier revision indexed ("entityId","periodId",
-- "metric"). That model has neither a period_id nor a metric column — it keys
-- on stat_date — so the statement could never have applied. Prisma's
-- @@index([entityId, statDate]) already covers the KPI lookup pattern.

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

-- Unique index is REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY
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

-- ── Refresh helper ───────────────────────────────────────────────────────────
-- Call this after period close or significant journal postings.
-- In production, schedule via pg_cron or a BullMQ job (jobs/mv-refresh-job.ts).

-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_period_account_balances;
