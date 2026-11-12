# WP-U design note: unified ledger

Status: design decisions approved by the owner on 12 November 2026 (section 1). No code has been written, and none starts until WP-A and WP-2 are merged.
Source: section 11 of the remediation brief (decision of 12 November 2026).
Written against the schema and code on branch `wp-a/access-control`.

This note covers the three things section 11 asks for before code:

1. The final schema (section 2).
2. The migration mapping for every existing payables, receivables and budget table (section 3).
3. The reports and screens whose source changes (section 4).

Section 1 records the owner's decisions. Section 5 lists what this note found that section 11 did not cover.

---

## 1. Decisions

Approved by the owner on 12 November 2026. Where section 11 of the brief says otherwise, these apply.

| #   | Decision                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Line amounts stay as a debit and credit pair per currency. The functional pair is renamed base; a reporting pair is added.                                                                  |
| D2  | History moves in place. The control-account line of each posted invoice, payment and receipt is re-pointed to the supplier's or customer's own account, and period balances are recomputed. |
| D3  | The supplier or customer code becomes the account code, behind a tenant prefix that is on by default. The migration stops and lists collisions instead of renaming.                         |
| D4  | A part-allocated line is split in two, and each part keeps a link to the original line. There is no `part-allocated` marker.                                                                |
| D5  | Each ledger has a must-balance setting. Ledger A always balances; the database refuses to turn the setting off for it. Budget and forecast ledgers need not balance.                        |
| D6  | A document's approval state is stored once, on its journal.                                                                                                                                 |
| D7  | Only posted lines are paid and revalued. An approved, unposted invoice is a held posting: visible in enquiry, absent from statements, not payable.                                          |
| D8  | ACC-02, ACC-04, ACC-05 and ACC-08 move from WP-3 into WP-U. ACC-02 is done first.                                                                                                           |
| D9  | A change to a supplier's or customer's bank details takes effect only after a second person approves it, and every request, approval and rejection is audited.                              |

---

## 2. Final schema

Terms used below:

- **Counterparty account**: an account of kind creditor, debtor or client.
- **Open line**: a posted line on an allocation-enabled account whose marker is not allocated or paid.
- **Header account**: the former control account, kept as a non-posting parent of the counterparty accounts.

### 2.1 Changed tables

**`Account`**

| Change                    | Detail                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add `accountKind`         | `GENERAL`, `CREDITOR`, `DEBTOR`, `CLIENT`, `BANK`, `MEMO`. Required. A structural classification the posting and allocation rules depend on, so an enum. |
| Add `allocationEnabled`   | True for every counterparty account; may be set on a general account (clearing, suspense). Lines on these accounts carry an allocation marker.           |
| Remove `isControlAccount` | No control accounts in this model. 21 references in code go with it.                                                                                     |
| Keep                      | `type`, `accountTypeDefId`, `normalBalance`, `allowPosting`, `allowedSources`, `parentId`, `level`, the USALI fields.                                    |

**`Journal`**

| Change                                  | Detail                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Add `ledgerId`                          | Required. Foreign key to `Ledger` (2.2).                                                                                  |
| Add `documentDate`                      | Date, required (ACC-01). Drives the period and the rate date.                                                             |
| Add `sourceSystem`, `sourceDocumentRef` | Unique on entity, source system and reference where both are set (section 5 of the brief).                                |
| Add `postingState`                      | `NONE`, `HELD`, `POSTED`. Says whether the journal's lines count in the ledger. `status` stays for the approval workflow. |
| Rename `functionalCurrency`             | To `baseCurrency`.                                                                                                        |
| Keep `source`                           | The internal origin enum stays until WP-4 folds it into `sourceSystem`.                                                   |

How `status` and `postingState` relate:

| `status`                                         | `postingState`                   |
| ------------------------------------------------ | -------------------------------- |
| Draft, pending approval, returned, voided        | `NONE`                           |
| Posted, reversed                                 | `POSTED`                         |
| Posted provisionally, awaiting release           | `HELD` (new status value `HELD`) |
| Approved, awaiting posting (entry documents, D7) | `HELD`                           |

Approving an entry document makes its journal a held posting; posting it is the release. Where a ledger's settings prohibit held postings, approval posts directly.

Journal numbers are assigned inside the posting transaction, with the year taken from the fiscal calendar, and are unique per entity, journal type and number (ACC-05).

**`JournalLine`**

| Change                                                   | Detail                                                                                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rename `fxRate`                                          | To `baseRate`.                                                                                                                                                                                                     |
| Rename `debitFunctional`, `creditFunctional`             | To `debitBase`, `creditBase`.                                                                                                                                                                                      |
| Add `reportingRate`, `debitReporting`, `creditReporting` | Third currency amount.                                                                                                                                                                                             |
| Add `transactionDate`, `dueDate`                         | Dates. `dueDate` is required on a line on a counterparty account.                                                                                                                                                  |
| Add `transactionReference`, `secondReference`            | Invoice number or payment reference; purchase order or remittance reference.                                                                                                                                       |
| Add `allocationMarker`                                   | `UNALLOCATED`, `ALLOCATED`, `PAID`, `WITHHELD`, `IN_DISPUTE`. Null on accounts that are not allocation-enabled.                                                                                                    |
| Add `allocationId`, `allocationDate`, `allocatedById`    | `allocationId` is the allocation reference: a foreign key to `Allocation` (2.2).                                                                                                                                   |
| Replace `dimension1` to `dimension10`                    | From free text to foreign keys to `AnalysisCode`.                                                                                                                                                                  |
| Add `taxCodeId`, `taxBaseAmount`                         | Tax reporting from the ledger.                                                                                                                                                                                     |
| Add `documentId`                                         | Foreign key to `EntryDocument`.                                                                                                                                                                                    |
| Add `quantity`, `unitPrice`                              | Optional. Carries what `APInvoiceLine` holds today.                                                                                                                                                                |
| Add `splitFromLineId`, `revaluesLineId`                  | Self-references. The first records a part-allocation split, so both parts can be traced to the original line (D4); the second ties a revaluation adjustment to the line it revalues, so both are settled together. |

Marker meanings:

| Marker        | Meaning                                                                  | Selected by a payment run |
| ------------- | ------------------------------------------------------------------------ | ------------------------- |
| `UNALLOCATED` | Open                                                                     | Yes                       |
| `ALLOCATED`   | Matched by a user or a rule (credit note, contra, write-off)             | No                        |
| `PAID`        | Matched to a payment or receipt line made by a payment or collection run | No                        |
| `WITHHELD`    | Open, payment held back                                                  | No                        |
| `IN_DISPUTE`  | Open, under query                                                        | No                        |

**`AccountPeriodBalance`**

| Change                         | Detail                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add `ledgerId`, `postingState` | Unique key becomes entity, ledger, account, period, posting state. Statements read `POSTED`; enquiry reads both. Releasing a held journal moves its amounts from the held row to the posted row in one transaction. |
| Add reporting columns          | Opening, debits, credits and closing in the reporting currency. Existing columns are the base amounts.                                                                                                              |

**`JournalType`**

| Change                    | Detail                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Add `entryPreset`         | JSON validated by a schema: per field, shown or hidden, required, locked, default value. |
| Add `allowedAccountKinds` | Alongside the existing `allowedAccountTypes`.                                            |
| Add `defaultLedgerId`     | Optional.                                                                                |

**`LedgerSetup`**

Its rows become the settings of a `Ledger` row (`ledgerId` replaces the one-character `ledger`). Columns are unchanged. Added, on ledger A: the creditor and debtor account-code prefixes (D3), the account for allocation differences, and the accounts for realised exchange gains and losses. All are tenant choices; none has a value in code. `provisionalPosting` now decides whether held postings are mandatory, optional or prohibited in that ledger.

**`Period`** (ACC-02, done first)

| Change                             | Detail                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| Add `startDate`, `endDate`         | Required. An exclusion constraint rejects overlapping periods within one calendar. |
| Add `periodNumber`, `isAdjustment` | Adjustment periods share the last day of the year and are chosen explicitly.       |
| Add `fiscalCalendarId`             | Foreign key to `FiscalCalendar` (2.2).                                             |

Existing periods are backfilled from `year` and `month` as calendar months. The posting service derives the period from the document date; a date that falls in no period, or in a closed one, is refused.

**`AnalysisDimension`**

| Change                     | Detail                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Add `appliesTo`            | `TRANSACTION`, `ACCOUNT`, `ASSET`. Unique key becomes entity, applies-to, dimension number. Existing rows are transaction dimensions. |
| Add `isReportingDimension` | Marks the dimensions kept in the dimension summary (ACC-07).                                                                          |

**Payment-run tables**

| Table               | Change                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PaymentRun`        | Unchanged. It records the process, not balances.                                                                   |
| `PaymentRunItem`    | `supplierId` becomes `counterpartyAccountId`.                                                                      |
| `PaymentRunInvoice` | Renamed `PaymentRunLine`. `invoiceId` becomes `journalLineId`. `isCreditNote` is dropped: the line's side says it. |
| `PaymentProfile`    | Unchanged. `selectionCriteria` is re-read against line fields (due date, marker, account analysis).                |

**Other tables that lose a relation**

| Table         | Relation removed               | Replaced by                   |
| ------------- | ------------------------------ | ----------------------------- |
| `TaxCode`     | `apInvoiceLines`, `arInvoices` | `JournalLine.taxCodeId`       |
| `BankAccount` | `apPayments`, `arReceipts`     | `EntryDocument.bankAccountId` |
| `Period`      | `apInvoices`                   | The document's journal        |

### 2.2 New tables

**`Ledger`** — one row per ledger per entity.

| Column                     | Purpose                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `entityId`, `code`, `name` | Code is unique per entity. `A` is created for every entity.                                                          |
| `kind`                     | `ACTUAL`, `BUDGET`, `FORECAST`.                                                                                      |
| `mustBalance`              | Whether journals in this ledger must balance (D5). A check constraint forces it to true for a ledger of kind actual. |
| `isLocked`                 | Stops posting to a budget version that has been signed off.                                                          |

A ledger table instead of a letter on the journal, because budget versions become ledgers and a tenant may keep more versions than eleven letters allow.

**`AccountCounterparty`** — one row per counterparty account.

| Column             | From                                     |
| ------------------ | ---------------------------------------- |
| `paymentTermsDays` | `Supplier`, `Customer`                   |
| `creditLimit`      | `Customer`                               |
| `defaultCurrency`  | `Supplier.currency`, `Customer.currency` |
| `taxRegistration`  | `Supplier.taxId`                         |

**`AccountAddress`** — addresses and contacts of an account: kind (registered, billing, remittance), address lines, city, postal code, country, contact name, email, phone, primary flag.

**`AccountBankDetail`** — the bank details payment files are built from: bank name, account name, account number, IBAN, SWIFT code, currency, default flag. Section 11 does not mention this table; `Supplier.bankDetails` has to go somewhere and a typed table is safer than JSON for data that directs payments.

**`AccountBankDetailChange`** — a requested change to an account's bank details (D9).

| Column                                 | Purpose                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `accountId`, `bankDetailId`            | The account, and the existing detail being changed (null for a new one). |
| `proposed` values                      | Bank name, account name, account number, IBAN, SWIFT code, currency.     |
| `requestedById`, `requestedAt`         | Who asked.                                                               |
| `decidedById`, `decidedAt`, `decision` | Approved or rejected, and by whom.                                       |

Rules, enforced by the database as well as the service:

- `AccountBankDetail` cannot be inserted, updated or deleted directly. A trigger allows the change only while an approved request is being applied.
- The person who decides cannot be the person who asked (check constraint).
- Approval needs its own permission, separate from the one that lets a user request the change.
- Every request, approval, rejection and application writes an audit event with the old and new values, the account number masked to its last four characters.
- A payment or collection run uses only details that came from an approved request. A pending change does not affect a run already proposed.

**`AccountAnalysis`** — account, account-analysis dimension, analysis code. One row per dimension per account. Used for supplier and customer categories and for data access by analysis code.

**`EntryDocument`** — the invoice, credit note, payment or receipt as entered. It owns no balances.

| Column                                           | Purpose                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `entityId`, `documentType`                       | `PURCHASE_INVOICE`, `PURCHASE_CREDIT_NOTE`, `SALES_INVOICE`, `SALES_CREDIT_NOTE`, `PAYMENT`, `RECEIPT`.             |
| `number`                                         | Unique per entity, counterparty account and document type.                                                          |
| `counterpartyAccountId`                          | The creditor, debtor or client account.                                                                             |
| `journalId`                                      | One to one. The journal exists from the moment the document is saved, in draft; its lines are the document's lines. |
| `documentDate`, `dueDate`, `currency`            | As entered. The journal and lines carry the authoritative copies once posted.                                       |
| `paymentMethod`, `bankAccountId`, `paymentRunId` | Payments and receipts only.                                                                                         |
| `externalOrderRef`, `notes`                      | From `APInvoice.externalPoRef`, `ARInvoice.notes`.                                                                  |
| `lastDunningLevel`, `lastDunnedAt`               | Sales invoices only.                                                                                                |
| `createdById`                                    | As today.                                                                                                           |

**`EntryDocumentAttachment`** — document, storage key, file name, media type, size, uploaded by.

**`Allocation`** — one row per match.

| Column                               | Purpose                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `entityId`, `accountId`, `reference` | All lines of one allocation are on one account. Reference is a number unique per entity. |
| `allocationDate`, `allocatedById`    | When and by whom.                                                                        |
| `differenceJournalId`                | The journal that booked a write-off, discount or realised exchange difference, if any.   |
| `reversedAt`, `reversedById`         | Reversal clears the stamp on the lines and keeps this row as the record.                 |

**`FiscalCalendar`** — one per entity (ACC-02): name, first month of the year, number of periods, number of adjustment periods. Periods belong to a calendar.

**`AccountDimensionBalance`** — the summary from ACC-07: entity, ledger, account, period, posting state, the reporting dimensions, and debits and credits in base and reporting currency. Maintained by the same balance writer as `AccountPeriodBalance`.

**`AssignmentAnalysisRestriction`** — role assignment, dimension, analysis code. A user whose assignment carries restrictions sees only lines with those codes. Built with WP-6; listed here so the line and balance schema is final.

### 2.3 Removed tables

Dropped after the migration and the reconciliation pass (section 3.6):

`Supplier`, `Customer`, `APInvoice`, `APInvoiceLine`, `APPayment`, `APPaymentAllocation`, `ARInvoice`, `ARReceipt`, `ARAllocation`, `BudgetDefinition`, `BudgetLine`.

Also dropped, under ACC-08: `ApprovalRule` and `JournalApproval`. Their rules are migrated to `AuthorizationStage`, the multi-stage model that stays. The fail-open check in `gl/service.ts` that swallows an authorization error goes with them (ACC-04).

Also dropped: the materialized view `mv_period_account_balances` (ACC-09; it has no ledger or posting state).

`PurchaseOrder`, `PurchaseOrderLine`, `GoodsReceivedNote` and `GoodsReceivedNoteLine` stay, with one change: `PurchaseOrder.supplierId` becomes `counterpartyAccountId`. No code reads or writes these tables today.

### 2.4 Database constraints (ACC-03, extended)

| Constraint                 | Rule                                                                                                                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line sides                 | Debit and credit are not negative and not both above zero, in each of the three currencies.                                                                                                                                              |
| Balanced journal           | A deferred trigger rejects a journal entering `HELD` or `POSTED` whose debits and credits differ in base or reporting currency, when the ledger's must-balance setting is on.                                                            |
| Posted lines are fixed     | A trigger rejects any change to a held or posted journal or its lines, except: the allocation columns, through the allocation service; a split, through the split function; the move from held to posted; the status change to reversed. |
| Counterparty lines         | A line on a counterparty account has a due date and a transaction reference.                                                                                                                                                             |
| Marker and reference agree | `ALLOCATED` and `PAID` require an allocation; the other markers forbid one.                                                                                                                                                              |
| An allocation nets to zero | The lines sharing one allocation net to zero in transaction currency. Checked by a deferred trigger.                                                                                                                                     |
| Split is exact             | The two parts of a split equal the original line in all three currencies.                                                                                                                                                                |
| One ledger per journal     | A journal's ledger and its entity's ledgers agree; balances are written to that ledger only.                                                                                                                                             |
| Duplicate source           | Unique on entity, source system, source document reference.                                                                                                                                                                              |

---

## 3. Migration mapping

### 3.1 Order

1. Fiscal calendars and period dates (ACC-02), then the rest of the schema expand: new tables and columns, nothing dropped.
2. Ledgers: create ledger `A` per entity; point existing journals, balances and `LedgerSetup` rows at it.
3. Journals and lines: backfill `documentDate`, `postingState`, base and reporting amounts, dimensions.
4. Suppliers and customers to accounts.
5. Invoices, payments and receipts to entry documents; re-point control-account lines.
6. Allocations.
7. Budgets to budget ledgers.
8. Recompute balances from lines; run the reconciliation script.
9. Constraints and triggers on.
10. Contract: drop the old tables, after the owner signs off the reconciliation report.

Steps 2 to 8 run per tenant in one transaction per entity. A failure leaves that entity untouched.

### 3.2 Existing ledger tables

| Existing                                                    | Becomes                                                                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Journal.postedAt`                                          | `documentDate`, where the journal has no better date. A journal linked to an invoice, payment or receipt takes that document's date.                                                                   |
| `Journal.status`                                            | `postingState` per the table in 2.1.                                                                                                                                                                   |
| `Journal.functionalCurrency`                                | `baseCurrency`.                                                                                                                                                                                        |
| `JournalLine.fxRate`, `debitFunctional`, `creditFunctional` | `baseRate`, `debitBase`, `creditBase`.                                                                                                                                                                 |
| Reporting amounts                                           | Computed from the base amounts at the entity's reporting-currency rate on the document date. Where base and reporting currency are the same, copied. A missing rate stops the migration and is listed. |
| `JournalLine.dimension1` to `dimension10` (text)            | For each entity and dimension number with values: the dimension is created if missing, one `AnalysisCode` per distinct value, and the line points at the code.                                         |
| `AccountPeriodBalance`                                      | Rows move to ledger `A`, state `POSTED`. Reporting columns are recomputed in step 8.                                                                                                                   |
| `Account.isControlAccount = true`                           | The account becomes a header account: `allowPosting` false once its attributable lines have moved (3.4).                                                                                               |
| `BankAccount.glAccountId`                                   | That account gets kind `BANK`.                                                                                                                                                                         |
| Accounts of a statistical type                              | Kind `MEMO`.                                                                                                                                                                                           |
| All other accounts                                          | Kind `GENERAL`.                                                                                                                                                                                        |

### 3.3 Payables master data

**`Supplier`** to `Account` + `AccountCounterparty` + `AccountAddress` + `AccountBankDetail`

| `Supplier`           | Target                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | Kept as a mapping row for the migration and the reconciliation script.                                                                                                                   |
| `entityId`           | `Account.entityId`                                                                                                                                                                       |
| `code`               | The tenant's creditor prefix followed by the code (D3). The prefix is a tenant setting, on by default.                                                                                   |
| `name`               | `Account.name`                                                                                                                                                                           |
| —                    | `Account.accountKind = CREDITOR`, `allocationEnabled = true`, `normalBalance = CREDIT`                                                                                                   |
| —                    | `Account.type` and `parentId`: the type of, and a child of, the entity's payables header account                                                                                         |
| `taxId`              | `AccountCounterparty.taxRegistration`                                                                                                                                                    |
| `currency`           | `AccountCounterparty.defaultCurrency`                                                                                                                                                    |
| `paymentTermsDays`   | `AccountCounterparty.paymentTermsDays`                                                                                                                                                   |
| `bankDetails` (JSON) | One `AccountBankDetail` row. Keys the reader in `ap/service.ts` already recognises are mapped; an unrecognised shape is listed, not dropped.                                             |
| —                    | The carried-over detail is recorded as migrated, not as approved by a second person, and is listed in the migration report. The first change after migration goes through approval (D9). |
| `isActive`           | `Account.isActive`                                                                                                                                                                       |

The payables header account is the account the payables code posts to today: code `2000`, else the first liability account flagged as control. Note that FX revaluation and the balance-sheet template use `2100` for the same purpose; the migration treats both as header candidates and reports which one each entity actually used.

### 3.4 Payables transactions

**`APInvoice`** to `EntryDocument` + its journal

| `APInvoice`                   | Target                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `supplierId`                  | `EntryDocument.counterpartyAccountId`                                                                 |
| `invoiceNumber`               | `EntryDocument.number`; `transactionReference` on the counterparty line                               |
| `invoiceDate`                 | `EntryDocument.documentDate`; `Journal.documentDate`; `transactionDate` on the lines                  |
| `dueDate`                     | `EntryDocument.dueDate`; `dueDate` on the counterparty line                                           |
| `currency`, `fxRate`          | Line currency and `baseRate`                                                                          |
| `grossAmount`                 | The counterparty line. Negative gross makes the document a purchase credit note and the line a debit. |
| `netAmount`, `taxAmount`      | Not stored. They are the sums of the expense lines and the tax line.                                  |
| `functionalAmount`            | Not stored. It is the base amount of the counterparty line plus any revaluation lines tied to it.     |
| `periodId`                    | The journal's period                                                                                  |
| `glJournalId`                 | `EntryDocument.journalId`                                                                             |
| `externalPoRef`               | `EntryDocument.externalOrderRef`; `secondReference` on the counterparty line                          |
| `paymentTerms`                | Dropped; the due date already reflects it                                                             |
| `createdById`, `approvedById` | The journal's `createdById`, `approvedById`                                                           |
| `status`                      | See below                                                                                             |

| `APInvoice.status` | Document's journal                                            | Counterparty line marker                  |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------- |
| `DRAFT`            | Draft journal built from the invoice lines; not in the ledger | —                                         |
| `PENDING_APPROVAL` | Pending approval; not in the ledger                           | —                                         |
| `APPROVED`         | Held posting built from the invoice lines (D7)                | `UNALLOCATED`, not payable until released |
| `POSTED`           | Existing journal, posted                                      | `UNALLOCATED`                             |
| `PAID`             | Existing journal, posted                                      | `PAID`, with the allocation from 3.5      |
| `DISPUTED`         | Existing journal if posted                                    | `IN_DISPUTE`                              |
| `CANCELLED`        | Voided                                                        | —                                         |

For a posted invoice the existing journal is kept. Its one line on the header account is re-pointed to the supplier's account. Nothing else in the journal changes, so the journal still balances.

**`APInvoiceLine`** to `JournalLine`

| `APInvoiceLine`         | Target                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `description`           | `description`                                                                            |
| `quantity`, `unitPrice` | `quantity`, `unitPrice`                                                                  |
| `amount`                | Debit (credit on a credit note)                                                          |
| `glAccountId`           | `accountId`                                                                              |
| `taxCodeId`             | `taxCodeId`; `taxBaseAmount` = the line amount                                           |
| `taxCode` (text)        | Resolved to `taxCodeId` by code where `taxCodeId` is empty; unresolved values are listed |

For a posted invoice the journal already has one line per invoice line, in the same order; the migration matches them by line number and amount and adds the fields above. A journal that does not match its invoice is listed and left for review.

**`APPayment`** to `EntryDocument` (type `PAYMENT`) + its journal

| `APPayment`                                      | Target                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `supplierId`                                     | `counterpartyAccountId`. A payment with no supplier is listed; it cannot be migrated to an account. |
| `paymentRunId`, `paymentMethod`, `bankAccountId` | Same columns on the document                                                                        |
| `paymentDate`                                    | Document and journal date; `transactionDate` on the lines                                           |
| `reference`                                      | `number`; `transactionReference` on the counterparty line                                           |
| `currency`, `amount`                             | Already on the journal's lines                                                                      |
| `glJournalId`                                    | `journalId`; the header-account line is re-pointed to the supplier's account                        |
| `status`                                         | `PROCESSED` is posted. Any other value is listed: the column is free text today.                    |

**`APPaymentAllocation`** — see 3.5.

**`PaymentRun`** — unchanged.

**`PaymentRunItem`** — `supplierId` becomes `counterpartyAccountId`. Amount columns are kept as the record of what the run proposed.

**`PaymentRunInvoice`** to `PaymentRunLine` — `invoiceId` becomes the counterparty line of that invoice's journal. `allocatedAmount` is kept. `isCreditNote` is dropped. A row whose invoice was never posted has no line to point at; it is kept with a null line and listed.

**`PaymentProfile`** — unchanged.

**`PurchaseOrder`** — `supplierId` becomes `counterpartyAccountId`. **`PurchaseOrderLine`, `GoodsReceivedNote`, `GoodsReceivedNoteLine`** — unchanged.

### 3.5 Receivables

**`Customer`** to `Account` + `AccountCounterparty` + `AccountAddress` + `AccountAnalysis`

| `Customer`                                        | Target                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`, `name`, `isActive`, `entityId`            | As for `Supplier`                                                                                                                                                                   |
| —                                                 | The code takes the tenant's debtor prefix (D3).                                                                                                                                     |
| —                                                 | `accountKind = DEBTOR`, `allocationEnabled = true`, `normalBalance = DEBIT`, child of the receivables header account (code `1200`, else the first asset account flagged as control) |
| `creditLimit`                                     | `AccountCounterparty.creditLimit`                                                                                                                                                   |
| `currency`, `paymentTermsDays`                    | `AccountCounterparty`                                                                                                                                                               |
| `billingContact` (JSON)                           | One `AccountAddress` row of kind billing. The `email` key feeds dunning today and maps to `email`.                                                                                  |
| `type` (corporate, OTA, travel agent, individual) | An account-analysis dimension named "Customer type" with those four codes, and one `AccountAnalysis` row per customer. The enum goes; the tenant can then add its own types.        |

**`ARInvoice`** to `EntryDocument` + its journal

| `ARInvoice`                                                                                  | Target                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `customerId`, `invoiceNumber`, `invoiceDate`, `dueDate`, `currency`, `fxRate`, `glJournalId` | As for `APInvoice`                                                                    |
| `amount`                                                                                     | The counterparty line (debit)                                                         |
| `netAmount`, `taxAmount`                                                                     | Not stored; they are the revenue and tax lines                                        |
| `taxCodeId`                                                                                  | `taxCodeId` on the tax line; `taxBaseAmount` = net amount                             |
| `functionalAmount`                                                                           | Not stored, as for payables                                                           |
| `amountPaid`                                                                                 | Not stored. It is the allocated part of the counterparty line. See allocations below. |
| `notes`                                                                                      | `EntryDocument.notes`                                                                 |
| `status`                                                                                     | Below                                                                                 |

| `ARInvoice.status` | Document's journal                                     | Counterparty line                                                         |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `DRAFT`            | Draft journal: debtor line, one revenue line, tax line | —                                                                         |
| `POSTED`           | Existing journal                                       | `UNALLOCATED`                                                             |
| `PARTIALLY_PAID`   | Existing journal                                       | Split: allocated part and open part                                       |
| `PAID`             | Existing journal                                       | Allocated                                                                 |
| `OVERDUE`          | Existing journal                                       | `UNALLOCATED`. Overdue is not stored; it is "open and past the due date". |
| `CANCELLED`        | Voided                                                 | —                                                                         |

`ARInvoice` has no lines of its own. A draft invoice gets one revenue line on the account the service uses today (code `4100`); that literal is a known hard-coded value and the rewritten entry form takes the account from the user.

**`ARReceipt`** to `EntryDocument` (type `RECEIPT`) + its journal

| `ARReceipt`                                                              | Target                         |
| ------------------------------------------------------------------------ | ------------------------------ |
| `customerId`, `receiptDate`, `reference`, `bankAccountId`, `glJournalId` | As for `APPayment`             |
| `currency`, `amount`                                                     | Already on the journal's lines |

**Allocations: `APPaymentAllocation` and `ARAllocation`** to `Allocation` + stamps on lines

1. One `Allocation` per payment or receipt, on the counterparty's account.
2. Its lines are the payment or receipt's counterparty line and the counterparty line of each invoice it settles.
3. Where `allocatedAmount` is less than a line, the line is split and only the matched part is stamped.
4. Credit notes netted in a payment run join the same allocation, so the set nets to zero.
5. Marker `PAID` where the payment came from a payment or collection run; `ALLOCATED` otherwise.
6. `allocationDate` is the payment or receipt date. `allocatedById` is the user who confirmed the run or recorded the receipt, where known.

Three cases cannot be matched and are listed in the migration report instead of being forced:

- An invoice whose `amountPaid` is more than its allocation rows. The collection run in `ap/payment-profile-service.ts` updates `amountPaid` directly, so this can occur.
- An invoice with status `PAID` and no allocation rows.
- Allocation rows whose amounts do not net to zero with their payment.

These lines stay open. The reconciliation script will then show a difference for that supplier or customer, which is the intended signal.

**Lines on the header accounts that belong to no document.** Manual journals and FX revaluation journals post to the control accounts today with nothing that names a supplier or customer. They cannot be attributed. They stay on the header account, which then keeps `allowPosting` true only for that residue, and each is listed for the owner to reclassify. New postings to a header account are refused.

### 3.6 Budgets

**`BudgetDefinition`** to `Ledger`

| `BudgetDefinition` | Target                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entityId`, `name` | One ledger per entity and name, kind `BUDGET`, must-balance off. Definitions that share a name across years share the ledger; the year is in the period. |
| `year`             | The periods of the budget's journals                                                                                                                     |
| `isActive`         | `Ledger.isLocked` is false when active                                                                                                                   |
| —                  | `Ledger.code`: `B`, `C`, … in order of creation                                                                                                          |

**`BudgetLine`** to `JournalLine` in that ledger

| `BudgetLine`                  | Target                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `budgetDefinitionId`, `month` | One posted journal per definition and month, in the period for that year and month. A missing period is created.                              |
| `accountId`                   | `accountId`                                                                                                                                   |
| `amount`                      | On the account's normal side; a negative amount goes on the other side. Base amount equal to the amount (budgets are in base currency today). |
| `notes`                       | `description`                                                                                                                                 |

Budget posting ignores period status: a budget for a closed month must still be loadable. The ledger's lock is what stops changes.

### 3.7 Reconciliation script

Run before the migration (to capture the old figures) and after it. It reports, per entity, and must show zero difference before the old tables are dropped:

| Check                      | Old side                                             | New side                                                                                                            |
| -------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Per supplier               | Posted invoices less allocated payments, by currency | Open lines on the supplier's account                                                                                |
| Per customer               | Posted invoices less `amountPaid`, by currency       | Open lines on the customer's account                                                                                |
| Per account, per period    | `AccountPeriodBalance`                               | Balance recomputed from lines, ledger `A`, posted. Each former control account is compared as header plus children. |
| Per counterparty account   | —                                                    | Sum of open lines equals the account balance                                                                        |
| Per budget, account, month | `BudgetLine.amount`                                  | Balance in the budget ledger                                                                                        |
| Trial balance              | Total debits equal total credits per period          | Same, per ledger whose must-balance setting is on                                                                   |

On the current development database the script has little to prove: `hfp_db` holds 2 suppliers, 24 accounts and no invoices, payments, receipts, budgets or journals. The UAT seed (`scripts/seed-uat.ts`) is the data set acceptance check 2 runs on. It used to insert invoices marked posted or approved with no journal behind them (OPS-09). It now creates them through the payables and receivables services: two supplier invoices and three customer invoices are posted, each with a balanced journal, and one supplier invoice is left approved to exercise the held-posting mapping.

---

## 4. Reports and screens whose source changes

### 4.1 Reports that read payables, receivables or budget tables today

| Report or process                                      | Reads today                                                                                                       | Reads after                                                                                                                                                           | Where                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Receivables ageing                                     | `ar_invoices` joined to `customers`, buckets on `due_date`, balance from `amount - amount_paid`                   | Open lines on debtor accounts, buckets on the line's `dueDate`                                                                                                        | `ar/repository.ts:225`; route `GET /ar/ageing`; screens `ar/ageing`, `dashboard/ar` |
| Dunning                                                | `ar_invoices` by status and due date; email from `customers.billing_contact`                                      | Open debtor lines past due; email from `AccountAddress`; level on the document                                                                                        | `ar/service.ts:543`                                                                 |
| Payment run proposal                                   | `ap_invoices` with status approved or posted, grouped by supplier                                                 | Lines on creditor accounts with marker `UNALLOCATED`, by due date. Withheld and in-dispute lines are skipped.                                                         | `ap/service.ts:713`                                                                 |
| Payment run confirmation, voucher and bank file        | `suppliers.bank_details`; `ap_payments`, `ap_payment_allocations`                                                 | `AccountBankDetail`; payment document, lines and one allocation                                                                                                       | `ap/service.ts:936`, `ap/payment-voucher-pdf.ts`                                    |
| Collection run                                         | `ar_invoices`, updating `amount_paid` directly                                                                    | Open debtor lines; receipt document and allocation                                                                                                                    | `ap/payment-profile-service.ts:170`                                                 |
| FX revaluation of open items                           | `ap_invoices` and `ar_invoices`; posts to accounts `2100` and `1200`; rewrites `functional_amount` on the invoice | Open lines in foreign currency on counterparty accounts; posts adjustment lines on the same account tied to the revalued line; base and reporting revalued separately | `fx/repository.ts:173`, `:193`, `:317`; `fx/service.ts:343`                         |
| Currency exposure                                      | Raw SQL on `ar_invoices` and `ap_invoices`                                                                        | Open lines on counterparty accounts by currency                                                                                                                       | `kpi/service.ts:879`                                                                |
| Payables dashboard, invoices due                       | `GET /ap/invoices?dueBefore=`                                                                                     | Open creditor lines by due date                                                                                                                                       | `web/lib/gl-api.ts:974`; screen `dashboard/ap`                                      |
| Budget variance                                        | `budget_lines` against `account_period_balances`                                                                  | The same balance query on two ledgers                                                                                                                                 | `budget/service.ts`; route `GET /budget/variance`; screen `budget/variance`         |
| USALI comparative, budget columns                      | `budget_definitions` and raw SQL on `budget_lines`                                                                | Balances in the chosen budget ledger                                                                                                                                  | `kpi/service.ts:685-771`                                                            |
| Report engine, budget, variance and variance % columns | `budgetLine` by definition and month                                                                              | Balances in the chosen budget ledger. The run parameter `budgetDefinitionId` becomes a ledger.                                                                        | `reporting/report-engine.ts:113`, `:288`, `:608`                                    |

### 4.2 Reports that read balances and must now choose a ledger and a posting state

Every reader of `account_period_balances` has to select ledger `A` and state posted, or it will add budgets and held postings to actuals.

| Report or process                                                                                  | Where                                                           |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Trial balance, account balance and account ledger enquiry                                          | `gl/repository.ts`                                              |
| USALI profit and loss, comparative, entity summary, RevPAR trend, KPI dashboard                    | `kpi/service.ts:466`, `:701-731`, `:967`                        |
| Balance sheet, cash flow, RevPAR (read the materialized view, which is dropped)                    | `kpi/service.ts:185`, `:282`, `:359`                            |
| Report engine: trial balance, balance sheet, cash flow, custom, and the three ledger-listing types | `reporting/report-engine.ts`; `jobs/report-generation-job.ts`   |
| Consolidation                                                                                      | `consolidation/service.ts`                                      |
| Intercompany reconciliation                                                                        | `intercompany/service.ts`                                       |
| Year-end clear-down and carry-forward                                                              | `period-close/year-end-cleardown.ts`, `period/carry-forward.ts` |
| Corporate allocations (basis balances)                                                             | `allocation/service.ts`                                         |

Enquiry screens add a switch to include held postings. Statements never do.

### 4.3 Reports whose account selection changes

After the move a tenant's creditors and debtors are many accounts, not one.

| Report                                                   | Today                                                                                                 | After                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Balance sheet template rows for receivables and payables | Literal code ranges starting `1200`, `2000`, `2100` (`report-engine.ts:809`, `:884`, `:892`, `:1283`) | The header account and its children. A range of codes will miss counterparty accounts whose codes are supplier or customer codes. |
| KPI balance sheet and cash flow                          | Code prefixes `12`, `20`, `13`, … (`kpi/service.ts:377-404`)                                          | Account kind and header account. This overlaps the WP-7 item that removes prefix logic.                                           |
| Trial balance                                            | One row per account                                                                                   | Option to show counterparty accounts summarised under their header                                                                |

### 4.4 Reports that do not exist today and become possible

Section 11 names these; listing them so nobody looks for an existing source.

| Report                           | Source                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| Payables ageing                  | Open creditor lines. Today there is a receivables ageing only.                            |
| Supplier and customer statements | Lines on one counterparty account between two dates                                       |
| Tax report                       | Lines with a tax code, using `taxBaseAmount`. Today tax is posted but nothing reports it. |
| Sales credit notes (ACC-10)      | An entry-document type                                                                    |

### 4.5 Screens

| Screen                                                                  | Change                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `ap` (invoices), `ap/suppliers`, `ap/payment-runs`                      | Same screens over documents, accounts and lines                            |
| `ar` (customers, invoices, receipts, allocation), `ar/ageing`           | Same; allocation works on lines                                            |
| `budget`, `budget/variance`                                             | Entry writes journals to a budget ledger; the version picker lists ledgers |
| `dashboard/ap`, `dashboard/ar`, `dashboard/cfo`, `dashboard/controller` | Read ledger enquiries                                                      |
| `gl/trial-balance`, `gl/accounts`, `reports/*`                          | Ledger selector; held-postings switch on enquiry                           |

### 4.6 Writers that change (not reports, but they write the tables being dropped)

| Writer                   | Writes today                             | Where                                                                                                         |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Inbound API              | `APInvoice`, `Supplier`, balances        | `integration/connectors/inbound/inbound-service.ts`                                                           |
| SAF import               | `APInvoice`, accounts flagged as control | `integration/connectors/saf/saf-import-service.ts`                                                            |
| Sky Jana sync            | `Supplier`                               | `integration/connectors/sky-jana/sky-jana-sync-job.ts`                                                        |
| Budget Excel import      | `BudgetLine`                             | `budget/excel-import.ts`                                                                                      |
| Chart of accounts import | `isControlAccount` column                | `gl/coa-import-service.ts`                                                                                    |
| Seeds and scripts        | All of the above                         | `db/seed.ts`, `scripts/seed-uat.ts`, `scripts/backfill-ap-invoices.ts`, `scripts/fix-payment-run-balances.ts` |

Under section 11 these become producers of the canonical document in WP-4. Until then they are rewritten to call the posting service.

---

## 5. Found while writing this note

1. **WP-3 was only partly carried over.** Resolved by D8: ACC-02, ACC-04, ACC-05 and ACC-08 are part of WP-U, ACC-02 first.

2. **Two payables control accounts are in use.** Logged as ACC-12. Payables posts to `2000`; FX revaluation and the balance-sheet template use `2100`. The migration treats both as header candidates and reports which each entity used.

3. **The dunning level is written to a column that does not exist.** Logged as ACC-13. Dunning-level tracking moves to the entry document.

4. **The UAT seed inserts invoices with no journal.** Logged as OPS-09 and fixed ahead of WP-U: the seed now creates its invoices through the payables and receivables services. Two defects in those services had to be fixed for that to work, because the UAT chart shares no codes with the template: the control account was taken by literal code before the account the tenant flagged (so receivables would have posted to the chart's `1200`, Inventory - Food), and an invoice created through the service could not carry a tax code that posting could use (logged as ACC-14).

5. **`APPayment.status` is free text**, and `supplierId`, `amount`, `currency` and `paymentDate` are all nullable. Rows that are incomplete cannot be migrated and are listed.

6. **Held postings interact with allocation and payment.** A held line cannot be allocated, paid or revalued. Releasing it makes it open.

## 6. Not covered by this note

- Export profiles (with WP-4) and the canonical document package: their schemas depend on this one and are designed after it is approved.
- The rules for data access by analysis code beyond the table in 2.2 (with WP-6).
- Screen designs. Section 11 says the screens stay where possible; none is redesigned here.
- A cut-over plan for a tenant with live data. None exists yet; the migration is written to be re-runnable per entity and to stop on anything it cannot map.
