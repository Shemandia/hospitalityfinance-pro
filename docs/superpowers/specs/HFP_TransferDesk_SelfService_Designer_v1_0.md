**HospitalityFinancePro**

Self-Service Transfer Desk Designer

Complete UI/UX & Backend Specification

Enabling Customers to Build Custom Profiles, Formats,

Transformations, and Automations

Version 1.0 --- April 2026

_Companion to: HFP Transfer Desk Technical Specification v1.0_

**Table of Contents**

**1. Design Philosophy**

The self-service Transfer Desk must enable customers --- hotel finance teams, not developers --- to create their own integration profiles with the same power available to the system-provided profiles. The design follows three core principles:

- **Guided wizard for creation, power panel for editing**: New profiles/formats/transformations are created via step-by-step wizards with inline validation. Once created, a power-user panel provides direct access to all settings.

- **Sample-file-first design**: Customers start by uploading a sample data file. The system auto-detects the format (delimiters, fields, encodings) and generates the FSD definition. This eliminates the need to understand FSD XML syntax.

- **Visual mapping, not scripting**: The Transformation Designer uses a drag-and-drop visual mapper (source fields on left, target fields on right, draw lines between them). JavaScript functions are offered as pre-built building blocks from a library, not as raw code. Power users CAN write custom JavaScript, but the default path never requires it.

+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Key UX Principle** |
| |
| Every screen that SunSystems exposes as a Windows dialog (Profile Designer, Format Designer, Transformation Designer, Lookup Table Designer, Automation Designer, Filter Designer, Transfer History Viewer) becomes a dedicated page or slide-over panel in the HFP Next.js frontend, accessible from the Transfer Desk section of the tenant dashboard. |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**2. Navigation & Information Architecture**

**2.1 Transfer Desk Landing Page**

URL: **/{tenant-slug}/transfer-desk**

The landing page mirrors the SunSystems hierarchy pane concept but as a modern dashboard. It contains:

- **Left sidebar navigation** with sections: Profiles, Automations, Formats, Transformations, Lookup Tables, File Repository, Execution History, Settings (admin only)

- **Main content area** shows the selected section\'s list view with search, filter, and sort controls

- **Quick Actions toolbar** at the top: New Import Profile, New Export Profile, New Process Profile, New Internal Transfer, New External Transfer, New Automation --- matching the SunSystems toolbar buttons exactly

- **Recent Executions widget** showing the last 5 runs with status indicators (green/red/yellow/grey)

- **System Profiles section** showing pre-built hospitality profiles (Opera, Jana, Simphony) as read-only cards that can be cloned

**2.2 URL Structure**

---

**URL Pattern** **Page** **Role Required**

---

/{tenant}/transfer-desk Dashboard / Landing transfer:user

/{tenant}/transfer-desk/profiles Profile List transfer:user

/{tenant}/transfer-desk/profiles/new?type={type} Profile Creation Wizard transfer:designer

/{tenant}/transfer-desk/profiles/{id} Profile Detail / Editor transfer:user (view) / designer (edit)

/{tenant}/transfer-desk/profiles/{id}/execute Execution Dialog transfer:power-user

/{tenant}/transfer-desk/automations Automation List transfer:user

/{tenant}/transfer-desk/automations/new Automation Creation Wizard transfer:designer

/{tenant}/transfer-desk/automations/{id} Automation Detail / Editor transfer:designer

/{tenant}/transfer-desk/formats Format List transfer:designer

/{tenant}/transfer-desk/formats/new Format Creation Wizard transfer:designer

/{tenant}/transfer-desk/formats/{id} Format Detail / Editor (GUI + Code) transfer:designer

/{tenant}/transfer-desk/transformations Transformation List transfer:designer

/{tenant}/transfer-desk/transformations/new Transformation Creation Wizard transfer:designer

/{tenant}/transfer-desk/transformations/{id} Transformation Detail / Visual Mapper transfer:designer

/{tenant}/transfer-desk/lookups Lookup Table List transfer:designer

/{tenant}/transfer-desk/lookups/new Lookup Table Creator transfer:designer

/{tenant}/transfer-desk/lookups/{id} Lookup Table Editor (spreadsheet view) transfer:designer

/{tenant}/transfer-desk/files File Repository Browser transfer:user (browse) / admin (manage)

/{tenant}/transfer-desk/history Execution History (TRH equivalent) transfer:user

/{tenant}/transfer-desk/history/{executionId} Execution Detail + Record Logs transfer:user

/{tenant}/transfer-desk/settings Config Export/Import/Cleardown transfer:admin

---

**3. Profile Creation Wizard**

The profile creation wizard is the most critical self-service flow. It must handle all five profile types while remaining approachable for non-technical users. The wizard uses a multi-step form with conditional steps based on profile type.

**3.1 Wizard Steps by Profile Type**

---

**Step** **Import** **Export** **Process** **Internal Transfer** **External Transfer**

---

1\. Basics Name, description, type Name, description, type Name, description, type Name, description, type Name, description, type

2\. Source Upload sample file OR select format Select source component (Ledger, PO, etc.) N/A (skip) Select source component Upload sample source file OR select format

3\. Target Select target component Upload sample file OR select format Select target process Auto-set to same as source Upload sample target file OR select format

4\. Format Auto-detect or edit FSD Auto-detect or edit FSD N/A N/A (SSML internal) Auto-detect both source + target FSD

5\. Mapping Visual mapper: source fields → target fields Visual mapper: component fields → file fields Process-specific params Visual mapper: source → target fields Visual mapper: source file → target file

6\. Parameters Runtime params (BU, ledger, journal type, etc.) Runtime params (BU, ledger, filters, range) Runtime params (process-specific) Source + target runtime params File handling params

7\. Notifications Email + webhook config Email + webhook config Email + webhook config Email + webhook config Email + webhook config

8\. Review Summary + validate + test Summary + validate + test Summary + validate Summary + validate + test Summary + validate + test

---

**3.2 Step 1: Basics**

**3.2.1 UI Components**

- **Profile Name** --- Text input with real-time uniqueness validation (debounced API call). Max 100 chars. Shows green check or red X.

- **Description** --- Textarea, optional, max 500 chars.

- **Profile Type** --- Card selector (not dropdown) showing 5 cards with icon, title, and one-line description:
  - Import: \"Bring external data into HFP (files, API responses)\"

  - Export: \"Send HFP data to external files for other systems\"

  - Process: \"Run an HFP process (payment run, revaluation, period close)\"

  - Internal Transfer: \"Move data within HFP (between business units, ledgers)\"

  - External Transfer: \"Convert a file from one format to another (no HFP data involved)\"

**3.3 Step 2: Source Configuration**

**3.3.1 For Import & External Transfer Profiles (External File Source)**

The source is an external file. The user has two paths:

+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Path A: Upload Sample File (Recommended)** |
| |
| User drags a sample data file onto the upload zone. The system auto-detects the format: delimiter type (comma, tab, semicolon, pipe, other), record separator, field count, whether first row contains headers, character encoding (UTF-8, ASCII, UTF-16). A live preview table shows the parsed data with detected field names as column headers. User can rename fields, exclude columns, and adjust detection settings. |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Path B: Select Existing Format** |
| |
| User chooses from a dropdown of previously created formats (including system formats like \'Jana Purchasing Voucher Format\', \'Opera EZZRV Format\'). A preview of the format structure is shown. User can clone and modify an existing format. |
+--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**3.3.2 Auto-Detection API Endpoint**

---

**Field** **Value**

---

Endpoint POST /api/{tenant}/transfer/formats/detect

Auth transfer:designer

Request Body multipart/form-data with the sample file

Response { classification, delimiter, recordSeparator, encoding, hasHeaders, fields: \[{name, startPos, length, sampleValues\[\]}\], previewRows: \[{\...}\], suggestedFsdXml, confidence }

---

The auto-detection engine works as follows:

1.  Read the first 100 lines of the file and detect encoding (BOM detection + chardet heuristic)

2.  Count occurrences of common delimiters (comma, tab, semicolon, pipe) per line. The delimiter with the most consistent count across lines wins.

3.  If no delimiter found with consistent counts, assume fixed-width. Detect field boundaries by analyzing whitespace/character patterns across lines.

4.  If first line has different content pattern than subsequent lines (e.g., all text vs mix of text/numbers), flag it as a header row.

5.  Generate field names from headers (sanitized to valid XML names) or auto-generate (Field1, Field2, \...).

6.  Generate the FSD XML definition based on detected classification.

7.  Return confidence score (0-100) based on consistency of detection across sample lines.

**3.3.3 For Export & Internal Transfer Profiles (HFP Component Source)**

The source is an HFP data component. The user selects from a dropdown of available components:

---

**Component** **Description** **Available Fields**

---

Ledger General Ledger journal transactions JournalNumber, JournalType, AccountCode, AnalysisCode1-10, Amount, BaseAmount, Description, TransactionDate, PostingPeriod, BusinessUnit, \...

Accounts Payable AP transactions and invoices SupplierCode, InvoiceNumber, InvoiceDate, DueDate, Amount, Currency, PaymentTerms, \...

Accounts Receivable AR transactions and invoices CustomerCode, InvoiceNumber, InvoiceDate, DueDate, Amount, Currency, \...

Chart of Accounts Account master data AccountCode, AccountName, AccountType, Category1-5, Status, \...

Supplier Master Supplier/vendor master data SupplierCode, SupplierName, Address1-5, TaxID, PaymentMethod, BankDetails, \...

Customer Master Customer master data CustomerCode, CustomerName, Address1-5, CreditLimit, PaymentTerms, \...

Address Book Shared address records AddressCode, Name, Address1-5, Phone, Email, \...

Purchase Order Purchase order headers and lines OrderNumber, SupplierCode, OrderDate, Status, Lines\[ItemCode, Quantity, UnitPrice, Amount\], \...

Budget Budget records by period AccountCode, Period, BudgetLedger, Amount, \...

---

**3.4 Step 3: Target Configuration**

Mirror of Step 2 but for the target side. Import profiles select a target component. Export profiles configure the output file format. Process profiles select a target process:

---

**Process** **Description** **Runtime Parameters**

---

Payment Run Execute AP payment processing BusinessUnit, PaymentDate, BankAccount, SupplierRange, CurrencyFilter

Ledger Revaluation FX revaluation of balances BusinessUnit, Ledger, RevaluationDate, RateType, GainLossAccount

Period Close Close an accounting period BusinessUnit, Ledger, Period, PostingYear

Trial Balance Recalculation Rebuild TB from journals BusinessUnit, Ledger, FromPeriod, ToPeriod

Bank Reconciliation Auto-match bank statements BusinessUnit, BankAccount, StatementDate

---

**3.5 Step 4: Format Configuration**

This step appears only when the profile involves external files. If auto-detection was used in Step 2/3, the FSD is pre-populated and the user sees:

**3.5.1 Format GUI Editor**

A dual-view editor with GUI and Code tabs (matching SunSystems\' TML Details / Text View toggle):

- **GUI Tab (default)**: Interactive form matching the SunSystems Format Designer:
  - **Classification badge** showing the detected type (Delimited / Single Fixed Width / Multiple Fixed Width / Simple XML / Other)

  - **General settings**: Initial lines to ignore (spinner), Field separator (dropdown: Comma, Tab, Semicolon, Pipe, Space, Other + custom input), Record separator (dropdown: Windows \\r\\n, UNIX \\n, Other + custom), File contains column headings (checkbox)

  - **Fields table**: Sortable, editable table with columns: Order (drag handle), Field Name (editable text), Start Position (fixed-width only), Length (fixed-width only), Ignore (checkbox). Add Row / Delete Row / Import from File buttons.

  - **Live Preview**: Side panel showing how the sample file parses with current settings. Updates in real-time as user changes fields.

- **Code Tab**: Raw FSD XML editor with syntax highlighting (CodeMirror or Monaco) for power users. Changes in Code tab are reflected in GUI tab and vice versa, with a warning when manual code edits break GUI round-trip.

- **Validate button**: Checks FSD XML syntax and structure. Shows green ✓ or error list.

- **Test button**: User uploads a data file; system parses it with the current FSD and shows the resulting JSON/XML in a split view (raw file on left, parsed output on right).

**3.5.2 Fixed-Width Field Detection**

For fixed-width files, the GUI includes a **column ruler** visualization:

- Display the first 10 lines of the sample file in a monospaced font

- User clicks to place vertical column markers that define field boundaries

- As markers are placed, the Fields table auto-updates with Start Position and Length

- Pre-detected boundaries are shown as blue dashed lines; user-confirmed boundaries are solid

**3.5.3 Simple XML Format Builder**

For Simple XML classification, the GUI provides a tree builder matching the SunSystems Simple XML editor:

- **Tree view** with Add Subelement, Edit, Delete, Move Up/Down buttons

- Each node shows: Element name, Namespace (optional), Occurrences, Attributes (expandable)

- **Namespace manager**: Add/remove namespace prefix + URL pairs

- **Import XSD button**: Parse an XSD file and auto-populate the tree (simple types only; complex types show a warning)

**3.5.4 Multiple Fixed-Width Record Types**

For files with multiple record types (identified by prefix markers), the GUI provides:

- **Record tabs** (matching SunSystems\' tabbed record view): each tab represents a record type

- Each tab has: Prefix field (the identifying string), Record Name, and its own Fields table

- **Add Record / Delete Record** buttons to manage record types

- **Ignore column** checkbox per field row for spacer/padding fields

**4. Visual Transformation Mapper**

This is the **Step 5: Mapping** screen and also the standalone Transformation Designer page. It replaces the SunSystems TML Details grid with an intuitive visual mapping interface.

**4.1 Layout**

Three-column layout:

- **Left panel (Source Fields)**: Tree view of source data structure (from FSD format or HFP component schema). Each leaf node is a draggable field with its data type icon.

- **Center panel (Mapping Canvas)**: Visual connection lines between source and target fields. Each mapping shows the operation type (Map, Set, Transform, Lookup) as a colored badge on the line.

- **Right panel (Target Fields)**: Tree view of target data structure. Each leaf node is a drop target. Mapped fields show a green check; unmapped mandatory fields show a red asterisk.

**4.2 Mapping Operations**

Users create mappings by one of four methods:

**4.2.1 Direct Map (Drag & Drop)**

- User drags a source field to a target field. A blue connection line appears.

- The TML engine generates: \<map\>\<target\>..path..\</target\>\<source\>..path..\</source\>\</map\>

- **Multi-source mapping**: User drags additional source fields to the same target. Lines stack vertically. A tooltip shows the concatenation order. User can reorder by dragging line endpoints.

- **Auto-map button**: For same-format transfers, clicking Auto-Map generates 1:1 mappings for all matching field names. Unmatched fields are highlighted for manual attention.

**4.2.2 Set Fixed Value (Right-Click Target)**

- User right-clicks a target field and selects \'Set Fixed Value\'.

- A popover appears with a text input for the fixed value.

- The TML engine generates: \<set\>\<target\>..path..\</target\>\<value\>..value..\</value\>\</set\>

- The target field shows an orange badge with the value displayed.

**4.2.3 Transform with Function (Double-Click Line)**

- After creating a Map connection, user double-clicks the line to open the Function Selector.

- The Function Selector shows a categorized list of available functions:
  - **Date Functions**: formatDate, parseDate, convertDateFormat, addDays, dateDiff

  - **String Functions**: concatenate, substring, toUpperCase, toLowerCase, trim, padLeft, padRight, replace

  - **Number Functions**: toFixed, round, abs, divide, multiply, percentage, reverseSign

  - **Currency Functions**: divideBy1000 (for Opera/Jana parsing), formatCurrency, convertCurrency

  - **Conditional Functions**: ifThenElse, ifEmpty, coalesce, switch

  - **Account Mapping Functions**: mapAccountCode, mapCostCenter, mapDepartment

- User selects a function and configures its parameters. Parameters can be: source fields (from-source=yes), fixed values, or the output of another function (function chaining).

- The connection line changes to purple with a function icon badge.

- The TML engine generates: \<transform\>\<target\>..path..\</target\>\<function name=\"\...\"\>\<param\>\...\</param\>\</function\>\</transform\>

**4.2.4 Lookup Table Substitution**

- User right-clicks a target field and selects \'Use Lookup Table\'.

- A dialog shows available lookup tables. User selects a table and column.

- User configures: Source field (what value to look up), Business Unit scope (auto:source, auto:target, specific BU, or Global), Unknown handling (fail or copy through).

- The connection line changes to green with a lookup icon badge.

- The TML engine generates: \<lookup table=\"\...\" business-unit=\"\...\" unknown=\"\...\"\>\<target\>..path..\</target\>\<source\>..path..\</source\>\</lookup\>

**4.3 Custom JavaScript Functions**

For power users who need logic beyond the pre-built library:

**4.3.1 Function Definition Panel**

- Accessible via \'Define Custom Function\' button in the Function Selector or the toolbar.

- Opens a slide-over panel with:
  - **Function Name**: Text input (must be valid JS identifier)

  - **Description**: What this function does

  - **Parameters**: Editable list of parameter names (comma-separated)

  - **Function Body**: CodeMirror/Monaco editor with JavaScript syntax highlighting, auto-complete, and bracket matching

  - **Test Panel**: Enter sample parameter values, click Run, see the result. Matches the SunSystems Function Test dialog exactly.

  - **Validate button**: Checks JS syntax within the V8 sandbox

**4.3.2 Function Import**

- Users can import from the pre-built function library (matching SunSystems\' Import Functions dialog)

- Each library function shows: name, description, parameter list, and example usage

- Imported functions can be modified after import

**4.3.3 Security Constraints**

+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Sandbox Enforcement** |
| |
| All user-defined JavaScript executes in an isolated-vm V8 sandbox with: no filesystem access, no network access, 64MB memory limit, 5-second execution timeout, no require/import. The sandbox is created per-execution and destroyed after. Malicious code cannot escape the sandbox. |
+----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**4.4 For-Each / Iteration Handling**

When the source data has parent-child structures (e.g., one invoice header with many lines), the visual mapper must handle iteration:

- **Parent fields** (e.g., InvoiceHeader) show a \'repeating\' icon (loop arrow) in the source tree

- When a parent field is mapped, the system automatically sets does-for-each=yes

- Only ONE source field per map command can have does-for-each=yes --- the UI enforces this by disabling for-each on other sources when one is already set

- Leaf fields default to passes-value=yes; parent fields default to passes-value=no --- shown as toggle switches on the mapping properties panel

**4.5 TML Code View**

Power users can switch to the Code View at any time (matching SunSystems\' Change View toggle). The generated TML XML is shown in a syntax-highlighted editor. Changes in Code View are reflected in the visual mapper and vice versa.

+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **One-Way Code Edit Warning** |
| |
| SunSystems warns that once manual code edits are made in Script View, returning to TML Details view may fail if the code is invalid. HFP replicates this: the Code View shows a yellow banner \'Manual edits detected --- visual mapper may not reflect all changes\' and attempts to parse the TML back to visual state. If parsing fails, the visual mapper is disabled with a message directing the user to fix issues in Code View. |
+-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**5. Filter Designer**

Filters limit the data included in Export and Internal Transfer profiles. The Filter Designer is accessible from Step 6 of the profile wizard (for Export/Internal Transfer types) and as a standalone page.

**5.1 UI Design**

A visual query builder (similar to Airtable/Notion filters) replacing the SunSystems drag-and-drop Filter Designer:

- **Rule rows**: Each row contains: Field (dropdown of all source component fields), Operator (Equals, Not Equals, Greater Than, Less Than, Greater or Equal, Less or Equal, Contains, Starts With, Ends With, Is Null, Is Not Null, Between, In List), Value (appropriate input based on field type: text, number, date picker, multi-select).

- **Logic connectors**: AND / OR between rows. Rows can be grouped with parentheses for complex logic. The group is visualized as an indented block with a colored left border.

- **Add Rule / Add Group buttons**: Add a new single rule or a nested group of rules.

- **Preview SQL**: A read-only panel shows the generated WHERE clause for power users to verify.

- **Not Equals + NULL handling**: When Not Equals is selected, a checkbox \"Include NULL values\" is shown (defaulting to checked), matching the SunSystems behavior where Not Equals excludes NULL columns. This auto-generates the OR field IS NULL clause.

**5.2 Filter Storage (JSONB)**

Filters are stored as a recursive JSON tree in the transfer_filters.filter_clauses column:

---

**Field** **Type** **Description**

---

type \"rule\" \| \"group\" Whether this node is a single rule or a group of rules

logic \"AND\" \| \"OR\" For groups: the logic connecting child rules

field String For rules: the source field path

operator String For rules: eq, neq, gt, lt, gte, lte, contains, starts_with, ends_with, is_null, is_not_null, between, in_list

value Any For rules: the comparison value (or array for between/in_list)

include_nulls Boolean For neq rules: whether to include NULL values

children Array For groups: nested rules and groups

---

**5.3 Filter-to-SQL Compilation**

At execution time, the filter JSON is compiled to a parameterized PostgreSQL WHERE clause. The compiler:

- Recursively traverses the filter tree

- Maps each operator to SQL: eq → =, neq → \<\> (with optional OR field IS NULL), gt → \>, etc.

- Uses parameterized queries (\$1, \$2, \...) to prevent SQL injection

- Applies grouping with parentheses for nested logic

- Validates field names against the source component schema to prevent injection via field names

**6. Runtime Parameter Configuration**

Step 6 of the profile wizard and the profile detail editor both include the Runtime Parameters panel. This is the direct equivalent of the SunSystems General, Ledger Specific, Email Notification, and Consolidation tabs.

**6.1 Parameter Form UI**

Each parameter is rendered as a row with:

- **Label** --- The parameter name (e.g., \"Business Unit\", \"Target Ledger\")

- **Value input** --- Appropriate control: text input, dropdown, date picker, checkbox, entity picker (for account codes, supplier codes, etc.)

- **Overridable toggle** --- Switch on the right side. When ON (blue), the parameter can be changed at execution time. When OFF (grey), the value is locked. Matches the SunSystems Overridable checkbox exactly.

- **Required indicator** --- Red asterisk for mandatory parameters that must be set either on the profile or at runtime (with overridable=true).

**6.2 Parameter Groups**

Parameters are organized in collapsible sections:

**6.2.1 General Parameters (All Profile Types)**

---

**Parameter** **Control Type** **Notes**

---

Business Unit Entity picker (BU list) Leave blank to mandate entry at runtime

Save Payload Dropdown: None / Input / Output / Both Controls S3 archival of payloads

---

**6.2.2 File Parameters (Import / Export / External Transfer)**

---

**Parameter** **Control Type** **Notes**

---

File Source Dropdown: Upload / File Repository / API Upload = direct upload at runtime; Repository = select from S3 folders; API = webhook trigger

File Key / Path File picker (S3 browser) or text input S3 key for repository files

File Encoding Dropdown: UTF-8 / ASCII / UTF-16 / ISO-8859-1 Default UTF-8; shown only if overridable

Post-Processing Action Dropdown: None / Delete / Rename / Move Import only: what happens to source file after processing

Rename Pattern / Move Destination Text input Conditional: shown only if Rename or Move selected

Generate Unique Filename Toggle Export only: appends user + timestamp to filename

Overwrite Existing File Toggle Export only: mutually exclusive with Append

Append to Existing File Toggle Export only: mutually exclusive with Overwrite; XML append warning shown

---

**6.2.3 Ledger Parameters (When Source/Target = Ledger)**

---

**Parameter** **Control Type** **Notes**

---

Target Ledger Dropdown: A-K Mandatory for ledger target

Journal Type Text input (5 char alphanumeric) Mandatory at runtime if not on profile

Error Suspense Account Account picker (30 char) Account for unresolvable import errors

Transaction Amount Account Account picker (30 char) Account for transaction amounts

Reporting Amount Account Account picker (30 char) Account for reporting currency amounts

Allow Over-Budget Entries Toggle (Y/N) Profile-only (not overridable at runtime)

Default Posting Period Period picker (PPP/YYYY) Profile-only

Posting Options Dropdown: Post Immediately / Hold / Validate Only Overridable

Allow Posting to Suspended Accounts Dropdown: Allow / Block Profile-only

Post Provisional Dropdown: Yes / No / Only Provisional Profile-only

Post to Hold Dropdown: Yes / No Profile-only

Balancing Options Dropdown: Auto-Balance / Reject Unbalanced / Suspense Overridable

Post if No Errors Dropdown: Post All / Post None if Errors Overridable

---

**6.2.4 Range Control Parameters (Export with Ledger Source)**

---

**Parameter** **Control Type** **Notes**

---

Enable Range Control Toggle When enabled, shows range fields below

Journal Number From Number input (read-only after first run) Defaults to 1; auto-updates to previous To + 1

Journal Number To Number input (overridable) Defaults to highest posted journal number

Repeat Last Range Checkbox At runtime: re-export the previous range

---

**6.2.5 Consolidation/Summarization (Ledger Transfers)**

A dedicated sub-panel matching the SunSystems Consolidation Designer:

- **Enable Consolidation toggle**: When ON, reveals the consolidation editor

- **Schema field list** on the left: all available data elements from the ledger schema, each with a type icon (summable fields have a ∑ icon)

- **Consolidating Columns** drop zone (right top): drag fields here to group by them. Order determines grouping hierarchy (drag to reorder).

- **Summing Columns** drop zone (right bottom): drag summable fields here to total them.

- **Debit/Credit Handling** dropdown: (1) Sum debits and credits separately, (2) Net total, (3) Summarize debits only --- detail credits, (4) Summarize credits only --- detail debits.

**6.2.6 Email & Webhook Notifications**

---

**Parameter** **Control Type** **Notes**

---

Email Notification Toggle: Enabled / Disabled

Email Addresses Tag input (multi-email, semicolon separated) Not validated by system (per SunSystems); user warned to verify

Email Content Textarea Custom text appended to auto-generated success/failure message

Webhook Notification Toggle: Enabled / Disabled HFP-specific enhancement

Webhook URL URL input with validation Endpoint to POST results to

Webhook Events Multi-select: on_success, on_failure, on_start Which events trigger the webhook

Webhook Headers Key-value pair editor Custom headers (e.g., Authorization) for the webhook request

---

**7. Profile Execution Dialog**

When a user clicks \'Run\' on a profile, the Execution Dialog appears. This replaces the SunSystems Transfer Results dialog and the Runtime Override prompt.

**7.1 Pre-Execution: Runtime Override Form**

If any parameters are marked as Overridable, the dialog first shows an override form:

- Only overridable parameters are shown, pre-populated with the profile\'s default values

- Mandatory-but-blank parameters are highlighted with red borders

- File upload zone is shown if the source file must be provided at runtime

- A \'Review\' section shows the frozen parameter snapshot that will be used for execution

- \'Run\' button is disabled until all mandatory parameters are satisfied

**7.2 During Execution: Live Progress**

Once \'Run\' is clicked, the dialog transitions to the progress view:

- **Progress bar** with percentage and record count (Processed: 347 / 1,024)

- **Status indicator**: Spinning animation while running (matching SunSystems\' rotating indicator), green check on success, red X on failure

- **Live log stream** via Server-Sent Events (SSE): each record\'s success/failure is streamed as a log line. Failed records are highlighted in red with the error message inline.

- **Cancel button**: Sends a cancel signal to the BullMQ worker. Running record completes; remaining records are skipped.

- **Cannot close without cancelling**: If the user tries to navigate away, a browser confirmation dialog warns that the execution will continue in the background but the progress view will be lost.

**7.3 Post-Execution: Results Summary**

After execution completes:

- **Summary card**: Total records, succeeded count (green), failed count (red), duration

- **Download Payload buttons**: If payload saving was enabled, download links for input and output payloads

- **Failed Records table**: Expandable list of failed records with: record index, source data preview, error code, error message, and a \'Copy\' button to copy the record for debugging

- **\'View in History\' link**: Opens the full execution detail in the Transfer History page

- **\'Run Again\' button**: Pre-populates the override form with the same values for repeat execution

**8. Automation Builder**

The Automation Builder replaces the SunSystems Automation Designer. It provides a visual pipeline builder for sequencing profiles.

**8.1 Visual Pipeline UI**

- **Pipeline canvas**: Horizontal flow of profile cards connected by arrows. Each card shows: profile name, type icon, and status indicators.

- **Add Step**: Dropdown selector to pick from available profiles. Invalid profiles (is_valid = false) are greyed out with a tooltip explaining why.

- **Drag to reorder**: Cards can be dragged to change execution order.

- **Step settings** (click gear icon on card): Fail-on-Error toggle (default: ON), Source Parameter Overrides form, Target Parameter Overrides form. Changes do NOT modify the original profile.

- **Same profile, different params**: A profile can be added multiple times. Each instance is shown as a separate card with a badge showing \'Copy 1\', \'Copy 2\', etc.

- **Schedule panel** (sidebar): Cron schedule builder with human-readable description (e.g., \'Every day at 2:00 AM EAT\'). Timezone selector defaulting to tenant timezone. Enable/disable toggle. \'Run As\' user selector (must be a transfer:power-user or higher).

**8.2 Automation Execution**

When an automation runs, the progress view shows:

- **Pipeline progress**: Each card transitions through states: Queued (grey) → Running (blue pulse) → Success (green) / Failed (red) / Skipped (yellow)

- **Step drill-down**: Clicking a card opens its individual execution progress (same as profile execution dialog)

- **Fail-on-Error visualization**: When a step fails and Fail-on-Error is ON, remaining cards turn yellow (Skipped) with a chain-break icon between the failed and skipped steps

**8.3 Configuration Export / Import / Cleardown**

Available under /{tenant}/transfer-desk/settings (Admin only):

**8.3.1 Configuration Export**

- Tree view of all Transfer Desk objects: Automations, Profiles, Formats, Transformations, Filters, Lookup Tables

- Select All / deselect individual items with checkboxes (matching SunSystems Configuration Export dialog)

- Click Export: generates a JSON file stored in S3 and provides a download link

- Export log shows record counts per object type

**8.3.2 Configuration Import**

- Upload a previously exported JSON configuration file

- Preview panel shows what will be imported with conflict detection (name collisions)

- Conflict resolution options: Skip, Overwrite, Rename (append suffix)

- Import log shows success/failure counts

**8.3.3 Configuration Cleardown**

- Big red \'Clear All Transfer Desk Data\' button with warning text

- First click: shows a confirmation dialog with the text \'This will permanently delete ALL profiles, automations, formats, transformations, filters, and lookup tables. Type the tenant name to confirm.\'

- User must type the exact tenant name. A confirmation token is generated (valid 60 seconds).

- Second confirmation: \'This action cannot be undone. Proceed?\' with the token submitted.

- Progress bar shows cleardown progress.

**9. Lookup Table Editor**

A spreadsheet-style editor matching the SunSystems Lookup Table Designer, with an enhanced UI.

**9.1 UI Design**

- **Table metadata bar**: Table name, description (editable inline), Business Unit selector (dropdown: \'Global Data\' or specific BU)

- **Spreadsheet grid**: Columns are lookup table columns; rows represent ranges. First two columns are always \'Range From\' and \'Range To\' (non-deletable).

- **Add Column button**: Opens a dialog for column name (must be unique). New column appears on the right.

- **Add Row button**: Opens a dialog for Range From and Range To values. Validates no overlap with existing rows.

- **Cell editing**: Clicking a cell opens the Column Value dialog with 5 value types: Constant (text input), Copy original value, Map other source value (field path input), Omit value, Reverse sign. Matches SunSystems exactly.

- **Delete Row / Delete Column**: With confirmation dialogs. Cannot delete if referenced by a transformation.

- **Business Unit switcher**: Changing the BU reloads the grid with BU-specific data. Global Data shows all non-BU-specific rows.

+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| **Alpha Collation Warning (Shown in UI)** |
| |
| A persistent yellow banner at the top of the Lookup Table Editor reads: \'Lookup tables use alphabetical ordering, not numeric. For numeric ranges, zero-pad values (e.g., 001-009 instead of 1-9). Numeric ranges like dates, journal numbers, and financial amounts should NOT use lookup tables.\' This matches the repeated SunSystems documentation warning. |
+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+

**10. File Repository Browser**

Replaces SunSystems Server Folder Management. A modern file browser UI backed by S3.

**10.1 UI Design**

- **Folder tree** (left sidebar): Hierarchical folder structure. Root is auto-created per tenant. Folders show assigned role badges.

- **File list** (main area): Table showing: filename, size, encoding, uploaded by, uploaded date. Click to preview (text files show first 50 lines; CSV files show parsed table).

- **Upload zone** (drag-and-drop area at top of file list): Admin only. Drag files or click to browse. Shows upload progress with S3 multipart upload.

- **Download button**: Generates a pre-signed S3 URL (valid 15 minutes) and triggers download.

- **Folder management** (Admin only): Create Folder dialog (name, description, assign roles), Delete Folder (must be empty), Edit Folder (rename, change role assignments).

- **Role-based visibility**: Users only see folders they have access to. The folder tree is filtered server-side based on the user\'s Keycloak roles.

**11. Transfer History Viewer**

Replaces SunSystems TRH Transfer History Viewer. A dual-tab view matching the SunSystems Automation and Transfer tabs.

**11.1 Automation History Tab**

---

**Column** **Sortable** **Filterable** **Description**

---

Automation Name Yes Yes (search) Name of the automation that was run

Start Time Yes Yes (date range) When the automation began

End Time Yes Yes (date range) When the automation finished

Tasks Yes No Number of profile steps in the automation

Succeeded Yes No Number of steps that succeeded

Failed Yes Yes (\> 0 filter) Number of steps that failed

Status Yes Yes (dropdown) Overall: completed, partial_failure, failed, cancelled

Triggered By Yes Yes (user search) User or \'Scheduled\' + cron details

---

**11.2 Transfer History Tab**

---

**Column** **Sortable** **Filterable** **Description**

---

Profile Name Yes Yes (search) Profile that was executed

Profile Type Yes Yes (dropdown) Import / Export / Process / Internal / External

Start Time Yes Yes (date range) When the execution began

End Time Yes Yes (date range) When the execution finished

Records Succeeded Yes No Count of successful records

Records Failed Yes Yes (\> 0 filter) Count of failed records

Status Yes Yes (dropdown) completed, failed, cancelled, running, queued

User ID Yes Yes (user search) Who triggered the execution

Component Yes Yes (dropdown) Source or target component

Method Yes No Import method / export method

Input Payload No No View / Download button (if saved)

Output Payload No No View / Download button (if saved)

---

**11.3 Execution Detail View**

Double-clicking a row (matching SunSystems\' double-click behavior) opens the Execution Detail view:

- **Summary card**: Profile name, type, start/end times, duration, record counts, status, user ID

- **Runtime parameters snapshot**: Frozen copy of all parameters used (including overrides)

- **Filter details**: If a filter was applied, show the filter name and generated SQL

- **File details**: Source/target file names and S3 keys

- **Record-level log table**: Paginated, searchable table of per-record results with columns: Index, Status (success/failed/skipped icon), Source Data (JSON preview, expandable), Transformed Data (JSON preview), Error Code, Error Message

- **Payload viewers**: If payloads were saved, inline viewer with syntax highlighting (XML/JSON) for payloads under 5MB. For larger payloads, download link only (matching SunSystems\' recommendation for files over 50MB).

- **Export button**: Export the execution log to CSV/Excel (matching SunSystems\' CTRL+C clipboard functionality with a more modern approach)

- **Drill-up**: For automation-triggered executions, a link \'Part of automation: {name}\' navigates to the automation execution detail

**12. Complete User Workflow Examples**

**12.1 Example: Create a Custom Bank Statement Import**

A finance manager at a new property needs to import bank statements from a local bank that uses a proprietary CSV format.

1.  Navigate to /{tenant}/transfer-desk/profiles/new?type=import

2.  Step 1 (Basics): Enter name \'NMB Bank Statement Import\', description \'Daily bank statement import from NMB CSV exports\'. Type is pre-selected as Import.

3.  Step 2 (Source): Drag the sample NMB CSV file onto the upload zone. System auto-detects: Delimited (comma), UTF-8, has headers. Preview shows columns: Date, Reference, Description, Debit, Credit, Balance. Confidence: 97%.

4.  Step 3 (Target): Select \'Ledger\' as the target component.

5.  Step 4 (Format): Review the auto-detected format. Rename \'Date\' field to \'TransactionDate\' for clarity. Accept the generated FSD. Save format as \'NMB Bank Statement Format\'.

6.  Step 5 (Mapping): The visual mapper shows NMB fields on the left, Ledger fields on the right. Drag TransactionDate → TransactionDate. Drag Reference → Description. For AccountCode, right-click and Set Fixed Value to \'1200\' (bank account). For Amount, select \'Transform with Function\' and choose the pre-built \'ifThenElse\' function: if Debit \> 0, use Debit (negative); else use Credit (positive). Set JournalType fixed to \'BNK\'. Save transformation as \'NMB to Ledger\'.

7.  Step 6 (Parameters): Set Business Unit to \'EZZ\', Target Ledger to \'A\', Journal Type to \'BNK\', Error Suspense Account to \'9999\', Posting Options to \'Hold\'. Mark Business Unit and Posting Options as overridable.

8.  Step 7 (Notifications): Enable email notification to finance@hotel.com. Enable webhook to the internal Slack integration URL.

9.  Step 8 (Review): All validations pass (green checkmarks). Click \'Save Profile\'. The profile appears in the profile list with a green valid indicator.

**12.2 Example: Create a Custom GL Export to Head Office**

Head office requires a monthly GL extract in a specific pipe-delimited format.

1.  Navigate to /{tenant}/transfer-desk/profiles/new?type=export

2.  Step 1 (Basics): Name \'Monthly GL Export to HQ\'. Type: Export.

3.  Step 2 (Source): Select \'Ledger\' as source component.

4.  Step 3 (Target): Choose \'Create New Format\'. Upload a sample file provided by head office showing the expected output format. System detects: pipe-delimited, no headers, fields: BUCode\|Period\|AccountCode\|Amount\|Currency\|Description.

5.  Step 4 (Format): Confirm the 6 fields. Name the format \'HQ GL Format\'. Enable range control on the Ledger Specific section.

6.  Step 5 (Mapping): Map Ledger.BusinessUnit → BUCode, Ledger.PostingPeriod → Period, Ledger.AccountCode → AccountCode, Ledger.Amount → Amount, Ledger.CurrencyCode → Currency, Ledger.Description → Description. Use the \'formatDate\' function on Period to match HQ\'s format (YYYY-MM).

7.  Step 6 (Parameters): Set Business Unit to \'EZZ\', Source Ledger to \'A\'. Enable Range Control. Create a filter \'Exclude Suspense\' with rule: AccountCode Not Equals \'9999\' (include nulls). Set Save Payload to \'Output\'. Set file handling to Generate Unique Filename = Yes.

8.  Step 7 (Notifications): Enable email to hq-finance@chain.com on success only.

9.  Step 8 (Review): Save. The profile is ready for monthly use with audit-safe journal range control.

**12.3 Example: Build an Automation for Night Audit**

The night auditor wants to automate the entire end-of-day integration: import Opera revenue, import Simphony POS, post all held journals, export daily GL to head office.

1.  Navigate to /{tenant}/transfer-desk/automations/new

2.  Name: \'Night Audit Automation\'. Description: \'End-of-day integration sequence.\'

3.  Add Step 1: Select \'Opera Revenue Import\' (system profile). Fail-on-Error: ON.

4.  Add Step 2: Select \'Simphony POS Revenue Import\' (system profile). Fail-on-Error: ON.

5.  Add Step 3: Select \'Opera City Ledger Import\'. Fail-on-Error: ON.

6.  Add Step 4: Select \'Opera Miscellaneous Import\'. Fail-on-Error: OFF (non-critical; some days have no misc charges).

7.  Add Step 5: Create or select a Process profile for \'Post Held Journals\'. Fail-on-Error: ON.

8.  Add Step 6: Select \'Monthly GL Export to HQ\' (custom profile created above). Override the filename to include today\'s date. Fail-on-Error: OFF.

9.  Save the automation. The pipeline canvas shows 6 connected cards.

10. Set up a cron schedule: \'0 2 \* \* \*\' (2:00 AM daily), timezone: Africa/Dar_es_Salaam, Run As: night-auditor@ezz.com.

11. Enable the schedule. The automation will run automatically every night.

**13. Self-Service API Endpoints (Additions)**

These endpoints supplement the API specification in the companion document (v1.0) with self-service-specific functionality:

---

**Method** **Endpoint** **Description**

---

POST /api/{tenant}/transfer/formats/detect Auto-detect format from uploaded sample file. Returns classification, fields, FSD XML, confidence score.

POST /api/{tenant}/transfer/formats/{id}/preview Parse a sample file using the format definition. Returns preview rows for UI display.

GET /api/{tenant}/transfer/components List available HFP components (Ledger, AP, AR, etc.) with their field schemas for the source/target selectors.

GET /api/{tenant}/transfer/components/{name}/schema Get the full field schema for a component (field name, data type, required flag, description).

POST /api/{tenant}/transfer/transformations/{id}/auto-map Generate automatic 1:1 field mappings for matching field names between source and target.

GET /api/{tenant}/transfer/functions/library List all pre-built JavaScript transformation functions with metadata, parameters, and examples.

POST /api/{tenant}/transfer/functions/test Execute a JavaScript function in the sandbox with sample parameters. Returns result or error.

GET /api/{tenant}/transfer/profiles/{id}/validate-full Deep validation: checks profile, format, transformation, lookup references, and parameter completeness.

POST /api/{tenant}/transfer/profiles/{id}/dry-run Execute the profile against a sample file without actually importing/exporting data. Returns what WOULD happen.

GET /api/{tenant}/transfer/executions/stats Dashboard stats: executions by day, success rate, average duration, most-run profiles.

GET /api/{tenant}/license/entitlements Returns the tenant\'s Transfer Desk entitlements for UI feature gating.

---

**14. HFP Component Schemas**

The self-service mapper needs to know the field structure of each HFP component so it can render the source/target field trees. These schemas are exposed via the /components/{name}/schema API and used by the visual mapper.

**14.1 Ledger Component Schema**

---

**Field Path** **Data Type** **Required** **Description**

---

Ledger/JournalNumber Integer Auto System-assigned journal sequence number

Ledger/JournalType String(5) Yes Journal type code (e.g., BNK, POS, AP)

Ledger/AccountCode String(30) Yes General ledger account code from COA

Ledger/AnalysisCode1 String(30) No Analysis dimension 1 (department/cost center)

Ledger/AnalysisCode2 String(30) No Analysis dimension 2 (project/activity)

Ledger/AnalysisCode3 String(30) No Analysis dimension 3 (custom)

Ledger/AnalysisCode4-10 String(30) No Analysis dimensions 4 through 10

Ledger/Amount Decimal(18,2) Yes Transaction amount in transaction currency

Ledger/BaseAmount Decimal(18,2) No Amount in base/reporting currency

Ledger/CurrencyCode String(3) Yes ISO 4217 currency code

Ledger/ExchangeRate Decimal(18,8) No FX rate used for conversion

Ledger/TransactionDate Date Yes Transaction date (YYYY-MM-DD)

Ledger/PostingPeriod String(8) Yes Posting period (PPP/YYYY)

Ledger/Description String(255) No Journal line description/narrative

Ledger/Reference String(30) No External reference (invoice no., check no.)

Ledger/DebitCredit String(1) Auto D or C (derived from Amount sign)

Ledger/BusinessUnit String(20) Yes Business unit code

Ledger/TransactionReference String(30) No Cross-reference to source document

Ledger/DueDate Date No Payment due date (AP/AR)

Ledger/AllocationMarker String(1) No Allocation flag

---

**14.2 Supplier Master Schema**

---

**Field Path** **Data Type** **Required** **Description**

---

Supplier/SupplierCode String(30) Yes Unique supplier identifier

Supplier/SupplierName String(100) Yes Supplier legal name

Supplier/Address1-5 String(100) No Address lines 1 through 5

Supplier/TaxID String(30) No Tax identification number (TIN/VAT)

Supplier/PaymentMethod String(10) No Default payment method code

Supplier/PaymentTerms String(10) No Payment terms code

Supplier/DefaultAccountCode String(30) No Default expense account

Supplier/CurrencyCode String(3) No Default transaction currency

Supplier/BankAccountName String(100) No Bank account holder name

Supplier/BankAccountNumber String(30) No Bank account number

Supplier/BankSortCode String(20) No Bank sort/routing code

Supplier/BankSwiftCode String(11) No SWIFT/BIC code

Supplier/Status String(10) Yes Active / Suspended / Closed

---

**14.3 Additional Component Schemas**

Full schemas for Customer Master, Chart of Accounts, Address Book, Purchase Order, Budget, Accounts Payable, and Accounts Receivable components follow the same pattern and are exposed via the /components/{name}/schema API endpoint. Each schema is maintained in code as a TypeScript interface and auto-generated into the API response, ensuring the visual mapper always reflects the current data model.

**15. Complete Permissions Matrix**

This matrix defines exactly what each Transfer Desk role can do across all self-service features:

---

**Action** **User** **Power User** **Designer** **Admin**

---

View profile list ✓ ✓ ✓ ✓

View profile detail ✓ ✓ ✓ ✓

Run profile (no overrides) ✓ ✓ ✓ ✓

Run profile (with overrides) ✗ ✓ ✓ ✓

Create profile ✗ ✗ ✓ ✓

Edit profile ✗ ✗ ✓ ✓

Delete profile ✗ ✗ ✓ ✓

Clone profile ✗ ✗ ✓ ✓

Create/edit format ✗ ✗ ✓ ✓

Create/edit transformation ✗ ✗ ✓ ✓

Create/edit lookup table ✗ ✗ ✓ ✓

Create/edit filter ✗ ✗ ✓ ✓

Create/edit automation ✗ ✗ ✓ ✓

Run automation ✗ ✓ ✓ ✓

Create/manage cron schedules ✗ ✗ ✓ ✓

View execution history ✓ ✓ ✓ ✓

View/download payloads ✗ ✓ ✓ ✓

Browse file repository ✓ (own folders) ✓ (own folders) ✓ (own folders) ✓ (all folders)

Upload files to repository ✗ ✗ ✗ ✓

Create/delete folders ✗ ✗ ✗ ✓

Assign folder access groups ✗ ✗ ✗ ✓

Configuration export ✗ ✗ ✗ ✓

Configuration import ✗ ✗ ✗ ✓

Configuration cleardown ✗ ✗ ✗ ✓

Write custom JavaScript functions ✗ ✗ ✓ ✓

Use pre-built function library ✗ ✗ ✓ ✓

Dry-run (test) profiles ✗ ✓ ✓ ✓

Cancel running executions ✗ ✓ ✓ ✓

Purge execution history ✗ ✗ ✗ ✓

---
