# HFP Codebase Assessment Against Specification Documents

## Purpose

Assess the current HospitalityFinancePro codebase against three specification documents and produce a structured gap analysis with prioritized remediation tasks.

## Specification Documents (in this directory)

1. **HFP_FinancialsAdmin_TechnicalSpec_v1_0.md** (~58K chars)
   - Covers: Ledger Setup, Chart of Accounts, Journal Entry Controls, Payments, Budgets, Corporate Allocations, Financial Reporting, Period/Year-End, Fixed Assets, Ledger Conversion
   - Based on: SunSystems 6.4.x Financials Administration Guide (403 pages, 13 chapters)
   - Contains: Database schemas, API endpoints, business logic rules, ENUM definitions, validation rules

2. **HFP_TransferDesk_TechnicalSpecification_v1_0.md** (~108K chars)
   - Covers: 9 modules — Core Engine, Profile Management, Automation Engine, Format Designer (FSD), Transformation Designer (TML), Lookup Table Designer, Server Folder Management, Multi-Tenancy, Hospitality Integration Profiles
   - Contains: Database schemas (tenant-scoped), API endpoints, BullMQ job specs, S3 integration, FSD XML grammar, TML command language, pre-built hospitality profiles (Opera PMS, Sky Jana, MICROS Simphony)

3. **HFP_TransferDesk_SelfService_Designer_v1_0.md** (~70K chars)
   - Covers: Full UI/UX specification for the Transfer Desk frontend
   - Contains: URL structure, page layouts, wizard flows, visual mapper spec, component specs, role-based access (4 roles: user, power-user, designer, admin)
   - Stack: Next.js pages, React components, SSE for real-time progress

## Assessment Process

### Phase 1: Inventory

Read each spec document fully. For each, extract:

- All database tables defined (table name, key columns, relationships)
- All API endpoints defined (method, path, request/response shape)
- All ENUMs and domain constants
- All business logic rules (numbered if possible)
- All integration touchpoints (Opera, Jana, Simphony, ION/BOD references)

### Phase 2: Codebase Scan

Scan the current codebase for:

- **Database**: Existing migration files, schema definitions, Entity classes / Prisma models / raw DDL
- **API Routes**: Existing Fastify routes, Next.js API routes, controller files
- **Business Logic**: Service classes, domain logic, validation rules
- **Frontend**: Next.js pages, React components, form definitions
- **Jobs**: BullMQ worker definitions, queue configurations
- **Integration**: Any existing Opera/Jana/Simphony connectors or parsers

### Phase 3: Gap Analysis

For each spec module, produce a table:

| Spec Item          | Status                              | File(s)      | Gap Description         | Priority |
| ------------------ | ----------------------------------- | ------------ | ----------------------- | -------- |
| ledger_setup table | ✅ Exists / ⚠️ Partial / ❌ Missing | path/to/file | What's missing or wrong | P0-P3    |

Status definitions:

- ✅ **Exists**: Implemented and matches spec
- ⚠️ **Partial**: Exists but missing columns, fields, logic, or deviates from spec
- ❌ **Missing**: Not implemented at all
- 🔄 **Divergent**: Implemented differently than spec (document the divergence and whether it's intentional/better or needs correction)

### Phase 4: Remediation Task List

Output a prioritized CLAUDE.md-compatible task list:

```
## Tasks

### P0 — Critical (blocks core financial operations)
- [ ] Task description — file(s) affected — spec reference

### P1 — High (required for MVP)
- [ ] Task description — file(s) affected — spec reference

### P2 — Medium (required for GA)
- [ ] Task description — file(s) affected — spec reference

### P3 — Low (post-GA enhancements)
- [ ] Task description — file(s) affected — spec reference
```

## Key Architecture Constraints (from existing CLAUDE.md)

- **Backend**: Node.js / Fastify
- **Frontend**: Next.js (App Router)
- **Database**: PostgreSQL with schema-per-tenant (tenant_xxx schemas)
- **Auth**: Keycloak OIDC
- **Job Queue**: Redis / BullMQ
- **Storage**: AWS S3 (tenant-scoped buckets/prefixes)
- **Deployment**: AWS ECS Fargate
- **Currency**: TZS context but full multi-currency support required
- **Standards**: USALI compliance for hospitality chart of accounts

## Important Notes

- The Transfer Desk spec (Module 9) contains pre-built integration profiles for Opera PMS (4 file types: EZZRV, EZZCL, EZZMS, EZZDS), Sky Jana (purchasing vouchers, internal movements, inventory differences), and MICROS Simphony POS. Cross-reference with any existing `simphony_to_jana.py` or `simphony-jana-bridge` code.
- The Financials Admin spec defines journal import via Transfer Desk profiles — this is the same pattern as SunSystems' Ledger Import SSC Component. The posting options (Post, Post if no errors, Validation only) must be preserved.
- FSD (Format Schema Definition) files are stored as raw XML in the database — same as TML transformation definitions. The Self-Service Designer provides a visual editor but the underlying storage is XML/JSON.
- The Transfer Desk uses 5 profile types: Import, Export, Process, Internal Transfer, External Transfer. Each has different runtime parameters and execution semantics.
- Jana parsing rules: purchasing vouchers use whole integers (TZS zero-decimal); internal movements use ÷1000 (3 implied decimals). Source detected by Journal Type field.
