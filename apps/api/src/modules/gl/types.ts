import { z } from "zod";

const decimalRegex = /^\d+(\.\d{1,8})?$/;

const decimalStringSchema = z
  .string()
  .regex(decimalRegex, "Expected a positive decimal string.")
  .transform((value) => value.trim());

export const accountTypeSchema = z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);

export const normalBalanceSchema = z.enum(["DEBIT", "CREDIT"]);

export const accountCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  type: accountTypeSchema,
  usaliCategory: z.string().max(100).optional(),
  usaliDepartment: z.string().max(100).optional(),
  normalBalance: normalBalanceSchema,
  allowPosting: z.boolean().default(true),
  allowedSources: z
    .array(z.enum(["MANUAL", "PMS", "POS", "PAYROLL", "FX_REVAL", "AP", "AR"]))
    .default([]),
  isControlAccount: z.boolean().default(false),
  parentId: z.string().uuid().optional(),
  level: z.number().int().positive().max(10).default(1)
});

export const accountUpdateSchema = accountCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

export const journalLineCreateSchema = z
  .object({
    accountId: z.string().uuid(),
    debit: decimalStringSchema.default("0"),
    credit: decimalStringSchema.default("0"),
    currency: z.string().length(3),
    fxRate: decimalStringSchema.default("1"),
    description: z.string().max(1000).optional(),
    dimension1: z.string().max(50).optional(),
    dimension2: z.string().max(50).optional(),
    dimension3: z.string().max(50).optional(),
    dimension4: z.string().max(50).optional(),
    dimension5: z.string().max(50).optional(),
    dimension6: z.string().max(50).optional(),
    lineNumber: z.number().int().positive().optional()
  })
  .superRefine((value, context) => {
    if (value.debit !== "0" && value.credit !== "0") {
      context.addIssue({
        code: "custom",
        message: "Line cannot contain both debit and credit amounts."
      });
    }
  });

export const journalCreateSchema = z.object({
  periodId: z.string().uuid(),
  journalTypeId: z.string().uuid().optional(),
  reference: z.string().max(50).optional(),
  description: z.string().max(1000).optional(),
  source: z.enum(["MANUAL", "PMS", "POS", "PAYROLL", "FX_REVAL", "AP", "AR"]).default("MANUAL"),
  functionalCurrency: z.string().length(3),
  lines: z.array(journalLineCreateSchema).min(1),
  /** When a manual journal touches source-restricted accounts (e.g. REVENUE),
   *  the user must supply a reason. Requires CONTROLLER or ADMIN role. */
  sourceOverrideReason: z.string().max(500).optional()
});

// ── Journal Type CRUD ───────────────────────────────────────────────────────

const journalSourceEnum = z.enum(["MANUAL", "PMS", "POS", "PAYROLL", "FX_REVAL", "AP", "AR"]);

export const journalTypeCreateSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  allowedSources: z.array(journalSourceEnum).default([]),
  allowedAccountTypes: z.array(accountTypeSchema).default([]),
  numberPrefix: z.string().min(1).max(10),
  autoReverse: z.boolean().default(false),
  requireBalance: z.boolean().default(true),
  isActive: z.boolean().default(true)
});

export const journalTypeUpdateSchema = journalTypeCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field must be provided.");

export const journalListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "POSTED", "REVERSED"]).optional(),
  source: z.enum(["MANUAL", "PMS", "POS", "PAYROLL", "FX_REVAL", "AP", "AR"]).optional(),
  journalTypeId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(100).optional()
});

export const trialBalanceQuerySchema = z.object({
  period_id: z.string().uuid(),
  comparative_period_id: z.string().uuid().optional(),
  show_zero_balances: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

export const journalDecisionSchema = z.object({
  reason: z.string().max(500).optional()
});

// ── Approval Rules ──────────────────────────────────────────────────────────

export const approvalRuleCreateSchema = z.object({
  module: z.enum(["GL", "AP", "AR"]),
  minAmount: z.coerce.number().nonnegative(),
  maxAmount: z.coerce.number().positive().optional(),
  requiredApprovers: z.array(z.string().uuid()).min(1, "At least one approver is required"),
  requireAll: z.boolean().default(true),
  isActive: z.boolean().default(true)
});

export const approvalRuleUpdateSchema = approvalRuleCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field must be provided.");

export type ApprovalRuleCreateInput = z.infer<typeof approvalRuleCreateSchema>;
export type ApprovalRuleUpdateInput = z.infer<typeof approvalRuleUpdateSchema>;

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
export type JournalCreateInput = z.infer<typeof journalCreateSchema>;
export type JournalListQuery = z.infer<typeof journalListQuerySchema>;
export type TrialBalanceQuery = z.infer<typeof trialBalanceQuerySchema>;
export type JournalTypeCreateInput = z.infer<typeof journalTypeCreateSchema>;
export type JournalTypeUpdateInput = z.infer<typeof journalTypeUpdateSchema>;
