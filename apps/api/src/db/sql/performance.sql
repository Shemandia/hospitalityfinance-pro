-- ============================================================================
-- HospitalityFinance Pro — Performance SQL
-- Materialized view + composite indexes for reporting and KPI queries
-- Apply once after initial schema migration.
-- Re-run refresh as a scheduled job or after period close.
-- ============================================================================

-- ── Composite indexes ────────────────────────────────────────────────────────

-- AccountPeriodBalance: primary lookup pattern in reporting queries
CREATE INDEX IF NOT EXISTS idx_apb_entity_period
  ON "AccountPeriodBalance" ("entityId", "periodId");

CREATE INDEX IF NOT EXISTS idx_apb_entity_account_period
  ON "AccountPeriodBalance" ("entityId", "accountId", "periodId");

-- Journal: common filters by entity + period + status
CREATE INDEX IF NOT EXISTS idx_journal_entity_period_status
  ON "Journal" ("entityId", "periodId", "status");

CREATE INDEX IF NOT EXISTS idx_journal_entity_source
  ON "Journal" ("entityId", "source");

-- JournalLine: join from journal, also used for account lookups
CREATE INDEX IF NOT EXISTS idx_journalline_journal_id
  ON "JournalLine" ("journalId");

CREATE INDEX IF NOT EXISTS idx_journalline_account_id
  ON "JournalLine" ("accountId");

-- ARInvoice: common filters
CREATE INDEX IF NOT EXISTS idx_arinvoice_entity_status
  ON "ARInvoice" ("entityId", "status");

CREATE INDEX IF NOT EXISTS idx_arinvoice_entity_customer
  ON "ARInvoice" ("entityId", "customerId");

CREATE INDEX IF NOT EXISTS idx_arinvoice_due_date
  ON "ARInvoice" ("entityId", "dueDate") WHERE "status" NOT IN ('PAID', 'CANCELLED');

-- APInvoice: payment run and due date lookups
CREATE INDEX IF NOT EXISTS idx_apinvoice_entity_status
  ON "APInvoice" ("entityId", "status");

CREATE INDEX IF NOT EXISTS idx_apinvoice_due_date
  ON "APInvoice" ("entityId", "dueDate") WHERE "status" NOT IN ('PAID', 'CANCELLED');

-- FXRate: most-recent-rate lookups
CREATE INDEX IF NOT EXISTS idx_fxrate_pair_type_date
  ON "FXRate" ("fromCurrency", "toCurrency", "rateType", "effectiveDate" DESC);

-- BankTransaction: matching by entity + status
CREATE INDEX IF NOT EXISTS idx_banktx_entity_status
  ON "BankTransaction" ("entityId", "status");

-- ImportLog: idempotency check
CREATE INDEX IF NOT EXISTS idx_importlog_entity_connector_date
  ON "ImportLog" ("entityId", "connectorType", "businessDate");

-- PMSStatistic: KPI lookups
CREATE INDEX IF NOT EXISTS idx_pmsstats_entity_period_metric
  ON "PMSStatistic" ("entityId", "periodId", "metric");

-- Account: code lookup (used in all report queries)
CREATE INDEX IF NOT EXISTS idx_account_entity_code
  ON "Account" ("entityId", "code");

-- ── Materialized View: Period Account Balances ───────────────────────────────
-- Pre-joins Account + AccountPeriodBalance + Period for fast reporting.
-- Used by Trial Balance, USALI, KPI, and Balance Sheet queries.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_period_account_balances AS
SELECT
  apb."entityId",
  apb."periodId",
  apb."accountId",
  p.year,
  p.month,
  p.name                              AS period_name,
  p.status                            AS period_status,
  a.code                              AS account_code,
  a.name                              AS account_name,
  a."accountType"                     AS account_type,
  a."normalBalance"                   AS normal_balance,
  a.dimension1                        AS dimension1,
  apb.opening_balance,
  apb.period_debits,
  apb.period_credits,
  apb.closing_balance
FROM "AccountPeriodBalance" apb
JOIN "Account" a ON a.id = apb."accountId"
JOIN "Period"  p ON p.id = apb."periodId";

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pab_pk
  ON mv_period_account_balances ("entityId", "periodId", "accountId");

CREATE INDEX IF NOT EXISTS idx_mv_pab_entity_period
  ON mv_period_account_balances ("entityId", "periodId");

CREATE INDEX IF NOT EXISTS idx_mv_pab_entity_type
  ON mv_period_account_balances ("entityId", "account_type");

-- ── Refresh helper ───────────────────────────────────────────────────────────
-- Call this after period close or significant journal postings.
-- In production, schedule via pg_cron or a BullMQ job.

-- REFRESH MATERIALIZED VIEW CONCURRENTLY mv_period_account_balances;
