/**
 * Transfer Desk Profile Wizard — Zod validation schemas.
 *
 * One schema per wizard step, plus shared field schemas.
 * Used with React Hook Form via @hookform/resolvers/zod.
 */

import { z } from "zod";

// ── Shared Enums ─────────────────────────────────────────────────────────────

export const profileTypeSchema = z.enum([
  "IMPORT",
  "EXPORT",
  "INTERNAL_TRANSFER",
  "EXTERNAL_TRANSFER",
  "PROCESS"
]);

export const profileStatusSchema = z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]);

export const formatTypeSchema = z.enum(["csv", "tsv", "fixed", "xlsx", "xml_ssml"]);

export const fieldTypeSchema = z.enum([
  "string",
  "integer",
  "decimal",
  "currency",
  "date",
  "datetime",
  "boolean",
  "enum",
  "account"
]);

export const transformTypeSchema = z.enum([
  "direct",
  "lookup",
  "expression",
  "function",
  "concat",
  "split",
  "static"
]);

export const errorHandlingStrategySchema = z.enum(["REJECT_ROW", "REJECT_FILE", "QUARANTINE"]);

export const duplicateActionSchema = z.enum(["SKIP", "OVERWRITE", "ERROR"]);

export const journalBatchGroupingSchema = z.enum(["PER_FILE", "PER_ROW", "PER_N_ROWS"]);

// ── Step 1: Profile Basics ───────────────────────────────────────────────────

export const step1Schema = z.object({
  name: z
    .string()
    .min(1, "Profile name is required")
    .max(100, "Profile name must be 100 characters or fewer")
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/,
      "Name must start with a letter or number and contain only letters, numbers, spaces, hyphens, or underscores"
    ),
  profileType: profileTypeSchema,
  description: z.string().max(500).optional().or(z.literal("")),
  entityId: z.string().min(1, "Entity is required"),
  journalSourceCode: z.string().max(10).optional().or(z.literal("")),
  targetLedgerId: z.string().optional().or(z.literal("")),
  tags: z.array(z.string().max(50)).max(20).optional()
});

export type Step1FormData = z.infer<typeof step1Schema>;

// ── Step 2: File Format Definition (FSD) ─────────────────────────────────────

const fsdFieldSchema = z.object({
  name: z
    .string()
    .min(1, "Field name is required")
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/, "Invalid field name"),
  target: z.string().min(1, "Target path is required"),
  type: fieldTypeSchema,
  columnName: z.string().optional(),
  columnIndex: z.number().int().min(0).optional(),
  fixedStart: z.number().int().min(0).optional(),
  fixedLength: z.number().int().min(1).optional(),
  xmlPath: z.string().optional(),
  dateFormat: z.string().optional(),
  // decimalDivisor: opt-in only, never pre-populated
  decimalDivisor: z.number().positive().optional(),
  precision: z.number().int().min(0).max(10).optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().optional(),
  ignoreField: z.boolean().optional(),
  allowedValues: z.array(z.string()).optional(),
  pattern: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional()
});

export const step2Schema = z.object({
  format: z.object({
    type: formatTypeSchema,
    delimiter: z.string().max(5).optional(),
    quoteChar: z.string().max(1).optional(),
    escapeChar: z.string().max(1).optional(),
    encoding: z.string().optional(),
    hasHeaderRow: z.boolean().optional(),
    lineEnding: z.enum(["CRLF", "LF"]).optional(),
    sheetIndex: z.number().int().min(0).optional(),
    skipRowsBeforeHeader: z.number().int().min(0).optional(),
    xmlRootElement: z.string().optional(),
    fixedRecordLength: z.number().int().min(1).optional()
  }),
  fields: z.array(fsdFieldSchema).min(1, "At least one field is required"),
  options: z
    .object({
      maxErrors: z.number().int().min(1).optional(),
      skipBlankRows: z.boolean().optional(),
      strictMode: z.boolean().optional(),
      outputNullAs: z.string().optional()
    })
    .optional()
});

export type Step2FormData = z.infer<typeof step2Schema>;

// ── Step 3: Field Mapping (TML) ──────────────────────────────────────────────

const tmlTransformSchema = z.object({
  type: transformTypeSchema,
  lookupTableId: z.string().optional(),
  lookupSourceColumn: z.string().optional(),
  lookupTargetColumn: z.string().optional(),
  lookupDefaultValue: z.string().optional(),
  expression: z.string().optional(),
  functionId: z.string().optional(),
  functionParams: z.record(z.unknown()).optional(),
  additionalSources: z.array(z.string()).optional(),
  separator: z.string().optional(),
  splitDelimiter: z.string().optional(),
  splitIndex: z.number().int().min(0).optional(),
  staticValue: z.string().optional()
});

const tmlMappingSchema = z.object({
  id: z.string(),
  sourceField: z.string().min(1, "Source field is required"),
  targetField: z.string().min(1, "Target field is required"),
  transform: tmlTransformSchema.nullable()
});

export const step3Schema = z.object({
  mappings: z.array(tmlMappingSchema).min(1, "At least one mapping is required")
});

export type Step3FormData = z.infer<typeof step3Schema>;

// ── Step 4: Validation Rules & Options ───────────────────────────────────────

const validationRuleSchema = z.object({
  id: z.string(),
  type: z.enum(["REQUIRED", "CROSS_FIELD", "RANGE", "PATTERN", "CUSTOM_EXPRESSION"]),
  field: z.string().min(1, "Field is required"),
  description: z.string().min(1, "Description is required"),
  config: z.object({
    otherField: z.string().optional(),
    condition: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    expression: z.string().optional()
  }),
  severity: z.enum(["error", "warning"])
});

export const step4Schema = z.object({
  validationRules: z.array(validationRuleSchema),
  errorHandling: z.object({
    strategy: errorHandlingStrategySchema,
    maxErrors: z.number().int().min(1).optional()
  }),
  duplicateDetection: z.object({
    enabled: z.boolean(),
    keyFields: z.array(z.string()),
    action: duplicateActionSchema
  }),
  postingOptions: z.object({
    autoPost: z.boolean(),
    requireApproval: z.boolean(),
    batchGrouping: journalBatchGroupingSchema,
    batchSize: z.number().int().min(1).optional()
  })
});

export type Step4FormData = z.infer<typeof step4Schema>;

// ── Step 5: Test & Preview — no form schema (file upload + SSE) ──────────────

// ── Step 6: Review & Activate — no form schema (read-only summary) ───────────

// ── Lookup Table ─────────────────────────────────────────────────────────────

export const lookupTableCreateSchema = z.object({
  name: z
    .string()
    .min(1, "Table name is required")
    .max(100, "Table name must be 100 characters or fewer"),
  description: z.string().max(500).optional().or(z.literal("")),
  columns: z.array(z.string().min(1)).min(2, "At least two columns are required"),
  entries: z
    .array(
      z.object({
        values: z.record(z.string())
      })
    )
    .optional()
});

export type LookupTableCreateFormData = z.infer<typeof lookupTableCreateSchema>;

// ── Schedule ─────────────────────────────────────────────────────────────────

export const scheduleSchema = z.object({
  scheduleType: z.enum(["CRON", "FILE_WATCH", "EVENT_DRIVEN", "MANUAL"]),
  cronExpression: z.string().optional(),
  fileWatchPath: z.string().optional(),
  fileWatchPattern: z.string().optional(),
  pollingIntervalMs: z.number().int().min(5000).optional(),
  eventType: z.string().optional(),
  notifyOnSuccess: z.boolean().optional(),
  notifyOnFailure: z.boolean().optional(),
  notifyOnWarning: z.boolean().optional(),
  notifyEmails: z.array(z.string().email()).optional(),
  maxRetries: z.number().int().min(0).max(10).optional()
});

export type ScheduleFormData = z.infer<typeof scheduleSchema>;
