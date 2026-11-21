-- Import feature, step 1 (docs/IMPORT-PLAN.md section 3): what the posting
-- contract needs from the database.
--
--   * Entities have a code, unique in the tenant: documents name their
--     entity by code.
--   * Source systems are tenant data (no enum in code).
--   * Journals carry documentDate, sourceSystem and sourceDocumentRef. A
--     source document posts once per entity: a unique index refuses the
--     second one, even when two imports race.
--   * documentDate always lies in the journal's period. Journals created by
--     code that does not set it yet (AP, AR, FX, assets, ...: WP-U gives
--     each its own business date) get one from the trigger below.
--   * Transfer profiles carry the import policies; execution logs link a
--     document to the journal it created.

-- The checks and the backfill below read every row. Under FORCE row-level
-- security the owner sees none unless it lifts the policies; it may, being
-- the database owner (SEC-11). Lifted for this migration's transaction only.
SELECT set_config('app.bypass_rls', 'true', true);

-- ── 1. Entity codes: required and unique in the tenant ──────────────────────

DO $$
DECLARE
  problems text;
BEGIN
  SELECT string_agg(format('%s (%s)', name, coalesce(code, 'no code')), ', ' ORDER BY name)
    INTO problems
    FROM entities e
   WHERE e.code IS NULL OR btrim(e.code) = ''
      OR EXISTS (SELECT 1 FROM entities o WHERE o.code = e.code AND o.id <> e.id);
  IF problems IS NOT NULL THEN
    RAISE EXCEPTION 'Every entity needs a code unique in the tenant before this release. Fix: %', problems
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

ALTER TABLE "entities" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "entities_code_key" ON "entities"("code");

-- ── 2. Source systems ───────────────────────────────────────────────────────

CREATE TABLE "source_systems" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_systems_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_systems_code_key" ON "source_systems"("code");

-- ── 3. Journals ─────────────────────────────────────────────────────────────

ALTER TABLE "journals"
    ADD COLUMN "document_date" DATE,
    ADD COLUMN "source_system" VARCHAR(20),
    ADD COLUMN "source_document_ref" VARCHAR(100);

-- A date in the journal's period for a journal that has none: `reference`
-- when it falls in the period's month, else the period's last day (a journal
-- booked after month end into that month is a month-end entry).
CREATE FUNCTION journal_date_in_period(period_id TEXT, reference DATE)
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
           WHEN extract(year FROM reference) = p.year AND extract(month FROM reference) = p.month
             THEN reference
           ELSE (make_date(p.year, p.month, 1) + interval '1 month - 1 day')::date
         END
    FROM periods p
   WHERE p.id = period_id;
$$;

-- Backfill: the posting date, else the creation date, kept inside the period.
UPDATE "journals"
   SET "document_date" = journal_date_in_period("period_id", coalesce("posted_at", "created_at")::date);

-- Prisma keeps the column optional so that code which does not know the
-- business date yet can leave it out; the database still requires it.
ALTER TABLE "journals"
    ADD CONSTRAINT "journals_document_date_required" CHECK ("document_date" IS NOT NULL),
    ADD CONSTRAINT "journals_source_ref_pair"
        CHECK (("source_system" IS NULL) = ("source_document_ref" IS NULL)),
    ADD CONSTRAINT "journals_source_system_fkey"
        FOREIGN KEY ("source_system") REFERENCES "source_systems"("code")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- The duplicate check of the import contract. Journals without a source
-- (NULLs) never conflict: NULLs are distinct in a unique index.
CREATE UNIQUE INDEX "journals_entity_id_source_system_source_document_ref_key"
    ON "journals"("entity_id", "source_system", "source_document_ref");

CREATE FUNCTION journal_document_date()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p_year int;
  p_month int;
BEGIN
  IF NEW.document_date IS NULL THEN
    NEW.document_date := journal_date_in_period(NEW.period_id, current_date);
    RETURN NEW;
  END IF;
  SELECT year, month INTO p_year, p_month FROM periods WHERE id = NEW.period_id;
  IF extract(year FROM NEW.document_date) <> p_year OR extract(month FROM NEW.document_date) <> p_month THEN
    RAISE EXCEPTION 'Journal document date % is not in its period %-%', NEW.document_date, p_year, lpad(p_month::text, 2, '0')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_journal_document_date"
    BEFORE INSERT OR UPDATE OF "document_date", "period_id" ON "journals"
    FOR EACH ROW EXECUTE FUNCTION journal_document_date();

-- ── 4. Transfer profiles: import policies ───────────────────────────────────

CREATE TYPE "ImportAtomicity" AS ENUM ('PER_DOCUMENT', 'WHOLE_FILE');
CREATE TYPE "UnmappedPolicy" AS ENUM ('REJECT', 'HOLD', 'SUSPENSE');

ALTER TABLE "transfer_profiles"
    ADD COLUMN "atomicity" "ImportAtomicity" NOT NULL DEFAULT 'PER_DOCUMENT',
    ADD COLUMN "unmapped_policy" "UnmappedPolicy" NOT NULL DEFAULT 'REJECT',
    ADD COLUMN "suspense_account_code" VARCHAR(30),
    ADD COLUMN "fx_rate_type" "FXRateType",
    ADD COLUMN "source_system_code" VARCHAR(20);

ALTER TABLE "transfer_profiles"
    ADD CONSTRAINT "transfer_profiles_suspense_needs_account"
        CHECK ("unmapped_policy" <> 'SUSPENSE' OR "suspense_account_code" IS NOT NULL),
    ADD CONSTRAINT "transfer_profiles_source_system_code_fkey"
        FOREIGN KEY ("source_system_code") REFERENCES "source_systems"("code")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 5. Execution logs: document and journal ─────────────────────────────────

ALTER TABLE "transfer_execution_logs"
    ADD COLUMN "document_ref" VARCHAR(100),
    ADD COLUMN "journal_id" TEXT;

ALTER TABLE "transfer_execution_logs"
    ADD CONSTRAINT "transfer_execution_logs_journal_id_fkey"
        FOREIGN KEY ("journal_id") REFERENCES "journals"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "transfer_execution_logs_journal_id_idx" ON "transfer_execution_logs"("journal_id");

SELECT set_config('app.bypass_rls', '', true);
