# HospitalityFinance Pro — Product Roadmap (Quality-First)

**Status:** Approved by the owner, 21 November 2026

**Supersedes:** the work-package order in `docs/REMEDIATION-BRIEF.md` sections 8 and 11 ("Order"). The findings, hard-coded register, working rules and design decisions in the brief still apply.

**Read with:** `docs/REMEDIATION-BRIEF.md`, `docs/WP-U-DESIGN-NOTE.md`, `docs/IMPORT-PLAN.md`

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

**Gate:** all WP-2 acceptance criteria in the brief; the RLS test passes; a backup of `hfp_db` is restored into a throwaway database and its row counts match.

### Stage 2 — Foundation design (documents only, no application code)

All documents go in `docs/foundation/`. Each is a pull request on its own. The accounting specification is reviewed and signed off by a qualified accountant (name recorded in the document) before it is approved. Mark every section Draft, Under accountant review or Approved.

| #    | Document                       | Must contain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | `PRODUCT-VISION.md`            | Personas (platform admin, group finance director, financial controller, property accountant, director of finance, GM, department head, auditor); target customers; MVP scope and explicit out-of-scope list; non-functional requirements. Use the owner's Mannal Finance blueprint as input, trimmed to what this product will build.                                                                                                                                                                                                                                                                                             |
| 2.2  | `ORGANISATION-MODEL.md`        | Hierarchy: tenant → group → country → legal entity → property → department / outlet. Which level owns the chart of accounts, fiscal calendar, functional currency, tax registration and ledger. Operator vs owner (management company running a hotel owned by another company). Migration from today's GROUP / PROPERTY entities.                                                                                                                                                                                                                                                                                                |
| 2.3  | `ACCOUNTING-SPECIFICATION.md`  | Double entry and balancing rules; journal life cycle (draft, held, posted, reversed); immutability and correction by reversal; posting validation order; fiscal calendars (calendar, 4-4-5, 13th / adjustment period); period open / close / lock rules and who may reopen; year-end close and retained-earnings rollover; FX: rate types, transaction / base / reporting amounts, revaluation, realised and unrealised differences, cross-currency settlement; rounding policy and where rounding differences post; journal numbering (gap-free or not); suspense and unmapped-data policy; month-end close checklist and order. |
| 2.4  | `TAX-SPECIFICATION.md`         | Tax codes; inclusive / exclusive; exemptions; Tanzania VAT (mainland and Zanzibar, confirm current rates and rules from official sources at time of writing); withholding tax on supplier payments with certificate references; tax reporting from the ledger.                                                                                                                                                                                                                                                                                                                                                                    |
| 2.5  | `DIMENSIONS-SPECIFICATION.md`  | The ten transaction dimensions; analysis on accounts, counterparties and assets; validation rules per dimension (required, optional, closed list); which dimensions are summarised for reporting; data access by analysis code.                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2.6  | `LEDGER-DESIGN.md`             | `docs/WP-U-DESIGN-NOTE.md` extended to cover 2.2–2.5: legal entity on every journal, fiscal-calendar periods, tax lines, dimension foreign keys. Final schema, database constraints and triggers, migration mapping from every current table, reconciliation script.                                                                                                                                                                                                                                                                                                                                                              |
| 2.7  | `POSTING-CONTRACT.md`          | The canonical document contract from `docs/IMPORT-PLAN.md`, aligned with 2.3–2.6: every document type, field rules, idempotency (`sourceSystem` + property + `sourceDocumentRef`), reverse-and-replace, business date, validation errors. Versioned.                                                                                                                                                                                                                                                                                                                                                                              |
| 2.8  | `HOSPITALITY-SPECIFICATION.md` | Business date vs posting date; revenue centres and outlets; night-audit financial checks (PMS totals vs posted totals); USALI mapping as tenant data; management-fee calculation methods (percentage of revenue, of GOP, fixed, incentive); owner statements.                                                                                                                                                                                                                                                                                                                                                                     |
| 2.9  | `SECURITY-AND-CONTROLS.md`     | Roles and permission catalogue; segregation of duties (who cannot both create and approve); approval matrices and thresholds as tenant data; audit trail contents; bank-detail change dual approval.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2.10 | `adr/`                         | One decision record per settled decision in section 2 and per major choice in 2.2–2.9: context, options, decision, consequences.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2.11 | `FOUNDATION-REVIEW.md`         | Conflicts between documents, open questions for the owner and the accountant, risks, and the list of findings from the brief that each later stage closes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Gate:** 2.3, 2.4 and 2.6 signed off by the accountant; all documents approved by the owner; no open item in `FOUNDATION-REVIEW.md` marked blocking.

### Stage 3 — Rebuild the accounting core to the specification

Implements 2.2, 2.3, 2.5 and 2.6. Includes WP-U and the WP-3 items carried into it (ACC-01, ACC-02, ACC-04, ACC-05, ACC-08), the legal-entity level, fiscal calendars, dimension administration (UDF-01), database-enforced controls (ACC-03), and the reconciliation script.

**Gate:** the eight WP-U acceptance tests in the brief; reconciliation script shows zero difference on the seeded and UAT data; posted journals cannot be altered by any role; an unbalanced journal is rejected by the database.

### Stage 4 — Hotel revenue imports onto the final ledger

Implements 2.7 and the import part of 2.8: the single pipeline from `docs/IMPORT-PLAN.md`, with the owner decisions already recorded there (per-document default, Opera night audit whole-file, property in every duplicate reference, reverse-and-replace, source-property lookup per template). Templates for Opera night audit, Simphony sales, Jana movements. Business-date handling and night-audit checks. Retire the bespoke connectors' posting code and the old interface engine (ARC-01).

**Gate:** with real EZZ files supplied by the owner: each template produces the journals the old connector produced (parity), a re-sent file is refused, a corrected file is reversed and replaced with an audit trail, and night-audit totals reconcile to posted totals.

### Stage 5 — Finance operations on the unified ledger

Payables and receivables as entry documents over the ledger; payment runs (with on-hold lines skipped); dunning and statements; cash and bank with statement import and reconciliation; tax per 2.4 including withholding tax.

**Gate:** ageing and balances come only from ledger lines; a full purchase-to-pay and order-to-cash cycle reconciles; bank reconciliation closes to zero on test data.

### Stage 6 — User-defined statements and reporting

Report layouts and KPIs as tenant data from a template library (HC-01, HC-02, UDF-04); drill-down from statement to journal line; actual vs budget across ledgers; exports.

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

---

## 6. What the owner provides

| Item                                                                            | Needed by                           |
| ------------------------------------------------------------------------------- | ----------------------------------- |
| Go-ahead for WP-2 item 4                                                        | Stage 1                             |
| A qualified accountant to review the accounting, tax and ledger documents       | Stage 2                             |
| Real Opera night-audit, Simphony and Jana files from EZZ (anonymised if needed) | Stage 4                             |
| Agreement from EZZ finance for a parallel-run month                             | Stage 8                             |
| Product name decision                                                           | Before any customer-facing material |

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
