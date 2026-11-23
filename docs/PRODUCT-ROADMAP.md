# HospitalityFinance Pro — Product Roadmap (Quality-First)

**Status:** Approved by the owner, 21 November 2026

**Supersedes:** the work-package order in `docs/REMEDIATION-BRIEF.md` sections 8 and 11 ("Order"). The findings, hard-coded register, working rules and design decisions in the brief still apply.

**Read with:** `docs/REMEDIATION-BRIEF.md`, `docs/WP-U-DESIGN-NOTE.md`, `docs/IMPORT-PLAN.md`, and the owner's blueprint `docs/foundation/input/MANNAL-FINANCE-BLUEPRINT.md` (input to Stage 2)

**Amended 23 November 2026** with the owner's approval, after matching the roadmap against the blueprint: items marked _(added 23 Nov)_ are new; nothing approved on 21 November was removed.

---

## 1. The direction in one paragraph

The goal is a correct, hospitality-native financial ERP, not a fast release. Time is not the constraint; correctness, auditability and tenant isolation are. The accounting core is therefore designed in writing and reviewed by a qualified accountant before it is rebuilt, and every feature after that is built once, onto the final ledger. The existing codebase, stack and merged work are kept: they are quality decisions, not shortcuts.

---

## 2. Decisions that are settled (do not reopen without the owner)

| Decision                             | Settled as                                                                                                               | Why                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend framework                    | Keep Fastify. No rewrite to NestJS or any other framework.                                                               | A framework change adds no accounting correctness and would force re-proving tenant isolation, access control and 1,000+ tests. Adopt a domain-folder layout gradually instead. |
| Tenancy model                        | One PostgreSQL database per tenant, as built in WP-A and WP-2.                                                           | Per-tenant backup, restore, export and deletion; strongest isolation for financial data.                                                                                        |
| Ledger model                         | Unified ledger (WP-U): suppliers and customers are ledger accounts; every invoice, payment and receipt is a ledger line. | No sub-ledger to reconcile; one source of truth.                                                                                                                                |
| Architecture style                   | Modular monolith. No microservices.                                                                                      | Extract a service only with measured evidence.                                                                                                                                  |
| Procurement and inventory            | Out of scope for this product. Data arrives from MMS / Jana through the import pipeline.                                 | MMS is a separate product; this product's job is to accept other systems' data.                                                                                                 |
| AI                                   | Assists only. Never posts, approves, pays or reopens periods. Read-only first.                                           | Financial controls must not be bypassed by automation.                                                                                                                          |
| Branding in customer-facing material | Describe what the product does. Do not cite Infor, SunSystems, Oracle or NetSuite.                                       | Trademarks; better positioning. Rename the "Transfer Desk" module before commercial release.                                                                                    |

---

## 3. Where the project stands (21 November 2026)

| Area                                                                                            | State                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WP-0 Stabilise                                                                                  | Merged                                                                                                                                                                                                |
| WP-A Access control and tenant context                                                          | Merged                                                                                                                                                                                                |
| WP-1 Central configuration                                                                      | Merged                                                                                                                                                                                                |
| PR #5 Production start                                                                          | Merged                                                                                                                                                                                                |
| PR #6 `frontend/ux-polish` (top bar, period selector, server-side pagination, setup wizard fix) | CI green; merge if not already merged                                                                                                                                                                 |
| WP-2 Tenant platform                                                                            | Items 1–3 done. Item 4 (adoption of `hfp_db`, `hfp_registry`) rehearsed on restored copies, backups taken, waiting for owner go-ahead. Items 5–9 previously deferred — now un-deferred (see Stage 1). |
| Import feature                                                                                  | Plan in `docs/IMPORT-PLAN.md` on `feat/import-pipeline`. Owner decisions recorded. No pipeline code to be written until Stage 2 is approved (see Stage 4).                                            |
| Open P0 found 21 Nov                                                                            | The application role can disable row-level security by setting `app.bypass_rls`. Must be fixed in Stage 1.                                                                                            |

**Update, 23 November 2026.** PR #6 is merged. WP-2 item 4 has run: `hfp_registry` and `hfp_db` were adopted on 21 November after restore-verified backups, and `hfp_registry` accepts connections from its owner only. The RLS bypass P0 is fixed (SEC-11, tenant migration `2_rls_bypass_by_function`) and applied to `hfp_db`. The import work went further than the plan before it was paused: steps 1 to 6 and parts of 7 and 10 are on `feat/import-pipeline` (draft PR #7); that code is input to Stage 4 and is not merged until then.

---

## 4. Roadmap

Every stage ends at a gate: its acceptance criteria pass in CI against a real database, the owner has seen a demo, and the documents it touches are updated. A stage does not start until the previous gate is passed, except where marked parallel.

### Stage 1 — Finish the tenant platform (WP-2, all items)

- **Item 4:** adopt `hfp_db` and `hfp_registry`, in the order already agreed (backups first, owner go-ahead, stop both stacks, adopt, restrict registry connections to its owner, move the checkout to WP-2).
- **P0: RLS bypass.** The application role must not be able to turn off row-level security. Bypass only through a `SECURITY DEFINER` function owned by the owner role, or a separate role. Test: the app role setting `app.bypass_rls` still sees only its property. Log as a finding.
- **Item 5:** encrypted secrets — complete rotation procedure in `docs/SECRETS-ROTATION.md`, including loss of `PLATFORM_ENCRYPTION_KEY`.
- **Item 6:** connection pooler — designed and tested in CI. Do not install or configure a pooler on the shared development server without asking the owner.
- **Item 7:** row-level security on every entity-scoped table and its child tables, forced; a test that fails when any entity-linked table has no policy.
- **Item 8:** plans table in the registry (HC-40) and per-tenant entitlements (upload size, import concurrency).
- **Item 9:** automated per-tenant backups plus a tested restore, documented in the go-live runbook.
- **Item 10** _(added 23 Nov)_: request context — replace `enterWith` with `runWithContext` in the request hook and every worker, and make data access throw without a bound tenant (brief WP-2 item 6, which the list above left out).

**Gate:** all WP-2 acceptance criteria in the brief; the RLS test passes; a backup of `hfp_db` is restored into a throwaway database and its row counts match.

### Stage 2 — Foundation design (documents only, no application code)

All documents go in `docs/foundation/`. Each is a pull request on its own. The accounting specification is reviewed and signed off by a qualified accountant (name recorded in the document) before it is approved. Mark every section Draft, Under accountant review or Approved.

| #    | Document                                         | Must contain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | `PRODUCT-VISION.md`                              | Personas (platform admin, group finance director, financial controller, property accountant, director of finance, GM, department head, auditor); target customers; MVP scope and explicit out-of-scope list; non-functional requirements. Use the owner's Mannal Finance blueprint (`docs/foundation/input/`) as input, trimmed to what this product will build. _(Added 23 Nov:)_ pricing, markets and positioning recorded as hypotheses to validate, not as scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2.2  | `ORGANISATION-MODEL.md`                          | Hierarchy: tenant → group → country → legal entity → property → department / outlet. Which level owns the chart of accounts, fiscal calendar, functional currency, tax registration and ledger. Operator vs owner (management company running a hotel owned by another company). Migration from today's GROUP / PROPERTY entities. _(Added 23 Nov:)_ legal entity and property are organisation levels, not free dimensions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.3  | `ACCOUNTING-SPECIFICATION.md`                    | Double entry and balancing rules; journal life cycle (draft, held, posted, reversed); immutability and correction by reversal; posting validation order; fiscal calendars (calendar, 4-4-5, 13th / adjustment period); period open / close / lock rules and who may reopen; year-end close and retained-earnings rollover; FX: rate types, transaction / base / reporting amounts, revaluation, realised and unrealised differences, cross-currency settlement; rounding policy and where rounding differences post; journal numbering (gap-free or not); suspense and unmapped-data policy; month-end close checklist and order. _(Added 23 Nov:)_ the approval workflow states (submitted, pending approval, approved, rejected, cancelled) reconciled with the ledger states; period states including future and soft close next to open, closed and locked; statistical accounts (rooms sold, covers) beside the five financial types; idempotency keys at posting. |
| 2.4  | `TAX-SPECIFICATION.md`                           | Tax codes; inclusive / exclusive; exemptions; Tanzania VAT (mainland and Zanzibar, confirm current rates and rules from official sources at time of writing); withholding tax on supplier payments with certificate references; tax reporting from the ledger.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2.5  | `DIMENSIONS-SPECIFICATION.md`                    | The ten transaction dimensions; analysis on accounts, counterparties and assets; validation rules per dimension (required, optional, closed list); which dimensions are summarised for reporting; data access by analysis code. _(Added 23 Nov:)_ department, cost centre, outlet, project and intercompany partner as named defaults among the ten.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.6  | `LEDGER-DESIGN.md`                               | `docs/WP-U-DESIGN-NOTE.md` extended to cover 2.2–2.5: legal entity on every journal, fiscal-calendar periods, tax lines, dimension foreign keys. Final schema, database constraints and triggers, migration mapping from every current table, reconciliation script.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.7  | `POSTING-CONTRACT.md`                            | The canonical document contract from `docs/IMPORT-PLAN.md`, aligned with 2.3–2.6: every document type, field rules, idempotency (`sourceSystem` + property + `sourceDocumentRef`), reverse-and-replace, business date, validation errors. Versioned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2.8  | `HOSPITALITY-SPECIFICATION.md`                   | Business date vs posting date; revenue centres and outlets; night-audit financial checks (PMS totals vs posted totals); USALI mapping as tenant data; management-fee calculation methods (percentage of revenue, of GOP, fixed, incentive); owner statements. _(Added 23 Nov:)_ statistics imports (rooms available and sold, covers) feeding occupancy, ADR, RevPAR, GOP and EBITDA where the data exists; a licence review before any USALI content is embedded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2.9  | `SECURITY-AND-CONTROLS.md`                       | Roles and permission catalogue; segregation of duties (who cannot both create and approve); approval matrices and thresholds as tenant data; audit trail contents; bank-detail change dual approval. _(Added 23 Nov:)_ a threat model; sign-in and multi-factor authentication; protected storage for documents and attachments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.10 | `UX-SPECIFICATION.md` _(added 23 Nov)_           | Navigation and permission-aware sidebar; top-bar selectors (tenant or group, legal entity, property, period; some built in PR #6); global search and notifications; design language (neutral canvas, restrained colour, dense finance tables, aligned numbers); demo values labelled as sample data; no dead buttons or placeholder screens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2.11 | `INTEGRATIONS-SPECIFICATION.md` _(added 23 Nov)_ | The adapters (Opera, Simphony, banks, payroll, MMS/Jana, CSV/Excel, inbound API): what each fetches and how; integration credentials (encrypted, per entity and source system); formats including JSON read natively; scheduling; failure and retry; what each adapter is tested against.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2.12 | `OPERATIONS.md` _(added 23 Nov)_                 | Non-functional requirements made measurable: response times, asynchronous heavy reports, the scaling order (indexes, pooler, more instances, more workers, reporting isolation, read replicas), monitoring and alerting, incident handling, backup retention, hosting, region and data residency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2.13 | `DATA-MIGRATION.md` _(added 23 Nov)_             | Moving a hotel onto the product: chart of accounts, opening balances, open payables and receivables, history and cut-over date, and how the migrated figures are reconciled; the prerequisite for the Stage 8 parallel run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2.14 | `adr/`                                           | One decision record per settled decision in section 2 and per major choice in 2.2–2.13: context, options, decision, consequences. _(Added 23 Nov:)_ including Fastify rather than NestJS, and one database per tenant rather than a shared database (both raised by the blueprint).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2.15 | `FOUNDATION-REVIEW.md`                           | Conflicts between documents, open questions for the owner and the accountant, risks, and the list of findings from the brief that each later stage closes. _(Added 23 Nov:)_ including the open decisions in section 6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Gate:** 2.3, 2.4 and 2.6 signed off by the accountant; all documents approved by the owner; no open item in `FOUNDATION-REVIEW.md` marked blocking.

### Stage 3 — Rebuild the accounting core to the specification

Implements 2.2, 2.3, 2.5 and 2.6. Includes WP-U and the WP-3 items carried into it (ACC-01, ACC-02, ACC-04, ACC-05, ACC-08), the legal-entity level, fiscal calendars, dimension administration (UDF-01), database-enforced controls (ACC-03), and the reconciliation script.

**Gate:** the eight WP-U acceptance tests in the brief; reconciliation script shows zero difference on the seeded and UAT data; posted journals cannot be altered by any role; an unbalanced journal is rejected by the database.

### Stage 4 — Hotel revenue imports onto the final ledger

Implements 2.7 and the import part of 2.8: the single pipeline from `docs/IMPORT-PLAN.md`, with the owner decisions already recorded there (per-document default, Opera night audit whole-file, property in every duplicate reference, reverse-and-replace, source-property lookup per template). Templates for Opera night audit, Simphony sales, Jana movements. Business-date handling and night-audit checks. Retire the bespoke connectors' posting code and the old interface engine (ARC-01). _(Added 23 Nov:)_ payroll journal and MT940 bank-statement imports through the same pipeline, and the statistics imports from 2.8; JSON formats read natively by the format engine; rate limits as settings per user and tenant.

**Gate:** with real EZZ files supplied by the owner: each template produces the journals the old connector produced (parity), a re-sent file is refused, a corrected file is reversed and replaced with an audit trail, and night-audit totals reconcile to posted totals.

### Stage 5 — Finance operations on the unified ledger

Payables and receivables as entry documents over the ledger; payment runs (with on-hold lines skipped); dunning and statements; cash and bank with statement import and reconciliation; tax per 2.4 including withholding tax. _(Added 23 Nov:)_ fixed assets — register, depreciation and its posting, transfers and disposals.

**Gate:** ageing and balances come only from ledger lines; a full purchase-to-pay and order-to-cash cycle reconciles; bank reconciliation closes to zero on test data.

### Stage 5B — Group accounting _(added 23 Nov)_

Consolidation and intercompany on the unified ledger: intercompany transactions and matching, eliminations, currency translation, group statements. (The current code has consolidation and intercompany modules; this stage rebuilds them onto the final ledger.)

**Gate:** a group of at least two legal entities with intercompany trading consolidates to statements that agree with a worked example, eliminations net to zero, and translation differences post where 2.3 says.

### Stage 6 — User-defined statements and reporting

Report layouts and KPIs as tenant data from a template library (HC-01, HC-02, UDF-04); drill-down from statement to journal line; actual vs budget across ledgers; exports. _(Added 23 Nov:)_ budget versions and rolling forecasts, and a cash-flow forecast.

**Gate:** a tenant whose chart shares no codes with the USALI template gets correct statements and KPIs from configuration alone.

### Stage 7 — Hospitality layer

Management-fee engine; owner statements and owner packs; group and multi-property comparison; departmental and outlet profitability.

**Gate:** fees calculated by every method in 2.8 agree with a hand-calculated worked example signed off by the accountant.

### Stage 8 — Pilot and production readiness

A parallel run at EZZ: at least one full month closed in both the current finance system and this product, reconciled line by line to zero, with differences explained. Independent security review. Restore drill. Training material. Runbook.

**Gate:** the month reconciles; the accountant signs off; no open P0 or P1 finding.

### Stage 9 — AI finance assistant

Read-only first: answers from ledger data within the user's permissions, variance explanation, anomaly detection. Every action that changes data requires a human approval and is audited.

**Gate:** permission tests prove the assistant never sees data the user cannot; no write path exists without approval.

---

## 5. Working rules for Claude Code (in addition to section 2 of the brief)

1. Inspect before changing. Never assume a folder is empty. Never delete, overwrite or reset without the owner's approval.
2. Specifications are authoritative. Where code and an approved document disagree, report the conflict before implementing.
3. One stage at a time. Stop at every gate and report. Do not start the next stage without the owner's go-ahead.
4. Stop and ask on: accounting policy, tenant security, destructive operations, database changes to existing (non-test) databases, architecture changes, paid services.
5. Tests gate commits. Never chain a commit or push after a failing test run.
6. Worktrees live under `~/projects/hfp-worktrees/`, never under `/tmp`. Commit and push completed work promptly.
7. Shared server. PostgreSQL on the development server also hosts live systems: no changes to `postgresql.conf`, no restart, only `hfp_`-prefixed databases and roles, no pooler installation without asking.
8. One AI tool per folder. If files changed that you did not change, report them before doing anything else.
9. Report every task with: what was implemented, files changed, decisions taken, tests and results, typecheck and lint, known issues, risks, and the next step. Distinguish implemented, tested, verified in a browser, incomplete and blocked.
10. Definition of done for any change: acceptance criteria met; tests green in CI with a real database; typecheck and lint pass; migrations reviewed and reversible or backed up; tenant isolation verified; no dead buttons or placeholder screens; documents updated.
11. _(Added 23 Nov)_ These rules, with section 2 of the brief, are kept in `CLAUDE.md` at the root of the repository, which tools read first.

---

## 6. What the owner provides

| Item                                                                                                    | Needed by                           |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Go-ahead for WP-2 item 4                                                                                | Stage 1                             |
| A qualified accountant to review the accounting, tax and ledger documents                               | Stage 2                             |
| Real Opera night-audit, Simphony and Jana files from EZZ (anonymised if needed)                         | Stage 4                             |
| Agreement from EZZ finance for a parallel-run month                                                     | Stage 8                             |
| Product name decision                                                                                   | Before any customer-facing material |
| _(Added 23 Nov)_ Whether subscription billing is in scope, or handled outside the product for the pilot | Stage 2 (2.1)                       |
| _(Added 23 Nov)_ Hosting: provider, region and data residency                                           | Stage 2 (2.12)                      |
| _(Added 23 Nov)_ Whether multi-factor authentication is required for the pilot                          | Stage 2 (2.9)                       |

---

## 7. First prompt for Claude Code

```text
Read docs/PRODUCT-ROADMAP.md in full, then docs/REMEDIATION-BRIEF.md sections 2 and 7.

From now on this roadmap sets the order of work. Quality comes first; time is not a constraint.

1. Commit this file to the repository as docs/PRODUCT-ROADMAP.md on a new branch from main,
   open a PR, and add a pointer to it at the top of docs/REMEDIATION-BRIEF.md.
2. Pause the import pipeline work on feat/import-pipeline. Keep docs/IMPORT-PLAN.md; it becomes
   input to Stage 2 document 2.7. Write no pipeline code.
3. Move existing worktrees from /tmp to ~/projects/hfp-worktrees/ (tell me first if a dev
   server is running from one of them).
4. Start Stage 1. Wait for my go-ahead before item 4 touches hfp_db or hfp_registry. Fix the
   RLS bypass P0 straight after adoption. Then items 5 to 9.
5. Stop at the Stage 1 gate and report in the format of section 5, rule 9.
```
