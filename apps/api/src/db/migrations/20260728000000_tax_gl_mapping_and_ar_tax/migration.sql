-- VAT/tax support for AP and AR posting.
--
-- Before this, AP invoices posted and were paid net of tax and AR had no tax
-- fields at all, so a Tanzanian 18% VAT invoice booked the wrong liability and
-- underpaid the supplier by the tax amount. Two things were missing:
--
--   1. tax_codes carried rates but no GL account, so there was nowhere to post
--      input or output tax. The seeded USALI chart has no VAT accounts either,
--      so no code convention could be assumed — the mapping has to be explicit.
--   2. ar_invoices had a single `amount` column with no net/tax split.
--
-- Both additions are nullable / defaulted, so this migration is safe to apply
-- to live tenant databases and changes no existing balances.

-- ── tax_codes: GL account mapping ────────────────────────────────────────────

ALTER TABLE tax_codes
  ADD COLUMN IF NOT EXISTS input_tax_account_id  TEXT,
  ADD COLUMN IF NOT EXISTS output_tax_account_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tax_codes_input_tax_account_id_fkey'
  ) THEN
    ALTER TABLE tax_codes
      ADD CONSTRAINT tax_codes_input_tax_account_id_fkey
      FOREIGN KEY (input_tax_account_id) REFERENCES accounts(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tax_codes_output_tax_account_id_fkey'
  ) THEN
    ALTER TABLE tax_codes
      ADD CONSTRAINT tax_codes_output_tax_account_id_fkey
      FOREIGN KEY (output_tax_account_id) REFERENCES accounts(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── ar_invoices: net / tax split ─────────────────────────────────────────────

ALTER TABLE ar_invoices
  ADD COLUMN IF NOT EXISTS net_amount  DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount  DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_code_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ar_invoices_tax_code_id_fkey'
  ) THEN
    ALTER TABLE ar_invoices
      ADD CONSTRAINT ar_invoices_tax_code_id_fkey
      FOREIGN KEY (tax_code_id) REFERENCES tax_codes(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Existing invoices predate tax tracking: their `amount` is entirely revenue.
-- Setting net_amount = amount preserves the invariant amount = net + tax with
-- tax = 0, so no posted balance changes and no journal is affected.
UPDATE ar_invoices SET net_amount = amount WHERE net_amount = 0 AND amount <> 0;
