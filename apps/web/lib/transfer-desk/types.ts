/**
 * Transfer Desk Profile Wizard — TypeScript types.
 *
 * Covers all domain types from Session B spec §1-§4:
 * profiles, FSD schemas, TML mappings, lookup tables,
 * wizard state, validation rules, and test/preview.
 */

// ── Enums & Literals ─────────────────────────────────────────────────────────

export type ProfileType =
  | "IMPORT"
  | "EXPORT"
  | "INTERNAL_TRANSFER"
  | "EXTERNAL_TRANSFER"
  | "PROCESS";

export type ProfileStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";

export type TransformType =
  | "direct"
  | "lookup"
  | "expression"
  | "function"
  | "concat"
  | "split"
  | "static";

export type ErrorHandlingStrategy = "REJECT_ROW" | "REJECT_FILE" | "QUARANTINE";

export type DuplicateAction = "SKIP" | "OVERWRITE" | "ERROR";

export type JournalBatchGrouping = "PER_FILE" | "PER_ROW" | "PER_N_ROWS";

export type ScheduleType = "CRON" | "FILE_WATCH" | "EVENT_DRIVEN" | "MANUAL";

export type FormatType = "csv" | "tsv" | "fixed" | "xlsx" | "xml_ssml";

export type FsdFieldType =
  | "string"
  | "integer"
  | "decimal"
  | "currency"
  | "date"
  | "datetime"
  | "boolean"
  | "enum"
  | "account";

export type LineEnding = "CRLF" | "LF";

// ── Wizard Step ──────────────────────────────────────────────────────────────

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export type WizardStepInfo = {
  step: WizardStep;
  label: string;
  description: string;
  /** Whether this step applies to the current profile type */
  applicable: boolean;
};

// ── Profile ──────────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  name: string;
  description: string | null;
  profileType: ProfileType;
  status: ProfileStatus;
  entityId: string;
  journalSourceCode: string | null;
  targetLedgerId: string | null;
  tags: string[];
  version: number;
  fsdSchemaId: string | null;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type ProfileVersion = {
  id: string;
  profileId: string;
  version: number;
  config: Record<string, unknown>;
  createdAt: string;
  createdBy: string | null;
};

export type ProfileListFilters = {
  profileType?: ProfileType;
  status?: ProfileStatus;
  entityId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type ProfileCreateInput = {
  name: string;
  description?: string;
  profileType: ProfileType;
  entityId: string;
  journalSourceCode?: string;
  targetLedgerId?: string;
  tags?: string[];
};

export type ProfileUpdateInput = Partial<ProfileCreateInput> & {
  fsdSchema?: FsdSchemaInput;
  tmlMappings?: TmlMapping[];
  validationRules?: ValidationRule[];
  postingOptions?: PostingOptions;
  errorHandling?: ErrorHandlingConfig;
  duplicateDetection?: DuplicateDetectionConfig;
};

export type ProfileStatusChangeInput = {
  status: ProfileStatus;
};

// ── FSD Schema (wizard-facing subset) ────────────────────────────────────────

export type FsdFormatConfig = {
  type: FormatType;
  delimiter?: string;
  quoteChar?: string;
  escapeChar?: string;
  encoding?: string;
  hasHeaderRow?: boolean;
  lineEnding?: LineEnding;
  /** Sheet index for XLSX (0-based) */
  sheetIndex?: number;
  /** Rows to skip before header row */
  skipRowsBeforeHeader?: number;
  /** XML root element for XML/SSML */
  xmlRootElement?: string;
  /** Fixed-width record length */
  fixedRecordLength?: number;
};

export type FsdFieldConfig = {
  name: string;
  target: string;
  type: FsdFieldType;
  /** Column name (CSV/TSV with header) */
  columnName?: string;
  /** Column index (CSV/TSV without header, 0-based) */
  columnIndex?: number;
  /** Fixed-width start position */
  fixedStart?: number;
  /** Fixed-width field length */
  fixedLength?: number;
  /** XML element path (dot-notation) */
  xmlPath?: string;
  /** Date format pattern (e.g. "DD/MM/YYYY") */
  dateFormat?: string;
  /** Division factor for raw numeric values — ALWAYS opt-in, never default */
  decimalDivisor?: number;
  /** Decimal precision for validation */
  precision?: number;
  required?: boolean;
  defaultValue?: string;
  /** Skip this field during processing */
  ignoreField?: boolean;
  /** Allowed values for enum type */
  allowedValues?: string[];
  /** Regex pattern for validation */
  pattern?: string;
  /** Min value for numeric fields */
  min?: number;
  /** Max value for numeric fields */
  max?: number;
};

export type FsdSchemaInput = {
  version: string;
  format: FsdFormatConfig;
  fields: FsdFieldConfig[];
  options?: {
    maxErrors?: number;
    skipBlankRows?: boolean;
    strictMode?: boolean;
    outputNullAs?: string;
  };
};

// ── Auto-detection result ────────────────────────────────────────────────────

export type FormatDetectionResult = {
  detectedFormat: FsdFormatConfig;
  confidence: number;
  suggestedFields: FsdFieldConfig[];
  sampleRows: Record<string, unknown>[];
};

export type SchemaValidationResult = {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
};

export type ParsePreviewResult = {
  rows: Array<Record<string, unknown>>;
  errors: Array<{
    rowIndex: number;
    fieldName: string;
    errorCode: string;
    message: string;
  }>;
  rowCount: number;
};

// ── TML Mapping ──────────────────────────────────────────────────────────────

export type TmlMapping = {
  id: string;
  sourceField: string;
  targetField: string;
  transform: TmlTransform | null;
};

export type TmlTransform = {
  type: TransformType;
  // lookup
  lookupTableId?: string;
  lookupSourceColumn?: string;
  lookupTargetColumn?: string;
  lookupDefaultValue?: string;
  // expression
  expression?: string;
  // function
  functionId?: string;
  functionParams?: Record<string, unknown>;
  // concat
  additionalSources?: string[];
  separator?: string;
  // split
  splitDelimiter?: string;
  splitIndex?: number;
  // static
  staticValue?: string;
};

// ── Lookup Tables ────────────────────────────────────────────────────────────

export type LookupTable = {
  id: string;
  name: string;
  description: string | null;
  columns: string[];
  entries: LookupEntry[];
  createdAt: string;
  updatedAt: string;
};

export type LookupEntry = {
  id: string;
  values: Record<string, string>;
};

export type LookupTableCreateInput = {
  name: string;
  description?: string;
  columns: string[];
  entries?: Array<{ values: Record<string, string> }>;
};

export type LookupTableUpdateInput = Partial<LookupTableCreateInput>;

// ── Validation Rules ─────────────────────────────────────────────────────────

export type ValidationRuleType =
  | "REQUIRED"
  | "CROSS_FIELD"
  | "RANGE"
  | "PATTERN"
  | "CUSTOM_EXPRESSION";

export type ValidationRule = {
  id: string;
  type: ValidationRuleType;
  /** Target field (dot-notation) */
  field: string;
  /** Human-readable description */
  description: string;
  /** Rule-specific configuration */
  config: ValidationRuleConfig;
  /** Whether to treat failure as error vs warning */
  severity: "error" | "warning";
};

export type ValidationRuleConfig = {
  // CROSS_FIELD
  otherField?: string;
  condition?: string;
  // RANGE
  min?: number;
  max?: number;
  // PATTERN
  pattern?: string;
  // CUSTOM_EXPRESSION
  expression?: string;
};

// ── Error Handling & Duplicate Detection ─────────────────────────────────────

export type ErrorHandlingConfig = {
  strategy: ErrorHandlingStrategy;
  maxErrors?: number;
};

export type DuplicateDetectionConfig = {
  enabled: boolean;
  keyFields: string[];
  action: DuplicateAction;
};

// ── Posting Options ──────────────────────────────────────────────────────────

export type PostingOptions = {
  autoPost: boolean;
  requireApproval: boolean;
  batchGrouping: JournalBatchGrouping;
  batchSize?: number;
};

// ── Test & Preview ───────────────────────────────────────────────────────────

export type TestProgressStep = "parsing" | "mapping" | "validation" | "complete";

export type TestProgressEvent = {
  step: TestProgressStep;
  current: number;
  total: number;
  message: string;
};

export type TestCompleteEvent = {
  summary: TestSummary;
};

export type TestSummary = {
  testId: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  warnings: number;
};

export type TestResults = {
  testId: string;
  summary: TestSummary;
  parsedRows: Array<Record<string, unknown>>;
  mappedRows: Array<Record<string, unknown>>;
  validationErrors: Array<{
    rowIndex: number;
    fieldName: string;
    errorCode: string;
    message: string;
    rawValue: unknown;
  }>;
  journalPreview: JournalPreviewEntry[];
};

export type JournalPreviewEntry = {
  lineNumber: number;
  account: string;
  description: string;
  debit: number;
  credit: number;
  currency: string;
  analysisCode1?: string;
  analysisCode2?: string;
  analysisCode3?: string;
};

// ── Schedule ─────────────────────────────────────────────────────────────────

export type Schedule = {
  id: string;
  profileId: string;
  scheduleType: ScheduleType;
  cronExpression: string | null;
  fileWatchPath: string | null;
  fileWatchPattern: string | null;
  pollingIntervalMs: number | null;
  eventType: string | null;
  isActive: boolean;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyOnWarning: boolean;
  notifyEmails: string[];
  maxRetries: number;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleCreateInput = {
  scheduleType: ScheduleType;
  cronExpression?: string;
  fileWatchPath?: string;
  fileWatchPattern?: string;
  pollingIntervalMs?: number;
  eventType?: string;
  notifyOnSuccess?: boolean;
  notifyOnFailure?: boolean;
  notifyOnWarning?: boolean;
  notifyEmails?: string[];
  maxRetries?: number;
};

// ── Pre-built Function ───────────────────────────────────────────────────────

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

// ── HFP Target Field ────────────────────────────────────────────────────────

export type HfpTargetField = {
  path: string;
  label: string;
  group: string;
  type: FsdFieldType;
  required: boolean;
};

// ── Held-Batch Review ────────────────────────────────────────────────────────

export type BatchItemValidationMessage = {
  code: string;
  severity: "WARNING" | "ERROR";
  message: string;
  line?: number;
};

export type HeldBatchItem = {
  id: string;
  itemIndex: number;
  status: "HELD" | "COMMITTED" | "REJECTED" | "ERROR";
  payload: {
    periodId: string;
    reference?: string;
    description?: string;
    functionalCurrency?: string;
    lines: Array<{
      accountId: string;
      debit: string;
      credit: string;
      currency?: string;
      fxRate?: string;
      description?: string;
    }>;
  };
  sourceRecordIndices: number[];
  validationStatus: "OK" | "WARNING" | "ERROR";
  validationMessages: BatchItemValidationMessage[];
  resultJournalId: string | null;
  rejectedReason: string | null;
};

export type HeldBatchSummary = {
  id: string;
  entityId: string;
  profileId: string;
  executionId: string;
  targetComponent: string;
  status: "PENDING_REVIEW" | "COMMITTED" | "DISCARDED";
  totalItems: number;
  heldItems: number;
  rejectedItems: number;
  committedItems: number;
  errorItems: number;
  createdAt: string;
  committedAt: string | null;
};

export type HeldBatchDetail = HeldBatchSummary & { items: HeldBatchItem[] };

export type CommitSummary = {
  alreadyCommitted: boolean;
  committed: number;
  pendingApproval: number;
  rejected: number;
  errors: number;
};
