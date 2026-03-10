# Opera PMS Integration Guide

## SUN File Import into FinSys Hospitality

---

## 1. Overview

Oracle Opera PMS exports daily financial data as `.SUN` files — a **pipe-delimited variant** of the SunAccount SAF format. Unlike Jana's fixed-width SAF files, Opera uses the pipe character (`|`) as a field separator while maintaining the same logical field structure.

Opera generates four distinct file types for the daily night audit, each serving a different purpose:

| File | Prefix | Purpose | Balanced | Posts to GL |
|------|--------|---------|----------|-------------|
| **Revenue** | `EZZRV` | All revenue, payment, tax, and settlement transactions | Yes | Yes |
| **City Ledger** | `EZZCL` | Guest folio transfers to city ledger (AR) | Yes | Yes |
| **Market Statistics** | `EZZMS` | Revenue breakdown by market segment/rate code | No (stats only) | No — statistics ledger |
| **Daily Statistics** | `EZZDS` | Occupancy, arrivals, departures, guest counts | No (stats only) | No — statistics ledger |

### File Naming Convention

```
EZZ{TYPE}{YYYYMMDD}.SUN
```

- `EZZ` = Property code prefix (configurable per property in Opera)
- Type: `RV` = Revenue, `CL` = City Ledger, `MS` = Market Statistics, `DS` = Daily Statistics
- Date: Business date of the night audit
- Extension: `.SUN` (SunSystems import format)

### Format Characteristics

| Property | Value |
|----------|-------|
| Format | Pipe-delimited (`\|`) SAF variant |
| Encoding | ASCII / UTF-8 |
| Line ending | CRLF (`\r\n`) |
| Currency | USD (property base currency) |
| Journal Type | `FIDEL` (Revenue/CL), `FIDMS` (Market Stats), `FIDST` (Daily Stats) |
| Property Code | `EZZ` (in analysis field) |
| Amount format | 18-digit integer — whole numbers, no implied decimals |
| Frequency | Daily (after night audit) |

---

## 2. Pipe-Delimited Field Layout

Opera's `.SUN` files use `|` as the delimiter. The fields map to the same SAF logical structure but in a delimited format rather than fixed-width positions.

| Index | Field | Example | Description |
|-------|-------|---------|-------------|
| 0 | **Account Code** | `30100` | GL account code |
| 1 | **Accounting Period** | `2025008` | YYYYPPP — FY2025, Period 8 (August) |
| 2 | **Transaction Date** | `20250830` | YYYYMMDD — Business date |
| 3 | Journal Number | *(blank)* | Assigned on import |
| 4 | Line Number | *(blank)* | Assigned on import |
| 5 | **Record Type** | `L` | L = Ledger transaction |
| 6 | **Amount** | `000000000007204970` | 18-digit integer (whole number) |
| 7 | **D/C Marker** | `C` | D = Debit, C = Credit |
| 8 | Allocation Indicator | *(blank)* | |
| 9 | **Journal Type** | `FIDEL` | Opera journal type identifier |
| 10 | **Journal Source** | `FOICL` | Sub-source (e.g. FOICL = Folio City Ledger) |
| 11 | **Transaction Reference** | `G1001` | Opera transaction code |
| 12 | **Description** | `Room Charge [M]` | Transaction description |
| 13 | Entry Date | *(blank)* | |
| 14 | Entry Period | *(blank)* | |
| 15 | Due Date | *(blank)* | |
| 16–21 | *(various blanks)* | | Payment/asset fields |
| 22 | **Currency Code** | `USD` | Transaction currency |
| 23 | *(blank)* | | |
| 24 | **Base Amount** | `000000000007204970` | Amount in base currency (mirrors field 6) |
| 25–30 | *(various)* | | Extended fields |
| 31 | **Analysis: Property** | `EZZ` | Property code |
| 32 | **Analysis: Department** | `110` | Department code |
| 33 | **Analysis: Department 2** | `110` | Mirrors field 32 (echo) |
| 34 | **Analysis: Outlet** | `201` | F&B outlet code (when applicable) |
| 35–41 | *(blank)* | | Additional analysis codes |

---

## 3. Amount Parsing

Opera uses the **standard SAF convention**: amounts are stored as **15 integer digits + 3 implied decimal digits** (no decimal point). The value must be divided by 1,000 to get the actual amount.

```
000000000007204970 → 7,204.970
000000000000173910 →   173.910
000000000000002000 →     2.000
```

**This differs from Jana**, which writes TZS amounts as whole integers. The Journal Type field identifies the source:
- `FIDEL`, `FIDMS`, `FIDST` → Opera → **divide by 1,000**
- `MFMCP` → Jana → **parse as whole number**

---

## 4. EZZRV — Revenue File

### Purpose

The Revenue file captures the **complete daily financial activity** from Opera's night audit. It contains all revenue postings, payment settlements, tax calculations, and inter-ledger transfers. This file **must balance** (total debits = total credits).

### Journal Type: `FIDEL`

### Transaction Pattern

The Revenue file follows the double-entry pattern:

```
CREDIT  30100    Revenue accounts (room charges, F&B, spa, etc.)
CREDIT  23100    Tax liabilities (VAT, infrastructure tax)
DEBIT   11xxx    Cash/bank/card settlement accounts
DEBIT   12500    Guest ledger control (unsettled balances)
DEBIT   24100    Deposit ledger movements
```

Package revenue uses a reclass pattern — the gross charge posts to rooms (30100) and then allocates portions to F&B (31500) via matching debit/credit pairs:

```
CREDIT  30100   7,204.970   Room Charge Package (gross)
DEBIT   30100   7,204.970   Room Charge Package (reclass out)
CREDIT  30100   7,204.970   Room Charge (net room portion)
CREDIT  31500     495.650   Breakfast Package Allocation
CREDIT  31500     921.740   Dinner Package Allocation
DEBIT   31500     495.650   Breakfast (offset)
DEBIT   31500     921.740   Dinner (offset)
```

### Sample File Summary (30 August 2025)

| Metric | Value |
|--------|-------|
| Total lines | 42 |
| Total debits | USD 22,044.890 |
| Total credits | USD 22,044.890 |
| **Balanced** | **Yes** |

### Account Mapping

**Revenue Accounts (Credit Side)**

| Opera Code | Description | USALI Category | Dept |
|-----------|-------------|---------------|------|
| `30100` | Room Revenue (incl. packages) | Rooms Revenue | 110 |
| `31100` | Food Revenue (restaurants) | F&B — Food | 210/211/213 |
| `31500` | Package Allocations (B'fast, lunch, dinner) | F&B — Food | 210 |
| `32100` | Beverage Revenue (bars) | F&B — Beverage | 211/212/213 |
| `34100` | Spa Services | Spa Revenue | 300 |
| `36200` | Transfers / Transport | Other Operated | 510 |
| `21300` | Tips / Gratuities (liability) | Staff Tips Payable | 213 |
| `23100` | VAT 15% | Tax Liability | — |
| `23200` | Infrastructure Tax | Tax Liability | 610 |

**Settlement / Balance Sheet Accounts (Debit Side)**

| Opera Code | Description | Account Type |
|-----------|-------------|-------------|
| `11600` | Front Office Cash (USD + TZS) | Asset — Cash |
| `11650` | Bank Transfer / EFT | Asset — Bank |
| `11750` | Credit/Debit Cards (Visa, MC via PesaPal) | Asset — Receivable |
| `12500` | Guest Ledger Control | Asset — AR Control |
| `24100` | Deposit Ledger Account | Liability — Deposits |

### Opera Transaction Codes (Reference Field)

| Code | Description | Type |
|------|-------------|------|
| `G1001` | Room Charge (manual/rack) | Revenue |
| `G1500` | Room Charge Package | Revenue |
| `P1000` | Room Charge (package reclass) | Revenue |
| `G2050` | Market Kitchen Lunch Food | Revenue |
| `G2100` | Market Kitchen Dinner Food | Revenue |
| `G2450` | Jetty Restaurant Lunch Food | Revenue |
| `G2500` | Jetty Restaurant Dinner Food | Revenue |
| `G3000` | Baobab Bar Food | Revenue |
| `G3005` | Baobab Bar Soft Beverages | Revenue |
| `G3010` | Baobab Bar Alcoholic Beverages | Revenue |
| `G3007` | Baobab Bar Soft Bev. Discount | Discount |
| `G3105` | Infinity Bar Soft Beverages | Revenue |
| `G3110` | Infinity Bar Alcoholic Beverages | Revenue |
| `G3305` | Jetty Bar Soft Beverages | Revenue |
| `G3310` | Jetty Bar Alcoholic Beverages | Revenue |
| `G3030` | Baobab Bar Tips | Tips |
| `G5101` | Transfers Charge | Revenue |
| `G6000` | Spa Services | Revenue |
| `G7000` | Breakfast Package Allocation | Package Split |
| `G7005` | Lunch Package Allocation | Package Split |
| `G7010` | Dinner Package Allocation | Package Split |
| `G8000` | VAT 15% | Tax |
| `G8010` | Infrastructure Tax | Tax |
| `G9000` | FO Cash [USD] | Payment |
| `G9001` | FO Cash [TZS] | Payment |
| `G9006` | Bank Transfer / EFT | Payment |
| `G9008` | Deposit Transfer at Checkout | Payment |
| `G9103` | Visa Card [PesaPal] | Payment |
| `G9104` | Master Card [PesaPal] | Payment |
| `G9106` | VCCC (Virtual CC) | Payment |
| `GSTLD` | Guest Ledger Trade Account | Control |
| `DPLED` | Deposit Ledger Account | Control |
| `PKGLD` | Package Ledger Total | Control |
| `P7000`–`P7010` | Package reclass entries | Reclass |
| `P1000`/`P1500` | Room charge reclass | Reclass |

### Department Codes (Analysis Fields 32–34)

| Code | Department | USALI Category |
|------|-----------|---------------|
| `110` | Rooms | Rooms |
| `210` | Market Kitchen (main restaurant) | F&B |
| `211` | Jetty Restaurant & Bar | F&B |
| `212` | Infinity Bar | F&B |
| `213` | Baobab Bar | F&B |
| `300` | Spa | Spa |
| `510` | Transfers / Transport | Other Operated |
| `610` | General / Admin | Undistributed |

### Outlet Codes (Analysis Field 34)

| Code | Outlet | Used With |
|------|--------|-----------|
| `200` | Breakfast | Dept 210 |
| `201` | Lunch | Dept 210, 211 |
| `202` | Dinner | Dept 210, 211 |
| `204` | Pool/Snack | Dept 212 |

---

## 5. EZZCL — City Ledger File

### Purpose

The City Ledger file records **guest folio transfers to city ledger accounts** (Accounts Receivable). When guests check out and their balance is posted to a company/travel agent account rather than settled directly, these transactions appear here.

### Journal Type: `FIDEL` / Source: `FOICL`

### Transaction Pattern

```
DEBIT   11750           Guest-level detail lines (per folio)
CREDIT  12450           City Ledger control total (single or batched)
```

### Sample File Summary (30 August 2025)

| Metric | Value |
|--------|-------|
| Total lines | 13 |
| Debits | USD 4,623.530 (11 individual guest lines) |
| Credits | USD 4,623.530 (2 control lines) |
| **Balanced** | **Yes** |

### Account Mapping

| Code | Description | Type |
|------|-------------|------|
| `11750` | AR — Credit Card / City Ledger Receivables | Asset — AR |
| `12450` | City Ledger Control Account | Asset — AR Control |

### Guest Detail Lines

Each debit line represents one guest's city ledger posting:

| Reference | Guest Name | Amount (USD) |
|-----------|-----------|-------------|
| `1925` | Li, Jie (Room 153) | 84.000 |
| `1106` | Barbara (Room 9001) | 8.000 |
| `1105` | Franchesica (Room 9006) | 35.000 |
| — | Khaloun Marryum (Room 9015) | 178.000 |
| `1921` | Pagano, Mauro (Room 31) | 973.000 |
| `1108` | Ernesto (Room 9001) | 80.000 + 56.000 |
| — | Kouza, Christini (Room 21) | 1,742.000 |
| — | Mahlake, Rebotile (Room 56) | 348.000 |
| — | Rezyapov, Aidar (Room 54) | 80.000 |
| — | Li, Jun (Room 9019) | 1,039.530 |

**Note**: The Reference field contains the Opera folio number. The Description contains "Guest Name, Room Number" — useful for AR tracking and statement generation.

### Credit Control Lines

| Reference | Description | Amount (USD) |
|-----------|-------------|-------------|
| `CTLED` | City Ledger Debtors Control | 0 |
| `CTLED` | City Ledger CC Totals Control | 4,623.530 |

---

## 6. EZZMS — Market Statistics File

### Purpose

The Market Statistics file provides **revenue breakdown by market segment and rate code**. This is NOT a financial posting file — it records statistical data for revenue management and performance analysis.

### Journal Type: `FIDMS`

### Key Characteristics

- **Not balanced** — all lines are debits (statistical values, not GL postings)
- Account codes use `Z` prefix (statistical accounts, not real GL accounts)
- Each line represents revenue from one market segment for the business date
- The Reference field contains the rate/market code

### Sample File Summary (30 August 2025)

| Metric | Value |
|--------|-------|
| Total lines | 24 |
| All debits | USD 7,462.890 |
| Credits | USD 0 |
| **Balanced** | **No (statistical file)** |

### Market Segment Codes (Reference Field)

| Code | Market Segment | Description |
|------|---------------|-------------|
| `RAC` | Rack Rate | Walk-in / published rate |
| `PRO` | Promotion Rate | Discounted promotional rates |
| `OTA` | Online Travel Agent | Booking.com, Expedia, etc. |
| `DMC` | DMC Rates | Destination Management Company |
| `CHR` | Charter Rates | Charter/tour operator rates |
| `STO` | STO Rates | Special Tour Operator rates |
| `HOU` | House Use | Complimentary / house use |
| `EXP` | Expedia (deprecated) | "[Do Not Use] Expedia" |

### Statistical Account Codes

| Account | Description | Notes |
|---------|-------------|-------|
| `Z127` | Charter revenue | Revenue by market |
| `Z128` | DMC revenue | |
| `Z129` | OTA revenue | |
| `Z131` | House Use value | Room night value (non-revenue) |
| `Z132`–`Z134` | Rack Rate revenue | Multiple segments |
| `Z135`–`Z136` | House Use rooms | Count data |
| `Z139`–`Z142` | OTA/DMC detail | Sub-segments |
| `Z143`–`Z145` | STO revenue | |
| `Z148`–`Z150` | Promotion revenue | |
| `Z188`–`Z190` | Expedia (deprecated) | Marked "[Do Not Use]" |

### Usage in FinSys

Market Statistics should be imported into a **separate statistics ledger** (not the main GL). They feed:
- RevPAR calculations by market segment
- ADR analysis by rate code
- Market mix reports
- Revenue management dashboards

---

## 7. EZZDS — Daily Statistics File

### Purpose

The Daily Statistics file provides **operational metrics** from the night audit — occupancy, guest counts, arrivals, departures, and total room revenue. Like Market Statistics, this is NOT a financial posting file.

### Journal Type: `FIDST`

### Key Characteristics

- **Not balanced** — all lines are debits (statistical values)
- Account codes use `Z` prefix
- Each line is a single KPI metric for the business date
- Amounts represent counts (rooms, persons) or revenue totals

### Sample File Summary (30 August 2025)

| Metric | Value |
|--------|-------|
| Total lines | 10 |

### Statistical Metrics

| Account | Reference | Description | Value | Unit |
|---------|-----------|-------------|-------|------|
| `Z101` | `PHYSI` | Total Rooms in Hotel | 48 | rooms |
| `Z104` | `OCC_R` | Rooms Occupied | 26 | rooms |
| `Z105` | `ADULT` | In-House Adults | 51 | persons |
| `Z106` | `CHILD` | In-House Children | 7 | persons |
| `Z107` | `GUEST` | Total In-House Persons | 58 | persons |
| `Z109` | `HOUSE` | House Use Rooms | 1 | rooms |
| `Z111` | `ARRIV` | Arrival Rooms | 6 | rooms |
| `Z114` | `DEPAR` | Departure Persons | 10 | persons |
| `Z116` | `CANCE` | Reservation Cancellations | 5 | count |
| `Z950` | `ROOM_` | Room Revenue | 7,378.887 | USD |

### Derived KPIs (Calculated)

From the daily statistics, FinSys can calculate:

| KPI | Formula | Value (30 Aug) |
|-----|---------|----------------|
| **Occupancy Rate** | Rooms Occupied / Total Rooms | 26 / 48 = **54.2%** |
| **ADR** | Room Revenue / Rooms Occupied | 7,378.887 / 26 = **283.803** |
| **RevPAR** | Room Revenue / Total Rooms | 7,378.887 / 48 = **153.727** |
| **Double Occupancy** | Total Guests / Rooms Occupied | 58 / 26 = **2.23** |
| **GOPPAR** | Requires full P&L data | *calculated after all imports* |

---

## 8. FinSys Import Configuration

### Revenue File (EZZRV) — Posts to GL

```json
{
  "fileType": "opera_revenue",
  "format": "pipe_delimited_saf",
  "groupingStrategy": "single_entry",
  "autoPost": false,
  "sourceModule": "PMS",
  "descriptionPrefix": "Opera Night Audit",
  "accountMapping": {
    "30100": "<rooms-revenue-uuid>",
    "31100": "<food-revenue-uuid>",
    "31500": "<package-allocation-uuid>",
    "32100": "<beverage-revenue-uuid>",
    "34100": "<spa-revenue-uuid>",
    "36200": "<transfer-revenue-uuid>",
    "21300": "<tips-liability-uuid>",
    "23100": "<vat-liability-uuid>",
    "23200": "<infra-tax-liability-uuid>",
    "11600": "<cash-asset-uuid>",
    "11650": "<bank-transfer-uuid>",
    "11750": "<card-receivable-uuid>",
    "12500": "<guest-ledger-control-uuid>",
    "24100": "<deposit-ledger-uuid>"
  },
  "departmentMapping": {
    "110": "<rooms-dept-uuid>",
    "210": "<market-kitchen-dept-uuid>",
    "211": "<jetty-restaurant-uuid>",
    "212": "<infinity-bar-uuid>",
    "213": "<baobab-bar-uuid>",
    "300": "<spa-dept-uuid>",
    "510": "<transport-dept-uuid>",
    "610": "<admin-dept-uuid>"
  }
}
```

### City Ledger File (EZZCL) — Posts to GL + AR

```json
{
  "fileType": "opera_city_ledger",
  "format": "pipe_delimited_saf",
  "groupingStrategy": "single_entry",
  "autoPost": false,
  "sourceModule": "PMS",
  "descriptionPrefix": "Opera City Ledger",
  "accountMapping": {
    "11750": "<ar-city-ledger-uuid>",
    "12450": "<city-ledger-control-uuid>"
  },
  "createARInvoices": true,
  "arCustomerMapping": "by_folio_reference"
}
```

**Special handling**: Each debit line in the City Ledger file should also create an AR invoice in the Accounts Receivable module, linked to the guest/company by folio reference.

### Market Statistics (EZZMS) — Statistics Ledger

```json
{
  "fileType": "opera_market_stats",
  "format": "pipe_delimited_saf",
  "targetLedger": "statistics",
  "sourceModule": "PMS",
  "descriptionPrefix": "Opera Market Stats"
}
```

### Daily Statistics (EZZDS) — Statistics Ledger + KPIs

```json
{
  "fileType": "opera_daily_stats",
  "format": "pipe_delimited_saf",
  "targetLedger": "statistics",
  "sourceModule": "PMS",
  "descriptionPrefix": "Opera Daily Stats",
  "kpiExtraction": {
    "Z101": "total_rooms",
    "Z104": "rooms_occupied",
    "Z105": "adults_in_house",
    "Z106": "children_in_house",
    "Z107": "total_guests",
    "Z109": "house_use_rooms",
    "Z111": "arrival_rooms",
    "Z114": "departure_persons",
    "Z116": "cancellations",
    "Z950": "room_revenue"
  }
}
```

---

## 9. Import Priority & Sequence

The four Opera files should be imported in this order each day:

1. **EZZRV (Revenue)** — Posts all revenue and settlements to the GL
2. **EZZCL (City Ledger)** — Posts AR transfers and creates customer invoices
3. **EZZDS (Daily Statistics)** — Loads KPIs for the dashboard
4. **EZZMS (Market Statistics)** — Loads market segment breakdown

Revenue must come first because it establishes the day's GL balances. City Ledger may reference the same control accounts. Statistics are informational and can follow in any order.

---

## 10. Differences: Opera vs Jana SAF Files

| Aspect | Opera (.SUN) | Jana (.txt) |
|--------|-------------|-------------|
| Format | Pipe-delimited (`\|`) | Fixed-width (512 chars) |
| Delimiter | `\|` between fields | Character positions |
| File types | 4 files per night audit | 1 file per batch |
| Currency | USD | TZS |
| Journal Types | `FIDEL`, `FIDMS`, `FIDST` | `MFMCP` |
| Amount format | 15int + 3 implied decimal | Mixed (integer + explicit decimal) |
| Analysis codes | Dept in fields [32]–[34] | T0=VAT, T1=Dept |
| Account patterns | Numeric only (30100, 11750) | Numeric + alpha (CFIKI001) |
| Balanced | RV/CL: Yes, MS/DS: No | Always Yes |
| Vendor accounts | Not applicable (revenue focus) | Yes (creditor codes) |
| Statistics data | Separate files (MS/DS) | Not included |
| Package handling | Explicit reclass entries | Not applicable |

### Parser Requirement

FinSys must support **both** formats:
- **Fixed-width parser** (existing) — for Jana and classic SAF
- **Pipe-delimited parser** (new) — for Opera `.SUN` files

Detection: If the file contains `|` characters, use pipe-delimited parsing. Otherwise, use fixed-width.

---

## 11. Reconciliation Checklist

After importing Opera files, verify:

### Revenue File
- [ ] Journal entry total debits = credits
- [ ] Room revenue matches Opera room revenue report
- [ ] Cash/card settlements match front desk cashier summary
- [ ] VAT amount matches expected rate on taxable revenue
- [ ] Package allocations net to zero (debit + credit pairs cancel)
- [ ] Guest ledger balance matches Opera guest ledger trial balance

### City Ledger File
- [ ] Total city ledger transfers match Opera CL transfer report
- [ ] Individual guest amounts match folio balances
- [ ] AR invoices created for each guest line
- [ ] Control account (12450) balances with detail (11750)

### Daily Statistics
- [ ] Room count matches Opera occupancy report
- [ ] Room revenue (Z950) matches EZZRV room revenue total
- [ ] Occupancy % calculation is reasonable

---

*Document version: 1.0*
*Property: EZZ (Zanzibar)*
*Sample files: 30 August 2025 night audit*
*Opera PMS → Infor SunSystems → FinSys Hospitality*
