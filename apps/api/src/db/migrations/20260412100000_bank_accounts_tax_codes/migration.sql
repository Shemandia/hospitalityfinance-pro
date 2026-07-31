-- Bank Accounts master table
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "gl_account_id" UUID,
    "bank_name" VARCHAR(200) NOT NULL,
    "account_name" VARCHAR(200),
    "account_number" VARCHAR(50) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "swift_code" VARCHAR(11),
    "iban" VARCHAR(34),
    "branch_code" VARCHAR(20),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bank_accounts_entity_id_account_number_key" UNIQUE ("entity_id", "account_number"),
    CONSTRAINT "bank_accounts_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bank_accounts_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "bank_accounts_entity_id_is_active_idx" ON "bank_accounts"("entity_id", "is_active");

-- Tax type enum
CREATE TYPE "TaxType" AS ENUM ('VAT', 'WHT', 'SALES_TAX', 'EXCISE');

-- Tax Codes table
CREATE TABLE "tax_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" VARCHAR(200),
    "tax_type" "TaxType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_codes_entity_id_code_key" UNIQUE ("entity_id", "code"),
    CONSTRAINT "tax_codes_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "tax_codes_entity_id_tax_type_is_active_idx" ON "tax_codes"("entity_id", "tax_type", "is_active");

-- Tax Rates table
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tax_code_id" UUID NOT NULL,
    "rate" DECIMAL(8,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_rates_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "tax_rates_tax_code_id_is_current_idx" ON "tax_rates"("tax_code_id", "is_current");

-- Add tax_code_id FK column to ap_invoice_lines
ALTER TABLE "ap_invoice_lines" ADD COLUMN "tax_code_id" UUID;
ALTER TABLE "ap_invoice_lines" ADD CONSTRAINT "ap_invoice_lines_tax_code_id_fkey"
    FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ap_invoice_lines_tax_code_id_idx" ON "ap_invoice_lines"("tax_code_id");

-- Add FK constraints for existing bank_account_id columns
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_bank_account_id_fkey"
    FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ap_payments_bank_account_id_idx" ON "ap_payments"("bank_account_id");

ALTER TABLE "ar_receipts" ADD CONSTRAINT "ar_receipts_bank_account_id_fkey"
    FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ar_receipts_bank_account_id_idx" ON "ar_receipts"("bank_account_id");

ALTER TABLE "payment_profiles" ADD CONSTRAINT "payment_profiles_bank_account_id_fkey"
    FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "payment_profiles_bank_account_id_idx" ON "payment_profiles"("bank_account_id");
