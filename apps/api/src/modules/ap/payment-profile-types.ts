import { z } from "zod";

// ── Payment Profile Schemas ─────────────────────────────────────────────────

export const selectionCriteriaSchema = z.object({
  supplierIds: z.array(z.string().uuid()).optional(),
  customerIds: z.array(z.string().uuid()).optional(),
  amountMin: z.number().min(0).optional(),
  amountMax: z.number().min(0).optional(),
  dueDateFrom: z.string().optional(),
  dueDateTo: z.string().optional(),
  accountTypes: z.array(z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"])).optional()
});

export const groupingRulesSchema = z.object({
  consolidatePerSupplier: z.boolean().default(true),
  consolidatePerCustomer: z.boolean().default(true)
});

export const createPaymentProfileSchema = z.object({
  name: z.string().min(1).max(200),
  direction: z.enum(["PAY", "COLLECT"]),
  paymentMethod: z.enum(["BANK_TRANSFER", "CHEQUE", "CARD", "CASH"]),
  bankAccountId: z.string().optional(),
  currency: z.string().length(3).optional(),
  fxHandling: z.enum(["ORIGINAL", "CURRENT_RATE"]).default("ORIGINAL"),
  selectionCriteria: selectionCriteriaSchema.default({}),
  groupingRules: groupingRulesSchema.default({}),
  totalPaymentLimit: z.number().min(0).optional(),
  remittanceAdvice: z.boolean().default(true),
  description: z.string().max(500).optional()
});

export const updatePaymentProfileSchema = createPaymentProfileSchema.partial();

export type CreatePaymentProfileInput = z.infer<typeof createPaymentProfileSchema>;
export type UpdatePaymentProfileInput = z.infer<typeof updatePaymentProfileSchema>;
export type SelectionCriteria = z.infer<typeof selectionCriteriaSchema>;
export type GroupingRules = z.infer<typeof groupingRulesSchema>;

// ── Collection Run Schema ───────────────────────────────────────────────────

export const runCollectionSchema = z.object({
  profileId: z.string().uuid(),
  periodId: z.string().uuid(),
  bankAccountId: z.string().optional(),
  referencePrefix: z.string().max(20).default("COL")
});

export type RunCollectionInput = z.infer<typeof runCollectionSchema>;
