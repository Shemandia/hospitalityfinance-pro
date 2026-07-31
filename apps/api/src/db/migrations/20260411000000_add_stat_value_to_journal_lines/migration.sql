-- Add statistical value column to journal_lines for memo / STATISTICAL-type postings.
-- Financial postings leave this NULL. Statistics imports (EZZDS daily stats,
-- EZZMS market segment) set debit=0, credit=0 and put the parsed quantity here.

ALTER TABLE "journal_lines"
  ADD COLUMN "stat_value" DECIMAL(18,3);

COMMENT ON COLUMN "journal_lines"."stat_value" IS
  'Statistical value for STATISTICAL-type account postings. Financial postings leave this NULL. For statistics imports: debit=0, credit=0, stat_value holds the parsed quantity (÷1000 from SAF).';
