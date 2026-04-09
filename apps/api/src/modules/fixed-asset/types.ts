import { z } from "zod";

// ── Asset Category ──────────────────────────────────────────────────────────

export const assetCategoryCreateSchema = z.object({
  code: z.string().min(1).max(30),
  name: z.string().min(1).max(100),
  defaultUsefulLifeMonths: z.coerce.number().int().positive().optional(),
  defaultDepreciationMethod: z
    .enum(["STRAIGHT_LINE", "REDUCING_BALANCE", "SUM_OF_DIGITS", "USER_TABLE", "NONE"])
    .optional(),
  defaultBsDepreciationAcct: z.string().max(50).optional(),
  defaultPlDepreciationAcct: z.string().max(50).optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0)
});

// ── Fixed Asset ─────────────────────────────────────────────────────────────

export const assetCreateSchema = z.object({
  assetCode: z.string().min(1).max(30),
  lookupCode: z.string().max(30).optional(),
  description: z.string().min(1).max(255),
  categoryId: z.string().uuid().optional(),
  bsDepreciationAccount: z.string().min(1).max(50),
  plDepreciationAccount: z.string().min(1).max(50),
  depreciationMethod: z
    .enum(["STRAIGHT_LINE", "REDUCING_BALANCE", "SUM_OF_DIGITS", "USER_TABLE", "NONE"])
    .default("STRAIGHT_LINE"),
  depreciationRate: z.coerce.number().min(0).max(100).optional(),
  usefulLifeMonths: z.coerce.number().int().positive(),
  depreciationStartPeriodId: z.string().uuid().optional(),
  firstPeriodDays: z.coerce.number().int().positive().optional(),
  finalValue: z.coerce.number().min(0).default(0),
  grossValue: z.coerce.number().min(0),
  assetQuantity: z.coerce.number().positive().optional(),
  acquisitionDate: z.string().min(10),
  analysisCode1: z.string().max(50).optional(),
  analysisCode2: z.string().max(50).optional(),
  analysisCode3: z.string().max(50).optional(),
  analysisCode4: z.string().max(50).optional(),
  analysisCode5: z.string().max(50).optional()
});

export const assetUpdateSchema = z.object({
  description: z.string().min(1).max(255).optional(),
  lookupCode: z.string().max(30).optional(),
  categoryId: z.string().uuid().nullable().optional(),
  analysisCode1: z.string().max(50).nullable().optional(),
  analysisCode2: z.string().max(50).nullable().optional(),
  analysisCode3: z.string().max(50).nullable().optional(),
  analysisCode4: z.string().max(50).nullable().optional(),
  analysisCode5: z.string().max(50).nullable().optional(),
  assetQuantity: z.coerce.number().positive().optional()
});

export const assetListQuerySchema = z.object({
  status: z.enum(["ACTIVE", "FULLY_DEPRECIATED", "DISPOSED"]).optional(),
  categoryId: z.string().uuid().optional(),
  search: z.string().optional()
});

// ── Lifecycle ───────────────────────────────────────────────────────────────

export const assetDisposeSchema = z.object({
  disposalDate: z.string().min(10),
  disposalProceeds: z.coerce.number().min(0),
  proceedsAccountCode: z.string().min(1).max(50),
  periodId: z.string().uuid()
});

export const assetTransferSchema = z.object({
  analysisCode1: z.string().max(50).optional(),
  analysisCode2: z.string().max(50).optional(),
  analysisCode3: z.string().max(50).optional(),
  analysisCode4: z.string().max(50).optional(),
  analysisCode5: z.string().max(50).optional()
});

export const assetRevalueSchema = z.object({
  newGrossValue: z.coerce.number().min(0)
});

// ── Depreciation ────────────────────────────────────────────────────────────

export const depreciationRunSchema = z.object({
  periodId: z.string().uuid()
});

// ── Inferred types ──────────────────────────────────────────────────────────

export type AssetCategoryCreateInput = z.infer<typeof assetCategoryCreateSchema>;
export type AssetCreateInput = z.infer<typeof assetCreateSchema>;
export type AssetUpdateInput = z.infer<typeof assetUpdateSchema>;
export type AssetListQuery = z.infer<typeof assetListQuerySchema>;
export type AssetDisposeInput = z.infer<typeof assetDisposeSchema>;
export type AssetTransferInput = z.infer<typeof assetTransferSchema>;
export type AssetRevalueInput = z.infer<typeof assetRevalueSchema>;
export type DepreciationRunInput = z.infer<typeof depreciationRunSchema>;
