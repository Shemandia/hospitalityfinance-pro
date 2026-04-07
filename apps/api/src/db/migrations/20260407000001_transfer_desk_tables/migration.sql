-- Transfer Desk foundation tables (Sprint 2)
-- See HFP_TransferDesk_TechnicalSpecification_v1_0.md modules 1-7 (TD-DB-001..018).
--
-- All tables are TENANT-WIDE except transfer_journal_ranges (entity-scoped per
-- spec TD-DB-006). RLS is enabled on every table for consistency with the rest
-- of the schema; tenant-wide tables use open policies (USING (true)).

-- ── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE "ProfileType" AS ENUM (
  'IMPORT', 'EXPORT', 'PROCESS', 'INTERNAL_TRANSFER', 'EXTERNAL_TRANSFER'
);

CREATE TYPE "ExecutionStatus" AS ENUM (
  'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'
);

CREATE TYPE "ExecutionLogStatus" AS ENUM (
  'SUCCESS', 'FAILED', 'SKIPPED'
);

CREATE TYPE "FormatClassification" AS ENUM (
  'DELIMITED', 'SINGLE_FIXED', 'MULTIPLE_FIXED', 'OTHER_FLAT', 'USER_XML', 'SIMPLE_XML'
);

CREATE TYPE "ScriptType" AS ENUM ('TML', 'XSL');

CREATE TYPE "LookupValueType" AS ENUM (
  'CONSTANT', 'COPY', 'MAP_TO', 'OMIT', 'REVERSE_SIGN'
);

CREATE TYPE "SavePayloadOption" AS ENUM (
  'NONE', 'INPUT', 'OUTPUT', 'BOTH'
);

-- ── transfer_formats (TD-DB-010) ────────────────────────────────────────────

CREATE TABLE "transfer_formats" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "classification" "FormatClassification" NOT NULL,
  "fsd_xml" TEXT NOT NULL,
  "gui_state" JSONB,
  "is_system" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_valid" BOOLEAN NOT NULL DEFAULT FALSE,
  "validation_errors" JSONB,
  "created_by" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "transfer_formats_classification_idx" ON "transfer_formats"("classification");

-- ── transfer_transformations (TD-DB-011) ────────────────────────────────────

CREATE TABLE "transfer_transformations" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "script_type" "ScriptType" NOT NULL DEFAULT 'TML',
  "source_format_id" TEXT REFERENCES "transfer_formats"("id"),
  "target_format_id" TEXT REFERENCES "transfer_formats"("id"),
  "source_component" TEXT,
  "target_component" TEXT,
  "tml_xml" TEXT,
  "rules_json" JSONB,
  "functions_json" JSONB,
  "is_system" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_valid" BOOLEAN NOT NULL DEFAULT FALSE,
  "validation_errors" JSONB,
  "created_by" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── transfer_filters (TD-DB-005) ────────────────────────────────────────────

CREATE TABLE "transfer_filters" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "source_component" TEXT NOT NULL,
  "filter_clauses" JSONB NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── transfer_profiles (TD-DB-003) ───────────────────────────────────────────

CREATE TABLE "transfer_profiles" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "profile_type" "ProfileType" NOT NULL,
  "source_component" TEXT,
  "target_component" TEXT,
  "source_format_id" TEXT REFERENCES "transfer_formats"("id"),
  "target_format_id" TEXT REFERENCES "transfer_formats"("id"),
  "transformation_id" TEXT REFERENCES "transfer_transformations"("id"),
  "filter_id" TEXT REFERENCES "transfer_filters"("id"),
  "source_params" JSONB,
  "target_params" JSONB,
  "is_valid" BOOLEAN NOT NULL DEFAULT FALSE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "save_payload" "SavePayloadOption" NOT NULL DEFAULT 'NONE',
  "created_by" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "transfer_profiles_profile_type_is_active_idx" ON "transfer_profiles"("profile_type", "is_active");

-- ── transfer_profile_versions (TD-DB-004) ───────────────────────────────────

CREATE TABLE "transfer_profile_versions" (
  "id" TEXT PRIMARY KEY,
  "profile_id" TEXT NOT NULL REFERENCES "transfer_profiles"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "changed_by" TEXT,
  "changed_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "change_note" TEXT,
  UNIQUE ("profile_id", "version")
);
CREATE INDEX "transfer_profile_versions_profile_id_changed_at_idx" ON "transfer_profile_versions"("profile_id", "changed_at");

-- ── transfer_journal_ranges (TD-DB-006) ─────────────────────────────────────
-- The only TD table that's entity-scoped (business_unit per spec).

CREATE TABLE "transfer_journal_ranges" (
  "id" TEXT PRIMARY KEY,
  "profile_id" TEXT NOT NULL REFERENCES "transfer_profiles"("id") ON DELETE CASCADE,
  "entity_id" TEXT NOT NULL,
  "ledger" CHAR(1) NOT NULL,
  "journal_number_from" BIGINT NOT NULL,
  "journal_number_to" BIGINT NOT NULL,
  "last_execution_id" TEXT,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("profile_id", "entity_id", "ledger")
);
CREATE INDEX "transfer_journal_ranges_entity_id_idx" ON "transfer_journal_ranges"("entity_id");

-- ── transfer_automations (TD-DB-007) ────────────────────────────────────────

CREATE TABLE "transfer_automations" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "is_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── transfer_automation_steps (TD-DB-008) ───────────────────────────────────

CREATE TABLE "transfer_automation_steps" (
  "id" TEXT PRIMARY KEY,
  "automation_id" TEXT NOT NULL REFERENCES "transfer_automations"("id") ON DELETE CASCADE,
  "profile_id" TEXT NOT NULL REFERENCES "transfer_profiles"("id"),
  "step_order" INTEGER NOT NULL,
  "fail_on_error" BOOLEAN NOT NULL DEFAULT TRUE,
  "source_param_overrides" JSONB,
  "target_param_overrides" JSONB,
  UNIQUE ("automation_id", "step_order")
);
CREATE INDEX "transfer_automation_steps_profile_id_idx" ON "transfer_automation_steps"("profile_id");

-- ── transfer_automation_schedules (TD-DB-009) ───────────────────────────────

CREATE TABLE "transfer_automation_schedules" (
  "id" TEXT PRIMARY KEY,
  "automation_id" TEXT NOT NULL REFERENCES "transfer_automations"("id") ON DELETE CASCADE,
  "cron_expression" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "run_as_user" TEXT,
  "next_run_at" TIMESTAMP,
  "bullmq_repeat_key" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "transfer_automation_schedules_next_run_at_idx" ON "transfer_automation_schedules"("next_run_at");

-- ── transfer_lookup_tables (TD-DB-012) ──────────────────────────────────────

CREATE TABLE "transfer_lookup_tables" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── transfer_lookup_columns (TD-DB-013) ─────────────────────────────────────

CREATE TABLE "transfer_lookup_columns" (
  "id" TEXT PRIMARY KEY,
  "table_id" TEXT NOT NULL REFERENCES "transfer_lookup_tables"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "column_order" INTEGER NOT NULL,
  UNIQUE ("table_id", "name"),
  UNIQUE ("table_id", "column_order")
);

-- ── transfer_lookup_rows (TD-DB-014) ────────────────────────────────────────
-- Range matching is alphabetical, NOT numeric (spec TD-BL-021).

CREATE TABLE "transfer_lookup_rows" (
  "id" TEXT PRIMARY KEY,
  "table_id" TEXT NOT NULL REFERENCES "transfer_lookup_tables"("id") ON DELETE CASCADE,
  "business_unit" TEXT,
  "range_from" TEXT NOT NULL,
  "range_to" TEXT NOT NULL,
  "row_order" INTEGER NOT NULL
);
CREATE INDEX "transfer_lookup_rows_table_id_business_unit_range_from_range_to_idx"
  ON "transfer_lookup_rows"("table_id", "business_unit", "range_from", "range_to");
CREATE INDEX "transfer_lookup_rows_table_id_row_order_idx"
  ON "transfer_lookup_rows"("table_id", "row_order");

-- ── transfer_lookup_values (TD-DB-015) ──────────────────────────────────────

CREATE TABLE "transfer_lookup_values" (
  "id" TEXT PRIMARY KEY,
  "row_id" TEXT NOT NULL REFERENCES "transfer_lookup_rows"("id") ON DELETE CASCADE,
  "column_id" TEXT NOT NULL REFERENCES "transfer_lookup_columns"("id") ON DELETE CASCADE,
  "value_type" "LookupValueType" NOT NULL,
  "value_param" TEXT,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE ("row_id", "column_id")
);

-- ── transfer_folders (TD-DB-016) ────────────────────────────────────────────

CREATE TABLE "transfer_folders" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "parent_id" TEXT REFERENCES "transfer_folders"("id"),
  "s3_prefix" TEXT NOT NULL UNIQUE,
  "created_by" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("parent_id", "name")
);

-- ── transfer_folder_access (TD-DB-017) ──────────────────────────────────────

CREATE TABLE "transfer_folder_access" (
  "id" TEXT PRIMARY KEY,
  "folder_id" TEXT NOT NULL REFERENCES "transfer_folders"("id") ON DELETE CASCADE,
  "role_name" TEXT NOT NULL,
  "can_read" BOOLEAN NOT NULL DEFAULT TRUE,
  "can_write" BOOLEAN NOT NULL DEFAULT FALSE,
  "can_delete" BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE ("folder_id", "role_name")
);

-- ── transfer_files (TD-DB-018) ──────────────────────────────────────────────

CREATE TABLE "transfer_files" (
  "id" TEXT PRIMARY KEY,
  "folder_id" TEXT NOT NULL REFERENCES "transfer_folders"("id") ON DELETE CASCADE,
  "filename" TEXT NOT NULL,
  "s3_key" TEXT NOT NULL UNIQUE,
  "file_size" BIGINT NOT NULL,
  "content_type" TEXT NOT NULL,
  "encoding" TEXT NOT NULL DEFAULT 'UTF-8',
  "metadata" JSONB,
  "uploaded_by" TEXT,
  "uploaded_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "transfer_files_folder_id_uploaded_at_idx" ON "transfer_files"("folder_id", "uploaded_at");

-- ── transfer_executions (TD-DB-001) ─────────────────────────────────────────

CREATE TABLE "transfer_executions" (
  "id" TEXT PRIMARY KEY,
  "profile_id" TEXT NOT NULL REFERENCES "transfer_profiles"("id"),
  "automation_id" TEXT REFERENCES "transfer_automations"("id"),
  "automation_step_order" INTEGER,
  "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
  "job_id" TEXT,
  "triggered_by" TEXT,
  "records_total" INTEGER NOT NULL DEFAULT 0,
  "records_succeeded" INTEGER NOT NULL DEFAULT 0,
  "records_failed" INTEGER NOT NULL DEFAULT 0,
  "input_payload_key" TEXT,
  "output_payload_key" TEXT,
  "error_message" TEXT,
  "runtime_params" JSONB,
  "started_at" TIMESTAMP,
  "finished_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "transfer_executions_profile_id_created_at_idx" ON "transfer_executions"("profile_id", "created_at");
CREATE INDEX "transfer_executions_status_idx" ON "transfer_executions"("status");
CREATE INDEX "transfer_executions_automation_id_automation_step_order_idx"
  ON "transfer_executions"("automation_id", "automation_step_order");

-- ── transfer_execution_logs (TD-DB-002) ─────────────────────────────────────
-- BIGSERIAL primary key for sortable order across millions of rows.

CREATE TABLE "transfer_execution_logs" (
  "id" BIGSERIAL PRIMARY KEY,
  "execution_id" TEXT NOT NULL REFERENCES "transfer_executions"("id") ON DELETE CASCADE,
  "record_index" INTEGER NOT NULL,
  "status" "ExecutionLogStatus" NOT NULL,
  "source_data" JSONB,
  "transformed_data" JSONB,
  "error_code" TEXT,
  "error_message" TEXT
);
CREATE INDEX "transfer_execution_logs_execution_id_record_index_idx"
  ON "transfer_execution_logs"("execution_id", "record_index");
CREATE INDEX "transfer_execution_logs_execution_id_status_idx"
  ON "transfer_execution_logs"("execution_id", "status");

-- ────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- Tenant-wide tables: open policy `USING (true)`. The tenant DB itself
-- provides isolation; the policies exist for consistency with the rest of
-- the schema and so a future tightening (e.g. per-entity profiles) only
-- needs to update the policy.
--
-- transfer_journal_ranges: standard `entity_id = app_current_entity_id()`.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'transfer_profiles',
    'transfer_profile_versions',
    'transfer_filters',
    'transfer_automations',
    'transfer_automation_steps',
    'transfer_automation_schedules',
    'transfer_formats',
    'transfer_transformations',
    'transfer_lookup_tables',
    'transfer_lookup_columns',
    'transfer_lookup_rows',
    'transfer_lookup_values',
    'transfer_folders',
    'transfer_folder_access',
    'transfer_files',
    'transfer_executions',
    'transfer_execution_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_wide_policy ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_wide_policy ON %I
       USING (true)
       WITH CHECK (true)',
      tbl
    );
  END LOOP;
END $$;

-- transfer_journal_ranges: entity-scoped policy
ALTER TABLE "transfer_journal_ranges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfer_journal_ranges" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_scope_policy ON "transfer_journal_ranges";
CREATE POLICY entity_scope_policy
ON "transfer_journal_ranges"
USING (
  app_current_entity_id() IS NOT NULL
  AND entity_id = app_current_entity_id()
)
WITH CHECK (
  app_current_entity_id() IS NOT NULL
  AND entity_id = app_current_entity_id()
);
