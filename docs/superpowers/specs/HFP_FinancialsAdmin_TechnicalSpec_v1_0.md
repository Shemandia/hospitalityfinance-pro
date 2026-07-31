**HospitalityFinancePro**

Financials Administration Module

Complete Technical Specification

Critical Analysis of SunSystems 6.4.x Financials Administration Guide (403 pages)

Version 1.0 --- April 2026

_Covers: Ledger Setup, COA, Ledger Entry, Payments, Budgets, Allocations, Reporting, Period End, Fixed Assets, Conversion_

**Table of Contents**

**Executive Summary**

This document provides a critical, chapter-by-chapter technical specification for implementing the Financials Administration capabilities within HospitalityFinancePro (HFP), derived from the Infor SunSystems 6.4.x Financials Administration Guide (document code: sunsystems_6.4.x_ssfiaolh\_\_en-us, 403 pages, published April 2026).

The SunSystems Financials Administration Guide covers **13 chapters** spanning the entire financial backend: ledger setup, chart of accounts, journal entry controls, payment processing, budgeting, corporate allocations, financial reporting, period/year-end processing, fixed asset administration, and ledger conversion. Each chapter is critically analyzed and mapped to the HFP architecture.

---

**Chapter** **SunSystems Topic** **HFP Module** **Priority**

---

Ch 1 Overview N/A (context only) Reference

Ch 2 Setting up the Financials Environment Ledger Setup & Administration P0 - Critical

Ch 3 Setting up the Chart of Accounts Chart of Accounts Manager P0 - Critical

Ch 4 Setting up and Controlling Ledger Entry Journal Entry Engine P0 - Critical

Ch 5 Setting up Payments and Payment Collections Payment Run & Collections P0 - Critical

Ch 6 Setting up Budgets Budget Management P1 - High

Ch 7 Setting up Corporate Allocations Corporate Allocations Engine P1 - High

Ch 8 Setting up Financials Reports Financial Report Writers P1 - High

Ch 9 Account Documents and Statements Statement Generation P2 - Medium

Ch 10 Period and Year End Processing Period Close & Revaluation P0 - Critical

Ch 11 Financials Solutions to Specific Requirements Localization / USALI P2 - Medium

Ch 12 Fixed Asset Administration Fixed Asset Register P1 - High

Ch 13 Ledger Conversion Business Unit Migration P3 - Low

---

**Module 1: Ledger Setup & Administration (Ch. 2)**

**1.1 Critical Analysis**

Chapter 2 is the foundational chapter (152,000 chars of content). It defines how a SunSystems Financials ledger operates within a business unit. The Ledger Setup form (LES) has **10 tabs**: General, Transaction Rules, Sequence Dimensions, Options, Currency, 4th Currency, Supplementary Financials, Agency/Broker, Voucher Numbering, and Journal Classes. This is the single most configuration-dense area of SunSystems.

**Key subsystems covered:**

- **Accounting Periods**: Format ppp/yyyy (period/year). Number of periods defined in Financial Calendars (FCS) and Business Unit Setup. Supports 4 (quarterly), 12/13 (monthly), 52 (weekly), or 365 (daily) periods. Current period set via Change Period (CPD).

- **Ledger Validity Controls**: Open Periods range, Open Dates range, with support for relative values (+nnnn/-nnnn from current, or C for current period, T for today). Controls which periods/dates operators can post to.

- **Provisional Posting**: Three modes --- Mandatory (all transactions provisional first), Optional (user chooses), Prohibited (all permanent). Provisional transactions can be viewed, reported on, and amended before becoming permanent.

- **Financial Calendars (FCS)**: Centralized period management across modules (Financials, Sales Order Processing, Purchase Order Processing, Inventory Control) and business unit groups. Overrides LES period settings when enabled.

- **Optional Ledger Tables (OLT)**: Initialize additional data structures (analysis codes, budget balances, etc.) for a ledger.

- **Ledger Sequence Numbering**: Transaction sequence numbers for audit trails. Configurable per transaction type with sequence dimensions.

- **Automatic Tax Calculation**: Tax details on journal types, semi-deductible tax, withholding/stoppage tax, account codes for tax amounts.

- **Allocation Codes**: Matching/allocation markers for transaction pairing (payments, receipts, transfers).

- **Authorization Facility**: Multi-stage authorization workflow for journal posting --- Authorization Stage Setup (AUS), User Teams, Financial Rejection Codes, Authorization Sets. Transactions can require approval before permanent posting.

- **Voucher Numbering Streams**: Separate number sequences for different journal classes. Configurable per journal class.

- **Journal Classes**: Grouping mechanism for journal types, enabling class-based voucher numbering and reporting.

**1.2 HFP Database Schema**

**1.2.1 ledger_setup (per business unit, per ledger A-K)**

---

**Column** **Type** **Description**

---

id UUID PK Setup record identifier

business_unit_id UUID FK References business_units.id

ledger CHAR(1) Ledger letter A-K (A=Actuals, B-K=Budgets/Forecasts)

current_period VARCHAR(8) Current accounting period (ppp/yyyy format)

open_period_from VARCHAR(12) Open posting period start (absolute or relative +/-nnnn or C)

open_period_to VARCHAR(12) Open posting period end

open_date_from VARCHAR(12) Open posting date start (absolute, relative +/-nnn, or T)

open_date_to VARCHAR(12) Open posting date end

provisional_posting ENUM mandatory / optional / prohibited

use_financial_calendar BOOLEAN If true, period controls come from financial_calendars table

timing_rule_code VARCHAR(20) Depreciation timing rule for fixed assets

exclude_final_value_from_depn BOOLEAN DEFAULT true

assets_in_second_currency BOOLEAN Hold asset values in reporting currency

use_asset_quantity BOOLEAN Track asset quantities on postings

lock_calculated_depreciation BOOLEAN Prevent retrospective depreciation recalculation

full_year_depreciation_first_year BOOLEAN Full year depreciation in acquisition year

payment_run_enabled BOOLEAN Whether PYR is available for this ledger

pay_at_current_rates BOOLEAN Use current FX rates for payments (vs historic rates)

currency_model ENUM Defines how multi-currency transactions are handled

base_currency VARCHAR(3) ISO 4217 base currency code

second_base_currency VARCHAR(3) Reporting/group currency code

fourth_currency_code VARCHAR(3) Optional 4th currency

rounding_method ENUM normal / truncate_to_unit

rounding_unit VARCHAR(20) Unit for truncation (e.g., Hundred)

non_match_system_payments BOOLEAN Allow unmatched system-generated payments

intercompany_posting_enabled BOOLEAN Allow cross-business-unit postings

---

**1.2.2 financial_calendars**

---

**Column** **Type** **Description**

---

id UUID PK Calendar record identifier

calendar_code VARCHAR(20) Unique calendar identifier

description TEXT Calendar description

financial_year INTEGER The year number (convention: year in which fiscal year ends)

periods_per_year INTEGER Number of accounting periods (4/12/13/52/365)

module ENUM financials / sales_order / purchase_order / inventory

business_unit_group VARCHAR(50) Group of business units sharing this calendar

---

**1.2.3 financial_calendar_periods**

---

**Column** **Type** **Description**

---

id UUID PK Period record identifier

calendar_id UUID FK References financial_calendars.id

period_number INTEGER Period within the year (1-based)

period_code VARCHAR(8) Formatted as ppp/yyyy

period_start_date DATE First day of period

period_end_date DATE Last day of period

is_open BOOLEAN Whether posting is allowed

is_current BOOLEAN Whether this is the current period

status ENUM open / closed / locked

---

**1.2.4 authorization_stages**

---

**Column** **Type** **Description**

---

id UUID PK Stage identifier

stage_code VARCHAR(20) Unique stage code

stage_name VARCHAR(100) Human-readable name

stage_order INTEGER Sequence in authorization workflow

required_approvers INTEGER Number of approvals needed to advance

auto_advance BOOLEAN Automatically move to next stage after approval

rejection_returns_to ENUM previous_stage / originator / specific_stage

user_team_id UUID FK Which team can approve at this stage

---

**1.2.5 voucher_number_streams**

---

**Column** **Type** **Description**

---

id UUID PK Stream identifier

stream_code VARCHAR(20) Unique stream code

journal_class VARCHAR(20) Associated journal class

current_number BIGINT Last issued voucher number

prefix VARCHAR(10) Optional prefix for voucher numbers

reset_period ENUM never / yearly / monthly

---

+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **CRITICAL: Period Change Impact** |
| |
| SunSystems warns that changing the current period while users have open sessions causes those sessions to continue using the previous period. HFP must broadcast period changes via WebSocket to all connected sessions and force a refresh of the period context. |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 2: Chart of Accounts Manager (Ch. 3)**

**2.1 Critical Analysis**

The COA chapter (42,000 chars) defines account coding, types, and analysis dimensions. Key observations:

- **Account codes up to 15 characters**: Alphanumeric with symbols allowed (- : . / ). Numbers sort before letters. Half-width Katakana excluded.

- **Six account types**: Profit & Loss, Balance Sheet, Debtor/Receivable (linked to customer), Creditor/Payable (linked to supplier), Client (dual-nature: sometimes debtor, sometimes creditor), and Statistical.

- **Analysis codes (10 dimensions)**: Each transaction can carry up to 10 analysis dimensions (T1-T10). These provide the management reporting structure --- departments, cost centers, projects, products, etc. For hospitality: department, outlet, revenue center, guest type, etc.

- **Account categories (5 levels)**: Hierarchical grouping for reporting. Category 1 through Category 5 provide progressive drill-down levels.

- **Lookup code**: Separate 15-char code for finding accounts by description rather than code.

- **Account lifecycle**: Active → Suspended (no new postings) → Closed (period-end only) → Deleted (only if zero balance and no transactions).

**2.2 HFP Database Schema**

**2.2.1 chart_of_accounts**

---

**Column** **Type** **Description**

---

id UUID PK Account record identifier

account_code VARCHAR(15) Unique account code (UNIQUE within tenant)

account_name VARCHAR(100) Account description

lookup_code VARCHAR(15) Alternative lookup code

account_type ENUM profit_loss / balance_sheet / debtor / creditor / client / statistical

category1 VARCHAR(20) Hierarchy level 1 (e.g., USALI major category)

category2 VARCHAR(20) Hierarchy level 2 (e.g., USALI minor category)

category3 VARCHAR(20) Hierarchy level 3

category4 VARCHAR(20) Hierarchy level 4

category5 VARCHAR(20) Hierarchy level 5

default_analysis_codes JSONB Default T1-T10 analysis codes for this account

currency_code VARCHAR(3) Default currency (NULL = use BU base currency)

linked_supplier_id UUID FK For creditor accounts: linked supplier master record

linked_customer_id UUID FK For debtor accounts: linked customer master record

tax_code VARCHAR(20) Default tax code for transactions on this account

status ENUM active / suspended / closed

opening_balance DECIMAL(18,2) Beginning balance (set during go-live or year-end)

is_control_account BOOLEAN Whether this is a control/summary account

is_intercompany BOOLEAN Whether used for intercompany postings

created_at TIMESTAMPTZ DEFAULT NOW()

updated_at TIMESTAMPTZ DEFAULT NOW()

---

**2.2.2 analysis_dimensions**

---

**Column** **Type** **Description**

---

id UUID PK Dimension identifier

dimension_number INTEGER 1-10 (T1 through T10)

dimension_name VARCHAR(50) Human-readable name (e.g., Department, Cost Center, Outlet)

is_required BOOLEAN Whether this dimension is mandatory on journal entry

validation_type ENUM none / list / range

---

**2.2.3 analysis_codes**

---

**Column** **Type** **Description**

---

id UUID PK Code identifier

dimension_id UUID FK References analysis_dimensions.id

code VARCHAR(30) Analysis code value

description VARCHAR(100) Code description

status ENUM active / suspended

---

+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **USALI Mapping** |
| |
| For hospitality, the 5 category levels map naturally to USALI (Uniform System of Accounts for the Lodging Industry): Category1 = USALI Department (Rooms, F&B, Spa, etc.), Category2 = Revenue/Expense classification, Category3 = Sub-department, Category4 = Detail line, Category5 = Property-specific sub-detail. The 10 analysis dimensions support: T1=Department, T2=Outlet/Revenue Center, T3=Cost Center, T4=Project, T5=Guest Segment, T6-T10=Custom. |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 3: Journal Entry Engine (Ch. 4)**

**3.1 Critical Analysis**

Chapter 4 (113,000 chars) covers the core transaction entry system. Key observations:

- **Journal Types**: The most configuration-intensive element. Each journal type controls: account code behavior, analysis code defaults, currency handling (up to 5 currencies per transaction), posting rules, tax calculation, transaction type, memo fields, and preset behaviors. Over 100 configurable options per journal type.

- **Journal Presets**: Pre-populate journal entry fields. Can preset: period, date, account code (from account list or pattern), amounts (value, percentage of previous line, balance of journal, copy of previous line). 8 preset types available.

- **Journal Balancing**: Complex rules for when a journal is balanced. Base currency must balance. Multi-currency journals have special balancing rules. Rounding differences handled automatically.

- **Held Journals**: Incomplete journals can be saved as \'held\' for later completion. Cannot post until all validation rules pass.

- **Validation Controls**: Account code validation (active/suspended), period validation (open periods/dates), budget checking, authorization requirements, intercompany rules, analysis code validation.

- **Journal Source tracking**: Each journal records the operator ID who created it and the journal source (manual entry, system-generated, imported).

- **Additional Fields Setup (AFS)**: Extend journal transactions with custom fields beyond the standard schema.

- **Intercompany Postings**: Cross-business-unit journal entries with automatic balancing entries in the target business unit.

- **Journal Number Assignment**: Auto-assigned sequential numbers. Monitored for gaps.

**3.2 HFP Database Schema**

**3.2.1 journal_types**

---

**Column** **Type** **Description**

---

id UUID PK Journal type identifier

type_code VARCHAR(5) Unique code (e.g., BNK, POS, AP, MAN, SYS)

description VARCHAR(100) Journal type description

journal_class VARCHAR(20) Associated journal class for voucher numbering

transaction_type ENUM normal / reversal / accrual / reclass / system

default_period_behavior ENUM current / prompted / fixed

default_date_behavior ENUM today / prompted / fixed

account_code_rules JSONB Per-line account code behavior (required dimensions, validation, defaults)

currency_rules JSONB Currency handling for base, transaction, reporting, and 4th/5th currencies

tax_config JSONB Automatic tax calculation settings (tax code, deductibility, withholding)

posting_rules JSONB Override posting rules (provisional allowed, authorization required, etc.)

analysis_code_defaults JSONB Default analysis codes T1-T10 for this journal type

memo_fields_config JSONB Which memo/reference fields are available and required

preset_config JSONB Journal preset definitions for this type

balancing_rules JSONB How journal balancing is enforced (base, multi-currency, auto-balance)

is_system BOOLEAN System-generated types (SYSTM) cannot be edited

status ENUM active / suspended

---

**3.2.2 journals**

---

**Column** **Type** **Description**

---

id UUID PK Journal identifier

journal_number BIGINT Auto-assigned sequential number (UNIQUE within BU+Ledger)

journal_type_id UUID FK References journal_types.id

business_unit_id UUID FK Business unit

ledger CHAR(1) Ledger letter A-K

posting_period VARCHAR(8) Period (ppp/yyyy)

transaction_date DATE Journal date

description VARCHAR(255) Journal header description

reference VARCHAR(30) External reference

journal_source VARCHAR(20) Source: MANUAL, IMPORT, PAYMT, PAYDS, SYSTM, DEPRC, REVAL, ALLOC

operator_id UUID Keycloak user who created/last modified

status ENUM held / provisional / posted / void

authorization_status ENUM not_required / pending / approved / rejected

voucher_number VARCHAR(30) Assigned voucher number from stream

is_balanced BOOLEAN Whether debits = credits

total_debit DECIMAL(18,2) Sum of debit amounts (base currency)

total_credit DECIMAL(18,2) Sum of credit amounts (base currency)

created_at TIMESTAMPTZ DEFAULT NOW()

posted_at TIMESTAMPTZ When permanently posted

---

**3.2.3 journal_lines**

---

**Column** **Type** **Description**

---

id UUID PK Line identifier

journal_id UUID FK References journals.id

line_number INTEGER Line sequence within journal

account_code VARCHAR(15) GL account code

amount DECIMAL(18,2) Transaction amount (positive=debit, negative=credit)

base_amount DECIMAL(18,2) Amount in base currency

transaction_currency VARCHAR(3) Transaction currency code

exchange_rate DECIMAL(18,8) FX rate to base currency

reporting_amount DECIMAL(18,2) Amount in reporting/2nd base currency

fourth_currency_amount DECIMAL(18,2) Amount in 4th currency (if configured)

description VARCHAR(255) Line description/narrative

reference VARCHAR(30) Line-level external reference

analysis_code_1 through analysis_code_10 VARCHAR(30) each 10 analysis dimensions

tax_code VARCHAR(20) Applied tax code

tax_amount DECIMAL(18,2) Calculated tax amount

allocation_marker ENUM none / paid / paid_unmatched / received / allocated

allocation_reference VARCHAR(30) Matching/allocation reference

due_date DATE Payment due date (AP/AR lines)

asset_code VARCHAR(30) Fixed asset code (if asset-related)

memo_amount DECIMAL(18,2) Memorandum quantity (e.g., asset units)

sequence_code VARCHAR(20) Transaction sequence code

sequence_number BIGINT Transaction sequence number

---

+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **CRITICAL: Journal Balancing Rules** |
| |
| A journal is in balance when total debits = total credits in the base currency. Multi-currency journals may have rounding differences that must be posted to a rounding account automatically. SunSystems generates SYSTM journal type entries for rounding differences. HFP must implement the same automatic rounding logic. |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 4: Payment Run & Collections (Ch. 5)**

**4.1 Critical Analysis**

Chapter 5 (76,000 chars) covers the complete payment processing pipeline. This directly impacts the HFP payment run already built. Key observations:

- **Payment Run (PYR) three-step process**: (1) Select transactions for payment/collection, (2) Generate payment transactions, (3) Produce payment documents (cheques, remittances, bank transfer files).

- **Payment Profiles (PYP)**: Define runtime selection criteria, payment method, currency handling, consolidation options, limits, and bank details. These are the configuration backbone of payment processing.

- **Transaction selection criteria**: By supplier range, account range, currency code, due date, allocation marker, payment stamp, analysis codes, and amount thresholds.

- **Payment methods**: Bank (electronic transfer), Cheque, Draft, Manual. Each method affects how transactions are consolidated and what documents are produced.

- **Postings generated by Payment Run**: (a) Payment transaction per creditor account (net amount = gross - discount), (b) Bank account posting(s) for total payment, (c) Optional discount transactions (including tax on discount) to discount account and tax account.

- **Journal type SYSTM, source PAYMT**: Payment transactions get journal type SYSTM and source PAYMT. Discount transactions get source PAYDS.

- **Allocation markers**: Paid transactions receive \'Paid\' allocation marker with allocation reference and date. Non-Match option allows \'Paid Unmatched\' status.

- **Payment account overdraft control**: Total Payment Limit in profile. Optional warning when bank account goes overdrawn (configurable per operator).

- **Pay at Current Rates**: Option to use current FX rates vs original transaction rates. Profile-level override.

- **Discount handling**: Automatic settlement discount calculation with tax adjustment. Tax on discount posted to tax account.

- **Bank transfer file**: Produced for electronic payments. Format defined per payment method.

- **Provisional payments**: If provisional posting is mandatory, all payment transactions are provisional. If optional, user chooses.

- **One-off payments**: Support for miscellaneous suppliers without full supplier setup.

- **Payment Collection (PCR)**: Reverse process for receivables --- select debit transactions on debtor/client accounts for collection.

**4.2 HFP Payment Run Postings (DR/CR)**

This is the exact posting logic that must be verified against the existing HFP payment run implementation:

---

**Posting** **Account** **Debit** **Credit** **Source**

---

Supplier payment (net) Creditor/AP Control (2100) Gross - Discount PAYMT

Bank posting Bank/Payment Account (1200) Net payment amount PAYMT

Settlement discount Discount Account (configured) Discount amount PAYDS

Tax on discount Tax Account (configured) Tax on discount PAYDS

Supplier discount offset Creditor/AP Control (2100) Discount amount PAYDS

---

+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **CRITICAL: Verify HFP Payment Run** |
| |
| The existing HFP payment run must be verified against these exact posting rules. The pending item \'Verify GL journal posting on payment run (DR AP 2100, CR Bank 1200)\' from the previous session must include discount and tax-on-discount postings. Also verify: allocation marker = Paid, journal type = SYSTM, journal source = PAYMT. |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 5: Budget Management (Ch. 6)**

**5.1 Critical Analysis**

Chapter 6 (64,000 chars) covers budgetary control. Key observations:

- **Budget controls**: Expenditure checking (warn/prevent when budget exceeded), Commitment checking (include committed but unpaid amounts), Budget checks (validate against available budget before posting).

- **Budget ledgers (B-K)**: Ledgers B through K can be used as budget/forecast ledgers. Each holds budget values by account, period, and analysis code.

- **Budget levels**: Budget can be set at account level, analysis code level, or combined analysis code level. Combined checking allows budget validation across multiple analysis dimensions simultaneously.

- **Expenditure checking**: Compares actual expenditure against budget at posting time. Can warn or prevent posting. Checks available budget = budget amount - actual spent (- committed, if commitment checking enabled).

- **Budget Labels (BLB)**: Human-readable names for budget ledgers (e.g., B=Budget, C=Forecast, D=Revised Budget).

- **Multi-currency budgets**: Budgets can be maintained in base currency or both base and transaction currency.

- **Rebuilding Budget Balances**: Recalculate budget balance tables from source transactions. Required after certain data modifications.

**5.2 HFP Database Schema**

**5.2.1 budget_definitions**

---

**Column** **Type** **Description**

---

id UUID PK Budget definition identifier

ledger CHAR(1) Budget ledger letter (B-K)

label VARCHAR(50) Human-readable name (e.g., Annual Budget, Forecast Q3)

financial_year INTEGER Year this budget applies to

checking_mode ENUM none / warn / prevent

include_commitments BOOLEAN Include committed amounts in available budget calculation

check_level ENUM account / analysis / combined

check_dimensions JSONB Which analysis dimensions to include in combined checking

currency_mode ENUM base_only / base_and_transaction

---

**5.2.2 budget_amounts**

---

**Column** **Type** **Description**

---

id UUID PK Budget amount identifier

budget_id UUID FK References budget_definitions.id

account_code VARCHAR(15) GL account code

period_code VARCHAR(8) Period (ppp/yyyy)

analysis_code_1 through analysis_code_10 VARCHAR(30) Analysis dimensions (for combined checking)

budget_amount DECIMAL(18,2) Budget amount in base currency

budget_amount_txn DECIMAL(18,2) Budget amount in transaction currency

actual_spent DECIMAL(18,2) Running total of actual expenditure

committed DECIMAL(18,2) Running total of committed amounts

available DECIMAL(18,2) GENERATED ALWAYS AS (budget_amount - actual_spent - committed)

---

**Module 6: Corporate Allocations Engine (Ch. 7)**

**6.1 Critical Analysis**

Chapter 7 (69,000 chars) covers the powerful allocations facility. Key observations:

- **Allocation components**: Sources (where amounts come from), Targets (where amounts go), Ratios (how amounts are split), Setup (rules combining sources, targets, ratios), Calendar (scheduling).

- **Source selection**: Account range, analysis code filters (up to 3 ranges per source), period/balance selection, source continuation lines for complex selections, threshold validation.

- **Two allocation types**: Charge (generates target posting + offset to target offset account --- source untouched) and Split (generates target posting + reversal on source account --- source zeroed out).

- **Ratio types**: Fixed Amount, Fixed Percentage, Variable Percentage (based on source amount), Calculated (based on ledger balances or transaction values from ratio accounts).

- **Stepped/sequenced allocations**: Run multiple allocations in sequence where output of one feeds input of next.

- **Common hospitality uses**: Allocating shared costs (utilities, admin) across departments by revenue percentage; splitting F&B costs between outlets; distributing marketing costs by occupied room count.

- **Generated transactions**: Allocation postings get journal type SYSTM and source ALLOC. Posted to the current period or a specified period.

+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Hospitality Use Case** |
| |
| For USALI compliance, corporate allocations are essential for distributing undistributed operating expenses (admin, marketing, property operations, utilities, IT) to operated departments (Rooms, F&B, Spa, etc.) based on revenue contribution percentages. The allocation engine must support this natively. |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 7: Financial Report Writers (Ch. 8)**

**7.1 Critical Analysis**

Chapter 8 (142,000 chars) covers three report writers --- the largest chapter in the document. Key observations:

- **Three report writers**: Financial Analysis (FAL), Financial Statements (FSL), Financial Tables (FTL). Each serves different reporting needs.

- **Financial Analysis**: Flexible ad-hoc reporting. Define columns as data columns (account balances, budgets, variances) or calculated columns (formulas). Rows are auto-generated from selection criteria. Supports sorting by any dimension and consolidation.

- **Financial Statements**: Traditional formatted reports (P&L, Balance Sheet). Layout-driven with row definitions specifying account ranges, subtotals, and formatting. Column headings define the data periods/comparatives.

- **Financial Tables**: Most powerful writer. Rows define account selections, columns define data types (actuals, budgets, variances, percentages, statistics). Supports cross-tab analysis, calculated rows/columns, conditional formatting, and statistics (occupancy rates, RevPAR, ADR for hospitality).

- **Column Heading Codes (FRH)**: Shared across all report writers. Define what data appears in each column: current period, YTD, comparative period, budget, variance, percentage, balance, movement.

- **Selection dimensions**: Account code range, analysis code ranges (T1-T10), period range, ledger, currency.

- **Consolidation**: Aggregate data across multiple accounts, analysis codes, or business units within a single report.

- **Multi-currency**: Report in base, transaction, reporting, or any specified currency with revaluation.

- **Report subdimensions**: Break down report rows by analysis dimension values (e.g., show each department\'s expenses as sub-rows under the expense category).

+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **USALI Reporting** |
| |
| Financial Tables is the primary writer for USALI reports. Each USALI department (Rooms, F&B, Spa, G&A, etc.) becomes a column or row group. Statistics columns enable hospitality KPIs: Occupancy %, ADR, RevPAR, GOPPAR, Cost Per Occupied Room, F&B Revenue Per Cover. These are calculated using the statistics facility where the denominator is a statistical account (e.g., rooms sold, covers served). |
+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 8: Period Close & Revaluation (Ch. 10)**

**8.1 Critical Analysis**

Chapter 10 (75,000 chars) covers period and year-end processing. Key observations:

- **No mandatory period close**: SunSystems is fully open --- no restrictions imposed on period end. You can move freely between periods. Change Period (CPD) simply sets the current default period.

- **Ledger Revaluation (LER)**: Revalues one currency against another on a group of transactions. Calculates unrealized gain/loss from FX fluctuations. Can post revaluation differences or just report. Selection by account type, account range, journal type range, currency code. Rate from Currency Rate Type (CRT) or Currency Period Rates (CNP).

- **Revaluation consolidation**: For large transaction volumes, consolidate by period, analysis dimension, asset, and account before calculating differences.

- **Ledger Cleardown**: Archive or remove old transactions. Consolidation options on cleardown. Strict controls on what can be cleared.

- **Rebuild Ledger Balances**: Recalculate balance tables from source transactions. Required after certain data corrections.

- **Year End Cleardown**: Transfer year-end P&L balance to Balance Sheet retained earnings account. Zero out P&L accounts for new year.

- **Exclusive functions**: Revaluation cannot run concurrently with: Payment Run, Payment Collection, Payment Voiding, Calculate Depreciation, Asset Disposal, Ledger Cleardown, Transaction Matching, and others. HFP must implement locking.

**8.2 HFP Database Schema**

**8.2.1 revaluation_profiles**

---

**Column** **Type** **Description**

---

id UUID PK Profile identifier

name VARCHAR(100) Profile name

source_currency_type ENUM base / transaction / reporting / fourth

target_currency_type ENUM base / transaction / reporting / fourth

rate_type_code VARCHAR(20) Currency Rate Type for revaluation rates

account_type_filter JSONB Which account types to include (debtor, creditor, client, etc.)

account_range_from VARCHAR(15) Account code range start

account_range_to VARCHAR(15) Account code range end

currency_filter VARCHAR(3) Specific currency to revalue (NULL = all)

gain_loss_account VARCHAR(15) Account for unrealized gain/loss posting

consolidation_config JSONB Consolidation dimensions (period, analysis, asset, account)

post_differences BOOLEAN Whether to post revaluation entries or just report

exclude_depreciation_accounts BOOLEAN DEFAULT true

---

**8.2.2 period_close_status**

---

**Column** **Type** **Description**

---

id UUID PK Status record identifier

business_unit_id UUID FK Business unit

ledger CHAR(1) Ledger A-K

period_code VARCHAR(8) Period (ppp/yyyy)

status ENUM open / soft_close / hard_close / locked

revaluation_run BOOLEAN Whether revaluation has been run for this period

depreciation_run BOOLEAN Whether depreciation has been calculated

allocations_run BOOLEAN Whether corporate allocations have been run

year_end_processed BOOLEAN Whether year-end cleardown has been executed

closed_by UUID User who closed the period

closed_at TIMESTAMPTZ When period was closed

---

+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **CRITICAL: Exclusive Locking** |
| |
| Revaluation, Payment Run, Depreciation, and other period-end processes cannot run concurrently. HFP must implement a process_locks table with advisory locks to prevent concurrent execution of conflicting processes within the same business unit. BullMQ workers must acquire the lock before processing and release on completion. |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 9: Fixed Asset Register (Ch. 12)**

**9.1 Critical Analysis**

Chapter 12 (138,000 chars) covers the fully integrated Fixed Asset Register. Key observations:

- **Fully integrated**: Asset values update automatically from ledger transactions (acquisitions, disposals). Depreciation calculations post automatically to P&L and Balance Sheet accounts.

- **Up to 11 valuations per asset**: 1 actuals + 10 budget ledgers. Each can use a different depreciation method. Supports budgeting, forecasting, taxation values in separate ledgers.

- **Multi-currency**: Asset values maintained in up to 3 currencies (base, transaction, reporting) with independent depreciation methods per currency.

- **Asset details**: Asset code (unique), lookup code, description, two depreciation accounts (BS + P&L), two advanced depreciation accounts, 10 global analysis codes, depreciation method/rate/period/final value, depreciation table code, gross value, accumulated depreciation, net value, asset quantity.

- **Depreciation methods**: Straight Line, Reducing Balance, Sum of Digits, User Table (custom depreciation curves), No Depreciation. Configurable start/end periods, first-year day count, locked historical depreciation.

- **Depreciation Calculation (FDC)**: Batch process that calculates and posts depreciation for all assets. Posts to configured BS and P&L accounts. Journal source = DEPRC.

- **Asset disposal**: Selection, gain/loss calculation, cleardown of asset record. Generates disposal transactions.

- **Asset Notes**: Additional information (insurance valuations, maintenance data, custom fields).

- **Asset revaluation**: Can revalue assets to reflect market value changes. Independent of ledger revaluation.

**9.2 HFP Database Schema**

**9.2.1 fixed_assets**

---

**Column** **Type** **Description**

---

id UUID PK Asset identifier

asset_code VARCHAR(30) Unique asset code

lookup_code VARCHAR(30) Alternative lookup code

description VARCHAR(255) Asset description

bs_depreciation_account VARCHAR(15) Balance sheet accumulated depreciation account

pl_depreciation_account VARCHAR(15) P&L depreciation expense account

adv_bs_depreciation_account VARCHAR(15) Advanced depreciation BS account

adv_pl_depreciation_account VARCHAR(15) Advanced depreciation P&L account

depreciation_method ENUM straight_line / reducing_balance / sum_of_digits / user_table / none

depreciation_rate DECIMAL(8,4) Annual depreciation percentage

depreciation_start_period VARCHAR(8) Period depreciation begins

depreciation_end_period VARCHAR(8) Period depreciation ends

first_period_days INTEGER Days of depreciation in first period

final_value DECIMAL(18,2) Residual/salvage value

depreciation_table_code VARCHAR(20) For user_table method: reference to depreciation table

gross_value DECIMAL(18,2) Acquisition cost (base currency)

accumulated_depreciation DECIMAL(18,2) Total depreciation to date (base currency)

net_value DECIMAL(18,2) GENERATED ALWAYS AS (gross_value - accumulated_depreciation)

txn_currency VARCHAR(3) Transaction currency

gross_value_txn DECIMAL(18,2) Gross value in transaction currency

accum_depreciation_txn DECIMAL(18,2) Accumulated depreciation in transaction currency

reporting_gross_value DECIMAL(18,2) Gross value in reporting currency

reporting_accum_depreciation DECIMAL(18,2) Accumulated depreciation in reporting currency

asset_quantity DECIMAL(18,4) Number of units (e.g., 100 chairs as one asset)

analysis_code_1 through analysis_code_10 VARCHAR(30) 10 analysis dimensions (location, category, etc.)

acquisition_date DATE Date asset was acquired

disposal_date DATE Date asset was disposed (NULL if active)

status ENUM active / fully_depreciated / disposed

---

+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Hospitality Assets** |
| |
| Hotels have distinctive asset categories: Building & Structure, FF&E (Furniture Fixtures & Equipment), Kitchen Equipment, IT Infrastructure, Vehicles, Operating Equipment (linen, china, glassware, silverware). The 10 analysis dimensions support: T1=Property, T2=Department, T3=Asset Category, T4=Location/Floor, T5=Supplier, T6-T10=Custom. |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**Module 10: Business Unit Migration (Ch. 13)**

**10.1 Critical Analysis**

Chapter 13 (31,000 chars) covers Ledger Conversion (LCN). Key observations:

- **Purpose**: Transfer ledger, archive, and budget transactions from a source business unit to a target business unit. Does NOT create or modify the target BU setup --- only copies transactions.

- **Currency conversion**: Can generate additional currency values, swap existing currency values, and/or change the pivot currency in the target.

- **Use cases**: Company reorganizations (split BU into two), currency conversion (change base currency), migration to a new COA structure, consolidation of multiple BUs into one.

- **HFP relevance**: Less critical for initial launch but important for onboarding properties that have existing SunSystems data. The Transfer Desk import profiles handle most migration scenarios.

**Appendix: Complete Table Summary**

---

**Table** **Module** **Purpose**

---

ledger_setup 1 - Ledger Setup Per-BU, per-ledger configuration (10 tabs of settings)

financial_calendars 1 - Ledger Setup Centralized period management

financial_calendar_periods 1 - Ledger Setup Individual period definitions with dates and status

authorization_stages 1 - Ledger Setup Multi-stage approval workflow definition

authorization_teams 1 - Ledger Setup User teams for authorization stages

voucher_number_streams 1 - Ledger Setup Sequence generators for voucher numbering

tax_codes 1 - Ledger Setup Tax calculation rules and rates

chart_of_accounts 2 - COA Account master data with 6 types and 5 categories

analysis_dimensions 2 - COA 10 analysis dimension definitions

analysis_codes 2 - COA Valid codes per dimension

journal_types 3 - Ledger Entry Journal type configuration (100+ options each)

journal_presets 3 - Ledger Entry Pre-populated field definitions for journal entry

journals 3 - Ledger Entry Journal headers

journal_lines 3 - Ledger Entry Journal line items with 10 analysis dimensions

payment_profiles 4 - Payments Payment run configuration and selection criteria

payment_runs 4 - Payments Payment run execution history

budget_definitions 5 - Budgets Budget ledger configuration and checking rules

budget_amounts 5 - Budgets Budget values by account/period/analysis

allocation_sources 6 - Allocations Cost allocation source definitions

allocation_targets 6 - Allocations Cost allocation target definitions

allocation_ratios 6 - Allocations Allocation split ratios and calculation methods

allocation_setups 6 - Allocations Complete allocation rules combining S/T/R

allocation_calendars 6 - Allocations Allocation scheduling

report_layouts 7 - Reporting Financial report layout definitions

report_columns 7 - Reporting Column definitions for all 3 report writers

report_rows 7 - Reporting Row definitions for statements and tables

column_heading_codes 7 - Reporting Shared column data type definitions

revaluation_profiles 8 - Period End FX revaluation configuration

period_close_status 8 - Period End Period lifecycle tracking

process_locks 8 - Period End Advisory locks for exclusive processes

fixed_assets 9 - Fixed Assets Asset register with 11 valuations, multi-currency

depreciation_tables 9 - Fixed Assets User-defined depreciation curves

asset_notes 9 - Fixed Assets Additional asset information

---
