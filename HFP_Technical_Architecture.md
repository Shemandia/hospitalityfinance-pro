

HOSPITALITY FINANCE PRO

Technical Architecture

System Design, Stack & Infrastructure Blueprint



Engineering Reference Document

March 2026 | Confidential



1. Architecture Overview

HospitalityFinance Pro is built on a cloud-native, API-first architecture designed for multi-tenancy, high availability, and the high transaction volumes typical of hotel operations. The system separates concerns cleanly across four layers: presentation, application, domain, and data — enabling independent scaling of each component and progressive feature delivery aligned to the phased roadmap.





2. Technology Stack

2.1 Backend Services



2.2 Frontend



2.3 Database Architecture

The system uses PostgreSQL as the primary database with a multi-schema strategy for tenant isolation. Each hotel property or group entity gets its own PostgreSQL schema within a shared cluster, providing strong data isolation without the operational overhead of separate databases per tenant at early scale.





2.4 Infrastructure & DevOps



3. Service Architecture

3.1 Microservices Breakdown

HospitalityFinance Pro uses a modular monolith approach for the MVP — a single deployable Node.js application with clearly separated domain modules. This avoids the operational complexity of microservices at early stage while keeping the codebase clean enough to extract services later. Each domain module has its own router, service layer, repository layer, and database schema.





3.2 API Design Standards

REST Conventions

Base URL: https://api.hospitalityfinancepro.com/v1/

All endpoints require Authorization: Bearer {jwt} header

Tenant scoping via X-Entity-ID header (property or group level)

Pagination: cursor-based for large datasets (GET /gl/journals?cursor=abc&limit=50)

Filtering: ?filter[account_code]=1000&filter[period]=2026-03

Sorting: ?sort=-created_at (prefix - for descending)

Versioning: URL-based (/v1/, /v2/) — no header versioning



Standard Response Envelope

{ "data": { ... }, "meta": { "total": 1250, "cursor": "eyJp..." }, "errors": [] }



Error Format

{ "errors": [{ "code": "GL_PERIOD_CLOSED", "message": "Period 2026-01 is closed", "field": "period_id" }] }



3.3 Database Schema — Core Tables

General Ledger

journals (
  id UUID PK, entity_id UUID FK, period_id UUID FK,
  reference VARCHAR(50), description TEXT,
  source ENUM(manual|pms|pos|payroll|fx_reval|ap|ar),
  status ENUM(draft|posted|reversed), posted_at TIMESTAMPTZ,
  created_by UUID FK, approved_by UUID FK,
  functional_currency CHAR(3), created_at TIMESTAMPTZ
)

journal_lines (
  id UUID PK, journal_id UUID FK, account_id UUID FK,
  debit NUMERIC(18,4), credit NUMERIC(18,4),
  currency CHAR(3), fx_rate NUMERIC(14,8),
  debit_functional NUMERIC(18,4), credit_functional NUMERIC(18,4),
  description TEXT, dimension1..6 VARCHAR(50),
  line_number INTEGER
)



Chart of Accounts

accounts (
  id UUID PK, entity_id UUID FK,
  code VARCHAR(30) UNIQUE, name VARCHAR(200),
  type ENUM(asset|liability|equity|revenue|expense),
  usali_category VARCHAR(100), usali_department VARCHAR(100),
  normal_balance ENUM(debit|credit),
  is_control_account BOOLEAN, allow_posting BOOLEAN,
  parent_id UUID FK, level INTEGER,
  created_at TIMESTAMPTZ
)



Accounts Payable

ap_invoices (
  id UUID PK, entity_id UUID FK, supplier_id UUID FK,
  invoice_number VARCHAR(50), invoice_date DATE, due_date DATE,
  currency CHAR(3), gross_amount NUMERIC(18,4), tax_amount NUMERIC(18,4),
  net_amount NUMERIC(18,4), functional_amount NUMERIC(18,4), fx_rate NUMERIC(14,8),
  status ENUM(draft|pending_approval|approved|posted|paid|disputed|cancelled),
  gl_journal_id UUID FK, po_id UUID FK,
  payment_terms VARCHAR(50), created_at TIMESTAMPTZ
)

ap_payments (
  id UUID PK, entity_id UUID FK, supplier_id UUID FK,
  payment_date DATE, currency CHAR(3), amount NUMERIC(18,4),
  payment_method ENUM(bank_transfer|cheque|card|cash),
  bank_account_id UUID FK, reference VARCHAR(100),
  status ENUM(pending|processed|bounced|cancelled),
  gl_journal_id UUID FK
)



4. Integration Architecture

4.1 PMS Integration — Night Audit Flow

The nightly PMS-to-GL integration is the most critical data pipeline in the system. It must be reliable, resumable, and produce a complete audit trail linking every GL journal line back to its PMS source document.





4.2 Supported Connector Types



5. Security Architecture



6. Scalability & Performance Targets



7. Project Folder Structure

The recommended monorepo structure using pnpm workspaces and Turborepo for build orchestration:



hospitalityfinance-pro/
├── apps/
│   ├── api/                    # Fastify backend (TypeScript)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── gl/         # General Ledger module
│   │   │   │   ├── ap/         # Accounts Payable
│   │   │   │   ├── ar/         # Accounts Receivable
│   │   │   │   ├── fx/         # Foreign Exchange
│   │   │   │   ├── reporting/  # Report engine
│   │   │   │   ├── integration/# PMS/POS connectors
│   │   │   │   └── auth/       # Authentication
│   │   │   ├── shared/         # Shared utilities, types, middleware
│   │   │   ├── db/             # Prisma schema, migrations, seeds
│   │   │   └── jobs/           # BullMQ job definitions
│   │   └── tests/              # Unit + integration tests
│   └── web/                    # Next.js 15 frontend
│       ├── app/
│       │   ├── (auth)/         # Login, SSO callback
│       │   ├── (dashboard)/    # Main app shell
│       │   │   ├── gl/         # GL screens
│       │   │   ├── ap/         # AP screens
│       │   │   ├── ar/         # AR screens
│       │   │   ├── reports/    # Report viewer
│       │   │   └── settings/   # Config screens
│       │   └── api/            # Next.js API routes (thin proxy layer)
│       └── components/         # Shared UI components
├── packages/
│   ├── types/                  # Shared TypeScript types (API contracts)
│   ├── utils/                  # Shared business logic (date, currency, USALI)
│   ├── ui/                     # Shared UI component library
│   └── config/                 # Shared ESLint, TypeScript, Tailwind config
├── infra/                      # Terraform / IaC
├── docs/                       # Architecture docs, API specs (OpenAPI)
├── .github/workflows/          # CI/CD pipelines
├── docker-compose.yml          # Local dev environment
└── turbo.json                  # Turborepo pipeline config



8. Local Development Setup

Prerequisites

Node.js 22 LTS

pnpm 9+

Docker Desktop (for PostgreSQL, Redis, RabbitMQ, Keycloak)

Claude Code (Max plan recommended)



Quick Start Commands

# Clone and install
git clone https://github.com/your-org/hospitalityfinance-pro
cd hospitalityfinance-pro
pnpm install

# Start all infrastructure containers
docker-compose up -d

# Run database migrations and seed data
pnpm db:migrate
pnpm db:seed

# Start all apps in development mode (hot reload)
pnpm dev

# Run tests
pnpm test

# Run linting and type checks
pnpm check



Environment Variables (apps/api/.env)

DATABASE_URL=postgresql://hfp:password@localhost:5432/hfp_dev
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=hfp
KEYCLOAK_CLIENT_ID=hfp-api
AWS_S3_BUCKET=hfp-dev-files
ECB_API_KEY=your_key_here
RESEND_API_KEY=your_key_here



9. Claude Code Usage Guide for This Project

This section provides specific guidance on how to use Claude Code Max effectively throughout the build of HospitalityFinance Pro.



9.1 Recommended Session Structure



9.2 High-Value Claude Code Prompts for This Project

Project Initialisation

> Scaffold a pnpm monorepo with Turborepo for a SaaS financial application called HospitalityFinance Pro. Apps: apps/api (Fastify 4 + TypeScript + Prisma) and apps/web (Next.js 15 App Router + Tailwind + shadcn/ui). Packages: types, utils, ui, config. Include docker-compose.yml with PostgreSQL 16, Redis 7, RabbitMQ, and Keycloak. Add GitHub Actions CI pipeline with lint, test, and build jobs.



GL Module Scaffold

> In apps/api/src/modules/gl/, create a complete General Ledger module following this structure: router.ts (Fastify routes), service.ts (business logic), repository.ts (Prisma queries), types.ts (Zod schemas), and gl.test.ts (Vitest unit tests). Implement: POST /journals (create draft journal), POST /journals/:id/post (post journal with debit=credit validation), GET /journals (paginated list with filters), GET /accounts (chart of accounts with hierarchy). Use the journal and journal_lines schema from the PRD. All amounts must be NUMERIC(18,4). Include double-entry validation that throws GL_UNBALANCED_JOURNAL if debits !== credits.



Currency Revaluation Job

> In apps/api/src/jobs/, create a BullMQ job called fx-revaluation-job.ts. It should: 1) Fetch all open foreign currency monetary items (AP invoices, AR invoices, bank balances) for a given entity, 2) Compare their booked FX rate to the current period closing rate, 3) Calculate the revaluation gain/loss, 4) Auto-post a GL journal with the revaluation entries (debit/credit FX Gain Loss account), 5) Update the functional amount on each item. Write the job to be idempotent — safe to re-run for the same period without duplicating entries.



PMS Integration

> Build a PMS integration connector for Opera Cloud (OHIP API) in apps/api/src/modules/integration/connectors/opera-cloud/. Create: opera-cloud-client.ts (API client using OHIP auth), opera-cloud-mapper.ts (maps OHIP revenue codes to GL accounts using configurable mapping rules), opera-cloud-import-job.ts (BullMQ job that runs nightly, fetches the revenue trial balance for a given business date, transforms it to GL journals, posts them, and writes an import_log record). Handle network failures with retry logic and write quarantined records for unmapped revenue codes.



9.3 What to Always Review Manually

All Prisma schema migrations before running db:migrate in any environment

Double-entry validation logic — test with edge cases (zero-amount lines, multi-currency)

FX revaluation calculations — manually verify against IFRS IAS 21 examples

AP three-way matching tolerance rules — confirm with accounting logic

Any SQL in repository files involving SUM, GROUP BY on financial amounts

Role and permission assignments in Keycloak configuration files

All environment variable handling — ensure no secrets are committed



10. Testing Strategy

