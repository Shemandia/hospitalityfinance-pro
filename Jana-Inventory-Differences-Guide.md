# Jana Inventory Differences Integration Guide

## Importing Stock Variance Journals into FinSys Hospitality

---

## 1. Overview

Jana Inventory Differences files record **stock variances** — the adjustments made when a physical inventory count reveals discrepancies between the system's recorded stock levels and the actual quantities on hand. These variances are posted as journal entries to adjust inventory balances and recognize the gain or loss.

Inventory differences arise from:

- **Spoilage / wastage** — food past its shelf life, broken items
- **Shrinkage / theft** — unaccounted-for stock losses
- **Counting errors** — corrections from prior counts
- **Positive variances** — more stock found than expected (rare)
- **Unit-of-measure discrepancies** — conversion differences during receiving

### Where This Fits in the Inventory Cycle

```
STEP 1: Purchasing        STEP 2: Store Issue        STEP 3: Inventory Count
  (Jana-IN)                 (Jana-CO)                  (Jana-CO or similar)

  Goods received             Goods issued to            Physical count vs system
  DR Inventory               kitchen/departments        → Variance journal
  CR Vendor                  CR Inventory               DR/CR Inventory
                             DR Cost of Sales           CR/DR Variance Expense
```

Inventory differences are typically processed after a physical stocktake (monthly, weekly, or ad-hoc) and represent the **third and final step** in the inventory control cycle.

---

## 2. File Characteristics

| Property | Value |
|----------|-------|
| Format | SunAccount SAF (fixed-width text, 512 chars per line) |
| File prefix | `Jana-CO-Inventory_Differences` (or similar) |
| Record Type | `M` (extended analysis codes) |
| Journal Type (pos 68–72) | *(blank)* |
| Journal Source (pos 73–77) | `MCTRF` (Materials Cost Transfer) |
| Amount format | **÷ 1000** (standard SAF: 3 implied decimal places) |
| Currency | TZS |
| Balanced | Yes — debits always equal credits |

The file format is **identical** to Internal Movements (store issues). The difference is purely the business meaning of the accounts and the context of when the file is generated.

---

## 3. Amount Parsing

Same rule as Internal Movements — **standard SAF format**, divide by 1,000:

```
000000000012500000 → 12,500.000
000000000000345670 →    345.670
```

Detection: Journal Source = `MCTRF` → apply ÷1000.

---

## 4. Transaction Patterns

### Stock Loss (Negative Variance — Most Common)

When the physical count is **less** than the system balance, the difference is a loss:

```
CREDIT  13050   12,500.000   Food Inventory (reduce stock to match count)
DEBIT   52100   12,500.000   Inventory Variance — Food (recognize the loss)
```

The inventory asset decreases, and the loss is charged to a variance expense account in the P&L.

### Stock Gain (Positive Variance — Less Common)

When the physical count is **more** than the system balance:

```
DEBIT   13050    1,200.000   Food Inventory (increase stock to match count)
CREDIT  52100    1,200.000   Inventory Variance — Food (recognize the gain)
```

The inventory asset increases, and the gain reduces the variance expense.

### Mixed Variance (Multiple Items)

A stocktake typically produces a single file with variances across many items and categories:

```
CREDIT  13050   45,000.000   Food Inventory loss (multiple items)
CREDIT  13200    3,500.000   Beverage Inventory loss
DEBIT   13050    2,000.000   Food Inventory gain (some items over)
DEBIT   52100   43,000.000   Food Variance Expense (net food loss)
DEBIT   52200    3,500.000   Beverage Variance Expense (net bev loss)
CREDIT  52100    2,000.000   Food Variance offset (for the gain items)
```

The key principle: **total debits = total credits**, and the net effect adjusts inventory to match the physical count.

---

## 5. Account Mapping

### Inventory Accounts (Adjusted to Match Physical Count)

| Code | Description | Account Type | Direction |
|------|-------------|-------------|-----------|
| `13050` | Food Inventory | Asset (Inventory) | CR for loss, DR for gain |
| `13100` | Beverage Inventory | Asset (Inventory) | CR for loss, DR for gain |
| `13200` | Cleaning Supplies Inventory | Asset (Inventory) | CR for loss, DR for gain |
| `13250` | Guest Supplies Inventory | Asset (Inventory) | CR for loss, DR for gain |
| `13300` | Engineering Supplies Inventory | Asset (Inventory) | CR for loss, DR for gain |

### Variance Expense Accounts

| Code | Description | USALI Category | Dept |
|------|-------------|---------------|------|
| `52100` | Inventory Variance — Food | F&B — Food Cost | 210/610 |
| `52200` | Inventory Variance — Beverage | F&B — Beverage Cost | 210/610 |
| `62100` | Inventory Variance — Supplies | POM — Supplies | 800 |

**Note**: The exact account codes for variance expense will depend on your property's Chart of Accounts configuration in Jana. The pattern is consistent — inventory accounts paired with corresponding variance expense accounts.

---

## 6. Analysis Codes

Identical to Internal Movements:

| Field | Content | Usage |
|-------|---------|-------|
| T0 (pos 242–256) | Department code | `610` = Central Store, `210` = Kitchen |
| T1–T9 | *(not used)* | |
| Reference (pos 78–92) | Store/location name | `Main Central St`, `F&B Store` |
| Description (pos 93–117) | Prefixed identifier | `FBMCO-` prefix + location |

**Reminder**: T0 = department code in `MCTRF` files, NOT VAT rate.

---

## 7. Distinguishing from Internal Movements

Since both file types use the same Journal Source (`MCTRF`) and identical SAF format, distinguishing them requires looking at the business context:

| Aspect | Internal Movements | Inventory Differences |
|--------|-------------------|----------------------|
| **When generated** | Daily/per-requisition (routine) | After physical stocktake (periodic) |
| **File prefix** | `Jana-CO-Internal_Movements` | `Jana-CO-Inventory_Differences` |
| **Credit accounts** | Always inventory (stock out) | Inventory (loss) or variance (gain) |
| **Debit accounts** | Always cost/expense (consumption) | Variance expense (loss) or inventory (gain) |
| **Frequency** | Daily | Monthly or per-count |
| **Volume** | Many lines (all daily issues) | Fewer lines (only variances) |
| **Business meaning** | Planned consumption | Unplanned loss/gain |

### Detection Strategy for FinSys

1. **Primary**: Use the filename prefix (`Internal_Movements` vs `Inventory_Differences`)
2. **Secondary**: Check account patterns — if both debit and credit hit inventory accounts (13xxx), it's likely a variance file
3. **Manual**: Let the user select the file type during upload

---

## 8. FinSys Import Configuration

```json
{
  "fileType": "jana_inventory_differences",
  "format": "fixed_width_saf",
  "amountRule": "divide_by_1000",
  "groupingStrategy": "single_entry",
  "autoPost": false,
  "sourceModule": "PROC",
  "descriptionPrefix": "Jana Stock Variance",
  "departmentMapping": {
    "210": "<kitchen-dept-uuid>",
    "610": "<fb-central-store-uuid>",
    "640": "<staff-dining-dept-uuid>",
    "800": "<pom-dept-uuid>"
  }
}
```

---

## 9. Operational Workflow

### Monthly Stocktake Process

```
1. Physical inventory count performed at property stores
2. Jana compares count quantities against system balances
3. Variances identified and approved by F&B Controller / Finance Manager
4. Jana generates SAF file with variance journal entries
5. Finance uploads to FinSys → Preview validates balance and accounts
6. Journal entry created in Draft status
7. Finance Manager reviews variance report:
   - Large variances flagged for investigation
   - Approved variances posted to GL
8. Inventory GL balance now matches physical count
```

### Variance Analysis

After importing, finance should review:

- **Total variance by category** — food vs beverage vs supplies
- **Variance as % of consumption** — flag if above threshold (e.g. >2% for food)
- **Trend analysis** — is variance increasing month-over-month?
- **Large individual items** — investigate any single-item variances above threshold
- **Gain variances** — unusual gains may indicate prior miscounting or receiving errors

### Reporting Integration

Inventory variances should appear in the USALI P&L as a separate line within departmental costs:

```
F&B Department
  Food Revenue                    1,200,000
  Cost of Food Consumed            (480,000)    ← from Internal Movements
  Food Inventory Variance           (12,500)    ← from Inventory Differences
  Gross Food Profit                 707,500
```

---

## 10. Reconciliation Checklist

After importing inventory difference files:

- [ ] Journal entry total matches Jana variance report total
- [ ] Net inventory adjustment (CR - DR on 13xxx accounts) matches the count difference
- [ ] Variance expense accounts reflect the correct departments
- [ ] GL inventory balance after posting matches the physical count value
- [ ] Variance is reasonable relative to total consumption for the period
- [ ] Any gains are investigated and documented
- [ ] Month-end inventory valuation ties to balance sheet

---

*Document version: 1.0*
*System: Sky Jana → FinSys Hospitality*
*Transaction type: Inventory Variances / Stock Differences*
*File format: Identical to Jana Internal Movements (MCTRF, ÷1000)*
