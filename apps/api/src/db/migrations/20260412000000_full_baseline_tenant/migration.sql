-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('CORPORATE', 'GROUP', 'CLUSTER', 'PROPERTY');

-- CreateEnum
CREATE TYPE "EntityRole" AS ENUM ('ADMIN', 'CONTROLLER', 'VIEWER', 'SUPERADMIN');

-- CreateEnum
CREATE TYPE "AccountTypeCategory" AS ENUM ('BALANCE_SHEET', 'INCOME', 'STATISTICAL');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSE', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ProvisionalPosting" AS ENUM ('MANDATORY', 'OPTIONAL', 'PROHIBITED');

-- CreateEnum
CREATE TYPE "RoundingMethod" AS ENUM ('NORMAL', 'TRUNCATE_TO_UNIT');

-- CreateEnum
CREATE TYPE "DimensionValidationType" AS ENUM ('NONE', 'LIST', 'RANGE');

-- CreateEnum
CREATE TYPE "PeriodCloseState" AS ENUM ('PC_OPEN', 'SOFT_CLOSE', 'HARD_CLOSE', 'PC_LOCKED');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'PMS', 'POS', 'PAYROLL', 'FX_REVAL', 'AP', 'AR', 'IMPORT', 'SYSTM', 'PAYMT', 'PAYDS', 'DEPRC', 'ALLOC', 'REVAL', 'COLLN', 'YEAREND', 'INTERCO');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REVERSED', 'RETURNED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RejectionReturnsTo" AS ENUM ('PREVIOUS_STAGE', 'ORIGINATOR', 'SPECIFIC_STAGE');

-- CreateEnum
CREATE TYPE "AuthorizationDecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AuthorizationSetStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorkflowModule" AS ENUM ('GL', 'AP', 'AR');

-- CreateEnum
CREATE TYPE "JournalApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('USALI_PL', 'TRIAL_BALANCE', 'BALANCE_SHEET', 'CASHFLOW', 'CUSTOM', 'FAL', 'FSL', 'FTL');

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
CREATE TYPE "FXRateSource" AS ENUM ('ECB', 'OANDA', 'MANUAL', 'OPEN_ER_API');

-- CreateEnum
CREATE TYPE "AllocationType" AS ENUM ('CHARGE', 'SPLIT');

-- CreateEnum
CREATE TYPE "AllocationBasisType" AS ENUM ('FIXED_PERCENTAGE', 'FIXED_AMOUNT', 'ACCOUNT_BALANCE', 'STATISTICAL_KEY');

-- CreateEnum
CREATE TYPE "AllocationBalanceType" AS ENUM ('OPENING', 'MOVEMENTS', 'CLOSING');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'REDUCING_BALANCE', 'SUM_OF_DIGITS', 'USER_TABLE', 'NONE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED');

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('IMPORT', 'EXPORT', 'PROCESS', 'INTERNAL_TRANSFER', 'EXTERNAL_TRANSFER');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExecutionLogStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FormatClassification" AS ENUM ('DELIMITED', 'SINGLE_FIXED', 'MULTIPLE_FIXED', 'OTHER_FLAT', 'USER_XML', 'SIMPLE_XML');

-- CreateEnum
CREATE TYPE "ScriptType" AS ENUM ('TML', 'XSL');

-- CreateEnum
CREATE TYPE "LookupValueType" AS ENUM ('CONSTANT', 'COPY', 'MAP_TO', 'OMIT', 'REVERSE_SIGN');

-- CreateEnum
CREATE TYPE "SavePayloadOption" AS ENUM ('NONE', 'INPUT', 'OUTPUT', 'BOTH');

-- CreateEnum
CREATE TYPE "PaymentProfileDirection" AS ENUM ('PAY', 'COLLECT');

-- CreateEnum
CREATE TYPE "FXHandling" AS ENUM ('ORIGINAL', 'CURRENT_RATE');

-- CreateEnum
CREATE TYPE "RevaluationRateType" AS ENUM ('CLOSING', 'AVERAGE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntercompanyJournalStatus" AS ENUM ('PENDING_SOURCE_APPROVAL', 'PENDING_MIRROR_APPROVAL', 'PENDING_BOTH_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ICTransactionStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'POSTED', 'REJECTED', 'REVERSED');

-- CreateTable
CREATE TABLE "tenant_setup_progress" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "current_step" INTEGER NOT NULL DEFAULT 1,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "step_data" JSONB NOT NULL DEFAULT '{}',
    "completed_steps" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_setup_progress_pkey" PRIMARY KEY ("id")
);

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
    "keycloak_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "job_title" TEXT,
    "department" TEXT,
    "avatar_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "last_login_ip" VARCHAR(45),
    "login_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "password_hash" VARCHAR(255),
    "password_changed_at" TIMESTAMP(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_reset_token" VARCHAR(255),
    "password_reset_expires" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_audits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "entity_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_users" (
    "entity_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "EntityRole",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_users_pkey" PRIMARY KEY ("entity_id","user_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
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
CREATE TABLE "account_type_definitions" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" "AccountTypeCategory" NOT NULL,
    "normal_balance" "NormalBalance" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_type_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "account_type_def_id" TEXT,
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
    "allowed_account_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "number_prefix" VARCHAR(10) NOT NULL,
    "auto_reverse" BOOLEAN NOT NULL DEFAULT false,
    "require_balance" BOOLEAN NOT NULL DEFAULT true,
    "authorization_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_journals" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "journal_type_id" TEXT,
    "source" "JournalSource" NOT NULL DEFAULT 'MANUAL',
    "functional_currency" CHAR(3) NOT NULL,
    "frequency" VARCHAR(20) NOT NULL,
    "day_of_month" INTEGER NOT NULL DEFAULT 1,
    "auto_post" BOOLEAN NOT NULL DEFAULT false,
    "auto_reverse" BOOLEAN NOT NULL DEFAULT false,
    "max_occurrences" INTEGER NOT NULL DEFAULT 0,
    "occurrence_count" INTEGER NOT NULL DEFAULT 0,
    "last_generated_at" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_journal_lines" (
    "id" TEXT NOT NULL,
    "recurring_journal_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "debit" DECIMAL(18,4) NOT NULL,
    "credit" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "fx_rate" DECIMAL(14,8) NOT NULL DEFAULT 1,
    "description" TEXT,
    "dimension1" VARCHAR(50),
    "dimension2" VARCHAR(50),
    "dimension3" VARCHAR(50),
    "dimension4" VARCHAR(50),
    "dimension5" VARCHAR(50),
    "dimension6" VARCHAR(50),
    "dimension7" VARCHAR(50),
    "dimension8" VARCHAR(50),
    "dimension9" VARCHAR(50),
    "dimension10" VARCHAR(50),
    "line_number" INTEGER NOT NULL,

    CONSTRAINT "recurring_journal_lines_pkey" PRIMARY KEY ("id")
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
    "current_auth_stage_order" INTEGER,
    "authorization_set_id" TEXT,
    "is_auto_reversible" BOOLEAN NOT NULL DEFAULT false,
    "reversal_of_id" TEXT,
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
    "stat_value" DECIMAL(18,3),
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
    "dimension7" VARCHAR(50),
    "dimension8" VARCHAR(50),
    "dimension9" VARCHAR(50),
    "dimension10" VARCHAR(50),
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
    "profile_id" TEXT,
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

-- CreateTable
CREATE TABLE "transfer_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "profile_type" "ProfileType" NOT NULL,
    "source_component" TEXT,
    "target_component" TEXT,
    "source_format_id" TEXT,
    "target_format_id" TEXT,
    "transformation_id" TEXT,
    "filter_id" TEXT,
    "source_params" JSONB,
    "target_params" JSONB,
    "is_valid" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "save_payload" "SavePayloadOption" NOT NULL DEFAULT 'NONE',
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_profile_versions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "change_note" TEXT,

    CONSTRAINT "transfer_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_filters" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source_component" TEXT NOT NULL,
    "filter_clauses" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_journal_ranges" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "ledger" CHAR(1) NOT NULL,
    "journal_number_from" BIGINT NOT NULL,
    "journal_number_to" BIGINT NOT NULL,
    "last_execution_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_journal_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_automations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_automation_steps" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "step_order" INTEGER NOT NULL,
    "fail_on_error" BOOLEAN NOT NULL DEFAULT true,
    "source_param_overrides" JSONB,
    "target_param_overrides" JSONB,

    CONSTRAINT "transfer_automation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_automation_schedules" (
    "id" TEXT NOT NULL,
    "automation_id" TEXT NOT NULL,
    "cron_expression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "run_as_user" TEXT,
    "next_run_at" TIMESTAMP(3),
    "bullmq_repeat_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_automation_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_formats" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "classification" "FormatClassification" NOT NULL,
    "fsd_xml" TEXT NOT NULL,
    "gui_state" JSONB,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_valid" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_formats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_transformations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "script_type" "ScriptType" NOT NULL DEFAULT 'TML',
    "source_format_id" TEXT,
    "target_format_id" TEXT,
    "source_component" TEXT,
    "target_component" TEXT,
    "tml_xml" TEXT,
    "rules_json" JSONB,
    "functions_json" JSONB,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_valid" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors" JSONB,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_transformations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_lookup_tables" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_lookup_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_lookup_columns" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "column_order" INTEGER NOT NULL,

    CONSTRAINT "transfer_lookup_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_lookup_rows" (
    "id" TEXT NOT NULL,
    "table_id" TEXT NOT NULL,
    "business_unit" TEXT,
    "range_from" TEXT NOT NULL,
    "range_to" TEXT NOT NULL,
    "row_order" INTEGER NOT NULL,

    CONSTRAINT "transfer_lookup_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_lookup_values" (
    "id" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "column_id" TEXT NOT NULL,
    "value_type" "LookupValueType" NOT NULL,
    "value_param" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "transfer_lookup_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_folders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" TEXT,
    "s3_prefix" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_folder_access" (
    "id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "can_read" BOOLEAN NOT NULL DEFAULT true,
    "can_write" BOOLEAN NOT NULL DEFAULT false,
    "can_delete" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "transfer_folder_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_files" (
    "id" TEXT NOT NULL,
    "folder_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "content_type" TEXT NOT NULL,
    "encoding" TEXT NOT NULL DEFAULT 'UTF-8',
    "metadata" JSONB,
    "uploaded_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_executions" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "automation_id" TEXT,
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
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_execution_logs" (
    "id" BIGSERIAL NOT NULL,
    "execution_id" TEXT NOT NULL,
    "record_index" INTEGER NOT NULL,
    "status" "ExecutionLogStatus" NOT NULL,
    "source_data" JSONB,
    "transformed_data" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,

    CONSTRAINT "transfer_execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_setups" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "ledger" CHAR(1) NOT NULL DEFAULT 'A',
    "open_date_from" VARCHAR(12),
    "open_date_to" VARCHAR(12),
    "provisional_posting" "ProvisionalPosting" NOT NULL DEFAULT 'OPTIONAL',
    "use_financial_calendar" BOOLEAN NOT NULL DEFAULT false,
    "base_currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "second_base_currency" VARCHAR(3),
    "fourth_currency_code" VARCHAR(3),
    "rounding_method" "RoundingMethod" NOT NULL DEFAULT 'NORMAL',
    "rounding_unit" VARCHAR(20),
    "payment_run_enabled" BOOLEAN NOT NULL DEFAULT false,
    "pay_at_current_rates" BOOLEAN NOT NULL DEFAULT true,
    "non_match_system_payments" BOOLEAN NOT NULL DEFAULT false,
    "current_period_id" TEXT,
    "lock_calculated_depreciation" BOOLEAN NOT NULL DEFAULT false,
    "full_year_depreciation_first_year" BOOLEAN NOT NULL DEFAULT false,
    "exclude_final_value_from_depn" BOOLEAN NOT NULL DEFAULT true,
    "authorization_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_setups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_locks" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "process_type" VARCHAR(50) NOT NULL,
    "ledger" CHAR(1) NOT NULL DEFAULT 'A',
    "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "acquired_by" TEXT,
    "worker_id" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "process_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_close_statuses" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "ledger" CHAR(1) NOT NULL DEFAULT 'A',
    "status" "PeriodCloseState" NOT NULL DEFAULT 'PC_OPEN',
    "revaluation_run" BOOLEAN NOT NULL DEFAULT false,
    "depreciation_run" BOOLEAN NOT NULL DEFAULT false,
    "allocations_run" BOOLEAN NOT NULL DEFAULT false,
    "year_end_processed" BOOLEAN NOT NULL DEFAULT false,
    "closed_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "period_close_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_dimensions" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "dimension_number" INTEGER NOT NULL,
    "dimension_name" VARCHAR(50) NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "validation_type" "DimensionValidationType" NOT NULL DEFAULT 'NONE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_codes" (
    "id" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "description" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "analysis_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_definitions" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "allocation_type" "AllocationType" NOT NULL,
    "period_id" TEXT,
    "is_stepped_sequence" BOOLEAN NOT NULL DEFAULT false,
    "sequence_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_sources" (
    "id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "account_code_from" VARCHAR(50) NOT NULL,
    "account_code_to" VARCHAR(50) NOT NULL,
    "analysis_code_1" VARCHAR(50),
    "analysis_code_2" VARCHAR(50),
    "analysis_code_3" VARCHAR(50),
    "balance_type" "AllocationBalanceType" NOT NULL DEFAULT 'MOVEMENTS',
    "minimum_threshold" DECIMAL(18,4),
    "maximum_threshold" DECIMAL(18,4),
    "source_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "allocation_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_targets" (
    "id" TEXT NOT NULL,
    "definition_id" TEXT NOT NULL,
    "target_account_code" VARCHAR(50) NOT NULL,
    "offset_account_code" VARCHAR(50),
    "basis_type" "AllocationBasisType" NOT NULL,
    "fixed_percentage" DECIMAL(8,4),
    "fixed_amount" DECIMAL(18,4),
    "ratio_account_code_from" VARCHAR(50),
    "ratio_account_code_to" VARCHAR(50),
    "statistical_key" VARCHAR(50),
    "statistical_value" DECIMAL(18,4),
    "analysis_codes" JSONB,
    "target_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "allocation_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_categories" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "default_useful_life_months" INTEGER,
    "default_depreciation_method" "DepreciationMethod",
    "default_bs_depreciation_acct" VARCHAR(50),
    "default_pl_depreciation_acct" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "asset_code" VARCHAR(30) NOT NULL,
    "lookup_code" VARCHAR(30),
    "description" VARCHAR(255) NOT NULL,
    "category_id" TEXT,
    "bs_depreciation_account" VARCHAR(50) NOT NULL,
    "pl_depreciation_account" VARCHAR(50) NOT NULL,
    "depreciation_method" "DepreciationMethod" NOT NULL DEFAULT 'STRAIGHT_LINE',
    "depreciation_rate" DECIMAL(8,4),
    "useful_life_months" INTEGER NOT NULL,
    "depreciation_start_period_id" TEXT,
    "first_period_days" INTEGER,
    "final_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gross_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "accumulated_depreciation" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "net_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "asset_quantity" DECIMAL(18,4),
    "acquisition_date" DATE NOT NULL,
    "disposal_date" DATE,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "analysis_code_1" VARCHAR(50),
    "analysis_code_2" VARCHAR(50),
    "analysis_code_3" VARCHAR(50),
    "analysis_code_4" VARCHAR(50),
    "analysis_code_5" VARCHAR(50),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_tables" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "entries" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "depreciation_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_stages" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "stage_code" VARCHAR(20) NOT NULL,
    "stage_name" VARCHAR(100) NOT NULL,
    "stage_order" INTEGER NOT NULL,
    "required_approvers" INTEGER NOT NULL DEFAULT 1,
    "auto_advance" BOOLEAN NOT NULL DEFAULT true,
    "rejection_returns_to" "RejectionReturnsTo" NOT NULL DEFAULT 'ORIGINATOR',
    "return_to_stage_id" TEXT,
    "journal_type_id" TEXT,
    "amount_threshold" DECIMAL(18,4),
    "user_team_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorization_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_teams" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorization_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_team_members" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "authorization_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_delegations" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "delegator_id" TEXT NOT NULL,
    "delegate_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorization_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rejection_codes" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rejection_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorization_sets" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "AuthorizationSetStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authorization_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_authorizations" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "journal_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "stage_order" INTEGER NOT NULL,
    "status" "AuthorizationDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "rejection_code_id" TEXT,
    "comments" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_profiles" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "direction" "PaymentProfileDirection" NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "bank_account_id" TEXT,
    "currency" CHAR(3),
    "fx_handling" "FXHandling" NOT NULL DEFAULT 'ORIGINAL',
    "selection_criteria" JSONB NOT NULL DEFAULT '{}',
    "grouping_rules" JSONB NOT NULL DEFAULT '{}',
    "total_payment_limit" DECIMAL(18,4),
    "remittance_advice" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revaluation_profiles" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "account_type_filter" JSONB NOT NULL DEFAULT '[]',
    "account_code_from" VARCHAR(15),
    "account_code_to" VARCHAR(15),
    "currency_filter" CHAR(3),
    "rate_type" "RevaluationRateType" NOT NULL DEFAULT 'CLOSING',
    "gain_account_code" VARCHAR(15) NOT NULL,
    "loss_account_code" VARCHAR(15) NOT NULL,
    "auto_reverse" BOOLEAN NOT NULL DEFAULT true,
    "post_differences" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revaluation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_end_configs" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "retained_earnings_code" VARCHAR(15) NOT NULL,
    "journal_type_code" VARCHAR(20),
    "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 1,
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "year_end_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intercompany_account_pairs" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "counterparty_entity_id" TEXT NOT NULL,
    "ic_receivable_code" VARCHAR(15) NOT NULL,
    "ic_payable_code" VARCHAR(15) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intercompany_account_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intercompany_journals" (
    "id" TEXT NOT NULL,
    "source_entity_id" TEXT NOT NULL,
    "mirror_entity_id" TEXT NOT NULL,
    "source_journal_id" TEXT,
    "mirror_journal_id" TEXT,
    "status" "IntercompanyJournalStatus" NOT NULL DEFAULT 'PENDING_BOTH_APPROVAL',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reference" VARCHAR(60) NOT NULL,
    "description" VARCHAR(500),
    "source_approved_by" TEXT,
    "source_approved_at" TIMESTAMP(3),
    "mirror_approved_by" TEXT,
    "mirror_approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" VARCHAR(500),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intercompany_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ic_entity_pairs" (
    "id" TEXT NOT NULL,
    "entity_a_id" TEXT NOT NULL,
    "entity_b_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "auto_approve_threshold" DECIMAL(18,4),
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ic_entity_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ic_account_mappings" (
    "id" TEXT NOT NULL,
    "pair_id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "entity_a_debit_code" VARCHAR(15) NOT NULL,
    "entity_a_credit_code" VARCHAR(15) NOT NULL,
    "entity_b_debit_code" VARCHAR(15) NOT NULL,
    "entity_b_credit_code" VARCHAR(15) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ic_account_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ic_transactions" (
    "id" TEXT NOT NULL,
    "pair_id" TEXT NOT NULL,
    "mapping_id" TEXT,
    "initiating_entity_id" TEXT NOT NULL,
    "counterparty_entity_id" TEXT NOT NULL,
    "status" "ICTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "fx_rate_initiator" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "fx_rate_counterparty" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "functional_amount_initiator" DECIMAL(18,4) NOT NULL,
    "functional_amount_counterparty" DECIMAL(18,4) NOT NULL,
    "reference" VARCHAR(60) NOT NULL,
    "description" VARCHAR(500),
    "period_id" TEXT NOT NULL,
    "initiator_journal_id" TEXT,
    "counterparty_journal_id" TEXT,
    "reversal_of_id" TEXT,
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by" TEXT,
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" VARCHAR(500),
    "posted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ic_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ic_reconciliation_snapshots" (
    "id" TEXT NOT NULL,
    "pair_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "balance_entity_a" DECIMAL(18,4) NOT NULL,
    "balance_entity_b" DECIMAL(18,4) NOT NULL,
    "difference" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'UNRECONCILED',
    "notes" VARCHAR(500),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ic_reconciliation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entities_parent_id_idx" ON "entities"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_keycloak_id_key" ON "users"("keycloak_id");

-- CreateIndex
CREATE INDEX "login_audits_user_id_created_at_idx" ON "login_audits"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "login_audits_email_created_at_idx" ON "login_audits"("email", "created_at");

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
CREATE UNIQUE INDEX "account_type_definitions_entity_id_code_key" ON "account_type_definitions"("entity_id", "code");

-- CreateIndex
CREATE INDEX "accounts_entity_id_parent_id_idx" ON "accounts"("entity_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_entity_id_code_key" ON "accounts"("entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_types_entity_id_code_key" ON "journal_types"("entity_id", "code");

-- CreateIndex
CREATE INDEX "recurring_journals_entity_id_is_active_idx" ON "recurring_journals"("entity_id", "is_active");

-- CreateIndex
CREATE INDEX "journals_entity_id_period_id_status_idx" ON "journals"("entity_id", "period_id", "status");

-- CreateIndex
CREATE INDEX "journals_entity_id_created_at_idx" ON "journals"("entity_id", "created_at");

-- CreateIndex
CREATE INDEX "journals_entity_id_journal_type_id_idx" ON "journals"("entity_id", "journal_type_id");

-- CreateIndex
CREATE INDEX "journals_entity_id_authorization_set_id_idx" ON "journals"("entity_id", "authorization_set_id");

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

-- CreateIndex
CREATE UNIQUE INDEX "transfer_profiles_name_key" ON "transfer_profiles"("name");

-- CreateIndex
CREATE INDEX "transfer_profiles_profile_type_is_active_idx" ON "transfer_profiles"("profile_type", "is_active");

-- CreateIndex
CREATE INDEX "transfer_profile_versions_profile_id_changed_at_idx" ON "transfer_profile_versions"("profile_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_profile_versions_profile_id_version_key" ON "transfer_profile_versions"("profile_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_filters_name_key" ON "transfer_filters"("name");

-- CreateIndex
CREATE INDEX "transfer_journal_ranges_entity_id_idx" ON "transfer_journal_ranges"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_journal_ranges_profile_id_entity_id_ledger_key" ON "transfer_journal_ranges"("profile_id", "entity_id", "ledger");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_automations_name_key" ON "transfer_automations"("name");

-- CreateIndex
CREATE INDEX "transfer_automation_steps_profile_id_idx" ON "transfer_automation_steps"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_automation_steps_automation_id_step_order_key" ON "transfer_automation_steps"("automation_id", "step_order");

-- CreateIndex
CREATE INDEX "transfer_automation_schedules_next_run_at_idx" ON "transfer_automation_schedules"("next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_formats_name_key" ON "transfer_formats"("name");

-- CreateIndex
CREATE INDEX "transfer_formats_classification_idx" ON "transfer_formats"("classification");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_transformations_name_key" ON "transfer_transformations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_lookup_tables_name_key" ON "transfer_lookup_tables"("name");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_lookup_columns_table_id_name_key" ON "transfer_lookup_columns"("table_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_lookup_columns_table_id_column_order_key" ON "transfer_lookup_columns"("table_id", "column_order");

-- CreateIndex
CREATE INDEX "transfer_lookup_rows_table_id_business_unit_range_from_rang_idx" ON "transfer_lookup_rows"("table_id", "business_unit", "range_from", "range_to");

-- CreateIndex
CREATE INDEX "transfer_lookup_rows_table_id_row_order_idx" ON "transfer_lookup_rows"("table_id", "row_order");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_lookup_values_row_id_column_id_key" ON "transfer_lookup_values"("row_id", "column_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_folders_s3_prefix_key" ON "transfer_folders"("s3_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_folders_parent_id_name_key" ON "transfer_folders"("parent_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_folder_access_folder_id_role_name_key" ON "transfer_folder_access"("folder_id", "role_name");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_files_s3_key_key" ON "transfer_files"("s3_key");

-- CreateIndex
CREATE INDEX "transfer_files_folder_id_uploaded_at_idx" ON "transfer_files"("folder_id", "uploaded_at");

-- CreateIndex
CREATE INDEX "transfer_executions_profile_id_created_at_idx" ON "transfer_executions"("profile_id", "created_at");

-- CreateIndex
CREATE INDEX "transfer_executions_status_idx" ON "transfer_executions"("status");

-- CreateIndex
CREATE INDEX "transfer_executions_automation_id_automation_step_order_idx" ON "transfer_executions"("automation_id", "automation_step_order");

-- CreateIndex
CREATE INDEX "transfer_execution_logs_execution_id_record_index_idx" ON "transfer_execution_logs"("execution_id", "record_index");

-- CreateIndex
CREATE INDEX "transfer_execution_logs_execution_id_status_idx" ON "transfer_execution_logs"("execution_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_setups_entity_id_ledger_key" ON "ledger_setups"("entity_id", "ledger");

-- CreateIndex
CREATE INDEX "process_locks_entity_id_process_type_ledger_is_active_idx" ON "process_locks"("entity_id", "process_type", "ledger", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "period_close_statuses_entity_id_period_id_ledger_key" ON "period_close_statuses"("entity_id", "period_id", "ledger");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_dimensions_entity_id_dimension_number_key" ON "analysis_dimensions"("entity_id", "dimension_number");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_codes_dimension_id_code_key" ON "analysis_codes"("dimension_id", "code");

-- CreateIndex
CREATE INDEX "allocation_definitions_entity_id_is_active_idx" ON "allocation_definitions"("entity_id", "is_active");

-- CreateIndex
CREATE INDEX "allocation_definitions_entity_id_is_stepped_sequence_sequen_idx" ON "allocation_definitions"("entity_id", "is_stepped_sequence", "sequence_order");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_definitions_entity_id_name_key" ON "allocation_definitions"("entity_id", "name");

-- CreateIndex
CREATE INDEX "allocation_sources_definition_id_idx" ON "allocation_sources"("definition_id");

-- CreateIndex
CREATE INDEX "allocation_targets_definition_id_idx" ON "allocation_targets"("definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_categories_entity_id_code_key" ON "asset_categories"("entity_id", "code");

-- CreateIndex
CREATE INDEX "fixed_assets_entity_id_status_idx" ON "fixed_assets"("entity_id", "status");

-- CreateIndex
CREATE INDEX "fixed_assets_entity_id_category_id_idx" ON "fixed_assets"("entity_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_entity_id_asset_code_key" ON "fixed_assets"("entity_id", "asset_code");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_tables_entity_id_code_key" ON "depreciation_tables"("entity_id", "code");

-- CreateIndex
CREATE INDEX "authorization_stages_entity_id_journal_type_id_stage_order_idx" ON "authorization_stages"("entity_id", "journal_type_id", "stage_order");

-- CreateIndex
CREATE UNIQUE INDEX "authorization_stages_entity_id_stage_code_key" ON "authorization_stages"("entity_id", "stage_code");

-- CreateIndex
CREATE UNIQUE INDEX "authorization_teams_entity_id_code_key" ON "authorization_teams"("entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "authorization_team_members_team_id_user_id_key" ON "authorization_team_members"("team_id", "user_id");

-- CreateIndex
CREATE INDEX "authorization_delegations_entity_id_delegate_id_is_active_idx" ON "authorization_delegations"("entity_id", "delegate_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "rejection_codes_entity_id_code_key" ON "rejection_codes"("entity_id", "code");

-- CreateIndex
CREATE INDEX "authorization_sets_entity_id_status_idx" ON "authorization_sets"("entity_id", "status");

-- CreateIndex
CREATE INDEX "journal_authorizations_entity_id_journal_id_stage_order_idx" ON "journal_authorizations"("entity_id", "journal_id", "stage_order");

-- CreateIndex
CREATE INDEX "journal_authorizations_entity_id_status_idx" ON "journal_authorizations"("entity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_authorizations_journal_id_stage_id_key" ON "journal_authorizations"("journal_id", "stage_id");

-- CreateIndex
CREATE INDEX "payment_profiles_entity_id_direction_is_active_idx" ON "payment_profiles"("entity_id", "direction", "is_active");

-- CreateIndex
CREATE INDEX "revaluation_profiles_entity_id_is_active_idx" ON "revaluation_profiles"("entity_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "year_end_configs_entity_id_key" ON "year_end_configs"("entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "intercompany_account_pairs_entity_id_counterparty_entity_id_key" ON "intercompany_account_pairs"("entity_id", "counterparty_entity_id");

-- CreateIndex
CREATE INDEX "intercompany_journals_source_entity_id_status_idx" ON "intercompany_journals"("source_entity_id", "status");

-- CreateIndex
CREATE INDEX "intercompany_journals_mirror_entity_id_status_idx" ON "intercompany_journals"("mirror_entity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ic_entity_pairs_entity_a_id_entity_b_id_key" ON "ic_entity_pairs"("entity_a_id", "entity_b_id");

-- CreateIndex
CREATE INDEX "ic_transactions_pair_id_status_idx" ON "ic_transactions"("pair_id", "status");

-- CreateIndex
CREATE INDEX "ic_transactions_initiating_entity_id_status_idx" ON "ic_transactions"("initiating_entity_id", "status");

-- CreateIndex
CREATE INDEX "ic_transactions_counterparty_entity_id_status_idx" ON "ic_transactions"("counterparty_entity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ic_reconciliation_snapshots_pair_id_period_id_key" ON "ic_reconciliation_snapshots"("pair_id", "period_id");

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_audits" ADD CONSTRAINT "login_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "account_type_definitions" ADD CONSTRAINT "account_type_definitions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_account_type_def_id_fkey" FOREIGN KEY ("account_type_def_id") REFERENCES "account_type_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_types" ADD CONSTRAINT "journal_types_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "recurring_journals_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journals" ADD CONSTRAINT "recurring_journals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_lines" ADD CONSTRAINT "recurring_journal_lines_recurring_journal_id_fkey" FOREIGN KEY ("recurring_journal_id") REFERENCES "recurring_journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_journal_lines" ADD CONSTRAINT "recurring_journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "journals" ADD CONSTRAINT "journals_authorization_set_id_fkey" FOREIGN KEY ("authorization_set_id") REFERENCES "authorization_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journals" ADD CONSTRAINT "journals_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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
ALTER TABLE "payment_runs" ADD CONSTRAINT "payment_runs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "payment_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "transfer_profiles" ADD CONSTRAINT "transfer_profiles_source_format_id_fkey" FOREIGN KEY ("source_format_id") REFERENCES "transfer_formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_profiles" ADD CONSTRAINT "transfer_profiles_target_format_id_fkey" FOREIGN KEY ("target_format_id") REFERENCES "transfer_formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_profiles" ADD CONSTRAINT "transfer_profiles_transformation_id_fkey" FOREIGN KEY ("transformation_id") REFERENCES "transfer_transformations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_profiles" ADD CONSTRAINT "transfer_profiles_filter_id_fkey" FOREIGN KEY ("filter_id") REFERENCES "transfer_filters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_profile_versions" ADD CONSTRAINT "transfer_profile_versions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "transfer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_journal_ranges" ADD CONSTRAINT "transfer_journal_ranges_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "transfer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_automation_steps" ADD CONSTRAINT "transfer_automation_steps_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "transfer_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_automation_steps" ADD CONSTRAINT "transfer_automation_steps_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "transfer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_automation_schedules" ADD CONSTRAINT "transfer_automation_schedules_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "transfer_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_transformations" ADD CONSTRAINT "transfer_transformations_source_format_id_fkey" FOREIGN KEY ("source_format_id") REFERENCES "transfer_formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_transformations" ADD CONSTRAINT "transfer_transformations_target_format_id_fkey" FOREIGN KEY ("target_format_id") REFERENCES "transfer_formats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lookup_columns" ADD CONSTRAINT "transfer_lookup_columns_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "transfer_lookup_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lookup_rows" ADD CONSTRAINT "transfer_lookup_rows_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "transfer_lookup_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lookup_values" ADD CONSTRAINT "transfer_lookup_values_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "transfer_lookup_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lookup_values" ADD CONSTRAINT "transfer_lookup_values_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "transfer_lookup_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_folders" ADD CONSTRAINT "transfer_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "transfer_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_folder_access" ADD CONSTRAINT "transfer_folder_access_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "transfer_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_files" ADD CONSTRAINT "transfer_files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "transfer_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_executions" ADD CONSTRAINT "transfer_executions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "transfer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_executions" ADD CONSTRAINT "transfer_executions_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "transfer_automations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_execution_logs" ADD CONSTRAINT "transfer_execution_logs_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "transfer_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_setups" ADD CONSTRAINT "ledger_setups_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_setups" ADD CONSTRAINT "ledger_setups_current_period_id_fkey" FOREIGN KEY ("current_period_id") REFERENCES "periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_locks" ADD CONSTRAINT "process_locks_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_locks" ADD CONSTRAINT "process_locks_acquired_by_fkey" FOREIGN KEY ("acquired_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_statuses" ADD CONSTRAINT "period_close_statuses_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_statuses" ADD CONSTRAINT "period_close_statuses_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_close_statuses" ADD CONSTRAINT "period_close_statuses_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_dimensions" ADD CONSTRAINT "analysis_dimensions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_codes" ADD CONSTRAINT "analysis_codes_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "analysis_dimensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_definitions" ADD CONSTRAINT "allocation_definitions_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_definitions" ADD CONSTRAINT "allocation_definitions_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_definitions" ADD CONSTRAINT "allocation_definitions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_sources" ADD CONSTRAINT "allocation_sources_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "allocation_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_targets" ADD CONSTRAINT "allocation_targets_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "allocation_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_categories" ADD CONSTRAINT "asset_categories_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciation_start_period_id_fkey" FOREIGN KEY ("depreciation_start_period_id") REFERENCES "periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_tables" ADD CONSTRAINT "depreciation_tables_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_stages" ADD CONSTRAINT "authorization_stages_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_stages" ADD CONSTRAINT "authorization_stages_journal_type_id_fkey" FOREIGN KEY ("journal_type_id") REFERENCES "journal_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_stages" ADD CONSTRAINT "authorization_stages_user_team_id_fkey" FOREIGN KEY ("user_team_id") REFERENCES "authorization_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_stages" ADD CONSTRAINT "authorization_stages_return_to_stage_id_fkey" FOREIGN KEY ("return_to_stage_id") REFERENCES "authorization_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_teams" ADD CONSTRAINT "authorization_teams_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_team_members" ADD CONSTRAINT "authorization_team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "authorization_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_team_members" ADD CONSTRAINT "authorization_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_delegations" ADD CONSTRAINT "authorization_delegations_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_delegations" ADD CONSTRAINT "authorization_delegations_delegator_id_fkey" FOREIGN KEY ("delegator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_delegations" ADD CONSTRAINT "authorization_delegations_delegate_id_fkey" FOREIGN KEY ("delegate_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_delegations" ADD CONSTRAINT "authorization_delegations_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "authorization_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rejection_codes" ADD CONSTRAINT "rejection_codes_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_sets" ADD CONSTRAINT "authorization_sets_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorization_sets" ADD CONSTRAINT "authorization_sets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_authorizations" ADD CONSTRAINT "journal_authorizations_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_authorizations" ADD CONSTRAINT "journal_authorizations_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_authorizations" ADD CONSTRAINT "journal_authorizations_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "authorization_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_authorizations" ADD CONSTRAINT "journal_authorizations_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_authorizations" ADD CONSTRAINT "journal_authorizations_rejection_code_id_fkey" FOREIGN KEY ("rejection_code_id") REFERENCES "rejection_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_profiles" ADD CONSTRAINT "payment_profiles_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revaluation_profiles" ADD CONSTRAINT "revaluation_profiles_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "year_end_configs" ADD CONSTRAINT "year_end_configs_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_account_pairs" ADD CONSTRAINT "intercompany_account_pairs_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_account_pairs" ADD CONSTRAINT "intercompany_account_pairs_counterparty_entity_id_fkey" FOREIGN KEY ("counterparty_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_source_entity_id_fkey" FOREIGN KEY ("source_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_mirror_entity_id_fkey" FOREIGN KEY ("mirror_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_source_journal_id_fkey" FOREIGN KEY ("source_journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intercompany_journals" ADD CONSTRAINT "intercompany_journals_mirror_journal_id_fkey" FOREIGN KEY ("mirror_journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_entity_pairs" ADD CONSTRAINT "ic_entity_pairs_entity_a_id_fkey" FOREIGN KEY ("entity_a_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_entity_pairs" ADD CONSTRAINT "ic_entity_pairs_entity_b_id_fkey" FOREIGN KEY ("entity_b_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_account_mappings" ADD CONSTRAINT "ic_account_mappings_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "ic_entity_pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_transactions" ADD CONSTRAINT "ic_transactions_pair_id_fkey" FOREIGN KEY ("pair_id") REFERENCES "ic_entity_pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_transactions" ADD CONSTRAINT "ic_transactions_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "ic_account_mappings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_transactions" ADD CONSTRAINT "ic_transactions_initiating_entity_id_fkey" FOREIGN KEY ("initiating_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_transactions" ADD CONSTRAINT "ic_transactions_counterparty_entity_id_fkey" FOREIGN KEY ("counterparty_entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_transactions" ADD CONSTRAINT "ic_transactions_initiator_journal_id_fkey" FOREIGN KEY ("initiator_journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_transactions" ADD CONSTRAINT "ic_transactions_counterparty_journal_id_fkey" FOREIGN KEY ("counterparty_journal_id") REFERENCES "journals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ic_transactions" ADD CONSTRAINT "ic_transactions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "ic_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

