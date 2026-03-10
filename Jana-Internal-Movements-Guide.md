# Jana Internal Movements (Store Issues) Integration Guide

## Importing Store Issue Vouchers into FinSys Hospitality

---

## 1. Overview

Jana Internal Movements files record the **transfer of goods from central stores to consuming departments**. This is the cost-of-sales recognition step in the hospitality inventory cycle — when food, beverages, or supplies leave the store and are charged to the department that consumed them.

These files are generated after store issue vouchers are processed and approved in Jana's materials management module.

### Where This Fits in the Inventory Cycle

```
STEP 1: Purchasing (Jana-IN)          STEP 2: Store Issue (Jana-CO)
  Vendor delivers goods                  Goods issued from store to kitchen
  DR  Inventory (13050)                  CR  Inventory (13050)
  CR  Vendor (CFIKI001)                  DR  Cost of Food (42100)
          ↓                                        ↓
    Stock increases                          Stock decreases
    AP liability created                     Expense recognized in department
```

The purchasing file increases inventory. The internal movements file **decreases inventory and recognizes the cost** in the consuming department's P&L.

---

## 2. File Characteristics

| Property | Value |
|----------|-------|
| Format | SunAccount SAF (fixed-width text, 512 chars per line) |
| File prefix | `Jana-CO-Internal_Movements` |
| File naming | `Jana-CO-Internal_Movements-{DDMMHHMM}.txt` |
| Record Type | `M` (extended analysis codes) |
| Journal Type (pos 68–72) | *(blank)* |
| Journal Source (pos 73–77) | `MCTRF` (Materials Cost Transfer) |
| Amount format | **÷ 1000** (standard SAF: 3 implied decimal places) |
| Currency | TZS |
| Balanced | Yes — debits always equal credits |

---

## 3. Amount Parsing

Internal movement files use the **standard SAF format**: 15 integer + 3 implied decimal digits. Divide by 1,000.

```
000000000571467040 → 571,467.040
000000000011717550 →  11,717.550
000000000391564400 → 391,564.400
```

**This differs from Jana Purchasing** (`MFMCP`), which uses whole integers. Detection:

| Journal Type | Journal Source | Amount Rule |
|-------------|--------------|-------------|
| `MFMCP` | *(blank)* | Whole integer (purchasing) |
| *(blank)* | `MCTRF` | ÷ 1000 (internal movements) |

---

## 4. Transaction Pattern

Each store issue generates a balanced set of entries:

**Credit side** — Inventory accounts decrease (goods leave the store):

```
CREDIT  13050   571,467.040   Food Inventory — Central Store
CREDIT  13200    11,717.550   Cleaning Supplies Inventory
```

**Debit side** — Departmental cost accounts increase (expense recognized):

```
DEBIT   42100   391,564.400   Cost of Food — Main Kitchen
DEBIT   51450   179,902.640   Staff Dining — Food Cost
DEBIT   61350    11,717.550   Cleaning Materials — Main Kitchen
```

The total stock reduction always equals the total cost charged to departments.

---

## 5. Account Mapping

### Credit Side — Inventory Accounts (Stock Reduction)

| Code | Description | Account Type | USALI Category |
|------|-------------|-------------|---------------|
| `13050` | Food Inventory — Central Store | Asset (Inventory) | Current Assets |
| `13200` | Cleaning Supplies Inventory | Asset (Inventory) | Current Assets |

These are the same inventory accounts that get **debited** in purchasing files when goods arrive. Internal movements **credit** them to reduce the stock balance.

### Debit Side — Cost / Consumption Accounts

| Code | Description | Account Type | USALI Category | Dept |
|------|-------------|-------------|---------------|------|
| `42100` | Cost of Food Consumed | Expense | F&B — Food Cost | 210 (Kitchen) |
| `51450` | Staff Dining — Food Cost | Expense | A&G — Staff Costs | 640 (Staff Dining) |
| `61350` | Cleaning Materials Used | Expense | POM — Cleaning | 210 (Kitchen) |

---

## 6. Analysis Codes

Internal movement files use Record Type `M` and populate **T0 with the department code** of the issuing or receiving location.

| T0 Value | Department | Role |
|----------|-----------|------|
| `610` | F&B Central Store | Issuing store (on credit/inventory lines) |
| `210` | Main Kitchen | Receiving department (on debit/cost lines) |
| `640` | Staff Dining | Receiving department (on debit/cost lines) |

**Important**: In internal movements, T0 = department code. In purchasing files, T0 = VAT rate. The parser must check the Journal Source field to interpret T0 correctly.

T1–T9 are not used in internal movement files.

### Reference & Description Fields

| Field | Content | Example |
|-------|---------|---------|
| Transaction Reference (pos 78–92) | Store or department name | `Main Central St`, `Main Kitchen`, `Staff Dining` |
| Description (pos 93–117) | Prefixed location identifier | `FBMCO-Main Central Store`, `FBMCO-Main Kitchen` |

The `FBMCO` prefix stands for F&B Materials Cost Output.

---

## 7. Sample File

Source: `Jana-CO-Internal_Movements-08030803.txt` — 8 March 2026, Period 2026003

| Account | D/C | Amount (TZS) | Reference | Department |
|---------|-----|-------------|-----------|-----------|
| 13050 | CR | 571,467.040 | Main Central Store | 610 (Central Store) |
| 13200 | CR | 11,717.550 | Main Central Store | 610 (Central Store) |
| 42100 | DR | 391,564.400 | Main Kitchen | 210 (Kitchen) |
| 51450 | DR | 179,902.640 | Staff Dining | 640 (Staff Dining) |
| 61350 | DR | 11,717.550 | Main Kitchen | 210 (Kitchen) |

| Metric | Value |
|--------|-------|
| Total lines | 5 |
| Total debits | TZS 583,184.590 |
| Total credits | TZS 583,184.590 |
| **Balanced** | **Yes** |

---

## 8. FinSys Import Configuration

```json
{
  "fileType": "jana_internal_movements",
  "format": "fixed_width_saf",
  "amountRule": "divide_by_1000",
  "groupingStrategy": "single_entry",
  "autoPost": false,
  "sourceModule": "PROC",
  "descriptionPrefix": "Jana Store Issue",
  "departmentMapping": {
    "210": "<kitchen-dept-uuid>",
    "610": "<fb-central-store-uuid>",
    "640": "<staff-dining-dept-uuid>"
  }
}
```

### Detection During Import

When the parser encounters a fixed-width SAF file:

1. Check Journal Source (pos 73–77) for `MCTRF` → Internal Movements
2. Apply ÷1000 amount parsing
3. Interpret T0 as department code (not VAT rate)

---

## 9. Reconciliation

After importing, verify:

- Journal entry total matches Jana store issue batch total
- Inventory account credits match the stock movement report in Jana
- Departmental cost debits align with kitchen requisition summaries
- Food inventory balance (13050) decreases by the credited amount
- Month-end inventory count reconciles with the GL balance after all issues are posted

### Common Issues

| Issue | Cause | Resolution |
|-------|-------|------------|
| Inventory account balance goes negative | Issues exceed purchases for the period | Check for missing purchasing imports |
| Department cost seems too high | Bulk issue for month-end or event | Verify against Jana requisition detail |
| Amount looks 1000x too large | Wrong parsing rule applied | Confirm Journal Source = `MCTRF` → use ÷1000 |

---

*Document version: 1.0*
*System: Sky Jana → FinSys Hospitality*
*Transaction type: Store Issues / Internal Cost Transfers*
*Sample: Jana-CO-Internal_Movements-08030803.txt*
