-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('GROUP', 'PROPERTY');

-- CreateEnum
CREATE TYPE "EntityRole" AS ENUM ('ADMIN', 'CONTROLLER', 'VIEWER', 'SUPERADMIN');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'PMS', 'POS', 'PAYROLL', 'FX_REVAL', 'AP', 'AR');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WorkflowModule" AS ENUM ('GL', 'AP', 'AR');

-- CreateEnum
CREATE TYPE "JournalApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('USALI_PL', 'TRIAL_BALANCE', 'BALANCE_SHEET', 'CASHFLOW', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "APInvoiceStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'PAID', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentRunStatus" AS ENUM ('PROPOSED', 'APPROVED', 'CONFIRMED', 'PROCESSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentFileFormat" AS ENUM ('SWIFT_MT103', 'SEPA_PAIN001', 'CSV');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CHEQUE', 'CARD', 'CASH');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('CORPORATE', 'OTA', 'TRAVEL_AGENT', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "ARInvoiceStatus" AS ENUM ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FXRateType" AS ENUM ('SPOT', 'AVERAGE', 'BUDGET', 'CLOSING');

-- CreateEnum
CREATE TYPE "FXRateSource" AS ENUM ('ECB', 'OANDA', 'MANUAL');

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" VARCHAR(20),
    "type" "EntityType" NOT NULL,
    "functional_currency" TEXT NOT NULL DEFAULT 'USD',
    "reporting_currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "country_code" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "postal_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_properties" INTEGER NOT NULL DEFAULT 0,
    "parent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "keycloak_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_users" (
    "entity_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "EntityRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_users_pkey" PRIMARY KEY ("entity_id","user_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periods" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "usali_category" TEXT,
    "usali_department" TEXT,
    "normal_balance" "NormalBalance" NOT NULL,
    "allow_posting" BOOLEAN NOT NULL DEFAULT true,
    "allowed_sources" "JournalSource"[] DEFAULT ARRAY[]::"JournalSource"[],
    "is_control_account" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "parent_id" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_types" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "allowed_sources" "JournalSource"[] DEFAULT ARRAY[]::"JournalSource"[],
    "allowed_account_types" "AccountType"[] DEFAULT ARRAY[]::"AccountType"[],
    "number_prefix" VARCHAR(10) NOT NULL,
    "auto_reverse" BOOLEAN NOT NULL DEFAULT false,
    "require_balance" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journals" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "journal_type_id" TEXT,
    "reference" TEXT,
    "description" TEXT,
    "source" "JournalSource" NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "posted_at" TIMESTAMP(3),
    "functional_currency" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "journal_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL,
    "credit" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fx_rate" DECIMAL(14,8) NOT NULL DEFAULT 1,
    "debit_functional" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "credit_functional" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "dimension1" VARCHAR(50),
    "dimension2" VARCHAR(50),
    "dimension3" VARCHAR(50),
    "dimension4" VARCHAR(50),
    "dimension5" VARCHAR(50),
    "dimension6" VARCHAR(50),
    "line_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_period_balances" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "opening_balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "period_debits" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "period_credits" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "closing_balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_period_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_rules" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "module" "WorkflowModule" NOT NULL,
    "min_amount" DECIMAL(18,4) NOT NULL,
    "max_amount" DECIMAL(18,4),
    "required_approvers" TEXT[],
    "require_all" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_approvals" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "journal_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "status" "JournalApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "tax_id" TEXT,
    "currency" CHAR(3) NOT NULL,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "bank_details" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_invoices" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "gross_amount" DECIMAL(18,4) NOT NULL,
    "tax_amount" DECIMAL(18,4) NOT NULL,
    "net_amount" DECIMAL(18,4) NOT NULL,
    "functional_amount" DECIMAL(18,4) NOT NULL,
    "fx_rate" DECIMAL(14,8) NOT NULL,
    "status" "APInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "gl_journal_id" TEXT,
    "external_po_ref" VARCHAR(100),
    "payment_terms" TEXT,
    "created_by" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ap_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "gl_account_id" TEXT,
    "tax_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ap_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'OPEN',
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_received_notes" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "grn_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_received_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_received_note_lines" (
    "id" TEXT NOT NULL,
    "goods_received_note_id" TEXT NOT NULL,
    "purchase_order_line_id" TEXT NOT NULL,
    "quantity_received" DECIMAL(18,4) NOT NULL,
    "amount_received" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_received_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_payments" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "payment_run_id" TEXT,
    "payment_date" TIMESTAMP(3),
    "currency" CHAR(3),
    "amount" DECIMAL(18,4),
    "payment_method" "PaymentMethod",
    "bank_account_id" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL,
    "gl_journal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ap_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_runs" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" "PaymentRunStatus" NOT NULL,
    "bank_file_format" "PaymentFileFormat" NOT NULL,
    "bank_file_path" TEXT,
    "approved_by" TEXT,
    "confirmed_by" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_run_items" (
    "id" TEXT NOT NULL,
    "payment_run_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "invoice_count" INTEGER NOT NULL,
    "gross_amount" DECIMAL(18,4) NOT NULL,
    "credit_amount" DECIMAL(18,4) NOT NULL,
    "discount_amount" DECIMAL(18,4) NOT NULL,
    "payable_amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_run_invoices" (
    "id" TEXT NOT NULL,
    "payment_run_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "allocated_amount" DECIMAL(18,4) NOT NULL,
    "is_credit_note" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_run_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_payment_allocations" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "allocated_amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'CORPORATE',
    "credit_limit" DECIMAL(18,4),
    "currency" CHAR(3) NOT NULL,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "billing_contact" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_invoices" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "functional_amount" DECIMAL(18,4) NOT NULL,
    "fx_rate" DECIMAL(14,8) NOT NULL,
    "amount_paid" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "ARInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "gl_journal_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ar_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_receipts" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "receipt_date" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "bank_account_id" TEXT,
    "reference" TEXT,
    "gl_journal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ar_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_allocations" (
    "id" TEXT NOT NULL,
    "receipt_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "allocated_amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "user_id" TEXT,
    "event_type" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definitions" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "template" JSONB NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'QUEUED',
    "output_url" TEXT,
    "error_message" TEXT,
    "run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "decimal_places" INTEGER NOT NULL DEFAULT 2,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "from_currency" CHAR(3) NOT NULL,
    "to_currency" CHAR(3) NOT NULL,
    "rate_type" "FXRateType" NOT NULL,
    "rate" DECIMAL(14,8) NOT NULL,
    "effective_date" DATE NOT NULL,
    "source" "FXRateSource" NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_definitions" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "budget_definition_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_runs" (
    "id" TEXT NOT NULL,
    "parent_entity_id" TEXT NOT NULL,
    "reporting_currency" CHAR(3) NOT NULL,
    "period_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "elimination_journals" JSONB,
    "run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consolidation_run_entities" (
    "id" TEXT NOT NULL,
    "consolidation_run_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "local_currency" CHAR(3) NOT NULL,
    "closing_rate" DECIMAL(14,8) NOT NULL,
    "average_rate" DECIMAL(14,8) NOT NULL,
    "translated_debits" DECIMAL(18,4) NOT NULL,
    "translated_credits" DECIMAL(18,4) NOT NULL,
    "cta_amount" DECIMAL(18,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consolidation_run_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interface_definitions" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "source_format" TEXT NOT NULL,
    "target_type" TEXT NOT NULL DEFAULT 'GL_JOURNAL',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "field_mappings" JSONB NOT NULL,
    "parse_options" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interface_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connector_mappings" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "source_code" TEXT NOT NULL,
    "gl_account_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connector_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_logs" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "connector_type" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "records_total" INTEGER NOT NULL DEFAULT 0,
    "records_imported" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "error_details" JSONB,
    "gl_journal_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_statistics" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "available_rooms" INTEGER NOT NULL,
    "occupied_rooms" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_statistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "statement_date" DATE NOT NULL,
    "opening_balance" DECIMAL(18,4) NOT NULL,
    "closing_balance" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "bank_statement_id" TEXT NOT NULL,
    "value_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reference" TEXT,
    "is_reconciled" BOOLEAN NOT NULL DEFAULT false,
    "journal_line_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entities_parent_id_idx" ON "entities"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_keycloak_id_key" ON "users"("keycloak_id");

-- CreateIndex
CREATE INDEX "entity_users_user_id_idx" ON "entity_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "user_roles_entity_id_idx" ON "user_roles"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_entity_id_key" ON "user_roles"("user_id", "role_id", "entity_id");

-- CreateIndex
CREATE INDEX "periods_entity_id_status_idx" ON "periods"("entity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "periods_entity_id_year_month_key" ON "periods"("entity_id", "year", "month");

-- CreateIndex
CREATE INDEX "accounts_entity_id_parent_id_idx" ON "accounts"("entity_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_entity_id_code_key" ON "accounts"("entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_types_entity_id_code_key" ON "journal_types"("entity_id", "code");

-- CreateIndex
CREATE INDEX "journals_entity_id_period_id_status_idx" ON "journals"("entity_id", "period_id", "status");

-- CreateIndex
CREATE INDEX "journals_entity_id_created_at_idx" ON "journals"("entity_id", "created_at");

-- CreateIndex
CREATE INDEX "journals_entity_id_journal_type_id_idx" ON "journals"("entity_id", "journal_type_id");

-- CreateIndex
CREATE INDEX "journal_lines_journal_id_line_number_idx" ON "journal_lines"("journal_id", "line_number");

-- CreateIndex
CREATE INDEX "journal_lines_account_id_idx" ON "journal_lines"("account_id");

-- CreateIndex
CREATE INDEX "account_period_balances_entity_id_period_id_idx" ON "account_period_balances"("entity_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_period_balances_entity_id_account_id_period_id_key" ON "account_period_balances"("entity_id", "account_id", "period_id");

-- CreateIndex
CREATE INDEX "approval_rules_entity_id_module_is_active_idx" ON "approval_rules"("entity_id", "module", "is_active");

-- CreateIndex
CREATE INDEX "journal_approvals_entity_id_journal_id_idx" ON "journal_approvals"("entity_id", "journal_id");

-- CreateIndex
CREATE INDEX "journal_approvals_approver_id_status_idx" ON "journal_approvals"("approver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_approvals_journal_id_approver_id_key" ON "journal_approvals"("journal_id", "approver_id");

-- CreateIndex
CREATE INDEX "suppliers_entity_id_is_active_idx" ON "suppliers"("entity_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_entity_id_code_key" ON "suppliers"("entity_id", "code");

-- CreateIndex
CREATE INDEX "ap_invoices_entity_id_status_due_date_idx" ON "ap_invoices"("entity_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "ap_invoices_supplier_id_invoice_date_idx" ON "ap_invoices"("supplier_id", "invoice_date");

-- CreateIndex
CREATE UNIQUE INDEX "ap_invoices_entity_id_supplier_id_invoice_number_key" ON "ap_invoices"("entity_id", "supplier_id", "invoice_number");

-- CreateIndex
CREATE INDEX "ap_invoice_lines_invoice_id_idx" ON "ap_invoice_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "ap_invoice_lines_gl_account_id_idx" ON "ap_invoice_lines"("gl_account_id");

-- CreateIndex
CREATE INDEX "purchase_orders_entity_id_supplier_id_status_idx" ON "purchase_orders"("entity_id", "supplier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_entity_id_po_number_key" ON "purchase_orders"("entity_id", "po_number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_purchase_order_id_idx" ON "purchase_order_lines"("purchase_order_id");

-- CreateIndex
CREATE INDEX "goods_received_notes_purchase_order_id_idx" ON "goods_received_notes"("purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_received_notes_entity_id_grn_number_key" ON "goods_received_notes"("entity_id", "grn_number");

-- CreateIndex
CREATE INDEX "goods_received_note_lines_goods_received_note_id_idx" ON "goods_received_note_lines"("goods_received_note_id");

-- CreateIndex
CREATE INDEX "goods_received_note_lines_purchase_order_line_id_idx" ON "goods_received_note_lines"("purchase_order_line_id");

-- CreateIndex
CREATE INDEX "ap_payments_entity_id_status_payment_date_idx" ON "ap_payments"("entity_id", "status", "payment_date");

-- CreateIndex
CREATE INDEX "ap_payments_supplier_id_idx" ON "ap_payments"("supplier_id");

-- CreateIndex
CREATE INDEX "ap_payments_payment_run_id_idx" ON "ap_payments"("payment_run_id");

-- CreateIndex
CREATE INDEX "payment_runs_entity_id_status_created_at_idx" ON "payment_runs"("entity_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payment_run_items_payment_run_id_supplier_id_currency_idx" ON "payment_run_items"("payment_run_id", "supplier_id", "currency");

-- CreateIndex
CREATE INDEX "payment_run_invoices_invoice_id_idx" ON "payment_run_invoices"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_run_invoices_payment_run_id_invoice_id_key" ON "payment_run_invoices"("payment_run_id", "invoice_id");

-- CreateIndex
CREATE INDEX "ap_payment_allocations_invoice_id_idx" ON "ap_payment_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payment_allocations_payment_id_invoice_id_key" ON "ap_payment_allocations"("payment_id", "invoice_id");

-- CreateIndex
CREATE INDEX "customers_entity_id_is_active_idx" ON "customers"("entity_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "customers_entity_id_code_key" ON "customers"("entity_id", "code");

-- CreateIndex
CREATE INDEX "ar_invoices_entity_id_status_due_date_idx" ON "ar_invoices"("entity_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "ar_invoices_customer_id_invoice_date_idx" ON "ar_invoices"("customer_id", "invoice_date");

-- CreateIndex
CREATE UNIQUE INDEX "ar_invoices_entity_id_customer_id_invoice_number_key" ON "ar_invoices"("entity_id", "customer_id", "invoice_number");

-- CreateIndex
CREATE INDEX "ar_receipts_entity_id_customer_id_receipt_date_idx" ON "ar_receipts"("entity_id", "customer_id", "receipt_date");

-- CreateIndex
CREATE INDEX "ar_allocations_invoice_id_idx" ON "ar_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_allocations_receipt_id_invoice_id_key" ON "ar_allocations"("receipt_id", "invoice_id");

-- CreateIndex
CREATE INDEX "audit_events_entity_id_resource_type_resource_id_created_at_idx" ON "audit_events"("entity_id", "resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "report_definitions_entity_id_type_idx" ON "report_definitions"("entity_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "report_definitions_entity_id_name_key" ON "report_definitions"("entity_id", "name");

-- CreateIndex
CREATE INDEX "report_runs_definition_id_status_created_at_idx" ON "report_runs"("definition_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "fx_rates_to_currency_effective_date_rate_type_idx" ON "fx_rates"("to_currency", "effective_date", "rate_type");

-- CreateIndex
CREATE UNIQUE INDEX "fx_rates_from_currency_to_currency_rate_type_effective_date_key" ON "fx_rates"("from_currency", "to_currency", "rate_type", "effective_date");

-- CreateIndex
CREATE INDEX "budget_definitions_entity_id_year_idx" ON "budget_definitions"("entity_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "budget_definitions_entity_id_name_year_key" ON "budget_definitions"("entity_id", "name", "year");

-- CreateIndex
CREATE INDEX "budget_lines_budget_definition_id_account_id_idx" ON "budget_lines"("budget_definition_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_budget_definition_id_account_id_month_key" ON "budget_lines"("budget_definition_id", "account_id", "month");

-- CreateIndex
CREATE INDEX "consolidation_runs_parent_entity_id_period_id_idx" ON "consolidation_runs"("parent_entity_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "consolidation_run_entities_consolidation_run_id_entity_id_key" ON "consolidation_run_entities"("consolidation_run_id", "entity_id");

-- CreateIndex
CREATE INDEX "interface_definitions_entity_id_connector_type_idx" ON "interface_definitions"("entity_id", "connector_type");

-- CreateIndex
CREATE UNIQUE INDEX "interface_definitions_entity_id_name_key" ON "interface_definitions"("entity_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "connector_mappings_entity_id_connector_type_source_code_key" ON "connector_mappings"("entity_id", "connector_type", "source_code");

-- CreateIndex
CREATE INDEX "import_logs_entity_id_connector_type_business_date_idx" ON "import_logs"("entity_id", "connector_type", "business_date");

-- CreateIndex
CREATE INDEX "pms_statistics_entity_id_stat_date_idx" ON "pms_statistics"("entity_id", "stat_date");

-- CreateIndex
CREATE UNIQUE INDEX "pms_statistics_entity_id_stat_date_key" ON "pms_statistics"("entity_id", "stat_date");

-- CreateIndex
CREATE INDEX "bank_statements_entity_id_account_id_idx" ON "bank_statements"("entity_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statements_entity_id_account_id_statement_date_key" ON "bank_statements"("entity_id", "account_id", "statement_date");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_statement_id_value_date_idx" ON "bank_transactions"("bank_statement_id", "value_date");

-- CreateIndex
CREATE INDEX "bank_transactions_is_reconciled_idx" ON "bank_transactions"("is_reconciled");

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_users" ADD CONSTRAINT "entity_users_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_users" ADD CONSTRAINT "entity_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "periods" ADD CONSTRAINT "periods_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_types" ADD CONSTRAINT "journal_types_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_journal_type_id_fkey" FOREIGN KEY ("journal_type_id") REFERENCES "journal_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_period_balances" ADD CONSTRAINT "account_period_balances_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_period_balances" ADD CONSTRAINT "account_period_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_period_balances" ADD CONSTRAINT "account_period_balances_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_approvals" ADD CONSTRAINT "journal_approvals_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_approvals" ADD CONSTRAINT "journal_approvals_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_approvals" ADD CONSTRAINT "journal_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoices" ADD CONSTRAINT "ap_invoices_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoices" ADD CONSTRAINT "ap_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoices" ADD CONSTRAINT "ap_invoices_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_lines" ADD CONSTRAINT "ap_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_lines" ADD CONSTRAINT "ap_invoice_lines_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_note_lines" ADD CONSTRAINT "goods_received_note_lines_goods_received_note_id_fkey" FOREIGN KEY ("goods_received_note_id") REFERENCES "goods_received_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_note_lines" ADD CONSTRAINT "goods_received_note_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payments" ADD CONSTRAINT "ap_payments_payment_run_id_fkey" FOREIGN KEY ("payment_run_id") REFERENCES "payment_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_payment_run_id_fkey" FOREIGN KEY ("payment_run_id") REFERENCES "payment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_run_items" ADD CONSTRAINT "payment_run_items_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_run_invoices" ADD CONSTRAINT "payment_run_invoices_payment_run_id_fkey" FOREIGN KEY ("payment_run_id") REFERENCES "payment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_run_invoices" ADD CONSTRAINT "payment_run_invoices_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payment_allocations" ADD CONSTRAINT "ap_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "ap_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payment_allocations" ADD CONSTRAINT "ap_payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_invoices" ADD CONSTRAINT "ar_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_receipts" ADD CONSTRAINT "ar_receipts_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_receipts" ADD CONSTRAINT "ar_receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_allocations" ADD CONSTRAINT "ar_allocations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "ar_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_allocations" ADD CONSTRAINT "ar_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ar_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "report_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_definitions" ADD CONSTRAINT "budget_definitions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_definition_id_fkey" FOREIGN KEY ("budget_definition_id") REFERENCES "budget_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_runs" ADD CONSTRAINT "consolidation_runs_parent_entity_id_fkey" FOREIGN KEY ("parent_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_run_entities" ADD CONSTRAINT "consolidation_run_entities_consolidation_run_id_fkey" FOREIGN KEY ("consolidation_run_id") REFERENCES "consolidation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consolidation_run_entities" ADD CONSTRAINT "consolidation_run_entities_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interface_definitions" ADD CONSTRAINT "interface_definitions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_mappings" ADD CONSTRAINT "connector_mappings_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connector_mappings" ADD CONSTRAINT "connector_mappings_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_statistics" ADD CONSTRAINT "pms_statistics_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_statement_id_fkey" FOREIGN KEY ("bank_statement_id") REFERENCES "bank_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "journal_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

