# HospitalityFinance Pro — UAT Test Plan

**Version:** 1.0
**Date:** 2026-03-22
**Prepared for:** Pilot Customer Finance Team
**Sign-off required from:** Finance Controller, General Manager

---

## Instructions

1. Log in to HospitalityFinance Pro at the provided URL
2. Work through each scenario in order — later scenarios depend on earlier ones
3. For each test, mark **PASS** or **FAIL** and add comments if needed
4. If a test fails, note the exact error message or unexpected behavior
5. A minimum of 90% PASS rate is required for go-live approval

---

## Module 1: Authentication & Navigation

| #   | Test                   | Steps                                                     | Expected Result                                                    | Status | Comments |
| --- | ---------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ | ------ | -------- |
| 1.1 | Login with native auth | Open tenant login URL, enter email and password           | Dashboard loads, user name shown in sidebar, session cookie is set |        |          |
| 1.2 | Entity switcher        | Click entity name in sidebar, select a different property | Dashboard refreshes with new property's data                       |        |          |
| 1.3 | Role-based menu        | Log in as VIEWER                                          | Settings/Admin menu items hidden; POST buttons disabled            |        |          |
| 1.4 | Sidebar navigation     | Click each menu item                                      | All pages load without errors                                      |        |          |
| 1.5 | Logout                 | Click user avatar → Logout                                | Redirected to login page, session cleared                          |        |          |

---

## Module 2: Chart of Accounts

| #   | Test                | Steps                                                                               | Expected Result                                       | Status | Comments |
| --- | ------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ | -------- |
| 2.1 | View COA            | Navigate to GL → Accounts                                                           | All accounts listed with code, name, type, USALI dept |        |          |
| 2.2 | Create account      | Click "New Account", fill: code=9999, name=Test Account, type=EXPENSE, normal=DEBIT | Account created, appears in list                      |        |          |
| 2.3 | Edit account        | Click account 9999, change name to "Updated Test"                                   | Name updated in list                                  |        |          |
| 2.4 | Import COA preview  | Settings → Integrations → COA Import, upload Excel file                             | Preview shows accounts with add/update/skip status    |        |          |
| 2.5 | Import COA execute  | Click "Execute Import"                                                              | Accounts imported, counts shown                       |        |          |
| 2.6 | Delete test account | Click delete on account 9999                                                        | Account removed (only if no transactions)             |        |          |

---

## Module 3: Accounting Periods

| #   | Test             | Steps                                                      | Expected Result                         | Status | Comments |
| --- | ---------------- | ---------------------------------------------------------- | --------------------------------------- | ------ | -------- |
| 3.1 | View periods     | Navigate to Periods                                        | Periods listed with year, month, status |        |          |
| 3.2 | Create period    | Click "New Period": year=2026, month=03, name="March 2026" | Period created with OPEN status         |        |          |
| 3.3 | Create duplicate | Try creating same year/month again                         | Error: "period already exists"          |        |          |

---

## Module 4: General Ledger — Journal Entries

| #   | Test               | Steps                                                                           | Expected Result                                              | Status | Comments |
| --- | ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------ | -------- |
| 4.1 | Create journal     | GL → Journals → New, select period, add 2 lines: DR Cash 1000 / CR Revenue 1000 | Journal created as DRAFT                                     |        |          |
| 4.2 | Unbalanced journal | Try posting journal where debits ≠ credits                                      | Error: "GL_UNBALANCED_JOURNAL"                               |        |          |
| 4.3 | Post journal       | Open draft journal, click "Post"                                                | Status changes to POSTED, account balances updated           |        |          |
| 4.4 | Verify balances    | Go to Trial Balance for current period                                          | Cash shows DR 1000, Revenue shows CR 1000, TB is balanced    |        |          |
| 4.5 | Reverse journal    | Click "Reverse" on posted journal                                               | Reversal journal auto-posted, original shows REVERSED        |        |          |
| 4.6 | Journal search     | Type reference or description in search box                                     | Matching journals appear                                     |        |          |
| 4.7 | Journal filters    | Filter by status=POSTED, source=MANUAL                                          | Only matching journals shown                                 |        |          |
| 4.8 | Approval workflow  | Create journal > 10,000 (if approval rule exists)                               | Status becomes PENDING_APPROVAL, approver can approve/reject |        |          |

---

## Module 5: Accounts Payable

| #   | Test                | Steps                                                                 | Expected Result                             | Status | Comments |
| --- | ------------------- | --------------------------------------------------------------------- | ------------------------------------------- | ------ | -------- |
| 5.1 | Create supplier     | AP → Suppliers → New, fill: code=SUP001, name, currency=USD, terms=30 | Supplier created                            |        |          |
| 5.2 | Create AP invoice   | AP → New Invoice: supplier=SUP001, amount=5000, date=today            | Invoice created as DRAFT                    |        |          |
| 5.3 | Approve invoice     | Click "Approve" on invoice                                            | Status → APPROVED                           |        |          |
| 5.4 | Post to GL          | Click "Post" on approved invoice                                      | GL journal auto-created, AP balance updated |        |          |
| 5.5 | Payment proposal    | AP → Payment Runs → New Proposal: currency=USD, due before=+30d       | Proposal created with matching invoices     |        |          |
| 5.6 | Approve payment run | Click "Approve" on proposal                                           | Status → APPROVED                           |        |          |
| 5.7 | Confirm payment     | Click "Confirm" (ADMIN only)                                          | Bank file generated, invoices marked PAID   |        |          |
| 5.8 | Download bank file  | Click "Download" on confirmed run                                     | MT940/XML file downloads                    |        |          |
| 5.9 | Payment voucher PDF | Click voucher icon next to supplier                                   | PDF downloads with payment details          |        |          |

---

## Module 6: Accounts Receivable

| #   | Test              | Steps                                                | Expected Result                                   | Status | Comments |
| --- | ----------------- | ---------------------------------------------------- | ------------------------------------------------- | ------ | -------- |
| 6.1 | Create customer   | AR → New Customer: code=CUS001, name, type=CORPORATE | Customer created                                  |        |          |
| 6.2 | Create AR invoice | AR → New Invoice: customer=CUS001, amount=8000       | Invoice created                                   |        |          |
| 6.3 | Post AR invoice   | Click "Post"                                         | GL journal auto-created                           |        |          |
| 6.4 | Create receipt    | AR → Receipts → New: customer=CUS001, amount=3000    | Receipt created                                   |        |          |
| 6.5 | Allocate receipt  | Allocate receipt to invoice                          | Invoice status → PARTIALLY_PAID, amount_paid=3000 |        |          |
| 6.6 | AR ageing report  | AR → Ageing, set date                                | Buckets shown: 0-30, 31-60, 61-90, 91+            |        |          |
| 6.7 | Dunning run       | Click "Run Dunning"                                  | Overdue invoices identified, email sent           |        |          |

---

## Module 7: Multi-Currency & FX

| #   | Test                     | Steps                                         | Expected Result                                        | Status | Comments |
| --- | ------------------------ | --------------------------------------------- | ------------------------------------------------------ | ------ | -------- |
| 7.1 | View currencies          | FX → Currencies                               | USD, EUR, GBP, AED etc. listed                         |        |          |
| 7.2 | Import ECB rates         | Click "Import ECB Rates"                      | Latest rates imported with source=ECB                  |        |          |
| 7.3 | Manual rate entry        | Add rate: USD/AED, CLOSING, rate=3.6725       | Rate created                                           |        |          |
| 7.4 | FX conversion            | Convert 1000 USD to AED                       | Shows converted amount using latest rate               |        |          |
| 7.5 | Foreign currency journal | Create journal with currency=EUR, fxRate=1.08 | Functional amount calculated correctly                 |        |          |
| 7.6 | FX revaluation           | Run revaluation for current period            | Revaluation journals auto-posted, gain/loss calculated |        |          |

---

## Module 8: Budget & Variance

| #   | Test               | Steps                                                        | Expected Result                              | Status | Comments |
| --- | ------------------ | ------------------------------------------------------------ | -------------------------------------------- | ------ | -------- |
| 8.1 | Create budget      | Budget → New Definition: name="2026 Budget", year=2026       | Definition created                           |        |          |
| 8.2 | Enter budget lines | Click definition, enter amounts for revenue/expense accounts | Lines saved                                  |        |          |
| 8.3 | Import from Excel  | Upload budget Excel template                                 | Budget lines imported                        |        |          |
| 8.4 | Variance report    | Budget → Variance: select definition + period                | Actual vs Budget with variance amounts and % |        |          |

---

## Module 9: Financial Reports

| #   | Test            | Steps                                               | Expected Result                                               | Status | Comments |
| --- | --------------- | --------------------------------------------------- | ------------------------------------------------------------- | ------ | -------- |
| 9.1 | Trial balance   | GL → Trial Balance, select period                   | All accounts with opening/debits/credits/closing; TB balanced |        |          |
| 9.2 | Comparative TB  | Select comparative period                           | Prior period column appears with variances                    |        |          |
| 9.3 | USALI P&L       | Reports → USALI P&L, select period                  | Departmental P&L: rooms, F&B, undistributed, GOP, EBITDA      |        |          |
| 9.4 | Balance sheet   | Reports → Balance Sheet                             | Assets = Liabilities + Equity                                 |        |          |
| 9.5 | Cash flow       | Reports → Cash Flow                                 | Operating/Investing/Financing sections                        |        |          |
| 9.6 | Generate PDF    | Click "Generate PDF" on any report                  | PDF downloads, format matches screen                          |        |          |
| 9.7 | Schedule report | Reports → definition → Schedule: daily at 08:00     | Schedule saved, report auto-generates next morning            |        |          |
| 9.8 | Report builder  | Reports → Builder → create custom account selection | Custom report generates with selected accounts                |        |          |

---

## Module 10: KPI Dashboard

| #    | Test                 | Steps                    | Expected Result                                    | Status | Comments |
| ---- | -------------------- | ------------------------ | -------------------------------------------------- | ------ | -------- |
| 10.1 | GM dashboard         | Dashboards → GM          | RevPAR, occupancy, GOP, revenue charts             |        |          |
| 10.2 | Controller dashboard | Dashboards → Controller  | Trial balance status, period close progress, AP/AR |        |          |
| 10.3 | CFO dashboard        | Dashboards → CFO         | Multi-property comparison, consolidated view       |        |          |
| 10.4 | Night audit          | Dashboards → Night Audit | PMS revenue, room statistics, daily reconciliation |        |          |
| 10.5 | RevPAR trend         | KPI section → RevPAR     | Occupancy %, ADR, RevPAR, TRevPAR values correct   |        |          |

---

## Module 11: Multi-Entity Consolidation

| #    | Test              | Steps                                                      | Expected Result                                        | Status | Comments |
| ---- | ----------------- | ---------------------------------------------------------- | ------------------------------------------------------ | ------ | -------- |
| 11.1 | View entity tree  | Settings → Entity hierarchy                                | Corporate → Cluster → Property tree visible            |        |          |
| 11.2 | Run consolidation | Consolidation → New Run: select parent + children + period | Consolidated TB produced                               |        |          |
| 11.3 | FX translation    | Child entity in different currency                         | Amounts translated at closing/average rates per IAS 21 |        |          |
| 11.4 | IC elimination    | Intercompany transactions exist                            | IC balances eliminated, warnings shown                 |        |          |
| 11.5 | CTA               | Currency translation adjustment                            | CTA amount calculated and shown                        |        |          |

---

## Module 12: Integrations

| #    | Test                  | Steps                                                          | Expected Result                                   | Status | Comments |
| ---- | --------------------- | -------------------------------------------------------------- | ------------------------------------------------- | ------ | -------- |
| 12.1 | Connector mapping     | Settings → Integrations, create mapping: PMS code → GL account | Mapping saved                                     |        |          |
| 12.2 | Bank statement import | Upload MT940 or OFX file                                       | Statement parsed, transactions listed             |        |          |
| 12.3 | Bank reconciliation   | Click "Auto-Match" on statement                                | Transactions matched to GL entries by amount/date |        |          |
| 12.4 | Transfer desk         | Create interface, upload CSV, preview, execute                 | Data transformed to GL journals                   |        |          |
| 12.5 | SAF import            | Upload SAF .txt file                                           | Journals created from SAF data                    |        |          |

---

## Module 13: Period Close Process

| #    | Test                  | Steps                                        | Expected Result                              | Status | Comments |
| ---- | --------------------- | -------------------------------------------- | -------------------------------------------- | ------ | -------- |
| 13.1 | Pre-close checklist   | Review all journals posted, AP/AR reconciled | No unposted items remaining                  |        |          |
| 13.2 | Close period          | Periods → click "Close" on March 2026        | Status → CLOSED, no new journals allowed     |        |          |
| 13.3 | Post to closed period | Try creating journal in closed period        | Error: period is not OPEN                    |        |          |
| 13.4 | Lock period           | Click "Lock" on closed period                | Status → LOCKED                              |        |          |
| 13.5 | Reopen period         | SUPERADMIN clicks "Reopen" on locked period  | Status → OPEN (only if no other OPEN period) |        |          |

---

## Module 14: Administration

| #    | Test             | Steps                                              | Expected Result                                             | Status | Comments |
| ---- | ---------------- | -------------------------------------------------- | ----------------------------------------------------------- | ------ | -------- |
| 14.1 | User management  | Settings → Users                                   | List of entity users with roles                             |        |          |
| 14.2 | Invite user      | Click "Invite", enter email + role                 | User created and assigned to entity                         |        |          |
| 14.3 | Change user role | Edit user → change role to CONTROLLER              | Role updated, permissions change immediately                |        |          |
| 14.4 | Deactivate user  | Click "Deactivate" on user                         | User cannot log in, isActive=false                          |        |          |
| 14.5 | Audit trail      | Audit → filter by resource type                    | All changes tracked with before/after state, IP, timestamp  |        |          |
| 14.6 | Role at a group  | Admin → Roles & Access → grant a role at a cluster | Effective permissions show the role at every child property |        |          |

---

## Sign-Off

| Role               | Name | Date | Signature |
| ------------------ | ---- | ---- | --------- |
| Finance Controller |      |      |           |
| General Manager    |      |      |           |
| IT Manager         |      |      |           |
| Project Manager    |      |      |           |

**Total Tests:** 68
**Pass Threshold:** 61/68 (90%)
**Actual Pass:** \_\_\_/68
**Go-Live Approved:** YES / NO
