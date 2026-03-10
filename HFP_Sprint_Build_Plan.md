## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

# HOSPITALITY FINANCE PRO

## Claude Code Sprint Plan

## 18-Sprint Agile Build Plan with Prompts & Deliverables

Engineering Execution Document

March 2026 | Confidential


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

How to Use This Document

This sprint plan maps the full development of HospitalityFinance Pro across 18 two-week sprints (9
months) using Claude Code Max as the primary development accelerator. Each sprint includes
specific Claude Code prompts, deliverables, definition of done, and manual review checkpoints.

Claude Code Max Working Method
Start each sprint: Open Claude Code in your project root directory
Provide context: Share the relevant PRD section and architecture doc at session start
Use /init to let Claude Code read your codebase before each session
Run tests after every Claude Code session: pnpm test before committing
Never auto-accept migrations, schema changes, or financial calculation logic
Commit after each working feature — small commits enable easy rollback

## Sprint Timeline Overview

Phase

## Sprints

Duration

Focus

Phase 1: Foundation

# S1 – S4

Weeks 1–8

Infrastructure, auth, GL core, COA

Phase 2: AP / AR

# S5 – S8

Weeks 9–16

Accounts payable, receivable,
suppliers, city ledger

Phase 3: Multi-
Currency

# S9 – S11

Weeks 17–22

FX engine, revaluation, consolidation

Phase 4: Reporting

# S12 – S14

Weeks 23–28

Phase 5: Integrations

# S15 – S16

Weeks 29–32

Dashboards, USALI P&L, report
builder

PMS/POS connectors, Sky Jana, bank
feeds

Phase 6: Launch Prep

# S17 – S18

Weeks 33–36

Performance, security, UAT, go-live

## Phase 1: Foundation (Sprints 1–4)

## Sprint 1

Monorepo Setup, Infrastructure & Authentication

Weeks 1–2

Goals

• Working local dev environment with all infrastructure containers
• Monorepo structure with CI/CD pipeline running


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

• User authentication with Keycloak (login, logout, JWT)
• Multi-tenant entity model in database

Claude Code Prompts

Prompt 1 — Project Scaffold:

> Scaffold a production-ready pnpm monorepo called hospitalityfinance-pro using
Turborepo. Create apps/api (Fastify 4, TypeScript 5.4, Prisma 5, Vitest) and
apps/web (Next.js 15 App Router, TypeScript, Tailwind CSS 4, shadcn/ui). Create
packages/types for shared Zod schemas and TypeScript types. Add docker-compose.yml
with: PostgreSQL 16 (port 5432), Redis 7 (port 6379), RabbitMQ 3 with management UI
(port 5672/15672), Keycloak 24 (port 8080). Configure .env.example files for both
apps. Set up GitHub Actions workflow: install → lint → typecheck → test → build.
Include .husky pre-commit hook running lint-staged.

Prompt 2 — Authentication:

> In apps/api, implement Keycloak JWT authentication using @fastify/jwt and
keycloak-js. Create: src/plugins/auth.ts (Fastify plugin that validates Bearer
tokens against Keycloak JWKS endpoint), src/middleware/requireAuth.ts (route
middleware), src/middleware/requireRole.ts (RBAC middleware accepting role array).
In apps/web, set up next-auth v5 with Keycloak provider. Create the login page at
app/(auth)/login/page.tsx with the HospitalityFinance Pro branding (navy #0F2D5E
and teal #0E7C7B). All protected routes redirect to login if unauthenticated.

Prompt 3 — Multi-Tenant Data Model:

> Create the Prisma schema in apps/api/src/db/schema.prisma for the core tenant and
entity model: Entity (id, name, type: GROUP|PROPERTY, parent_id,
functional_currency, timezone, country_code, is_active), User (id, email,
keycloak_id, name, entities: EntityUser[]), EntityUser (entity_id, user_id, role:
ENUM), Role, Permission. Add a Prisma middleware that automatically scopes all
queries by entity_id. Create seed data: 1 group entity "HFP Demo Group", 2 property
entities, and 3 demo users (admin, controller, viewer). Write Vitest tests for the
entity scoping middleware.

Deliverables & Definition of Done

Deliverable

Acceptance Criteria

Monorepo running

pnpm dev starts both api (port 3001) and web (port 3000) with hot reload

Docker environment

docker-compose up starts all 4 containers; health checks pass

CI pipeline

Authentication

Multi-tenancy

GitHub Actions passes on every push to main and feature branches

User can log in via Keycloak; JWT validated on all API routes; logout
clears session

All Prisma queries scoped by entity_id; cross-entity data leakage
impossible

Test coverage

Unit tests pass; API auth routes have integration test coverage

## Sprint 2

Chart of Accounts & GL Core Engine

Weeks 3–4


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

Goals

Full Chart of Accounts CRUD with USALI hierarchy
Journal entry creation, validation, and posting

•
•
• Double-entry enforcement (debits must equal credits)
•

Account balance calculation and trial balance

Claude Code Prompts

Prompt 1 — COA Schema & API:

> Build the Chart of Accounts module in apps/api/src/modules/gl/. Prisma models:
Account (id, entity_id, code, name, type: ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE,
usali_category, usali_department, normal_balance: DEBIT|CREDIT, parent_id, level,
allow_posting, is_active). API routes in accounts.router.ts: GET /accounts (tree
structure with children nested), GET /accounts/:id, POST /accounts, PUT
/accounts/:id, DELETE /accounts/:id (soft delete only if no transactions). Seed the
USALI standard chart of accounts for a full-service hotel (Rooms, F&B, Spa, Admin,
Undistributed expenses) using the official USALI 11th edition structure. Write Zod
validation schemas and Vitest tests.

Prompt 2 — Journal Engine:

> Build the Journal Entry module in apps/api/src/modules/gl/. Prisma models:
Journal (id, entity_id, period_id, reference, description, source, status: DRAFT|
POSTED|REVERSED, posted_at, created_by, approved_by, functional_currency),
JournalLine (id, journal_id, account_id, debit, credit, currency, fx_rate,
debit_functional, credit_functional, description, dimensions 1-6, line_number).
Service methods in journal.service.ts: createJournal() — creates draft,
validateBalance() — throws GL_UNBALANCED_JOURNAL if sum(debit) != sum(credit) to 4
decimal places, postJournal() — validates balance, checks period is open, posts all
lines atomically, updateAccountBalances() — updates account period balances,
reverseJournal() — creates equal and opposite journal. Write comprehensive Vitest
tests covering all edge cases including multi-currency journals.

Prompt 3 — Trial Balance API:

> Add GET /gl/trial-balance to the GL router. It should accept query params:
period_id (required), comparative_period_id (optional), show_zero_balances
(boolean). Return: array of accounts with opening_balance, period_debits,
period_credits, closing_balance, comparative_closing_balance. Amounts in both
functional and original currency. Implement as a single optimised PostgreSQL query
using CTEs. The total of all debit balances must equal total credit balances — add
a validation check and return a is_balanced boolean in the response. Write
integration tests using Testcontainers with a real PostgreSQL instance.

Deliverables & Definition of Done

Deliverable

# COA API

Journal posting

Trial balance

Acceptance Criteria

Full CRUD working; USALI seed data loaded; tree structure correct

POST /journals creates draft; POST /journals/:id/post validates and posts;
unbalanced journal returns 422 with GL_UNBALANCED_JOURNAL error

Returns correct balances; is_balanced always true for posted data;
comparative columns correct

Accounting integrity

10,000 random journal entries posted; sum of all debits = sum of all


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

Test coverage

>90% coverage on gl/service.ts; all validation edge cases tested

credits in trial balance

## Sprint 3

Period Management, Approval Workflows & GL
Frontend

Weeks 5–6

Goals

Accounting period management (open, close, lock)
Journal approval workflow with email notifications

•
•
• GL frontend: journal entry form, COA browser, trial balance screen

Key Claude Code Prompts

Prompt 1 — Period Management:

> Build the Period Management module. Prisma model: Period (id, entity_id, year,
month, name, status: OPEN|CLOSED|LOCKED, opened_at, closed_at, closed_by). Rules:
only one period can be OPEN per entity at a time; cannot post journals to CLOSED or
LOCKED periods; LOCKED periods cannot be reopened. API: GET /periods, POST
/periods/:id/close, POST /periods/:id/lock, POST /periods/:id/reopen (LOCKED only
by SUPERADMIN role). Emit period.closed event to RabbitMQ on close (triggers FX
revaluation job).

Prompt 2 — Approval Workflow:

> Build a configurable journal approval workflow. Model: ApprovalRule (entity_id,
module: GL|AP|AR, min_amount, max_amount, required_approvers: string[],
require_all: boolean). When a journal above the threshold is created, its status
becomes PENDING_APPROVAL. Send approval request email via Resend to each approver
with a one-click approve/reject link. Track approvals in JournalApproval table.
Auto-post when all required approvals received. Build API: POST
/journals/:id/approve, POST /journals/:id/reject (with rejection reason). Include
approval history in GET /journals/:id response.

Prompt 3 — GL Frontend Screens:

> Build the GL frontend screens in apps/web/app/(dashboard)/gl/. Create: 1)
/gl/journals — data table with TanStack Table showing all journals (filterable by
date, status, account, source); clicking a row opens a side drawer with full
journal detail. 2) /gl/journals/new — journal entry form with dynamic line item
rows (add/remove lines), account code picker with search, auto-calculate
debit/credit totals, real-time balance indicator (green if balanced, red if not).
3) /gl/trial-balance — period selector, trial balance table with account hierarchy
expand/collapse, comparative column, export to Excel button. Use shadcn/ui
components throughout. All data fetched via TanStack Query from the API.

Deliverables

Deliverable

Acceptance Criteria

Period management

Open/close/lock working; posting to closed period returns 422

Approval workflow

Journals above threshold require approval; email sent; one-click approve


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

works

# GL UI

Journal list, new journal form, and trial balance all functional; mobile
responsive

## Sprint 4

Audit Trail, Reporting Foundation & GL Polish

Weeks 7–8

Goals

Immutable audit trail for all financial events

•
• Report engine foundation (template system, PDF export)
• GL module complete: drill-down, search, export
Phase 1 internal review and bug fix sprint
•

Key Claude Code Prompts

Prompt 1 — Audit Trail:

> Build an immutable audit trail system. Create AuditEvent model (id, entity_id,
user_id, event_type, resource_type, resource_id, before_state JSONB, after_state
JSONB, ip_address, user_agent, created_at). Implement as a Prisma extension that
automatically captures before/after state for all writes to financial tables
(journals, journal_lines, accounts, ap_invoices, ar_invoices, ap_payments). The
audit table must be insert-only — no updates or deletes permitted, enforced at the
database level via a PostgreSQL trigger. API: GET /audit?
resource_type=journal&resource_id=xxx returns full event history. Build the audit
log viewer in the frontend.

Prompt 2 — Report Engine Foundation:

> Build the report engine foundation in apps/api/src/modules/reporting/. Create:
ReportDefinition model (id, entity_id, name, type: USALI_PL|TRIAL_BALANCE|
BALANCE_SHEET|CASHFLOW|CUSTOM, template JSONB, is_system boolean), ReportRun model
(id, definition_id, parameters JSONB, status: QUEUED|RUNNING|COMPLETE|FAILED,
output_url, run_at). Implement a BullMQ report-generation-job that: runs the report
SQL query, formats the results using the template, generates a PDF using @react-
pdf/renderer, uploads the PDF to S3, updates the ReportRun record. Build the USALI
Departmental P&L as the first system report template with hardcoded USALI account
mappings.

## Phase 2: Accounts Payable & Receivable (Sprints 5–8)

## Sprint 5

Supplier Management & AP Invoice Processing

Weeks 9–10

Goals

•
•
•

Supplier master data management
AP invoice creation, three-way matching, approval
Invoice posting to GL (auto-journal generation)


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

Key Claude Code Prompt

Core AP Prompt:

> Build the Accounts Payable module in apps/api/src/modules/ap/. Models: Supplier
(id, entity_id, name, code, tax_id, currency, payment_terms_days, bank_details
JSONB, is_active), APInvoice (id, entity_id, supplier_id, invoice_number,
invoice_date, due_date, currency, gross_amount, tax_amount, net_amount,
functional_amount, fx_rate, status, gl_journal_id, po_id), APInvoiceLine (id,
invoice_id, description, quantity, unit_price, amount, gl_account_id, tax_code).
Implement three-way matching service: matchInvoiceToPO() — compare invoice lines to
PO lines and GRN lines with configurable tolerance (default 2%); return MATCH|
PARTIAL_MATCH|MISMATCH. On approval and posting, auto-generate the GL journal: DR
Expense accounts (per invoice lines), CR Accounts Payable control account. Build
full CRUD API and supplier portal endpoint for invoice submission.

## Sprint 6

Payment Runs & AP Frontend

Weeks 11–12

Goals

•
•
•

Payment run engine (select invoices, generate payment file)
Bank file generation (SWIFT MT103, SEPA XML)
AP frontend: supplier list, invoice inbox, payment run screen

Key Claude Code Prompt

Payment Run Prompt:

> Build the payment run engine in ap/payment-run.service.ts. A payment run: 1)
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

## Sprint 7

Accounts Receivable — City Ledger & Invoicing

Weeks 13–14

Goals

AR invoice creation and posting

• Customer and city ledger account management
•
• Receipt allocation and payment matching
Ageing analysis and dunning workflow
•


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

Key Claude Code Prompt

AR Core Prompt:

> Build the Accounts Receivable module in apps/api/src/modules/ar/. Models:
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

## Sprint 8

AR Frontend, Group Billing & AP/AR Reporting

Weeks 15–16

Goals

AR frontend screens: customer list, invoice list, ageing dashboard

•
• Group billing: master bill, split bill, individual folios
AP Ageing and AR Ageing reports with export
•
Phase 2 review and integration testing
•

## Phase 3: Multi-Currency (Sprints 9–11)

## Sprint 9

FX Rate Engine & Currency Management

Weeks 17–18

Goals

Exchange rate management (spot, average, budget, closing)
Automated daily ECB rate import

•
•
• Currency revaluation job (IAS 21 compliant)

Key Claude Code Prompt

FX Engine Prompt:

> Build the Foreign Exchange module in apps/api/src/modules/fx/. Models: Currency
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


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

## Sprint 10

Multi-Entity Consolidation Engine

Weeks 19–20

Goals

• Group consolidation with currency translation
•
• Currency Translation Adjustment (CTA) calculation

Inter-company elimination journals

Key Claude Code Prompt

Consolidation Prompt:

> Build the consolidation engine in apps/api/src/modules/consolidation/. The engine
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

## Sprint 11

Budget Module & FX Frontend

Weeks 21–22

Goals

•
•
•
•

Budget entry by department and GL account
Budget import via Excel template
Budget vs actual variance reporting
FX management frontend screens

## Phase 4: Reporting & Dashboards (Sprints 12–14)

## Sprint 12

USALI P&L, Balance Sheet & Cash Flow

Weeks 23–24

Goals

• USALI Summary Operating Statement (full hotel P&L)
•
Balance sheet with comparative period
• Cash flow statement (indirect method)
•

PDF export for all reports


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

Key Claude Code Prompt

USALI P&L Prompt:

> Build the USALI Departmental P&L report in
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

## Sprint 13

Executive Dashboards & KPI Engine

Weeks 25–26

Goals

• GM Revenue Dashboard (RevPAR, ADR, Occupancy, TRevPAR, GOP%)
Finance Controller daily dashboard
•
• Group CFO multi-property dashboard
• Real-time data refresh with Redis caching

Key Claude Code Prompt

Dashboard Prompt:

> Build the executive dashboard system. Backend: create a KPI computation engine in
reporting/kpi.service.ts that calculates: RevPAR (Rooms Revenue / Available Rooms),
ADR (Rooms Revenue / Occupied Rooms), Occupancy % (Occupied / Available), TRevPAR
(Total Revenue / Available Rooms), GOP % (GOP / Total Revenue), Food Cost % (Food
Cost / Food Revenue), Beverage Cost % (Beverage Cost / Beverage Revenue). KPIs are
sourced from GL account balances + PMS statistics table (room counts imported from
PMS). Cache KPI results in Redis with 5-minute TTL. Frontend: build three dashboard
pages using Recharts: 1) GM Dashboard — KPI score cards, 7-day RevPAR trend line
chart, revenue mix donut chart, departmental GOP bar chart. 2) Controller Dashboard
— AR ageing bar, AP due this week, bank balance summary cards, daily revenue vs
budget sparklines. 3) CFO Dashboard — multi-property table (all properties side by
side), currency exposure summary, covenant ratio gauges.

## Sprint 14

Self-Service Report Builder & Scheduling

Weeks 27–28

Goals

Automated report scheduling (daily/weekly/monthly)

• Drag-and-drop custom report builder
•
• Report distribution via email and secure portal
•

Power BI connector (ODBC / REST data source)


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

## Phase 5: Integrations (Sprints 15–16)

## Sprint 15

PMS Connectors — Opera Cloud, Mews &
Simphony POS

Weeks 29–30

Goals

• Opera Cloud (OHIP) nightly revenue import connector
• Mews PMS connector with webhook support
• Oracle Simphony POS daily sales import
• Connector configuration UI in admin settings

Key Claude Code Prompt

Opera Cloud Connector Prompt:

> Build the Opera Cloud (OHIP) PMS connector in
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

## Sprint 16

Sky Jana / Procurement & Bank Feed Integration

Weeks 31–32

Goals

Sky Jana materials management connector (PO, GRN, invoices)

•
• Generic SFTP/CSV procurement connector for other platforms
•
•

Bank statement import (MT940 / OFX) for bank reconciliation
Bank reconciliation matching engine

Key Claude Code Prompt

Sky Jana Connector Prompt:

> Build the Sky Jana procurement connector. Sky Jana communicates via SFTP file
exchange: outbound PO acknowledgement XML, inbound GRN XML, inbound supplier
invoice XML. Create: sky-jana-sftp.client.ts (SFTP connection using ssh2-sftp-
client; polls for new files every 15 minutes), sky-jana-parser.ts (parses Sky Jana
XML schema to internal types), sky-jana-sync.job.ts (BullMQ job: downloads new
files, parses them, upserts PurchaseOrders, GoodsReceivedNotes, and APInvoices in
the database, triggers three-way matching on new GRNs). For each new GRN, run the
three-way matching engine against the linked PO and any received invoices. Auto-


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

approve matched invoices within tolerance. Flag mismatches to the AP team via in-
app notification. Write integration tests using a mock SFTP server.

## Phase 6: Launch Preparation (Sprints 17–18)

## Sprint 17

Performance, Security Hardening & Load Testing

Weeks 33–34

Goals

• Database query optimisation (EXPLAIN ANALYZE all slow queries)
•
•
•

API load testing with k6 (target: 500 concurrent users)
Security audit: OWASP Top 10 review, dependency scanning
Penetration testing preparation

Key Claude Code Prompts

Performance Prompt:

> Audit the GL and reporting module for database performance. For each query in
gl.repository.ts and reporting service, run EXPLAIN ANALYZE and identify queries
with sequential scans on large tables. Add appropriate indexes: composite index on
(entity_id, period_id) for journal_lines, partial index on ap_invoices where status
!= 'PAID', GIN index on audit_events JSONB columns. Create a materialized view
mv_period_account_balances that pre-aggregates debit/credit totals by entity,
account, and period. Add a trigger to refresh this view on journal post. Replace
the trial balance query to use this materialized view. Benchmark before/after:
trial balance for 12 months of data should complete in < 500ms.

Security Prompt:

> Conduct a security review of the entire API codebase. Check for: 1) SQL injection
vulnerabilities — ensure all queries use parameterised inputs, 2) Missing
authorisation checks — every route must verify entity_id ownership, 3) Sensitive
data exposure — financial amounts, bank details, tax IDs must be masked in logs, 4)
Rate limiting gaps — add per-endpoint rate limits for auth, payment, and export
routes, 5) IDOR vulnerabilities — ensure users cannot access resources from other
entities by manipulating IDs. Generate a security findings report with severity
ratings and fix each HIGH or CRITICAL finding. Add security-focused integration
tests that attempt cross-entity data access and verify 403 responses.

## Sprint 18

UAT, Documentation, Go-Live Checklist & Launch

Weeks 35–36

Goals

API documentation (OpenAPI spec published to docs portal)

• User acceptance testing with pilot customer finance team
•
• Runbook for go-live cutover and rollback procedure
Production environment provisioned and validated
•
First customer go-live
•


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

Go-Live Checklist

Area

Check

Infrastructure

Production RDS PostgreSQL provisioned with Multi-AZ

Infrastructure

Redis ElastiCache cluster active

Infrastructure

ECS Fargate service scaled to minimum 2 tasks

Infrastructure

CloudFront CDN configured for static assets

Security

Security

Security

Data

Data

SSL/TLS certificates issued and valid

All API keys rotated from dev to production values

Keycloak production realm configured with SSO

COA loaded and validated with customer finance team

Opening balances migrated and trial balance verified

Integrations

PMS connector tested with production system

Integrations

Bank file generation tested with finance team

Monitoring

Monitoring

Backup

Training

Support

Datadog APM active; alerts configured

Error rate alerts < 1% threshold set

Daily backup policy active; recovery test completed

Finance controller training completed and signed off

Helpdesk email and escalation path documented

## Sprint Summary & Velocity Targets

Phase

## Sprints

Weeks

Key Deliverable

Status

☐

☐

☐

☐

☐

☐

☐

☐

☐

☐

☐

☐

☐

☐

☐

☐

GL live, auth, audit trail

Full AP/AR with payments

FX engine, consolidation

Claude Code
Sessions Est.

16-20 sessions

18-22 sessions

12-15 sessions

1: Foundation

# 2: AP/AR

1–4

5–8

3: Multi-Currency

9–11

4: Reporting

5: Integrations

6: Launch

# TOTAL

12–14

15–16

17–18

1–8

9–16

17–22

23–28

29–32

33–36

Dashboards, USALI P&L, builder

14-18 sessions

Opera, Sky Jana, bank feeds

10-14 sessions

Security, UAT, go-live

8-10 sessions

78–99 sessions

18 sprints

36 weeks

Production system live

Final Reminder: Claude Code Max Best Practices


## HospitalityFinance Pro  |  Claude Code Sprint Build Plan

Always run: pnpm test after every Claude Code session before committing
Financial logic: Never auto-accept — always read and understand the calculation
Database migrations: Always review the generated SQL before applying to any environment
Security: Never commit .env files; rotate secrets after any accidental exposure
Keep sessions focused: One feature per session is better than one sprint per session
Use /init at the start of each session so Claude Code reads your current codebase

