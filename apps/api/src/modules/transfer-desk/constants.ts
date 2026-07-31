/**
 * Transfer Desk server-side constants.
 *
 * HFP target journal fields (§18) and pre-built function library (§7).
 * Served by the mappings router as read-only reference data.
 */

// ── HFP Target Journal Fields (§18) ──────────────────────────────────────────

export type HfpTargetField = {
  path: string;
  label: string;
  group: string;
  type: string;
  required: boolean;
};

export const HFP_TARGET_FIELDS: ReadonlyArray<HfpTargetField> = [
  // Journal Header
  {
    path: "journal.date",
    label: "Transaction Date",
    group: "Journal Header",
    type: "date",
    required: true
  },
  {
    path: "journal.period",
    label: "Accounting Period",
    group: "Journal Header",
    type: "string",
    required: false
  },
  {
    path: "journal.source",
    label: "Journal Source Code",
    group: "Journal Header",
    type: "string",
    required: true
  },
  {
    path: "journal.reference",
    label: "External Reference",
    group: "Journal Header",
    type: "string",
    required: false
  },
  {
    path: "journal.description",
    label: "Journal Description",
    group: "Journal Header",
    type: "string",
    required: false
  },
  {
    path: "journal.currency",
    label: "ISO Currency Code",
    group: "Journal Header",
    type: "string",
    required: true
  },
  {
    path: "journal.exchangeRate",
    label: "Exchange Rate",
    group: "Journal Header",
    type: "decimal",
    required: false
  },
  {
    path: "journal.entity",
    label: "Entity Code",
    group: "Journal Header",
    type: "string",
    required: false
  },
  // Journal Line
  {
    path: "line.sequence",
    label: "Line Sequence",
    group: "Journal Line",
    type: "integer",
    required: false
  },
  {
    path: "line.account",
    label: "GL Account Code",
    group: "Journal Line",
    type: "account",
    required: true
  },
  {
    path: "line.debit",
    label: "Debit (Base Currency)",
    group: "Journal Line",
    type: "decimal",
    required: false
  },
  {
    path: "line.credit",
    label: "Credit (Base Currency)",
    group: "Journal Line",
    type: "decimal",
    required: false
  },
  {
    path: "line.transactionDebit",
    label: "Debit (Transaction Currency)",
    group: "Journal Line",
    type: "decimal",
    required: false
  },
  {
    path: "line.transactionCredit",
    label: "Credit (Transaction Currency)",
    group: "Journal Line",
    type: "decimal",
    required: false
  },
  {
    path: "line.description",
    label: "Line Description",
    group: "Journal Line",
    type: "string",
    required: false
  },
  {
    path: "line.reference",
    label: "Line Reference",
    group: "Journal Line",
    type: "string",
    required: false
  },
  { path: "line.dueDate", label: "Due Date", group: "Journal Line", type: "date", required: false },
  {
    path: "line.quantity",
    label: "Quantity",
    group: "Journal Line",
    type: "decimal",
    required: false
  },
  {
    path: "line.unitPrice",
    label: "Unit Price",
    group: "Journal Line",
    type: "decimal",
    required: false
  },
  {
    path: "line.taxCode",
    label: "Tax Code",
    group: "Journal Line",
    type: "string",
    required: false
  },
  {
    path: "line.taxAmount",
    label: "Tax Amount",
    group: "Journal Line",
    type: "decimal",
    required: false
  },
  // Analysis Dimensions
  {
    path: "line.analysisCode1",
    label: "Department (Dim 1)",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  },
  {
    path: "line.analysisCode2",
    label: "Cost Centre (Dim 2)",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  },
  {
    path: "line.analysisCode3",
    label: "Project (Dim 3)",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  },
  {
    path: "line.analysisCode4",
    label: "Dimension 4",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  },
  {
    path: "line.analysisCode5",
    label: "Dimension 5",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  },
  {
    path: "line.analysisCode6",
    label: "Dimension 6",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  },
  {
    path: "line.analysisCode7",
    label: "Dimension 7",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  },
  {
    path: "line.analysisCode8",
    label: "Dimension 8",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  },
  {
    path: "line.analysisCode9",
    label: "Dimension 9",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  },
  {
    path: "line.analysisCode10",
    label: "Dimension 10",
    group: "Analysis Dimensions",
    type: "string",
    required: false
  }
];

// ── Pre-built Function Library (§7) ──────────────────────────────────────────

export type PrebuiltFunctionParam = {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  description: string;
  required: boolean;
  defaultValue?: unknown;
};

export type PrebuiltFunction = {
  id: string;
  name: string;
  description: string;
  category: "core" | "hospitality";
  params: PrebuiltFunctionParam[];
};

export const PREBUILT_FUNCTIONS: ReadonlyArray<PrebuiltFunction> = [
  // ── Core Functions ──
  {
    id: "fn_trim",
    name: "Trim Whitespace",
    description: "Trim leading and trailing whitespace",
    category: "core",
    params: []
  },
  {
    id: "fn_upper",
    name: "Uppercase",
    description: "Convert to uppercase",
    category: "core",
    params: []
  },
  {
    id: "fn_lower",
    name: "Lowercase",
    description: "Convert to lowercase",
    category: "core",
    params: []
  },
  {
    id: "fn_pad_left",
    name: "Pad Left",
    description: "Left-pad with character to specified length",
    category: "core",
    params: [
      { name: "char", type: "string", description: "Padding character", required: true },
      { name: "length", type: "number", description: "Target length", required: true }
    ]
  },
  {
    id: "fn_pad_right",
    name: "Pad Right",
    description: "Right-pad with character to specified length",
    category: "core",
    params: [
      { name: "char", type: "string", description: "Padding character", required: true },
      { name: "length", type: "number", description: "Target length", required: true }
    ]
  },
  {
    id: "fn_date_format",
    name: "Date Format",
    description: "Convert date between formats",
    category: "core",
    params: [
      { name: "inputFormat", type: "string", description: "Source date format", required: true },
      { name: "outputFormat", type: "string", description: "Target date format", required: true }
    ]
  },
  {
    id: "fn_number_format",
    name: "Number Format",
    description: "Format number with decimal places and separators",
    category: "core",
    params: [
      { name: "decimals", type: "number", description: "Decimal places", required: true },
      {
        name: "thousandsSep",
        type: "string",
        description: "Thousands separator",
        required: false,
        defaultValue: ","
      },
      {
        name: "decimalSep",
        type: "string",
        description: "Decimal separator",
        required: false,
        defaultValue: "."
      }
    ]
  },
  {
    id: "fn_substring",
    name: "Substring",
    description: "Extract substring from value",
    category: "core",
    params: [
      { name: "start", type: "number", description: "Start position (0-based)", required: true },
      { name: "length", type: "number", description: "Number of characters", required: true }
    ]
  },
  {
    id: "fn_replace",
    name: "Replace",
    description: "Find and replace in string",
    category: "core",
    params: [
      { name: "find", type: "string", description: "Search string or regex", required: true },
      { name: "replace", type: "string", description: "Replacement string", required: true },
      {
        name: "regex",
        type: "boolean",
        description: "Treat find as regex",
        required: false,
        defaultValue: false
      }
    ]
  },
  {
    id: "fn_lookup",
    name: "Lookup",
    description: "Map value via lookup table",
    category: "core",
    params: [
      { name: "tableId", type: "string", description: "Lookup table ID", required: true },
      { name: "defaultValue", type: "string", description: "Fallback if no match", required: false }
    ]
  },
  {
    id: "fn_divide",
    name: "Divide",
    description: "Divide value by a number",
    category: "core",
    params: [{ name: "divisor", type: "number", description: "Divisor", required: true }]
  },
  {
    id: "fn_multiply",
    name: "Multiply",
    description: "Multiply value by a number",
    category: "core",
    params: [{ name: "multiplier", type: "number", description: "Multiplier", required: true }]
  },
  {
    id: "fn_default",
    name: "Default Value",
    description: "Use fallback if value is empty or null",
    category: "core",
    params: [
      { name: "defaultValue", type: "string", description: "Fallback value", required: true }
    ]
  },
  {
    id: "fn_concat_fields",
    name: "Concatenate Fields",
    description: "Join multiple fields together",
    category: "core",
    params: [
      {
        name: "fields",
        type: "object",
        description: "Array of field names to join",
        required: true
      },
      {
        name: "separator",
        type: "string",
        description: "Separator between values",
        required: false,
        defaultValue: ""
      }
    ]
  },
  {
    id: "fn_split_field",
    name: "Split Field",
    description: "Split value and take Nth part",
    category: "core",
    params: [
      { name: "delimiter", type: "string", description: "Split delimiter", required: true },
      { name: "index", type: "number", description: "Part index (0-based)", required: true }
    ]
  },
  {
    id: "fn_currency_code",
    name: "Currency Code",
    description: "Map currency abbreviation to ISO code",
    category: "core",
    params: [
      {
        name: "mappings",
        type: "object",
        description: "Source \u2192 ISO code mappings",
        required: true
      }
    ]
  },
  {
    id: "fn_account_segment",
    name: "Account Segment",
    description: "Extract segment from composite account code",
    category: "core",
    params: [
      { name: "delimiter", type: "string", description: "Account code delimiter", required: true },
      {
        name: "segmentIndex",
        type: "number",
        description: "Segment index (0-based)",
        required: true
      }
    ]
  },
  // ── Hospitality-Specific Functions ──
  {
    id: "fn_opera_date",
    name: "Opera Date Parse",
    description: "Parse Opera PMS date formats (YYYYMMDD, YYMMDD)",
    category: "hospitality",
    params: [
      {
        name: "format",
        type: "string",
        description: "Date format (YYYYMMDD or YYMMDD)",
        required: true
      }
    ]
  },
  {
    id: "fn_jana_amount",
    name: "Jana Amount",
    description: "Apply \u00F71000 divisor for Jana internal movement files",
    category: "hospitality",
    params: []
  },
  {
    id: "fn_simphony_rvc",
    name: "Simphony RVC Map",
    description: "Map Simphony RVC code to department",
    category: "hospitality",
    params: [
      {
        name: "rvcMappings",
        type: "object",
        description: "RVC code \u2192 department mappings",
        required: true
      }
    ]
  },
  {
    id: "fn_usali_map",
    name: "USALI Department Map",
    description: "Map account to USALI department code",
    category: "hospitality",
    params: [
      {
        name: "usaliVersion",
        type: "string",
        description: "USALI version (e.g. '12th')",
        required: true
      }
    ]
  },
  {
    id: "fn_entity_code",
    name: "Entity Code",
    description: "Map property code to HFP entity ID",
    category: "hospitality",
    params: []
  },
  {
    id: "fn_tax_extract",
    name: "Tax Extractor",
    description: "Split gross amount into net + tax",
    category: "hospitality",
    params: [
      {
        name: "taxRate",
        type: "number",
        description: "Tax rate (e.g. 0.15 for 15%)",
        required: true
      },
      {
        name: "taxInclusive",
        type: "boolean",
        description: "Whether amount is tax-inclusive",
        required: true
      }
    ]
  }
];
