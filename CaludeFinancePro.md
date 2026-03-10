# HospitalityFinance Pro — Comprehensive Technology & Claude Prompt Reference

> **Consolidated from:** Business Plan, Technical Architecture, and Claude Code Sprint Build Plan
> **Date:** March 2026 | Confidential

---

## 1. Project Overview

HospitalityFinance Pro (HFP) is a purpose-built, cloud-native enterprise financial management platform designed for hotels, resorts, restaurant groups, and integrated hospitality operators. It addresses hospitality-specific challenges that generic ERP platforms cannot handle natively: nightly revenue recognition across PMS/POS systems, multi-property consolidation in different currencies, USALI-compliant departmental reporting, and owner vs. operator dual-book accounting.

The platform is organized into four core modules — General Ledger (GL), Accounts Payable & Receivable (AP/AR), Multi-Currency Management, and Financial Reporting & Dashboards — delivered as a modular SaaS with phased deployment capability.

**Key Business Metrics:**

| Metric | Value |
|---|---|
| Target Market | Hotels, resorts, F&B groups globally |
| Revenue Model | SaaS subscription + implementation |
| Year 1 Target ARR | USD 2.4 million |
| Year 3 Target ARR | USD 12+ million |
| Initial Markets | East Africa, Middle East, SE Asia |
| Funding Sought | USD 3.5 million (Seed / Pre-Series A) |

---

## 2. Architecture Principles

The system is built on a cloud-native, API-first architecture designed for multi-tenancy, high availability, and high transaction volumes. Four layers separate concerns cleanly: presentation, application, domain, and data.

- **API-First:** Every feature is exposed as a versioned REST API before UI is built
- **Domain-Driven Design:** Each financial module (GL, AP, AR, FX) is a bounded context with its own service
- **Event Sourcing:** All financial transactions are immutable events — no updates, only corrections via new entries
- **CQRS:** Command (write) and Query (read) paths are separated for performance and audit integrity
- **12-Factor App:** Stateless services, environment-based config, and disposable containers throughout

---

## 3. Complete Technology Stack

### 3.1 Backend Services

| Layer | Technology | Rationale |
|---|---|---|
| Runtime | Node.js 22 LTS (TypeScript 5.4) | Strong async I/O for high-concurrency journal posting; type safety for financial logic |
| API Framework | Fastify 4 | 2x faster than Express; built-in JSON schema validation; OpenAPI 3.1 plugin |
| ORM / Query | Prisma 5 + raw SQL (PostgreSQL) | Prisma for migrations & model; raw SQL for complex GL aggregations |
| Message Broker | RabbitMQ (via CloudAMQP) | Reliable async processing for PMS imports, payment runs, email notifications |
| Job Scheduler | BullMQ (Redis-backed) | Cron-style jobs for night audit imports, FX revaluation, report generation |
| Auth | Keycloak 24 (OIDC/SAML2) | Enterprise SSO, RBAC, multi-tenant isolation; self-hostable |
| Caching | Redis 7 | Session cache, rate limiting, real-time dashboard data, BullMQ backbone |
| Search | PostgreSQL full-text (tsvector + GIN indexes) | Supplier search, transaction search — avoid Elasticsearch complexity at MVP |
| File Storage | AWS S3 / MinIO (self-host) | Invoice PDFs, report exports, PMS import files |
| Email | Resend (API) + React Email | Transactional emails: payment reminders, report delivery, approvals |
| Validation | Zod | Type-safe form validation mirroring backend schemas on every API endpoint |

### 3.2 Frontend

| Layer | Technology | Rationale |
|---|---|---|
| Framework | Next.js 15 (App Router) | SSR for reports; RSC for dashboard data; strong ecosystem |
| UI Components | shadcn/ui + Radix UI | Accessible, unstyled primitives — full design control |
| Styling | Tailwind CSS 4 | Utility-first; consistent design tokens; small bundle |
| Data Fetching | TanStack Query v5 | Optimistic updates, background refetch for live dashboards |
| Charts / Analytics | Recharts + Nivo | Recharts for standard KPI charts; Nivo for heatmaps & sankey flows |
| Data Tables | TanStack Table v8 | Virtual scrolling for 50,000+ GL transaction grids |
| Forms | React Hook Form + Zod | Type-safe form validation mirroring backend schemas |
| State | Zustand | Lightweight global state for filters, user preferences, multi-tab GL |
| PDF Export | react-pdf / @react-pdf/renderer | Client-side PDF generation for financial reports |

### 3.3 Database Architecture

PostgreSQL is the primary database with a multi-schema strategy for tenant isolation. Each hotel property or group entity gets its own PostgreSQL schema within a shared cluster.

| Database | Purpose | Technology |
|---|---|---|
| Primary OLTP | All transactional financial data — journals, AP, AR, payments | PostgreSQL 16 (AWS RDS / Supabase) |
| Read Replicas | Reporting queries, dashboard aggregations, exports | PostgreSQL read replica (auto-scaled) |
| Cache Layer | Session data, rate limits, BullMQ, real-time dashboard | Redis 7 (ElastiCache / Upstash) |
| Time-Series | Exchange rate history, audit event streams | TimescaleDB extension on PostgreSQL |
| Document Store | PMS connector configs, report templates, email templates | PostgreSQL JSONB columns (avoid MongoDB complexity) |
| Search Index | Full-text search on transactions, suppliers, accounts | PostgreSQL tsvector with GIN indexes |

### 3.4 Infrastructure & DevOps

| Component | Tool / Service | Notes |
|---|---|---|
| Cloud Provider | AWS (primary) or Azure | Multi-region support; East Africa → eu-west-1 or af-south-1 |
| Containers | Docker + Docker Compose (dev); ECS Fargate (prod) | Serverless containers — no EC2 management |
| IaC | Terraform + Terragrunt | All infra as code; per-environment workspaces |
| CI/CD | GitHub Actions | Lint → test → build → deploy pipeline; preview environments per PR |
| Monitoring | Datadog (or self-host: Grafana + Prometheus) | APM, log aggregation, custom financial metrics |
| Error Tracking | Sentry | Frontend and backend error capture with release tracking |
| Secret Management | AWS Secrets Manager | Database passwords, API keys, encryption keys |
| CDN | CloudFront + S3 | Static assets, report PDFs, invoice files |
| DNS / TLS | Route 53 + ACM | Wildcard cert for *.hospitalityfinancepro.com |
| Backup | AWS Backup + pg_dump | Daily automated backups; 30-day retention; point-in-time recovery |

### 3.5 Testing Stack

| Test Type | Tool | Coverage Target | What to Test |
|---|---|---|---|
| Unit Tests | Vitest | 90%+ for service layer | Business logic: journal validation, FX calc, matching rules, USALI mapping |
| Integration Tests | Vitest + Testcontainers | 80%+ for API routes | Full request-response cycle with real PostgreSQL in Docker container |
| E2E Tests | Playwright | Critical paths only | Login, post a journal, run a report, approve an invoice, generate payment |
| Load Tests | k6 | Key endpoints | Journal posting: 1000 concurrent posts; report generation: 100 concurrent |
| Accounting Tests | Custom test suite | 100% of GL logic | Balanced journals, period close, consolidation, FX revaluation correctness |

---

## 4. Service Architecture — Modular Monolith

HFP uses a modular monolith approach for the MVP — a single deployable Node.js application with clearly separated domain modules. Each module has its own router, service layer, repository layer, and database schema.

| Service Module | Responsibility | Key Tables | API Exposes |
|---|---|---|---|
| auth-service | User auth, roles, permissions, SSO | users, roles, permissions, tenants | POST /auth/\*, GET /me |
| gl-service | Chart of accounts, journal entries, periods | accounts, journals, journal_lines, periods | CRUD /gl/\* |
| ap-service | Suppliers, invoices, PO matching, payments | suppliers, ap_invoices, ap_payments, purchase_orders | CRUD /ap/\* |
| ar-service | Customers, city ledger, invoices, receipts | customers, ar_invoices, ar_receipts, aging | CRUD /ar/\* |
| fx-service | Exchange rates, revaluation, CTA | currencies, fx_rates, fx_revaluations | CRUD /fx/\* |
| consolidation-service | Multi-entity, eliminations, group reporting | entities, eliminations, consol_adjustments | POST /consolidate/\* |
| reporting-service | Report generation, scheduling, delivery | report_definitions, report_runs, schedules | GET /reports/\* |
| integration-service | PMS/POS/Payroll connectors, import jobs | connectors, import_logs, mapping_rules | POST /integrations/\* |
| notification-service | Email, in-app alerts, approval workflows | notifications, approval_chains, alerts | Internal events only |
| audit-service | Immutable audit trail for all financial events | audit_events, change_log | GET /audit/\* |

### API Design Standards

- **Base URL:** `https://api.hospitalityfinancepro.com/v1/`
- **Auth:** Bearer {jwt} header on all endpoints
- **Tenant Scoping:** X-Entity-ID header (property or group level)
- **Pagination:** Cursor-based for large datasets
- **Filtering:** `?filter[account_code]=1000&filter[period]=2026-03`
- **Sorting:** `?sort=-created_at` (prefix `-` for descending)
- **Versioning:** URL-based (/v1/, /v2/) — no header versioning

**Standard Response Envelope:**
```json
{ "data": { ... }, "meta": { "total": 1250, "cursor": "eyJp..." }, "errors": [] }
```

**Error Format:**
```json
{ "errors": [{ "code": "GL_PERIOD_CLOSED", "message": "Period 2026-01 is closed", "field": "period_id" }] }
```

---

## 5. Core Database Schema

### General Ledger
```sql
journals (
  id UUID PK, entity_id UUID FK, period_id UUID FK,
  reference VARCHAR(50), description TEXT,
  source ENUM(manual|pms|pos|payroll|fx_reval|ap|ar),
  status ENUM(draft|posted|reversed),
  posted_at TIMESTAMPTZ, created_by UUID FK,
  approved_by UUID FK, functional_currency CHAR(3),
  created_at TIMESTAMPTZ
)

journal_lines (
  id UUID PK, journal_id UUID FK, account_id UUID FK,
  debit NUMERIC(18,4), credit NUMERIC(18,4),
  currency CHAR(3), fx_rate NUMERIC(14,8),
  debit_functional NUMERIC(18,4), credit_functional NUMERIC(18,4),
  description TEXT, dimension1..6 VARCHAR(50),
  line_number INTEGER
)
```

### Chart of Accounts
```sql
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
```

### Accounts Payable
```sql
ap_invoices (
  id UUID PK, entity_id UUID FK, supplier_id UUID FK,
  invoice_number VARCHAR(50), invoice_date DATE, due_date DATE,
  currency CHAR(3), gross_amount NUMERIC(18,4),
  tax_amount NUMERIC(18,4), net_amount NUMERIC(18,4),
  functional_amount NUMERIC(18,4), fx_rate NUMERIC(14,8),
  status ENUM(draft|pending_approval|approved|posted|paid|disputed|cancelled),
  gl_journal_id UUID FK, po_id UUID FK,
  payment_terms VARCHAR(50), created_at TIMESTAMPTZ
)

ap_payments (
  id UUID PK, entity_id UUID FK, supplier_id UUID FK,
  payment_date DATE, currency CHAR(3),
  amount NUMERIC(18,4),
  payment_method ENUM(bank_transfer|cheque|card|cash),
  bank_account_id UUID FK, reference VARCHAR(100),
  status ENUM(pending|processed|bounced|cancelled),
  gl_journal_id UUID FK
)
```

---

## 6. Integration Architecture

### 6.1 PMS Night Audit Flow (Critical Data Pipeline)

| Step | Action | Error Handling |
|---|---|---|
| 1. Trigger | Scheduled job fires at 01:00 AM property local time | Retry up to 3x with exponential backoff |
| 2. Fetch | Pull revenue transaction file from PMS API or SFTP | Alert finance team if source unavailable after 3 retries |
| 3. Validate | Check totals balance, required fields, duplicate detection | Quarantine invalid records; import valid portion |
| 4. Map | Apply account mapping rules (PMS revenue code → GL account) | Flag unmapped codes for finance admin for action |
| 5. Transform | Build balanced journal entry (debit revenues, credit control accounts) | Validation: debits must equal credits (to the cent) |
| 6. Post | Write to journal_lines, update account balances | Wrap in DB transaction — all-or-nothing posting |
| 7. Reconcile | Compare PMS trial balance to GL entries | Email exception report if variance > threshold |
| 8. Log | Write import_log record with row counts and amounts | Full audit trail retained indefinitely |

### 6.2 Supported Connector Types

| System | Protocol | Data Exchanged | Frequency |
|---|---|---|---|
| Opera Cloud PMS | REST API (OHIP) | Revenue transactions, room statistics, folio data | Nightly + on-demand |
| Mews PMS | REST API (Mews Open API) | Accounting items, bills, revenue breakdown | Nightly + webhook |
| Cloudbeds PMS | REST API | Reservations, revenue, folios | Nightly |
| Oracle Simphony POS | REST API / SFTP CSV | Sales by revenue centre, discounts, voids | Nightly |
| Lightspeed Restaurant | REST API | Sales summary, product mix, payment types | Nightly |
| Sky Jana Procurement | SFTP + XML / REST | Purchase orders, GRNs, supplier invoices | Real-time + nightly |
| Adaco / Birchstreet | SFTP CSV | Purchase orders, receiving, inventory counts | Nightly |
| Generic Payroll | CSV over SFTP | Payroll journals by department and GL code | Monthly / per run |
| Bank Feeds | OFX / ISO 20022 / SWIFT MT940 | Bank statement transactions for reconciliation | Daily |
| Exchange Rates | ECB / OANDA REST API | Mid-market rates for 180+ currency pairs | Daily at 16:00 ECB |

---

## 7. Security Architecture

| Security Layer | Implementation | Standard |
|---|---|---|
| Authentication | Keycloak OIDC; JWT access tokens (15 min expiry); refresh token rotation | OAuth 2.0 / OIDC |
| Authorisation | RBAC with 12 built-in roles; row-level entity scoping; field-level masks for sensitive data | Custom RBAC |
| Data Encryption at Rest | AES-256 for database volumes; AWS KMS for key management | AES-256 |
| Data Encryption in Transit | TLS 1.3 enforced; HSTS with 1-year max-age; no TLS 1.1/1.2 fallback | TLS 1.3 |
| API Security | Rate limiting (100 req/min per tenant); request signing for webhooks; CORS whitelist | OWASP API Top 10 |
| Input Validation | Zod schemas on every API endpoint; parameterised queries only (no raw SQL interpolation) | OWASP Top 10 |
| Audit Trail | Immutable append-only audit log; every financial record change captured with user, timestamp, diff | SOX-aligned |
| Penetration Testing | Annual third-party pentest; automated DAST scanning in CI/CD pipeline | OWASP ASVS Level 2 |
| Compliance | GDPR data residency options; ISO 27001 roadmap Year 2; SOC 2 Type II Year 3 | GDPR / ISO 27001 |
| Secret Management | No secrets in code or environment files; AWS Secrets Manager with rotation | CIS Benchmark |

---

## 8. Scalability & Performance Targets

| Metric | Target | How Achieved |
|---|---|---|
| API Response Time (p95) | < 200ms read, < 500ms write | Redis caching; read replicas; indexed queries |
| Journal Posting Throughput | 5,000 journal lines/minute | Async batch posting via BullMQ; DB connection pooling (PgBouncer) |
| Concurrent Users | 500 per tenant cluster | Horizontal scaling of API containers; stateless service design |
| Night Audit Import | Process 50,000 PMS transactions in < 10 minutes | Parallel chunk processing; bulk INSERT with pg COPY |
| Report Generation | P&L report < 5 seconds for 12-month view | Pre-aggregated period balances; materialized views refreshed on post |
| Dashboard Load | < 1 second for all KPI widgets | Redis cache with 5-minute TTL; CDN for static assets |
| Database Size (Year 3) | ~2TB across all tenants | Table partitioning by entity_id + year; archive strategy for 7yr+ data |
| Uptime SLA | 99.9% (< 9 hours downtime/year) | Multi-AZ RDS; ECS auto-scaling; Route 53 health checks |

---

## 9. Project Folder Structure

Monorepo using pnpm workspaces and Turborepo for build orchestration:

```
hospitalityfinance-pro/
├── apps/
│   ├── api/                          # Fastify backend (TypeScript)
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── gl/               # General Ledger module
│   │   │   │   ├── ap/               # Accounts Payable
│   │   │   │   ├── ar/               # Accounts Receivable
│   │   │   │   ├── fx/               # Foreign Exchange
│   │   │   │   ├── reporting/        # Report engine
│   │   │   │   ├── integration/      # PMS/POS connectors
│   │   │   │   └── auth/             # Authentication
│   │   │   ├── shared/               # Shared utilities, types, middleware
│   │   │   ├── db/                   # Prisma schema, migrations, seeds
│   │   │   └── jobs/                 # BullMQ job definitions
│   │   └── tests/                    # Unit + integration tests
│   └── web/                          # Next.js 15 frontend
│       ├── app/
│       │   ├── (auth)/               # Login, SSO callback
│       │   ├── (dashboard)/          # Main app shell
│       │   │   ├── gl/               # GL screens
│       │   │   ├── ap/               # AP screens
│       │   │   ├── ar/               # AR screens
│       │   │   ├── reports/          # Report viewer
│       │   │   └── settings/         # Config screens
│       │   └── api/                  # Next.js API routes (thin proxy layer)
│       └── components/               # Shared UI components
├── packages/
│   ├── types/                        # Shared TypeScript types (API contracts)
│   ├── utils/                        # Shared business logic (date, currency, USALI)
│   ├── ui/                           # Shared UI component library
│   └── config/                       # Shared ESLint, TypeScript, Tailwind config
├── infra/                            # Terraform / IaC
├── docs/                             # Architecture docs, API specs (OpenAPI)
├── .github/workflows/                # CI/CD pipelines
├── docker-compose.yml                # Local dev environment
└── turbo.json                        # Turborepo pipeline config
```

---

## 10. Sprint Build Plan — 18 Sprints Over 36 Weeks

### Sprint Timeline Overview

| Phase | Sprints | Weeks | Focus | Claude Code Sessions Est. |
|---|---|---|---|---|
| Phase 1: Foundation | S1–S4 | 1–8 | Infrastructure, auth, GL core, COA | 16-20 sessions |
| Phase 2: AP/AR | S5–S8 | 9–16 | Accounts payable, receivable, suppliers, city ledger | 18-22 sessions |
| Phase 3: Multi-Currency | S9–S11 | 17–22 | FX engine, revaluation, consolidation | 12-15 sessions |
| Phase 4: Reporting | S12–S14 | 23–28 | Dashboards, USALI P&L, report builder | 14-18 sessions |
| Phase 5: Integrations | S15–S16 | 29–32 | PMS/POS connectors, Sky Jana, bank feeds | 10-14 sessions |
| Phase 6: Launch Prep | S17–S18 | 33–36 | Performance, security, UAT, go-live | 8-10 sessions |
| **TOTAL** | **18 sprints** | **36 weeks** | **Production system live** | **78–99 sessions** |

### Claude Code Max Working Method

- Start each sprint: Open Claude Code in your project root directory
- Provide context: Share the relevant PRD section and architecture doc at session start
- Use `/init` to let Claude Code read your codebase before each session
- Run tests after every Claude Code session: `pnpm test` before committing
- Never auto-accept migrations, schema changes, or financial calculation logic
- Commit after each working feature — small commits enable easy rollback

---

## 11. All Claude Code Prompts by Sprint

### Phase 1: Foundation (Sprints 1–4)

---

#### Sprint 1 — Monorepo Setup, Infrastructure & Authentication (Weeks 1–2)

**Prompt 1 — Project Scaffold:**
```
Scaffold a production-ready pnpm monorepo called hospitalityfinance-pro using
Turborepo. Create apps/api (Fastify 4, TypeScript 5.4, Prisma 5, Vitest) and
apps/web (Next.js 15 App Router, TypeScript, Tailwind CSS 4, shadcn/ui). Create
packages/types for shared Zod schemas and TypeScript types. Add docker-compose.yml
with: PostgreSQL 16 (port 5432), Redis 7 (port 6379), RabbitMQ 3 with management UI
(port 5672/15672), Keycloak 24 (port 8080). Configure .env.example files for both
apps. Set up GitHub Actions workflow: install → lint → typecheck → test → build.
Include .husky pre-commit hook running lint-staged.
```

**Prompt 2 — Authentication:**
```
In apps/api, implement Keycloak JWT authentication using @fastify/jwt and
keycloak-js. Create: src/plugins/auth.ts (Fastify plugin that validates Bearer
tokens against Keycloak JWKS endpoint), src/middleware/requireAuth.ts (route
middleware), src/middleware/requireRole.ts (RBAC middleware accepting role array).
In apps/web, set up next-auth v5 with Keycloak provider. Create the login page at
app/(auth)/login/page.tsx with the HospitalityFinance Pro branding (navy #0F2D5E
and teal #0E7C7B). All protected routes redirect to login if unauthenticated.
```

**Prompt 3 — Multi-Tenant Data Model:**
```
Create the Prisma schema in apps/api/src/db/schema.prisma for the core tenant and
entity model: Entity (id, name, type: GROUP|PROPERTY, parent_id,
functional_currency, timezone, country_code, is_active), User (id, email,
keycloak_id, name, entities: EntityUser[]), EntityUser (entity_id, user_id, role:
ENUM), Role, Permission. Add a Prisma middleware that automatically scopes all
queries by entity_id. Create seed data: 1 group entity "HFP Demo Group", 2 property
entities, and 3 demo users (admin, controller, viewer). Write Vitest tests for the
entity scoping middleware.
```

---

#### Sprint 2 — Chart of Accounts & GL Core Engine (Weeks 3–4)

**Prompt 1 — COA Schema & API:**
```
Build the Chart of Accounts module in apps/api/src/modules/gl/. Prisma models:
Account (id, entity_id, code, name, type: ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE,
usali_category, usali_department, normal_balance: DEBIT|CREDIT, parent_id, level,
allow_posting, is_active). API routes in accounts.router.ts: GET /accounts (tree
structure with children nested), GET /accounts/:id, POST /accounts, PUT
/accounts/:id, DELETE /accounts/:id (soft delete only if no transactions). Seed the
USALI standard chart of accounts for a full-service hotel (Rooms, F&B, Spa, Admin,
Undistributed expenses) using the official USALI 11th edition structure. Write Zod
validation schemas and Vitest tests.
```

**Prompt 2 — Journal Engine:**
```
Build the Journal Entry module in apps/api/src/modules/gl/. Prisma models:
Journal (id, entity_id, period_id, reference, description, source, status: DRAFT|
POSTED|REVERSED, posted_at, created_by, approved_by, functional_currency),
JournalLine (id, journal_id, account_id, debit, credit, currency, fx_rate,
debit_functional, credit_functional, description, dimensions 1-6, line_number).
Service methods in journal.service.ts: createJournal() – creates draft,
validateBalance() – throws GL_UNBALANCED_JOURNAL if sum(debit) != sum(credit) to 4
decimal places, postJournal() – validates balance, checks period is open, posts all
lines atomically, updateAccountBalances() – updates account period balances,
reverseJournal() – creates equal and opposite journal. Write comprehensive Vitest
tests covering all edge cases including multi-currency journals.
```

**Prompt 3 — Trial Balance API:**
```
Add GET /gl/trial-balance to the GL router. It should accept query params:
period_id (required), comparative_period_id (optional), show_zero_balances
(boolean). Return: array of accounts with opening_balance, period_debits,
period_credits, closing_balance, comparative_closing_balance. Amounts in both
functional and original currency. Implement as a single optimised PostgreSQL query
using CTEs. The total of all debit balances must equal total credit balances — add
a validation check and return a is_balanced boolean in the response. Write
integration tests using Testcontainers with a real PostgreSQL instance.
```

---

#### Sprint 3 — Period Management, Approval Workflows & GL Frontend (Weeks 5–6)

**Prompt 1 — Period Management:**
```
Build the Period Management module. Prisma model: Period (id, entity_id, year,
month, name, status: OPEN|CLOSED|LOCKED, opened_at, closed_at, closed_by). Rules:
only one period can be OPEN per entity at a time; cannot post journals to CLOSED or
LOCKED periods; LOCKED periods cannot be reopened. API: GET /periods, POST
/periods/:id/close, POST /periods/:id/lock, POST /periods/:id/reopen (LOCKED only
by SUPERADMIN role). Emit period.closed event to RabbitMQ on close (triggers FX
revaluation job).
```

**Prompt 2 — Approval Workflow:**
```
Build a configurable journal approval workflow. Model: ApprovalRule (entity_id,
module: GL|AP|AR, min_amount, max_amount, required_approvers: string[],
require_all: boolean). When a journal above the threshold is created, its status
becomes PENDING_APPROVAL. Send approval request email via Resend to each approver
with a one-click approve/reject link. Track approvals in JournalApproval table.
Auto-post when all required approvals received. Build API: POST
/journals/:id/approve, POST /journals/:id/reject (with rejection reason). Include
approval history in GET /journals/:id response.
```

**Prompt 3 — GL Frontend Screens:**
```
Build the GL frontend screens in apps/web/app/(dashboard)/gl/. Create: 1)
/gl/journals – data table with TanStack Table showing all journals (filterable by
date, status, account, source); clicking a row opens a side drawer with full
journal detail. 2) /gl/journals/new – journal entry form with dynamic line item
rows (add/remove lines), account code picker with search, auto-calculate
debit/credit totals, real-time balance indicator (green if balanced, red if not).
3) /gl/trial-balance – period selector, trial balance table with account hierarchy
expand/collapse, comparative column, export to Excel button. Use shadcn/ui
components throughout. All data fetched via TanStack Query from the API.
```

---

#### Sprint 4 — Audit Trail, Reporting Foundation & GL Polish (Weeks 7–8)

**Prompt 1 — Audit Trail:**
```
Build an immutable audit trail system. Create AuditEvent model (id, entity_id,
user_id, event_type, resource_type, resource_id, before_state JSONB, after_state
JSONB, ip_address, user_agent, created_at). Implement as a Prisma extension that
automatically captures before/after state for all writes to financial tables
(journals, journal_lines, accounts, ap_invoices, ar_invoices, ap_payments). The
audit table must be insert-only — no updates or deletes permitted, enforced at the
database level via a PostgreSQL trigger. API: GET /audit?
resource_type=journal&resource_id=xxx returns full event history. Build the audit
log viewer in the frontend.
```

**Prompt 2 — Report Engine Foundation:**
```
Build the report engine foundation in apps/api/src/modules/reporting/. Create:
ReportDefinition model (id, entity_id, name, type: USALI_PL|TRIAL_BALANCE|
BALANCE_SHEET|CASHFLOW|CUSTOM, template JSONB, is_system boolean), ReportRun model
(id, definition_id, parameters JSONB, status: QUEUED|RUNNING|COMPLETE|FAILED,
output_url, run_at). Implement a BullMQ report-generation-job that: runs the report
SQL query, formats the results using the template, generates a PDF using @react-
pdf/renderer, uploads the PDF to S3, updates the ReportRun record. Build the USALI
Departmental P&L as the first system report template with hardcoded USALI account
mappings.
```

---

### Phase 2: Accounts Payable & Receivable (Sprints 5–8)

---

#### Sprint 5 — Supplier Management & AP Invoice Processing (Weeks 9–10)

**Core AP Prompt:**
```
Build the Accounts Payable module in apps/api/src/modules/ap/. Models: Supplier
(id, entity_id, name, code, tax_id, currency, payment_terms_days, bank_details
JSONB, is_active), APInvoice (id, entity_id, supplier_id, invoice_number,
invoice_date, due_date, currency, gross_amount, tax_amount, net_amount,
functional_amount, fx_rate, status, gl_journal_id, po_id), APInvoiceLine (id,
invoice_id, description, quantity, unit_price, amount, gl_account_id, tax_code).
Implement three-way matching service: matchInvoiceToPO() – compare invoice lines to
PO lines and GRN lines with configurable tolerance (default 2%); return MATCH|
PARTIAL_MATCH|MISMATCH. On approval and posting, auto-generate the GL journal: DR
Expense accounts (per invoice lines), CR Accounts Payable control account. Build
full CRUD API and supplier portal endpoint for invoice submission.
```

---

#### Sprint 6 — Payment Runs & AP Frontend (Weeks 11–12)

**Payment Run Prompt:**
```
Build the payment run engine in ap/payment-run.service.ts. A payment run: 1)
Selects all approved AP invoices due within a date range for a given entity,
grouped by supplier and currency. 2) Applies any available credit notes. 3)
Captures early payment discounts if applicable (based on discount terms on the
invoice). 4) Generates a payment proposal for user review and approval. 5) On
confirmation, generates bank payment files: SWIFT MT103 format for international
payments, SEPA pain.001 XML for EUR SEPA payments, generic CSV for other local bank
formats. 6) Posts GL journals: DR Accounts Payable control, CR Bank account. 7)
Marks invoices as PAID and links to the APPayment record. Build the payment run
approval screen in the frontend with a payment proposal table (supplier, invoice
count, amount, currency) before final submission.
```

---

#### Sprint 7 — Accounts Receivable — City Ledger & Invoicing (Weeks 13–14)

**AR Core Prompt:**
```
Build the Accounts Receivable module in apps/api/src/modules/ar/. Models:
Customer (id, entity_id, name, code, type: CORPORATE|OTA|TRAVEL_AGENT|INDIVIDUAL,
credit_limit, currency, payment_terms_days, billing_contact JSONB), ARInvoice (id,
entity_id, customer_id, invoice_number, invoice_date, due_date, currency, amount,
functional_amount, fx_rate, status, gl_journal_id), ARReceipt (id, entity_id,
customer_id, receipt_date, currency, amount, bank_account_id, reference,
gl_journal_id), ARAllocation (receipt_id, invoice_id, allocated_amount). Implement:
createInvoice() with auto GL posting (DR AR control, CR Revenue), allocateReceipt()
with partial allocation support, getAgeingReport() returning 0-30, 31-60, 61-90,
90+ day buckets per customer, dunning workflow that sends reminder emails at 7, 14,
30 days overdue via BullMQ scheduled jobs.
```

---

#### Sprint 8 — AR Frontend, Group Billing & AP/AR Reporting (Weeks 15–16)

Goals: AR frontend screens (customer list, invoice list, ageing dashboard), group billing (master bill, split bill, individual folios), AP Ageing and AR Ageing reports with export, Phase 2 review and integration testing.

---

### Phase 3: Multi-Currency (Sprints 9–11)

---

#### Sprint 9 — FX Rate Engine & Currency Management (Weeks 17–18)

**FX Engine Prompt:**
```
Build the Foreign Exchange module in apps/api/src/modules/fx/. Models: Currency
(code CHAR(3) PK, name, symbol, decimal_places, is_active), FXRate (id,
from_currency, to_currency, rate_type: SPOT|AVERAGE|BUDGET|CLOSING, rate
NUMERIC(14,8), effective_date DATE, source: ECB|OANDA|MANUAL, created_at). Build a
BullMQ daily job that fetches ECB reference rates at 16:00 CET, stores them as SPOT
rates, and calculates cross rates for non-EUR pairs. Build the FX revaluation job:
query all open foreign currency monetary items (AP invoices status != PAID, AR
invoices status != PAID, bank account balances in foreign currency); calculate
revaluation gain/loss using closing rate vs booked rate; auto-post GL journal with
revaluation entries (IAS 21: P&L for monetary items); mark items as revalued. The
job must be fully idempotent — safe to run multiple times for the same period.
```

---

#### Sprint 10 — Multi-Entity Consolidation Engine (Weeks 19–20)

**Consolidation Prompt:**
```
Build the consolidation engine in apps/api/src/modules/consolidation/. The engine
should: 1) Accept a consolidation group (parent entity + child entities), a
reporting currency, and a period. 2) Translate each child entity's trial balance to
the reporting currency: assets/liabilities at closing rate, income/expenses at
average rate, equity at historical rate. 3) Calculate Currency Translation
Adjustment (CTA) as the balancing figure posted to equity (OCI). 4) Identify and
eliminate inter-company balances: query all journal lines tagged with intercompany
dimensions, generate elimination journals, warn on elimination differences above
threshold. 5) Produce a consolidated trial balance with: entity columns,
eliminations column, consolidated total column. 6) Store consolidation run results
in ConsolidationRun model for historical reference. Build the consolidated P&L view
in the frontend with entity drill-down.
```

---

#### Sprint 11 — Budget Module & FX Frontend (Weeks 21–22)

Goals: Budget entry by department and GL account, budget import via Excel template, budget vs actual variance reporting, FX management frontend screens.

---

### Phase 4: Reporting & Dashboards (Sprints 12–14)

---

#### Sprint 12 — USALI P&L, Balance Sheet & Cash Flow (Weeks 23–24)

**USALI P&L Prompt:**
```
Build the USALI Departmental P&L report in
apps/api/src/modules/reporting/reports/usali-pl.report.ts. The report should follow
the USALI 11th Edition Summary Operating Statement structure: Revenue by department
(Rooms, Food, Beverage, Spa, Golf, Other), Departmental expenses by department, GOP
calculation, Undistributed Operating Expenses (Admin, IT, Sales, Maintenance,
Utilities), EBITDA, Management fees, Fixed charges, NOI. Map GL accounts to USALI
lines using the usali_category and usali_department fields on the Account model.
Support: current period, year-to-date, prior year comparative, budget comparative,
all with variance and variance% columns. Generate as PDF using @react-pdf/renderer
with the HospitalityFinance Pro brand styling. Also generate an Excel version using
ExcelJS with proper number formatting.
```

---

#### Sprint 13 — Executive Dashboards & KPI Engine (Weeks 25–26)

**Dashboard Prompt:**
```
Build the executive dashboard system. Backend: create a KPI computation engine in
reporting/kpi.service.ts that calculates: RevPAR (Rooms Revenue / Available Rooms),
ADR (Rooms Revenue / Occupied Rooms), Occupancy % (Occupied / Available), TRevPAR
(Total Revenue / Available Rooms), GOP % (GOP / Total Revenue), Food Cost % (Food
Cost / Food Revenue), Beverage Cost % (Beverage Cost / Beverage Revenue). KPIs are
sourced from GL account balances + PMS statistics table (room counts imported from
PMS). Cache KPI results in Redis with 5-minute TTL. Frontend: build three dashboard
pages using Recharts: 1) GM Dashboard – KPI score cards, 7-day RevPAR trend line
chart, revenue mix donut chart, departmental GOP bar chart. 2) Controller Dashboard
– AR ageing bar, AP due this week, bank balance summary cards, daily revenue vs
budget sparklines. 3) CFO Dashboard – multi-property table (all properties side by
side), currency exposure summary, covenant ratio gauges.
```

---

#### Sprint 14 — Self-Service Report Builder & Scheduling (Weeks 27–28)

Goals: Drag-and-drop custom report builder, automated report scheduling (daily/weekly/monthly), report distribution via email and secure portal, Power BI connector (ODBC / REST data source).

---

### Phase 5: Integrations (Sprints 15–16)

---

#### Sprint 15 — PMS Connectors — Opera Cloud, Mews & Simphony POS (Weeks 29–30)

**Opera Cloud Connector Prompt:**
```
Build the Opera Cloud (OHIP) PMS connector in
apps/api/src/modules/integration/connectors/opera-cloud/. Create: opera-cloud-
auth.ts (handles OHIP OAuth2 client credentials flow; caches access token with
auto-refresh), opera-cloud-client.ts (typed API client for OHIP revenue management
endpoints), opera-cloud-mapper.ts (maps OHIP revenue transaction codes to GL
account codes using configurable mapping rules stored in ConnectorMapping model;
flags unmapped codes to admin), opera-cloud-import.job.ts (BullMQ job scheduled
nightly: fetches revenue trial balance for business date, validates totals,
transforms to GL journals via mapper, posts journals, writes ImportLog). The job
must: support re-running for a specific date (idempotent), handle partial failures
by quarantining invalid records, send email summary to finance controller on
completion. Build the connector configuration UI where admin can: enter OHIP
credentials, map revenue codes to GL accounts, set import schedule, view import
history.
```

---

#### Sprint 16 — Sky Jana / Procurement & Bank Feed Integration (Weeks 31–32)

**Sky Jana Connector Prompt:**
```
Build the Sky Jana procurement connector. Sky Jana communicates via SFTP file
exchange: outbound PO acknowledgement XML, inbound GRN XML, inbound supplier
invoice XML. Create: sky-jana-sftp-client.ts (SFTP connection using ssh2-sftp-
client; polls for new files every 15 minutes), sky-jana-parser.ts (parses Sky Jana
XML schema to internal types), sky-jana-sync.job.ts (BullMQ job: downloads new
files, parses them, upserts PurchaseOrders, GoodsReceivedNotes, and APInvoices in
the database, triggers three-way matching on new GRNs). For each new GRN, run the
three-way matching engine against the linked PO and any received invoices. Auto-
approve matched invoices within tolerance. Flag mismatches to the AP team via in-
app notification. Write integration tests using a mock SFTP server.
```

---

### Phase 6: Launch Preparation (Sprints 17–18)

---

#### Sprint 17 — Performance, Security Hardening & Load Testing (Weeks 33–34)

**Performance Prompt:**
```
Audit the GL and reporting module for database performance. For each query in
gl.repository.ts and reporting service, run EXPLAIN ANALYZE and identify queries
with sequential scans on large tables. Add appropriate indexes: composite index on
(entity_id, period_id) for journal_lines, partial index on ap_invoices where status
!= 'PAID', GIN index on audit_events JSONB columns. Create a materialized view
mv_period_account_balances that pre-aggregates debit/credit totals by entity,
account, and period. Add a trigger to refresh this view on journal post. Replace
the trial balance query to use this materialized view. Benchmark before/after:
trial balance for 12 months of data should complete in < 500ms.
```

**Security Prompt:**
```
Conduct a security review of the entire API codebase. Check for: 1) SQL injection
vulnerabilities – ensure all queries use parameterised inputs, 2) Missing
authorisation checks – every route must verify entity_id ownership, 3) Sensitive
data exposure – financial amounts, bank details, tax IDs must be masked in logs, 4)
Rate limiting gaps – add per-endpoint rate limits for auth, payment, and export
routes, 5) IDOR vulnerabilities – ensure users cannot access resources from other
entities by manipulating IDs. Generate a security findings report with severity
ratings and fix each HIGH or CRITICAL finding. Add security-focused integration
tests that attempt cross-entity data access and verify 403 responses.
```

---

#### Sprint 18 — UAT, Documentation, Go-Live Checklist & Launch (Weeks 35–36)

Goals: User acceptance testing with pilot customer finance team, API documentation (OpenAPI spec published to docs portal), runbook for go-live cutover and rollback procedure, production environment provisioned and validated, first customer go-live.

---

## 12. High-Value Standalone Claude Code Prompts

These prompts from the Technical Architecture document can be used independently of the sprint plan:

**Project Initialisation:**
```
Scaffold a pnpm monorepo with Turborepo for a SaaS financial application called
HospitalityFinance Pro. Apps: apps/api (Fastify 4 + TypeScript + Prisma) and
apps/web (Next.js 15 App Router + Tailwind + shadcn/ui). Packages: types, utils,
ui, config. Include docker-compose.yml with PostgreSQL 16, Redis 7, RabbitMQ, and
Keycloak. Add GitHub Actions CI pipeline with lint, test, and build jobs.
```

**GL Module Scaffold:**
```
In apps/api/src/modules/gl/, create a complete General Ledger module following
this structure: router.ts (Fastify routes), service.ts (business logic),
repository.ts (Prisma queries), types.ts (Zod schemas), and gl.test.ts (Vitest unit
tests). Implement: POST /journals (create draft journal), POST /journals/:id/post
(post journal with debit=credit validation), GET /journals (paginated list with
filters), GET /accounts (chart of accounts with hierarchy). Use the journal and
journal_lines schema from the PRD. All amounts must be NUMERIC(18,4). Include
double-entry validation that throws GL_UNBALANCED_JOURNAL if debits !== credits.
```

**Currency Revaluation Job:**
```
In apps/api/src/jobs/, create a BullMQ job called fx-revaluation-job.ts. It
should: 1) Fetch all open foreign currency monetary items (AP invoices, AR
invoices, bank balances) for a given entity, 2) Compare their booked FX rate to the
current period closing rate, 3) Calculate the revaluation gain/loss, 4) Auto-post a
GL journal with the revaluation entries (debit/credit FX Gain Loss account), 5)
Update the functional amount on each item. Write the job to be idempotent — safe to
re-run for the same period without duplicating entries.
```

**PMS Integration (Opera Cloud):**
```
Build a PMS integration connector for Opera Cloud (OHIP API) in
apps/api/src/modules/integration/connectors/opera-cloud/. Create: opera-cloud-
client.ts (API client using OHIP auth), opera-cloud-mapper.ts (maps OHIP revenue
codes to GL accounts using configurable mapping rules), opera-cloud-import-job.ts
(BullMQ job that runs nightly, fetches the revenue trial balance for a given
business date, transforms it to GL journals, posts them, and writes an import_log
record). Handle network failures with retry logic and write quarantined records for
unmapped revenue codes.
```

---

## 13. Claude Code Session Best Practices

### Recommended Session Structure

| Session Type | Scope | Duration | Claude Code Mode |
|---|---|---|---|
| Module Scaffold | Full module (e.g. GL): routes, service, repo, types, tests | 2-3 hours | Auto-accept for file creation; review for schema |
| Feature Build | One feature end-to-end (e.g. three-way AP matching) | 1-2 hours | Interactive — review each file |
| Bug Fix / Iteration | Fix failing tests, refactor a service, adjust business logic | 30-60 min | Auto-accept with test run after each change |
| Integration Build | Build a PMS connector (e.g. Opera Cloud) | 2-4 hours | Interactive — API mapping requires review |
| Report Engine | Build a new report template and its data query | 1-2 hours | Interactive — verify SQL logic carefully |

### What to Always Review Manually

- All Prisma schema migrations before running `db:migrate` in any environment
- Double-entry validation logic — test with edge cases (zero-amount lines, multi-currency)
- FX revaluation calculations — manually verify against IFRS IAS 21 examples
- AP three-way matching tolerance rules — confirm with accounting logic
- Any SQL in repository files involving SUM, GROUP BY on financial amounts
- Role and permission assignments in Keycloak configuration files
- All environment variable handling — ensure no secrets are committed

### Final Reminder: Best Practices

- Always run: `pnpm test` after every Claude Code session before committing
- Financial logic: Never auto-accept — always read and understand the calculation
- Database migrations: Always review the generated SQL before applying to any environment
- Security: Never commit .env files; rotate secrets after any accidental exposure
- Keep sessions focused: One feature per session is better than one sprint per session
- Use `/init` at the start of each session so Claude Code reads your current codebase

---

## 14. Go-Live Checklist

| Area | Check |
|---|---|
| Infrastructure | Production RDS PostgreSQL provisioned with Multi-AZ |
| Infrastructure | Redis ElastiCache cluster active |
| Infrastructure | ECS Fargate service scaled to minimum 2 tasks |
| Infrastructure | CloudFront CDN configured for static assets |
| Security | SSL/TLS certificates issued and valid |
| Security | All API keys rotated from dev to production values |
| Security | Keycloak production realm configured with SSO |
| Data | COA loaded and validated with customer finance team |
| Data | Opening balances migrated and trial balance verified |
| Integrations | PMS connector tested with production system |
| Integrations | Bank file generation tested with finance team |
| Monitoring | Datadog APM active; alerts configured |
| Monitoring | Error rate alerts < 1% threshold set |
| Backup | Daily backup policy active; recovery test completed |
| Training | Finance controller training completed and signed off |
| Support | Helpdesk email and escalation path documented |

---

## 15. Local Development Quick Start

**Prerequisites:** Node.js 22 LTS, pnpm 9+, Docker Desktop, Claude Code (Max plan recommended)

```bash
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
```

**Environment Variables (apps/api/.env):**
```
DATABASE_URL=postgresql://hfp:password@localhost:5432/hfp_dev
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=hfp
KEYCLOAK_CLIENT_ID=hfp-api
AWS_S3_BUCKET=hfp-dev-files
ECB_API_KEY=your_key_here
RESEND_API_KEY=your_key_here
```

---

*This document consolidates the HospitalityFinance Pro Business Plan, Technical Architecture, and Claude Code Sprint Build Plan into a single engineering reference. Use it as the primary guide when starting Claude Code sessions for building HFP.*
