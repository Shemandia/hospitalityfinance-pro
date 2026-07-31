# STATISTICS IMPORT — Claude Code Implementation Guide

> **Sprint:** 4 (Statistics Import)
> **Depends on:** Sprint 3 (Transfer Desk foundation tables, BullMQ worker skeleton)
> **Spec:** HFP_Opera_Statistics_Import_v1.1.md

---

## CONTEXT

HFP needs to import non-financial statistical data from Opera PMS night audit exports (EZZDS and EZZMS `.SUN` files). These files use the same SAF pipe-delimited format as financial files (EZZRV, EZZCL) but post to `STATISTICS`-type accounts with zero GL impact.

The EZZ Chart of Accounts already has 147 statistics accounts under the `Z` root node. The account type `STATISTICS` is the HFP equivalent of SunSystems Memo accounts — excluded from trial balance, supports single-sided posting, and skips journal balance checks.

---

## TASK 1: Prisma Schema — Ensure STATISTICS Account Type

Check `packages/database/prisma/schema.prisma` (or wherever the tenant schema lives). The `account_type` enum must include `STATISTICS`. If it's missing, add it.

### Expected enum (6 values):

```prisma
enum AccountType {
  ASSET
  LIABILITY
  EQUITY
  REVENUE
  EXPENSE
  STATISTICS
}
```

If the COA model uses a `CHECK` constraint or `VARCHAR` instead of enum, ensure `STATISTICS` is a valid value.

**Verify:** The `coa_accounts` table's `account_type` column accepts `STATISTICS`.

---

## TASK 2: Migration — Add `stat_value` Column to `journal_lines`

Create a new migration that adds the `stat_value` column.

### SQL:

```sql
-- Migration: add_stat_value_to_journal_lines
ALTER TABLE journal_lines
  ADD COLUMN stat_value NUMERIC(18,3) DEFAULT NULL;

COMMENT ON COLUMN journal_lines.stat_value IS
  'Statistical value for STATISTICS-type account postings. Financial postings leave this NULL. For statistics imports: debit_amount=0, credit_amount=0, stat_value holds the parsed amount (÷1000 from SAF).';
```

### Prisma model update:

```prisma
model JournalLine {
  // ... existing fields ...
  statValue   Decimal?  @map("stat_value") @db.Decimal(18, 3)
}
```

---

## TASK 3: Journal Engine — Balance Check Override

Locate the journal posting/validation logic (likely in `packages/fsd-engine/` or a journal service). Modify the balance check to skip validation when ALL lines in a journal post to `STATISTICS`-type accounts.

### Logic:

```typescript
/**
 * Check if a journal is balanced.
 * Statistics-only journals skip balance validation entirely.
 * Mixed journals (statistics + financial) must balance on non-statistics lines.
 */
function isJournalBalanced(lines: JournalLine[]): boolean {
  const nonStatLines = lines.filter((line) => line.account.accountType !== "STATISTICS");

  // Statistics-only journal — always balanced
  if (nonStatLines.length === 0) {
    return true;
  }

  // Normal balance check on non-statistics lines only
  const totalDebit = nonStatLines.reduce((sum, l) => sum + (l.debitAmount ?? 0), 0);
  const totalCredit = nonStatLines.reduce((sum, l) => sum + (l.creditAmount ?? 0), 0);

  return Math.abs(totalDebit - totalCredit) < 0.01;
}
```

### Additional validation rules:

- A `STATISTICS` line CANNOT be the balancing entry for a non-`STATISTICS` line.
- `STATISTICS` accounts must NOT appear in trial balance, P&L, or balance sheet report queries. Add a filter: `WHERE account_type != 'STATISTICS'` to those queries.
- `STATISTICS` account type is immutable once transactions exist — enforce in the COA update endpoint.

---

## TASK 4: SAF Parser — Statistics File Support

The SAF parser should already exist for EZZRV/EZZCL files. Extend it to handle EZZDS and EZZMS files. The format is identical — the only differences are:

1. Journal type is `FIDST` (daily stats) or `FIDMS` (market segment stats)
2. Target accounts are `STATISTICS` type
3. DR/CR indicator is ignored (set debit_amount=0, credit_amount=0)
4. The parsed amount (÷1000) goes into `stat_value` instead of debit/credit

### SAF Column Positions (pipe-delimited, 0-indexed after split):

```typescript
interface SAFLine {
  accountCode: string; // [0] — trim whitespace, e.g. "Z104"
  period: string; // [1] — "YYYYPPP" e.g. "2025008"
  date: string; // [2] — "YYYYMMDD" e.g. "20250830"
  // [3],[4] — unused
  status: string; // [5] — "L" = posted
  amount: number; // [6] — 18-digit zero-padded, ÷1000
  drCr: string; // [7] — "D" or "C" (IGNORED for statistics)
  // [8] — unused
  journalType: string; // [9] — "FIDST" or "FIDMS"
  // [10] — unused
  statCode: string; // [11] — e.g. "OCC_R", "PRO", "RAC"
  description: string; // [12] — e.g. "Rooms Occupied"
  // [13]-[22] — unused analysis fields
  currency: string; // [23] — "USD"
  // [24] — unused
  amountDup: number; // [25] — duplicate of [6], can be used for validation
  businessUnit: string; // [26] — "EZZ"
  // [27]-[35] — T-Codes T2-T10 (unused in stats files)
}
```

### Parser function:

```typescript
function parseSAFLine(raw: string): SAFLine | null {
  // Skip empty/whitespace-only lines
  if (!raw.trim()) return null;

  const fields = raw.split("|");
  if (fields.length < 27) return null;

  const rawAmount = fields[6]?.trim();
  const amount = rawAmount ? parseInt(rawAmount, 10) / 1000 : 0;

  return {
    accountCode: fields[0]?.trim(),
    period: fields[1]?.trim(),
    date: fields[2]?.trim(),
    status: fields[5]?.trim(),
    amount,
    drCr: fields[7]?.trim(),
    journalType: fields[9]?.trim(),
    statCode: fields[11]?.trim(),
    description: fields[12]?.trim(),
    currency: fields[23]?.trim(),
    amountDup: parseInt(fields[25]?.trim() || "0", 10) / 1000,
    businessUnit: fields[26]?.trim()
  };
}
```

### Posting logic for statistics lines:

```typescript
function createStatisticsJournalLine(parsed: SAFLine) {
  return {
    accountCode: parsed.accountCode,
    period: parsed.period,
    transactionDate: parsed.date,
    journalType: parsed.journalType,
    debitAmount: 0, // Always zero for statistics
    creditAmount: 0, // Always zero for statistics
    statValue: parsed.amount, // The actual statistical value
    currency: parsed.currency,
    businessUnit: parsed.businessUnit,
    description: parsed.description,
    reference: parsed.statCode,
    status: "POSTED"
  };
}
```

---

## TASK 5: Transfer Desk Import Profiles

Create two import profile records (seed data or via the admin UI). These configure the Transfer Desk to recognise and process statistics files.

### Profile: OPERA-DS

```json
{
  "profileCode": "OPERA-DS",
  "profileName": "Opera PMS Daily Statistics",
  "profileType": "IMPORT",
  "filePattern": "EZZ*DS*.SUN",
  "format": "SAF",
  "delimiter": "|",
  "journalTypeFilter": "FIDST",
  "targetAccountType": "STATISTICS",
  "balanceCheck": false,
  "amountRule": "DIVIDE_1000",
  "drCrHandling": "IGNORE",
  "duplicateDetection": ["accountCode", "date", "period"],
  "duplicateAction": "OVERWRITE",
  "schedule": "DAILY",
  "sourceSystem": "OPERA_PMS",
  "active": true
}
```

### Profile: OPERA-MS

```json
{
  "profileCode": "OPERA-MS",
  "profileName": "Opera PMS Market Segment Statistics",
  "profileType": "IMPORT",
  "filePattern": "EZZ*MS*.SUN",
  "format": "SAF",
  "delimiter": "|",
  "journalTypeFilter": "FIDMS",
  "targetAccountType": "STATISTICS",
  "balanceCheck": false,
  "amountRule": "DIVIDE_1000",
  "drCrHandling": "IGNORE",
  "duplicateDetection": ["accountCode", "date", "period", "statCode"],
  "duplicateAction": "OVERWRITE",
  "schedule": "DAILY",
  "sourceSystem": "OPERA_PMS",
  "active": true
}
```

---

## TASK 6: Cross-Validation (Post-Import)

After both EZZDS and EZZMS files are imported for the same business date, run cross-validation:

```typescript
async function crossValidateStatistics(
  entityId: string,
  businessDate: string
): Promise<ValidationWarning[]> {
  const warnings: ValidationWarning[] = [];

  // Get EZZDS totals
  const dsOccR = await getStatValue(entityId, businessDate, "Z104"); // Rooms Occupied
  const dsGuest = await getStatValue(entityId, businessDate, "Z107"); // Total Guests
  const dsRoomRev = await getStatValue(entityId, businessDate, "Z950"); // Room Revenue stat

  // Get EZZMS totals — sum all active segment room night accounts
  const msRoomNightAccounts = [
    "Z133",
    "Z135",
    "Z137",
    "Z139",
    "Z141",
    "Z143",
    "Z146",
    "Z149",
    "Z154",
    "Z156",
    "Z159",
    "Z174",
    "Z180",
    "Z186",
    "Z192",
    "Z195",
    "Z211"
  ];
  const msGuestNightAccounts = [
    "Z134",
    "Z136",
    "Z138",
    "Z140",
    "Z142",
    "Z144",
    "Z147",
    "Z150",
    "Z155",
    "Z157",
    "Z160",
    "Z175",
    "Z181",
    "Z187",
    "Z193",
    "Z196",
    "Z212"
  ];
  const msRevenueAccounts = [
    "Z124",
    "Z126",
    "Z127",
    "Z128",
    "Z129",
    "Z130",
    "Z131",
    "Z132",
    "Z145",
    "Z148",
    "Z158",
    "Z173",
    "Z179",
    "Z185",
    "Z191",
    "Z194",
    "Z210"
  ];

  const msRoomNights = await sumStatValues(entityId, businessDate, msRoomNightAccounts);
  const msGuestNights = await sumStatValues(entityId, businessDate, msGuestNightAccounts);
  const msRevenue = await sumStatValues(entityId, businessDate, msRevenueAccounts);

  if (dsOccR !== null && Math.abs(dsOccR - msRoomNights) > 0.01) {
    warnings.push({
      type: "ROOM_NIGHTS_MISMATCH",
      message: `EZZDS room nights (${dsOccR}) != EZZMS sum (${msRoomNights})`,
      severity: "WARNING"
    });
  }

  if (dsGuest !== null && Math.abs(dsGuest - msGuestNights) > 0.01) {
    warnings.push({
      type: "GUEST_NIGHTS_MISMATCH",
      message: `EZZDS guest nights (${dsGuest}) != EZZMS sum (${msGuestNights})`,
      severity: "WARNING"
    });
  }

  if (dsRoomRev !== null && Math.abs(dsRoomRev - msRevenue) > 0.5) {
    warnings.push({
      type: "REVENUE_STAT_MISMATCH",
      message: `EZZDS revenue stat (${dsRoomRev}) != EZZMS sum (${msRevenue})`,
      severity: "WARNING"
    });
  }

  return warnings;
}
```

**Note:** These are warnings, not errors. Minor rounding differences (< 0.50 USD for revenue, < 0.01 for counts) are expected.

---

## TASK 7: Tests (Vitest)

Create test file at `packages/fsd-engine/src/__tests__/saf-statistics-parser.test.ts` (or appropriate location).

### Test data — embed these raw SAF lines:

```typescript
// EZZDS sample line
const EZZDS_SAMPLE = `Z104      |2025008|20250830|||L|000000000000026000|D||FIDST||OCC_R|Rooms Occupied           ||||||||||USD||000000000000026000|EZZ |     |     |     |     |     |     |     |     |     |`;

// EZZMS sample line
const EZZMS_SAMPLE = `Z132      |2025008|20250830|||L|000000000004231500|D||FIDMS||RAC  |Rack Rate                ||||||||||USD||000000000004231500|EZZ |     |     |     |     |     |     |     |     |     |`;

// Empty/blank line (first row of EZZDS files)
const BLANK_LINE = `       \r\n`;
```

### Test cases:

```typescript
describe("SAF Statistics Parser", () => {
  it("should parse EZZDS line correctly", () => {
    const result = parseSAFLine(EZZDS_SAMPLE);
    expect(result).not.toBeNull();
    expect(result!.accountCode).toBe("Z104");
    expect(result!.period).toBe("2025008");
    expect(result!.date).toBe("20250830");
    expect(result!.amount).toBe(26);
    expect(result!.journalType).toBe("FIDST");
    expect(result!.statCode).toBe("OCC_R");
    expect(result!.businessUnit).toBe("EZZ");
  });

  it("should parse EZZMS line correctly", () => {
    const result = parseSAFLine(EZZMS_SAMPLE);
    expect(result).not.toBeNull();
    expect(result!.accountCode).toBe("Z132");
    expect(result!.amount).toBe(4231.5);
    expect(result!.journalType).toBe("FIDMS");
    expect(result!.statCode).toBe("RAC");
  });

  it("should skip blank lines", () => {
    const result = parseSAFLine(BLANK_LINE);
    expect(result).toBeNull();
  });

  it("should apply ÷1000 correctly to integer counts", () => {
    const result = parseSAFLine(EZZDS_SAMPLE);
    expect(result!.amount).toBe(26); // 26000 / 1000
  });

  it("should apply ÷1000 correctly to decimal amounts", () => {
    const line = `Z950      |2025008|20250830|||L|000000000007378887|D||FIDST||ROOM_|Room Revenue             ||||||||||USD||000000000007378887|EZZ |     |     |     |     |     |     |     |     |     |`;
    const result = parseSAFLine(line);
    expect(result!.amount).toBeCloseTo(7378.887, 3);
  });

  it("should validate amount field matches duplicate field", () => {
    const result = parseSAFLine(EZZDS_SAMPLE);
    expect(result!.amount).toBe(result!.amountDup);
  });
});

describe("Statistics Journal Posting", () => {
  it("should create journal line with zero DR/CR and stat_value", () => {
    const parsed = parseSAFLine(EZZDS_SAMPLE)!;
    const line = createStatisticsJournalLine(parsed);
    expect(line.debitAmount).toBe(0);
    expect(line.creditAmount).toBe(0);
    expect(line.statValue).toBe(26);
  });
});

describe("Journal Balance Check", () => {
  it("should pass for statistics-only journal", () => {
    const lines = [
      { account: { accountType: "STATISTICS" }, debitAmount: 0, creditAmount: 0 },
      { account: { accountType: "STATISTICS" }, debitAmount: 0, creditAmount: 0 }
    ];
    expect(isJournalBalanced(lines)).toBe(true);
  });

  it("should check balance only on non-statistics lines in mixed journal", () => {
    const lines = [
      { account: { accountType: "REVENUE" }, debitAmount: 0, creditAmount: 100 },
      { account: { accountType: "ASSET" }, debitAmount: 100, creditAmount: 0 },
      { account: { accountType: "STATISTICS" }, debitAmount: 0, creditAmount: 0 }
    ];
    expect(isJournalBalanced(lines)).toBe(true);
  });

  it("should fail if non-statistics lines are unbalanced", () => {
    const lines = [
      { account: { accountType: "REVENUE" }, debitAmount: 0, creditAmount: 100 },
      { account: { accountType: "ASSET" }, debitAmount: 50, creditAmount: 0 },
      { account: { accountType: "STATISTICS" }, debitAmount: 0, creditAmount: 0 }
    ];
    expect(isJournalBalanced(lines)).toBe(false);
  });
});
```

---

## SAMPLE FILES FOR TESTING

### EZZDS20250830.SUN (10 lines, Daily Statistics)

```

Z148      |2025008|20250830|||L|000000000000574780|D||FIDMS||PRO  |Promotion Rate           ||||||||||USD||000000000000574780|EZZ |     |     |     |     |     |     |     |     |     |
Z950      |2025008|20250830|||L|000000000007378887|D||FIDST||ROOM_|Room Revenue             ||||||||||USD||000000000007378887|||||||EZZ |     |     |     |     |     |     |     |     |     |
Z116      |2025008|20250830|||L|000000000000005000|D||FIDST||CANCE|Reservation Cancellations||||||||||USD||000000000000005000|||||||EZZ |     |     |     |     |     |     |     |     |     |
Z111      |2025008|20250830|||L|000000000000006000|D||FIDST||ARRIV|Arrival Rooms            ||||||||||USD||000000000000006000|||||||EZZ |     |     |     |     |     |     |     |     |     |
Z104      |2025008|20250830|||L|000000000000026000|D||FIDST||OCC_R|Rooms Occupied           ||||||||||USD||000000000000026000|||||||EZZ |     |     |     |     |     |     |     |     |     |
Z105      |2025008|20250830|||L|000000000000051000|D||FIDST||ADULT|In-House Adults          ||||||||||USD||000000000000051000|||||||EZZ |     |     |     |     |     |     |     |     |     |
Z101      |2025008|20250830|||L|000000000000048000|D||FIDST||PHYSI|Total Rooms in Hotel     ||||||||||USD||000000000000048000|||||||EZZ |     |     |     |     |     |     |     |     |     |
Z106      |2025008|20250830|||L|000000000000007000|D||FIDST||CHILD|In-House Children        ||||||||||USD||000000000000007000|||||||EZZ |     |     |     |     |     |     |     |     |     |
Z109      |2025008|20250830|||L|000000000000001000|D||FIDST||HOUSE|House Use Rooms          ||||||||||USD||000000000000001000|||||||EZZ |     |     |     |     |     |     |     |     |     |
Z107      |2025008|20250830|||L|000000000000058000|D||FIDST||GUEST|Total In-House Persons   ||||||||||USD||000000000000058000|||||||EZZ |     |     |     |     |     |     |     |     |     |
Z114      |2025008|20250830|||L|000000000000010000|D||FIDST||DEPAR|Departure Persons        ||||||||||USD||000000000000010000|||||||EZZ |     |     |     |     |     |     |     |     |     |
```

### EZZMS20250830.SUN (24 lines, Market Segment Statistics — 8 segments × 3 rows each)

```
Z148      |2025008|20250830|||L|000000000000574780|D||FIDMS||PRO  |Promotion Rate           ||||||||||USD||000000000000574780|EZZ |     |     |     |     |     |     |     |     |     |
Z149      |2025008|20250830|||L|000000000000002000|D||FIDMS||PRO  |Promotion Rate           ||||||||||USD||000000000000002000|EZZ |     |     |     |     |     |     |     |     |     |
Z150      |2025008|20250830|||L|000000000000004000|D||FIDMS||PRO  |Promotion Rate           ||||||||||USD||000000000000004000|EZZ |     |     |     |     |     |     |     |     |     |
Z188      |2025008|20250830|||L|000000000000253300|D||FIDMS||EXP  |[Do Not Use] Expedia     ||||||||||USD||000000000000253300|EZZ |     |     |     |     |     |     |     |     |     |
Z189      |2025008|20250830|||L|000000000000001000|D||FIDMS||EXP  |[Do Not Use] Expedia     ||||||||||USD||000000000000001000|EZZ |     |     |     |     |     |     |     |     |     |
Z190      |2025008|20250830|||L|000000000000003000|D||FIDMS||EXP  |[Do Not Use] Expedia     ||||||||||USD||000000000000003000|EZZ |     |     |     |     |     |     |     |     |     |
Z145      |2025008|20250830|||L|000000000000446960|D||FIDMS||STO  |STO Rates                ||||||||||USD||000000000000446960|EZZ |     |     |     |     |     |     |     |     |     |
Z143      |2025008|20250830|||L|000000000000001000|D||FIDMS||STO  |STO Rates                ||||||||||USD||000000000000001000|EZZ |     |     |     |     |     |     |     |     |     |
Z144      |2025008|20250830|||L|000000000000002000|D||FIDMS||STO  |STO Rates                ||||||||||USD||000000000000002000|EZZ |     |     |     |     |     |     |     |     |     |
Z127      |2025008|20250830|||L|000000000000656700|D||FIDMS||CHR  |Charter Rates            ||||||||||USD||000000000000656700|EZZ |     |     |     |     |     |     |     |     |     |
Z154      |2025008|20250830|||L|000000000000003000|D||FIDMS||CHR  |Charter Rates            ||||||||||USD||000000000000003000|EZZ |     |     |     |     |     |     |     |     |     |
Z155      |2025008|20250830|||L|000000000000007000|D||FIDMS||CHR  |Charter Rates            ||||||||||USD||000000000000007000|EZZ |     |     |     |     |     |     |     |     |     |
Z128      |2025008|20250830|||L|000000000000537220|D||FIDMS||DMC  |DMC Rates                ||||||||||USD||000000000000537220|EZZ |     |     |     |     |     |     |     |     |     |
Z141      |2025008|20250830|||L|000000000000002000|D||FIDMS||DMC  |DMC Rates                ||||||||||USD||000000000000002000|EZZ |     |     |     |     |     |     |     |     |     |
Z142      |2025008|20250830|||L|000000000000006000|D||FIDMS||DMC  |DMC Rates                ||||||||||USD||000000000000006000|EZZ |     |     |     |     |     |     |     |     |     |
Z129      |2025008|20250830|||L|000000000000678430|D||FIDMS||OTA  |Online Travel Agent      ||||||||||USD||000000000000678430|EZZ |     |     |     |     |     |     |     |     |     |
Z139      |2025008|20250830|||L|000000000000003000|D||FIDMS||OTA  |Online Travel Agent      ||||||||||USD||000000000000003000|EZZ |     |     |     |     |     |     |     |     |     |
Z140      |2025008|20250830|||L|000000000000007000|D||FIDMS||OTA  |Online Travel Agent      ||||||||||USD||000000000000007000|EZZ |     |     |     |     |     |     |     |     |     |
Z131      |2025008|20250830|||L|000000000000000000|D||FIDMS||HOU  |House Use                ||||||||||USD||000000000000000000|EZZ |     |     |     |     |     |     |     |     |     |
Z135      |2025008|20250830|||L|000000000000001000|D||FIDMS||HOU  |House Use                ||||||||||USD||000000000000001000|EZZ |     |     |     |     |     |     |     |     |     |
Z136      |2025008|20250830|||L|000000000000001000|D||FIDMS||HOU  |House Use                ||||||||||USD||000000000000001000|EZZ |     |     |     |     |     |     |     |     |     |
Z132      |2025008|20250830|||L|000000000004231500|D||FIDMS||RAC  |Rack Rate                ||||||||||USD||000000000004231500|EZZ |     |     |     |     |     |     |     |     |     |
Z133      |2025008|20250830|||L|000000000000013000|D||FIDMS||RAC  |Rack Rate                ||||||||||USD||000000000000013000|EZZ |     |     |     |     |     |     |     |     |     |
Z134      |2025008|20250830|||L|000000000000028000|D||FIDMS||RAC  |Rack Rate                ||||||||||USD||000000000000028000|EZZ |     |     |     |     |     |     |     |     |     |
```

---

## IMPLEMENTATION ORDER

1. **Task 1** — Verify/add `STATISTICS` to account type enum in Prisma schema
2. **Task 2** — Create migration for `stat_value` column
3. **Task 3** — Modify journal balance check logic
4. **Task 4** — Implement/extend SAF parser for statistics files
5. **Task 5** — Seed Transfer Desk import profiles (OPERA-DS, OPERA-MS)
6. **Task 7** — Write Vitest tests using sample data
7. **Task 6** — Cross-validation (can be deferred to next sprint if needed)

---

## KEY RULES

- **÷1000**: ALL amounts in SAF files must be divided by 1000. This applies to both financial and statistical files.
- **Zero DR/CR**: Statistics lines always have `debit_amount = 0`, `credit_amount = 0`. The statistical value goes in `stat_value`.
- **Single-sided posting**: Statistics journals don't need to balance. The journal engine must skip balance checks for statistics-only journals.
- **Account type immutability**: Once a `STATISTICS` account has transactions, its type cannot be changed.
- **Blank first line**: EZZDS files may start with a blank/whitespace-only line. The parser must skip it.
- **CRLF line endings**: SAF files use `\r\n`. The parser must handle this.
- **Field padding**: All fields are whitespace-padded. Always `.trim()` after splitting on `|`.

---

## EXPECTED OUTCOMES

After implementation:

1. `npx prisma migrate dev` runs clean with `stat_value` column added
2. SAF parser correctly parses both EZZDS and EZZMS sample files
3. Statistics lines post with `debit_amount=0`, `credit_amount=0`, `stat_value=<parsed>`
4. Journal balance check passes for statistics-only journals
5. All Vitest tests pass
6. Transfer Desk profiles OPERA-DS and OPERA-MS exist in seed data
