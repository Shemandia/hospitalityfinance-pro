import { z } from "zod";

// ── Allocation Source schema ────────────────────────────────────────────────

const allocationSourceSchema = z.object({
  accountCodeFrom: z.string().min(1).max(50),
  accountCodeTo: z.string().min(1).max(50).optional(),
  analysisCode1: z.string().max(50).optional(),
  analysisCode2: z.string().max(50).optional(),
  analysisCode3: z.string().max(50).optional(),
  balanceType: z.enum(["OPENING", "MOVEMENTS", "CLOSING"]).default("MOVEMENTS"),
  minimumThreshold: z.coerce.number().optional(),
  maximumThreshold: z.coerce.number().optional(),
  sourceOrder: z.coerce.number().int().optional()
});

// ── Allocation Target schema ────────────────────────────────────────────────

const allocationTargetSchema = z.object({
  targetAccountCode: z.string().min(1).max(50),
  offsetAccountCode: z.string().max(50).optional(),
  basisType: z.enum(["FIXED_PERCENTAGE", "FIXED_AMOUNT", "ACCOUNT_BALANCE", "STATISTICAL_KEY"]),
  fixedPercentage: z.coerce.number().min(0).max(100).optional(),
  fixedAmount: z.coerce.number().optional(),
  ratioAccountCodeFrom: z.string().max(50).optional(),
  ratioAccountCodeTo: z.string().max(50).optional(),
  statisticalKey: z.string().max(50).optional(),
  statisticalValue: z.coerce.number().optional(),
  analysisCodes: z.record(z.string()).optional(),
  targetOrder: z.coerce.number().int().optional()
});

// ── Allocation Definition CRUD schemas ──────────────────────────────────────

export const allocationCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  allocationType: z.enum(["CHARGE", "SPLIT"]),
  periodId: z.string().uuid().optional(),
  isSteppedSequence: z.boolean().default(false),
  sequenceOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
  sources: z.array(allocationSourceSchema).min(1),
  targets: z.array(allocationTargetSchema).min(1)
});

export const allocationUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  allocationType: z.enum(["CHARGE", "SPLIT"]).optional(),
  periodId: z.string().uuid().nullable().optional(),
  isSteppedSequence: z.boolean().optional(),
  sequenceOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
  sources: z.array(allocationSourceSchema).optional(),
  targets: z.array(allocationTargetSchema).optional()
});

export const allocationListQuerySchema = z.object({
  isActive: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  isSteppedSequence: z
    .string()
    .transform((v) => v === "true")
    .optional()
});

export const allocationExecuteSchema = z.object({
  periodId: z.string().uuid().optional()
});

export type AllocationCreateInput = z.infer<typeof allocationCreateSchema>;
export type AllocationUpdateInput = z.infer<typeof allocationUpdateSchema>;
export type AllocationListQuery = z.infer<typeof allocationListQuerySchema>;
export type AllocationExecuteInput = z.infer<typeof allocationExecuteSchema>;
