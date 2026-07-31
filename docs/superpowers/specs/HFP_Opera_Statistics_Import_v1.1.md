# HospitalityFinancePro — Opera PMS Statistics Import

> **Version:** 1.1 · **Date:** April 2026 · **Status:** Draft
> **Reference Property:** Essque Zalu Zanzibar (EZZ) · **Currency:** USD

---

## 1. Introduction

This specification defines how HospitalityFinancePro (HFP) imports and stores non-financial statistical data from Oracle Opera PMS night audit exports, and how the broader statistics account framework operates within HFP.

Two Opera file types are covered for automated import:

- **EZZDS** — Daily Statistics (journal type `FIDST`)
- **EZZMS** — Market Segment Statistics (journal type `FIDMS`)

These files use the standard SunSystems SAF (Standard Accounting Format) pipe-delimited structure but carry **no financial impact**. They record operational KPIs such as occupancy, guest counts, arrivals, departures, cancellations, and market segment breakdowns.

In SunSystems, this data posts to **Memo accounts** — a dedicated account type for non-financial information that is excluded from the trial balance and ignores debit/credit balancing rules. HFP implements this as the `STATISTICS` account type in the Chart of Accounts. Statistics files are processed through the same Transfer Desk SAF import pipeline as financial files (EZZRV, EZZCL), but post to statistics accounts with zero GL impact.

---

## 2. SunSystems Memo Account Model (Reference)

SunSystems defines six account types: Profit & Loss, Balance Sheet, Debtor (Receivable), Creditor (Payable), Client, and **Memo**. The Memo type is the SunSystems equivalent of HFP's `STATISTICS` type.

### 2.1 Key Behaviours (replicated in HFP)

- Record non-financial data that is **excluded from the trial balance**.
- Support **single-sided posting** (no balancing counter-entry required).
- When checking journal balance, the system **ignores postings to statistical accounts**.
- Balances **carry forward** year-to-year (like balance sheet accounts).
- Cannot be used as a balancing entry for a posting to another account type.
- Account type is **immutable** once transactions have been posted.

### 2.2 Memorandum Amount Field

SunSystems also provides a Memorandum Amount field on every journal line for recording non-financial values (quantities, headcounts) alongside financial postings. For HFP statistics import, we use the **statistics account approach** (not a memo amount field) because statistics files contain only non-financial data with no accompanying financial transaction.

---

## 3. HFP Account Types

The HFP Chart of Accounts uses six account types. The `STATISTICS` type is already present in the EZZ COA with 147 accounts.

### 3.1 Account Types

| Type Code    | Display Name | SunSystems Equivalent | Description                                                                             |
| ------------ | ------------ | --------------------- | --------------------------------------------------------------------------------------- |
| `ASSET`      | Asset        | Balance Sheet         | Assets; balances carry forward                                                          |
| `LIABILITY`  | Liability    | Balance Sheet         | Liabilities; balances carry forward                                                     |
| `EQUITY`     | Equity       | Balance Sheet         | Equity accounts; balances carry forward                                                 |
| `REVENUE`    | Revenue      | Profit & Loss         | Income accounts; balances reset at year-end                                             |
| `EXPENSE`    | Expense      | Profit & Loss         | Expenditure accounts; balances reset at year-end                                        |
| `STATISTICS` | Statistics   | Memo                  | Non-financial data; excluded from trial balance; single-sided posting; no balance check |

### 3.2 EZZ COA Summary

| Type       | Count     |
| ---------- | --------- |
| LIABILITY  | 470       |
| EXPENSE    | 241       |
| STATISTICS | 147       |
| ASSET      | 124       |
| REVENUE    | 34        |
| EQUITY     | 8         |
| **Total**  | **1,024** |

### 3.3 STATISTICS Account Validation Rules

1. Journals containing **ONLY** statistics account lines skip the debit/credit balance check entirely.
2. A statistics account line **cannot** be the balancing entry for a non-statistics account line in the same journal. Mixed journals must balance on their non-statistics lines independently.
3. Account type is **immutable** once transactions have been posted.
4. STATISTICS accounts are **excluded** from trial balance, P&L, and balance sheet reports. They appear only in statistical reports and Q&A queries.
5. STATISTICS account balances **carry forward** at year-end (no year-end close reset).

---

## 4. Statistics Account Hierarchy

The EZZ COA organises all 147 statistics accounts under a root `Z` node with category sub-groups. Only `Z1` (Room Statistics) accounts are populated by Opera PMS files. The remaining categories are populated by manual entry or other source system imports.

### 4.1 Category Structure

| Parent | Code Range | Category                    | Source                  | Accounts |
| ------ | ---------- | --------------------------- | ----------------------- | -------: |
| `Z`    |            | STATISTICS (root)           | —                       |        1 |
| `Z1`   | Z101–Z199  | Room Statistics             | Opera PMS (EZZDS/EZZMS) |       99 |
| `Z2`   | Z201–Z212  | F&B Statistics              | Manual / POS            |        4 |
| `Z4`   | Z402–Z426  | Productivity / Man Hours    | Manual / HR             |        9 |
| `Z5`   | Z510–Z536  | Spa Statistics              | Manual / Spa            |       11 |
| `Z6`   | Z602–Z606  | Laundry Statistics          | Manual                  |        3 |
| `Z7`   | Z701       | AR Statistics               | Manual / HFP            |        1 |
| `Z8`   | Z802–Z806  | Utility Statistics          | Manual / BMS            |        5 |
| `Z9`   | Z901–Z960  | Geographic / Booking Source | Opera PMS               |        5 |

### 4.2 Room Statistics — Daily KPIs (EZZDS)

These accounts are populated by the EZZDS file (journal type `FIDST`), one row per KPI per business date:

| Account | Name                             | Unit    | Sample (2025-08-30) |
| ------- | -------------------------------- | ------- | ------------------- |
| `Z101`  | Total Rooms in Hotel             | Rooms   | 48                  |
| `Z102`  | Out of Order Rooms               | Rooms   | —                   |
| `Z103`  | Total Available Room Nights      | Rooms   | —                   |
| `Z104`  | Room Occupied                    | Rooms   | 26                  |
| `Z105`  | Number of Adults                 | Persons | 51                  |
| `Z106`  | Number of Children               | Persons | 7                   |
| `Z107`  | Total Number of Guests           | Persons | 58                  |
| `Z108`  | Complimentary Rooms              | Rooms   | —                   |
| `Z109`  | House Use Rooms                  | Rooms   | 1                   |
| `Z110`  | Out of Service Rooms             | Rooms   | —                   |
| `Z111`  | Arrival Rooms                    | Rooms   | 6                   |
| `Z112`  | Arrival Persons                  | Persons | —                   |
| `Z113`  | Departure Rooms                  | Rooms   | —                   |
| `Z114`  | Departure Persons                | Persons | 10                  |
| `Z115`  | Reservations Made Today          | Count   | —                   |
| `Z116`  | Cancelled Reservations Today     | Count   | 5                   |
| `Z117`  | Room Night Reserved Today        | Count   | —                   |
| `Z118`  | Day Use Rooms                    | Rooms   | —                   |
| `Z119`  | Walk in Rooms                    | Rooms   | —                   |
| `Z120`  | No Show Rooms                    | Rooms   | —                   |
| `Z121`  | Extended Stay Persons            | Persons | —                   |
| `Z122`  | Early Departure Persons          | Persons | —                   |
| `Z123`  | Cancelled Reservations for Today | Count   | —                   |

> **Note:** Not all accounts appear in every nightly export. Opera only outputs accounts with non-zero values for the business date. Accounts marked "—" were not present in the 2025-08-30 sample file but are valid and may appear on other dates.

### 4.3 Room Statistics — Market Segment Triplets (EZZMS)

Each market segment has three accounts in a **triplet pattern**: Revenue Stat, Room Nights, Guest Nights. Populated by EZZMS file (journal type `FIDMS`).

| Revenue | Rooms  | Guests | Segment Code | Segment Name                  | Status     |
| ------- | ------ | ------ | ------------ | ----------------------------- | ---------- |
| `Z124`  | `Z146` | `Z147` | `BAR`        | BAR Rate                      | Active     |
| `Z125`  | `Z177` | `Z178` | —            | [Do Not Use] Guest Direct     | Deprecated |
| `Z126`  | `Z156` | `Z157` | `NEG`        | Negotiated Rate               | Active     |
| `Z127`  | `Z154` | `Z155` | `CHR`        | Charter Rates                 | Active     |
| `Z128`  | `Z141` | `Z142` | `DMC`        | DMC Rates                     | Active     |
| `Z129`  | `Z139` | `Z140` | `OTA`        | Online Travel Agent           | Active     |
| `Z130`  | `Z137` | `Z138` | `FIT`        | FIT Rate                      | Active     |
| `Z131`  | `Z135` | `Z136` | `HOU`        | House Use                     | Active     |
| `Z132`  | `Z133` | `Z134` | `RAC`        | Rack Rate                     | Active     |
| `Z145`  | `Z143` | `Z144` | `STO`        | STO Rates                     | Active     |
| `Z148`  | `Z149` | `Z150` | `PRO`        | Promotion Rate                | Active     |
| `Z151`  | `Z152` | `Z153` | —            | [Do Not Use] International TA | Deprecated |
| `Z158`  | `Z159` | `Z160` | `COMP`       | Complimentary                 | Active     |
| `Z161`  | `Z162` | `Z163` | —            | [Do Not Use] Booking.com      | Deprecated |
| `Z164`  | `Z165` | `Z166` | —            | [Do Not Use] BAR Rate (dup)   | Deprecated |
| `Z167`  | `Z168` | `Z169` | —            | [Do Not Use] Charters (dup)   | Deprecated |
| `Z170`  | `Z171` | `Z172` | —            | [Do Not Use] Web Booking      | Deprecated |
| `Z173`  | `Z174` | `Z175` | `INT`        | Internal Use Only             | Active     |
| `Z179`  | `Z180` | `Z181` | `GRP`        | Group [Company]               | Active     |
| `Z182`  | `Z183` | `Z184` | —            | [Do Not Use] Travel Agent     | Deprecated |
| `Z185`  | `Z186` | `Z187` | `RES`        | Resident Rates                | Active     |
| `Z188`  | `Z189` | `Z190` | `EXP`        | [Do Not Use] Expedia          | Deprecated |
| `Z191`  | `Z192` | `Z193` | `DIS`        | Discount Rate                 | Active     |
| `Z194`  | `Z195` | `Z196` | `PKG`        | Package                       | Active     |
| `Z197`  | `Z198` | `Z199` | —            | [Do Not Use] Company          | Deprecated |
| `Z210`  | `Z211` | `Z212` | `GRPO`       | Group [Individual / Other]    | Active     |

### 4.4 Geographic & Booking Source (EZZDS/Manual)

| Account | Name                         | Unit      |
| ------- | ---------------------------- | --------- |
| `Z901`  | Geographic — Room Revenue    | USD       |
| `Z902`  | Geographic — Number of Guest | Persons   |
| `Z903`  | Geographic — Number of Rooms | Rooms     |
| `Z950`  | Booking Source Rooms         | Rooms/USD |
| `Z960`  | Booking Source Revenue       | USD       |

### 4.5 Non-Opera Statistics Categories

These are **not** populated by Opera PMS files. They are entered manually or imported from other systems:

| Category          | Accounts  | Sample Metrics                                                |
| ----------------- | --------- | ------------------------------------------------------------- |
| F&B (Z2)          | Z201–Z203 | Covers, Walk-in Covers, Day Visits                            |
| Productivity (Z4) | Z402–Z426 | Headcount (Permanent/Part-time/Casual), Man-hours, STD hours  |
| Spa (Z5)          | Z510–Z536 | Treatment rooms, treatments sold, therapist hours, spa guests |
| Laundry (Z6)      | Z602–Z606 | Kg house laundry by department (Rooms, F&B, Total)            |
| AR (Z7)           | Z701      | Outstanding AR balance                                        |
| Utilities (Z8)    | Z802–Z806 | Gas, Diesel, Water, Other Fuel, Kilowatt Hours                |

---

## 5. SAF File Format — Statistics Files

Both EZZDS and EZZMS files follow the standard Opera PMS SAF export format: pipe-delimited, CRLF line endings, fixed-width padded fields. They share the same column layout as financial SAF files (EZZRV, EZZCL) and are processed by the same Transfer Desk import profile parser.

### 5.1 Common SAF Column Layout

| Pos   | Field         | Example              | Notes                                                          |
| ----- | ------------- | -------------------- | -------------------------------------------------------------- |
| 1     | Account Code  | `Z104`               | Statistics account code (15-char padded)                       |
| 2     | Period        | `2025008`            | `YYYYPPP` format — year + 3-digit period number                |
| 3     | Date          | `20250830`           | Business date `YYYYMMDD`                                       |
| 4–5   | (unused)      |                      | Empty fields                                                   |
| 6     | Status        | `L`                  | `L` = Posted (Ledger)                                          |
| 7     | Amount        | `000000000000026000` | 18-digit zero-padded; **divide by 1000** for actual value      |
| 8     | DR/CR         | `D`                  | `D` = Debit indicator (**irrelevant** for statistics accounts) |
| 9     | (unused)      |                      | Empty                                                          |
| 10    | Journal Type  | `FIDST` / `FIDMS`    | `FIDST` = Daily Stats, `FIDMS` = Market Segment Stats          |
| 11    | (unused)      |                      | Empty                                                          |
| 12    | Stat Code     | `OCC_R` / `PRO`      | 5-char statistic or market segment code                        |
| 13    | Description   | `Rooms Occupied`     | 25-char padded description                                     |
| 14–23 | (unused)      |                      | Reserved/empty analysis fields                                 |
| 24    | Currency      | `USD`                | Always USD for EZZ                                             |
| 25    | (unused)      |                      | Empty                                                          |
| 26    | Amount (dup)  | `000000000000026000` | Duplicate of field 7                                           |
| 27    | Business Unit | `EZZ`                | Property code (5-char padded)                                  |
| 28–36 | T-Codes       |                      | Analysis dimension codes T2–T10 (unused in stats files)        |

### 5.2 Amount Parsing Rule

All Opera PMS SAF files (financial and statistical) use the ÷1000 convention:

```
Raw: 000000000000026000  →  26000 / 1000  =  26        (rooms occupied)
Raw: 000000000007378887  →  7378887 / 1000  =  7378.887  (revenue stat)
```

### 5.3 First Row Handling

The EZZDS file may begin with a blank/whitespace-only first row. The parser must detect and skip empty lines before processing.

---

## 6. Derived KPIs

HFP calculates these KPIs from imported EZZDS data at query time or during a nightly aggregation job:

| KPI                | Formula                         | Sample (2025-08-30)             |
| ------------------ | ------------------------------- | ------------------------------- |
| Occupancy %        | `OCC_R / PHYSI × 100`           | 26 / 48 = **54.17%**            |
| ADR                | `ROOM_ / OCC_R`                 | 7,378.887 / 26 = **USD 283.80** |
| RevPAR             | `ROOM_ / PHYSI`                 | 7,378.887 / 48 = **USD 153.73** |
| Avg Guests/Room    | `GUEST / OCC_R`                 | 58 / 26 = **2.23**              |
| Double Occupancy % | `(GUEST – OCC_R) / OCC_R × 100` | (58–26)/26 = **123.08%**        |
| Available Rooms    | `PHYSI – HOUSE`                 | 48 – 1 = **47**                 |

---

## 7. Transfer Desk Import Profile Configuration

Statistics files share the same SAF format as financial files and are handled by the existing Transfer Desk SAF import pipeline.

### 7.1 Profile Definitions

| Setting             | OPERA-DS (Daily Stats)             | OPERA-MS (Market Segment)          |
| ------------------- | ---------------------------------- | ---------------------------------- |
| Profile Code        | `OPERA-DS`                         | `OPERA-MS`                         |
| Profile Type        | `IMPORT`                           | `IMPORT`                           |
| File Pattern        | `EZZ*DS*.SUN`                      | `EZZ*MS*.SUN`                      |
| Format              | SAF (pipe-delimited)               | SAF (pipe-delimited)               |
| Journal Type Filter | `FIDST`                            | `FIDMS`                            |
| Target Account Type | STATISTICS only                    | STATISTICS only                    |
| Balance Check       | Disabled (statistics-only journal) | Disabled (statistics-only journal) |
| Amount Rule         | ÷1000                              | ÷1000                              |
| DR/CR Handling      | Ignore (set to zero)               | Ignore (set to zero)               |
| Duplicate Detection | Account + Date + Period            | Account + Date + Period + Segment  |
| Schedule            | Daily after night audit            | Daily after night audit            |
| Source System       | Opera PMS                          | Opera PMS                          |

### 7.2 Processing Pipeline

1. **File Detection:** BullMQ scheduled job scans the configured S3 path for files matching the glob pattern.
2. **Parse:** SAF parser splits on pipe delimiter, strips whitespace padding, applies ÷1000 to amount fields. Skips blank/empty lines.
3. **Validate:** Each account code is verified as `STATISTICS` type in the COA. Non-statistics accounts in a statistics file trigger a validation error.
4. **Duplicate Check:** If a record with the same account + date + period (+ segment for EZZMS) already exists, the row is flagged for review or overwritten based on profile configuration.
5. **Post:** Transactions are inserted into the journal/transaction tables with `debit_amount = 0`, `credit_amount = 0`, and the statistical value stored in the `stat_value` field. Journal balance check is skipped.
6. **Activity Log:** Import results (rows processed, errors, duplicates) are recorded in the Integration Activity monitor.

---

## 8. Database Schema Changes

### 8.1 Account Type — STATISTICS Value

The `STATISTICS` account type is already present in the EZZ COA. Ensure the account_type enum/check includes it:

```sql
-- If using enum
ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'STATISTICS';

-- If using check constraint
account_type VARCHAR(12) CHECK (account_type IN (
  'ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','STATISTICS'
))
```

### 8.2 Journal Transactions — stat_value Column

Add a `stat_value` column to the `journal_lines` table:

```sql
ALTER TABLE journal_lines ADD COLUMN stat_value NUMERIC(18,3) DEFAULT NULL;
```

For statistics account postings: `debit_amount = 0`, `credit_amount = 0`, `stat_value = parsed amount (÷1000)`.
For financial postings: `stat_value` remains `NULL`.

### 8.3 Journal Engine — Balance Check Override

The journal posting engine must detect when a journal contains **only** `STATISTICS`-type account lines and skip the debit/credit balance validation:

```typescript
// Pseudo-code for journal balance check
const nonStatLines = journalLines.filter((line) => line.account.type !== "STATISTICS");

if (nonStatLines.length === 0) {
  // Statistics-only journal — skip balance check
  return true;
}

// Normal balance check on non-statistics lines only
const totalDebit = nonStatLines.reduce((sum, l) => sum + l.debitAmount, 0);
const totalCredit = nonStatLines.reduce((sum, l) => sum + l.creditAmount, 0);
return Math.abs(totalDebit - totalCredit) < 0.01;
```

---

## 9. Cross-Validation Rules

When both EZZDS and EZZMS files are imported for the same business date, HFP validates consistency:

| Validation Rule           | EZZDS Source    | EZZMS Source                             |
| ------------------------- | --------------- | ---------------------------------------- |
| Room nights must match    | `Z104` (OCC_R)  | SUM of all segment room night accounts   |
| Guest nights must match   | `Z107` (GUEST)  | SUM of all segment guest night accounts  |
| Revenue stat should match | `Z950` (ROOM\_) | SUM of all segment revenue stat accounts |

Validation failures are logged as **warnings** (not errors) since minor rounding differences are expected between aggregated segment values and daily totals.

---

## 10. Reporting & Dashboard Integration

Statistics data imported via `STATISTICS` accounts feeds the following HFP reporting modules:

- **Daily Flash Report:** Occupancy %, ADR, RevPAR, total guests, arrivals, departures, cancellations from EZZDS accounts.
- **Market Segment Mix:** Revenue and room night contribution by segment from EZZMS accounts. Pie chart and bar chart visualizations.
- **Monthly/YTD Roll-up:** Period aggregations of daily statistics. Supports USALI summary reporting for rooms department.
- **Budget vs Actual:** Statistical budget values can be loaded to statistics accounts via budget import, enabling variance analysis on occupancy, ADR, and RevPAR.
- **Productivity Reports:** Man-hours per occupied room, man-hours per guest from Z4 accounts combined with Z1 occupancy data.
- **Spa Performance:** Treatment utilisation, revenue per treatment hour, therapist productivity from Z5 accounts.
- **Utility Tracking:** Cost per occupied room for utilities from Z8 accounts combined with Z1 occupancy data.
- **Q&A / Ad-hoc Query:** Statistics accounts are queryable through the HFP report writers (FAL, FSL, FTL) when account type filter includes `STATISTICS`.

---

## Appendix A: USALI Department Mapping

All statistics accounts map to USALI departments via the `usaliDepartment` field in the COA:

| USALI Department        | Account Range |
| ----------------------- | ------------- |
| Room Statistics         | Z1xx          |
| F&B Statistics          | Z2xx          |
| Productivity Statistics | Z4xx          |
| Spa Statistics          | Z5xx          |
| Laundry Statistics      | Z6xx          |
| AR Statistics           | Z7xx          |
| Utility Statistics      | Z8xx          |
| Geographic Statistics   | Z9xx          |

---

_End of specification._
