# Mannal Finance — Hospitality Financial Management Cloud: Enterprise SaaS Product Blueprint

> **Input document, kept as the owner supplied it (version 1.0, November 2026).** It is input to Stage 2 of `docs/PRODUCT-ROADMAP.md` (document 2.1 in particular), not a specification. Where it differs from the roadmap's settled decisions (section 2 of the roadmap: Fastify, one database per tenant, procurement and inventory out of scope, no vendor names in customer-facing material), the roadmap wins; the differences are listed in the roadmap's amendment of 23 November 2026. The vendor names below are for internal reference only and must not appear in customer-facing material. "Mannal Finance" is a working name until the owner decides the product name.

Vision • Requirements • Architecture • Accounting • Data Model • UX • AI • Roadmap • Claude Code guide

Inspired by Infor SUN Systems and Oracle NetSuite; designed specifically around hotel and resort financial operations.

## Contents

1. Product Vision & Positioning
2. Product Requirements Document
3. Core Modules & Hospitality Differentiators
4. System Architecture & Engineering Standards
5. Accounting Engine & Ledger Specification
6. Database Architecture & Conceptual Data Model
7. Navigation & UX Specification
8. AI Finance Copilot & Governance
9. SaaS Business Model & Competitive Positioning
10. Project Roadmap & Delivery Plan
11. Claude Code Operating Instructions
12. First Claude Code Prompt
13. Risks, Open Decisions & Definition of Done

## 1. Product Vision & Positioning

Mannal Finance is a cloud-based enterprise financial management platform purpose-built for hotels, resorts, hospitality management companies, hotel groups, owners, and multi-property operators. It combines enterprise accounting, hospitality-native reporting, operational integrations, financial controls, budgeting, consolidation, and AI-assisted insights.

### Positioning

| Dimension         | Direction                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Product category  | Hospitality Financial ERP / SaaS                                                                                |
| Primary customers | Independent hotels, resorts, hotel groups, management companies and asset owners                                |
| Differentiation   | Hotel-native accounting, USALI-oriented reporting, PMS/POS integration, owner reporting and property comparison |
| Principles        | Accuracy, traceability, tenant isolation, hospitality-first workflows, controlled automation and explainable AI |

### Product objectives

- Enterprise-grade accounting and controls.
- Scale from one hotel to multi-property, multi-entity groups.
- Automate daily revenue and reconciliation.
- Native hospitality departmental and USALI reporting.
- Connect PMS, POS, banks, payroll, procurement and other systems.
- Reduce spreadsheet dependency without losing auditability.
- Use AI to assist—not bypass—financial controls.

### Target customers

- Independent and boutique hotels
- Resorts and lodges
- Hotel management companies
- Multi-property hotel groups
- Hospitality asset managers and owners
- Serviced apartments and restaurant groups

### Personas

| Persona                | Responsibilities                                       |
| ---------------------- | ------------------------------------------------------ |
| Platform Administrator | Tenant provisioning, subscriptions and platform health |
| Group Finance Director | Consolidation, group performance and cash flow         |
| Financial Controller   | Ledger, close, reconciliation, approvals and reporting |
| Property Accountant    | Invoices, journals, payments and revenue imports       |
| Director of Finance    | Property budgets, expenses and forecasts               |
| General Manager        | Hotel performance, KPIs and alerts                     |
| Department Head        | Department budgets and approved costs                  |
| Auditor                | Read-only audit and compliance review                  |

### Product domains

- Platform/tenant management; organization/property; identity and access
- GL, AP, AR, cash/bank and tax
- Procurement, inventory, fixed assets, budgeting
- Hospitality revenue, PMS/POS integration and USALI
- Financial reporting, analytics, consolidation and intercompany
- Workflows, audit, AI Copilot and subscription administration

### Non-functional requirements

- Fast, paginated views and asynchronous heavy reports
- Backups, recovery, availability and scale-ready architecture
- Transactional posting and recoverable integrations
- Modular code, migration controls, tests and documentation
- Security, tenant isolation, protected documents and auditable activity

### MVP scope

- Tenant and organization/property setup
- Authentication, roles and permissions
- COA, dimensions and fiscal periods
- Journal entry and posting engine
- Ledger, trial balance, P&L and balance sheet
- Audit trail and period locks
- AP/AR foundation and cash/bank basics
- Hotel revenue import, mapping and reconciliation

### Out of scope for MVP

Payroll engine, PMS/POS replacement, reservation/booking engine, channel manager, HR management, advanced supply chain, and autonomous AI accounting transactions.

## 2. Core Modules & Hospitality Differentiators

| Module              | Capabilities                                                                          |
| ------------------- | ------------------------------------------------------------------------------------- |
| General Ledger      | COA, journals, posting, periods, accruals, trial balance, financial statements        |
| Accounts Payable    | Supplier invoices, approvals, credit notes, payment runs and aging                    |
| Accounts Receivable | Corporate/guest accounts, invoices, receipts, collections and aging                   |
| Cash & Bank         | Cashbook, bank accounts, statement import, reconciliation and forecasts               |
| Tax                 | Tax codes, inclusive/exclusive tax, exemptions and country-specific rules             |
| Procurement         | Requisitions, RFQ, quotations, PO, receiving and invoice matching                     |
| Inventory & Cost    | Stores, stock movement, counts, valuation, wastage and consumption                    |
| Fixed Assets        | Register, capitalization, depreciation, transfers, disposals and impairment           |
| Budget & Forecast   | Department/property budgets, versions, rolling forecasts and variance                 |
| Hospitality Finance | Business date, revenue centers, outlets, revenue batches, USALI and departmental P&L  |
| Consolidation       | Multi-entity, intercompany, eliminations, currency translation and group statements   |
| Reporting & BI      | Financial statements, dashboards, variance analysis and owner reporting               |
| Workflow & Audit    | Approvals, SoD, protected audit logs and period controls                              |
| AI Copilot          | Finance Q&A, variance explanation, anomaly detection, invoice and forecast assistance |

### Hospitality differentiators

- PMS daily revenue ingestion and finance-ready posting proposals
- POS revenue by outlet, taxes, discounts and payments
- Night audit checks and daily revenue audit
- USALI-compatible reporting framework with configurable mappings
- Department/outlet profitability and owner reporting
- Management fee calculation options
- Hotel KPIs: occupancy, ADR, RevPAR, GOP and EBITDA where data is available
- Multi-property comparison and CapEx tracking

### Integration targets

| System                 | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| Oracle OPERA Cloud     | Daily revenue, guest ledger, taxes, payment and operational data |
| Oracle MICROS Simphony | POS revenue, outlet totals, discounts, taxes and payment totals  |
| Other PMS/POS          | Vendor adapters; expand based on customer demand                 |
| Banks                  | Statement imports/reconciliation; feeds where supported          |
| Payroll                | Payroll journal import and liability mapping                     |
| Excel/CSV              | Controlled import/export and migration                           |
| APIs/Webhooks          | Partner integration and event exchange                           |

## 3. System Architecture & Engineering Standards

| Layer      | Recommended technology                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Frontend   | Next.js, React, TypeScript, Tailwind, shadcn/ui, TanStack Query, React Hook Form, Zod, TanStack Table |
| Backend    | NestJS, TypeScript, REST, OpenAPI, domain services                                                    |
| Database   | PostgreSQL, Prisma, migrations, tenant-aware constraints and indexes                                  |
| Jobs       | Redis, BullMQ, scheduled/retryable workers                                                            |
| Storage    | S3-compatible private storage for documents and attachments                                           |
| Testing    | Vitest/Jest, React Testing Library, integration and Playwright E2E                                    |
| Deployment | Linux, managed DB if practical, CI/CD, environments, monitoring and backups                           |

### Monorepo proposal

- `apps/` (web, api, worker)
- `packages/` (ui, config, types, validation, database, auth, tenancy, audit, accounting, finance, hospitality, integrations, reporting)
- `docs/` (product, architecture, accounting, database, security, modules, API, decisions)

### Architecture principles

- Modular monolith first; no microservices initially.
- Controllers stay thin; domain/application services own rules.
- Accounting is centralized; modules cannot create separate ledgers.
- Tenant context comes from authenticated membership, not untrusted client values.
- Use tenant-aware constraints, backend authorization, isolation tests and evaluate PostgreSQL RLS.
- Posting is transactional, idempotent and immutable.
- Integration adapters stage, normalize and validate data before posting.
- Workers handle imports, OCR, reports, forecasts and scheduled work.
- Reports reconcile to posted ledger data.
- Record important decisions in ADRs.

### Scale strategy

Optimize SQL and indexes → connection pooling → scale web instances → scale workers → isolate reporting workloads → read replicas → extract services only when justified.

## 4. Accounting Engine & Ledger Specification

### Core accounting rules

- Double-entry; debits equal credits.
- Posted records are immutable; corrections use reversals/adjustments.
- Posting is atomic, transactional and idempotent.
- Validate tenant, entity, source, state, accounts, dimensions, period, currency, approvals and balance.
- Use decimal-safe financial arithmetic.
- Ledger is the source of truth for posted balances.

### Chart of accounts

Account code/name, type/category, parent, posting allowed, active status, normal balance, control/cash/tax/retained-earnings flags, financial statement mapping, USALI mapping and effective dates.

### Account types

Assets; Liabilities; Equity; Revenue; Expenses.

### Dimensions

Legal Entity; Property; Department; Cost Center; Outlet; Project; Intercompany Entity; additional dimensions configurable later.

### Fiscal periods

- States: Future, Open, Soft Closed, Closed.
- Posting requires open period.
- Reopening requires authorization and audit.
- Closed periods prohibit posting.

### Journal data

Header: ID/number, tenant, entity, source/type, transaction/accounting date, period, currency/rate, description/reference, source document, status, actors/timestamps and reversal reference. Lines: account, description, debit/credit, transaction/functional/base currency amounts, exchange rate, dimensions, tax code and reference. Amounts cannot be negative; a line cannot debit and credit simultaneously; journals require debit and credit lines.

### Posting sequence

1. Authenticate and authorize; validate tenant and entity.
2. Validate source/status, accounts, dimensions, period, currency/rate, approval and balance.
3. Check idempotency key.
4. Begin transaction and lock relevant records.
5. Create posted record/ledger, update journal, write audit and idempotency outcome.
6. Commit; on failure roll back all effects.

### Lifecycle

Draft → Submitted → Pending Approval → Approved → Posted. Additional states: Rejected, Cancelled, Reversed. Variations may be policy-driven.

### Reversal & immutability

- Reversal references the original; equal-and-opposite lines; valid authorized date; respects periods; audited; duplicate reversal blocked.
- Never edit or delete posted journals.

### Multi-currency

- Transaction, functional and reporting currency distinctions.
- Daily, monthly-average, closing, historical and user-defined rates.
- Retain applied rate; realized/unrealized FX and revaluation.
- Do not rewrite historical posted values.

### Source traceability

Manual Journal, AP, AR, Bank, Cash, PMS, POS, Inventory, Procurement, Fixed Assets, Payroll, Tax, Intercompany and Consolidation. Users can drill to source documents.

### Reconciliation

AP subledger to GL; AR to GL; cashbook to GL; inventory to GL; assets to GL; PMS revenue to GL; POS revenue to GL. Protect control accounts.

### Critical test gates

- Balanced journals post; unbalanced fail; inactive account, invalid dimension, closed period and unauthorized posting fail.
- Rollback leaves no partial records; concurrency and retries cannot duplicate posting.
- Posted records immutable; reversal balances and is unique.
- Trial balance reconciles to ledger; statements reconcile to posted balances.

## 5. Database Architecture & Conceptual Data Model

| Domain       | Entities                                                      |
| ------------ | ------------------------------------------------------------- |
| Platform     | Tenant, Subscription, Plan, Feature                           |
| Identity     | User, Membership, Role, Permission, Session                   |
| Organization | Group, LegalEntity, Property, Department, Outlet, CostCenter  |
| Accounting   | Account, FiscalYear, FiscalPeriod, Journal, JournalLine       |
| Finance      | Supplier, Customer, Invoice, CreditNote, Payment              |
| Banking      | BankAccount, BankStatement, BankStatementLine, Reconciliation |
| Hospitality  | BusinessDate, RevenueCenter, RevenueBatch, RevenueMapping     |
| Procurement  | Requisition, RFQ, PurchaseOrder, GoodsReceipt                 |
| Inventory    | Item, Store, StockMovement, StockCount, InventoryValuation    |
| Assets       | Asset, AssetCategory, DepreciationSchedule, AssetMovement     |
| Budget       | Budget, BudgetVersion, BudgetLine, Forecast                   |
| Reporting    | ReportDefinition, FinancialStatementMapping                   |
| Workflow     | ApprovalWorkflow, ApprovalRequest, ApprovalStep               |
| Audit        | AuditEvent, ActivityLog                                       |
| Integration  | IntegrationConnection, ImportJob, ImportBatch, MappingRule    |
| AI           | AIConversation, AIAction, AIUsageLog                          |

### Conceptual relationships

Tenant owns legal entities and memberships. Legal entities relate to properties and maintain accounts and fiscal periods. Legal entities record journals; journals contain lines; lines reference accounts and dimensions. Integration connections produce jobs/batches; normalized revenue batches can create validated journal proposals and postings.

### Database requirements

- Tenant-owned records include tenant identifiers.
- Use composite tenant-aware keys and foreign keys where appropriate.
- Legal entity and property are separate concepts.
- Specify cardinality, ownership and constraints for relationships.
- Index critical query patterns; document migrations.
- Soft delete only suitable master data; never erase posted records.
- Preserve source references and documents.
- Define transactional boundaries and concurrency control.
- Configurable dimensions should not multiply COA accounts.

## 6. Navigation & UX Specification

| Navigation          | Screens / purpose                                         |
| ------------------- | --------------------------------------------------------- |
| Dashboard           | Finance overview, alerts and KPIs                         |
| Organization        | Group, entity, property, department, outlet               |
| General Ledger      | COA, journals, ledger, periods, TB                        |
| Accounts Payable    | Suppliers, invoices, approvals, payments, aging           |
| Accounts Receivable | Customers, invoices, receipts, collections, aging         |
| Cash & Banking      | Cashbooks, banks, statements, reconciliation              |
| Procurement         | Requisitions, quotes, PO, goods receipt                   |
| Inventory           | Items, stores, stock movement, counts and costing         |
| Fixed Assets        | Register, depreciation and movements                      |
| Budgets & Forecasts | Budget versions, forecast and variance                    |
| Hospitality Finance | Revenue batches, mappings, audit and departmental reports |
| Financial Reports   | Statements, management reports, USALI views               |
| AI Finance          | Copilot and insights                                      |
| Administration      | Users, roles, workflows, integrations and settings        |

### Top bar

Tenant/group, legal entity, property, financial period selectors; global search; notifications; help; user profile.

### Workspace

Collapsible permission-aware sidebar; title/breadcrumbs; actions; filters; table/analytics; context actions.

### Design language

Premium enterprise SaaS; neutral canvas; dark navy navigation; teal/emerald accent; restrained colors; consistent typography; dense finance tables; aligned numbers; responsive; avoid gratuitous gradients and decorative charts.

### Dashboard metrics

Revenue, expenses, profit, cash/bank, budget variance, cash flow, AP due, AR aging, reconciliation status, daily revenue, occupancy, ADR, RevPAR, GOP, EBITDA and department performance. Demo values must be labeled sample data.

## 7. AI Finance Copilot & Governance

| Agent                    | Function                                                 |
| ------------------------ | -------------------------------------------------------- |
| Finance Analyst          | Natural-language financial queries within permitted data |
| AP Assistant             | Invoice extraction, coding suggestions, duplicate alerts |
| Reconciliation Assistant | Mismatch detection and investigation suggestions         |
| Budget Agent             | Monitor and explain budget variances                     |
| Revenue Audit Agent      | PMS/POS reconciliation assistance                        |
| Forecast Agent           | Cash flow and expenditure forecast assistance            |
| Controller Assistant     | Close checklist and missing-entry assistance             |
| Executive Agent          | Management summaries and property comparisons            |

### Guardrails

- AI respects tenant, entity, property and user permissions.
- No silent journal posting, invoice approval, payment, closed-period change or irreversible action.
- Financial actions require explicit permission, deterministic validation and human approval.
- Use approved application services; no unrestricted database mutation.
- Log AI actions; protect sensitive data.
- Explain evidence/assumptions where possible and distinguish facts from estimates.

## 8. SaaS Business Model & Competitive Positioning

### Customer segments

Independent hotels and boutique properties; resorts and lodges; multi-property hotel groups; management companies; hotel owners and asset managers.

### Indicative pricing hypotheses (not market research)

| Plan         | Target                | Illustrative price/month |
| ------------ | --------------------- | ------------------------ |
| Starter      | One independent hotel | $99–199                  |
| Professional | Larger hotel/resort   | $299–599                 |
| Group        | 3–10 properties       | $799–1,999               |
| Enterprise   | 10+ properties        | Custom                   |

Add-ons: additional properties/entities; AI usage; advanced integrations; consolidation; premium support; implementation and migration.

### Positioning

Do not claim early releases outperform Oracle or Infor. Compete through hospitality-native workflows, easier deployment, usability, integration and accessible support. Potential markets to validate include East Africa, Tanzania, Kenya, Zanzibar, UAE and other hotel regions where legacy finance platforms may be costly or complex.

## 9. Project Roadmap & Delivery Plan

Planning ranges for a small focused team using AI-assisted development; estimates are not guarantees. Accounting review, security, migration and integration work may alter timing. Each phase requires working software, test evidence, documentation and a demo.

| Phase                      | Estimate | Scope / outcome                                                             | Exit gate                             |
| -------------------------- | -------- | --------------------------------------------------------------------------- | ------------------------------------- |
| 0. Product foundation      | 1–2 wks  | Specs, architecture, ADRs, threat model, UX system, backlog                 | Approved foundation                   |
| 1. Platform                | 2–4 wks  | Repo, CI, auth, tenant context, organization, RBAC, audit, shell            | Secure tenant skeleton                |
| 2. Accounting core         | 4–7 wks  | COA, dimensions, periods, journals, posting, reversal, ledger, TB           | Accounting tests; ledger/TB reconcile |
| 3. Statements              | 2–4 wks  | P&L, balance sheet, mappings, filters, exports, close controls              | Statements reconcile to TB            |
| 4. AP/AR/Cash              | 4–6 wks  | Masters, invoices, approvals, receipts/payments, bank import/reconciliation | Subledgers reconcile to GL            |
| 5. Hospitality revenue     | 3–5 wks  | Staging, mapping, business date, PMS/POS imports, audit/reconciliation      | Idempotent import; controlled posting |
| 6. Budgets & assets        | 4–6 wks  | Budget versions, variance, asset register, depreciation and posting         | Budget/asset tests                    |
| 7. Procurement & inventory | 5–8 wks  | Requisition, PO, receipt, matching, stores, counts, costing                 | Inventory/control reconcile           |
| 8. Consolidation           | 5–8 wks  | Intercompany, FX translation, eliminations and group reporting              | Group controls/statements             |
| 9. AI/integrations         | Ongoing  | Copilot, anomaly insights, OPERA/OHIP and Simphony, bank APIs               | Permission-aware; connector QA        |
| 10. Pilot/production       | 4–8 wks  | Pilot, migration, UAT, security, backup/restore, training and rollout       | Operational readiness                 |

### First 90 days — suggested

| Window     | Work                                                          | Deliverable                    |
| ---------- | ------------------------------------------------------------- | ------------------------------ |
| Days 1–15  | Foundation docs, ADRs, repo/tooling, UI system                | Approved foundation/backlog    |
| Days 16–30 | Tenant/auth/org skeleton, CI, audit, app shell and tests      | Secure multi-tenant skeleton   |
| Days 31–60 | COA, dimensions, periods, journal workflow and posting engine | Accounting core with tests     |
| Days 61–90 | Ledger, TB, statement mapping, reports and accounting QA      | Validated accounting prototype |

### Milestone definition of done

Acceptance criteria met; tests green; typecheck and lint pass; migration reviewed; tenant isolation verified; no dead UI; docs updated; risks and known issues reported; end-to-end demo.

## 10. Claude Code Operating Instructions

Project rules — add to CLAUDE.md:

- Act as Principal Architect and implementation engineer for Mannal Finance.
- Inspect repository before changes; never assume empty; do not overwrite/delete without approval.
- Specifications are authoritative; report conflicts before implementation.
- Accounting: double-entry, transactional posting, idempotency, immutable posted records, reversal correction, decimal-safe arithmetic, period validation and audit.
- Tenancy: validated tenant context, backend authorization, tenant-aware constraints and isolation tests.
- Engineering: strict TypeScript; avoid unnecessary any; no fake functionality, dead buttons, swallowed errors or unverified claims.
- Database: use migrations; no destructive reset without explicit approval; review migrations and preserve data.
- Testing: critical domains require automated unit, integration and security tests.
- Workflow: small milestones; no unrelated modules in one task.
- Stop for ambiguity in accounting policy, tenant security, destructive operations, major architecture changes, migration risks, paid services or external costs.
- For each task: read specs, inspect code, scope, risks, plan, implement, migrate only if authorized, test, typecheck, lint, verify, document and report.
- Distinguish implemented, tested, verified, incomplete, blocked and known issues.
- AI uses approved services, respects permissions and cannot autonomously execute financial actions.

Required task report: implemented work; files changed; decisions; tests and results; typecheck/lint; known issues; risks; next task.

## 11. First Claude Code Prompt

> You are the Principal Software Architect responsible for founding Mannal Finance, an enterprise Hospitality Financial Management SaaS inspired by Infor SUN Systems and Oracle NetSuite.
>
> The platform serves hotels, resorts, hotel groups, management companies, owners and multi-property operators. It combines enterprise accounting with hospitality finance, USALI reporting, PMS/POS revenue integration, property reporting, consolidation, procurement, inventory, fixed assets, budgeting and analytics.
>
> FIRST TASK: DOCUMENTATION AND ARCHITECTURE ESTABLISHMENT — NOT APPLICATION DEVELOPMENT.
>
> 1. Inspect the repository. Determine whether empty, existing or containing prior work. Do not delete, overwrite or replace files.
> 2. Establish docs for product/PRD and vision; architecture/system design/ADRs; accounting engine/posting rules/financial controls; database model/relationships/tenancy; modules; security/RBAC/audit; integrations/OPERA/SIMPHONY; UX/design/navigation; roadmap/implementation plan; AI architecture/governance.
> 3. Document personas, requirements, scope, tenancy, accounting controls, hospitality, integrations and non-functional requirements.
> 4. Evaluate Next.js, React, TypeScript, NestJS, PostgreSQL, Prisma, Redis, BullMQ, modular monolith, REST/OpenAPI and automated tests. Explain tradeoffs; don't silently change architecture.
> 5. Design accounting: double-entry, COA, dimensions, periods, journals, posting, reversal, ledger, TB, statements, FX, immutable records, idempotency and audit.
> 6. Create conceptual data model before full schema implementation: ownership, cardinality, tenant constraints, indexes, relationships and security.
> 7. Create phased roadmap with objectives, dependencies, deliverables, acceptance criteria, risks and test gates.
> 8. Record major decisions in ADRs.
> 9. Review conflicts, missing requirements, accounting/security risks and dependencies. Create FOUNDATION-REVIEW.md.
> 10. Do not build application features, create fake functionality, assume hotel policies, make destructive changes, introduce microservices or skip financial architecture.
> 11. Report documentation created, architecture decisions, unresolved questions and recommended first development milestone.

## 12. Risks, Open Decisions & Definition of Done

### Key risks and mitigations

| Risk                          | Mitigation / gate                                                           |
| ----------------------------- | --------------------------------------------------------------------------- |
| Accounting mistakes           | Accounting review, deterministic posting, tests and reconciliation gates    |
| Tenant leakage                | Tenant-aware constraints, authorization, RLS evaluation and isolation tests |
| Scope creep                   | Milestone scope and backlog; defer advanced features                        |
| Duplicate integration revenue | Idempotency, source IDs, staging, reconciliation and monitoring             |
| AI unsafe action              | Tool allowlist, permissions, approvals and audit                            |
| Migration errors              | Mapping review, trial migration, reconciliation and rollback plan           |
| Over-engineering              | Modular monolith; extract only with evidence                                |
| Operational gaps              | Backup/restore test, monitoring, incident plan, pilot and training          |

### Open decisions before implementation

- Tenant model: shared DB/schema with tenant-aware constraints/RLS versus future dedicated DB option.
- Accounting policy: fiscal calendar, retained earnings, FX revaluation, rounding, taxes, control accounts and approval thresholds.
- USALI version, departmental structure and report mapping; review licensing before embedding standards.
- Initial market and country compliance priorities.
- Authentication/MFA approach.
- Cloud provider, region, data residency, backups and retention.
- Document storage, OCR and AI providers/cost limits.
- Initial integrations and credential strategy.
- Pilot customer/property and migration scope.
- Pricing validated through interviews.

### Foundation completion gate

Specs reviewed and organized; architecture and ADRs recorded; accounting model accepted; tenant/security design reviewed; conceptual schema reviewed; roadmap and acceptance gates approved; Claude Code project rules established; first milestone selected.

**Recommended next step:** Run the Foundation Prompt in Claude Code and ask it to assess the repository and create documentation only. Review its foundation report before approving Milestone 1.

_End of blueprint. Accounting policy, tenant isolation, security, legal compliance and data migration decisions require deliberate review before implementation._
