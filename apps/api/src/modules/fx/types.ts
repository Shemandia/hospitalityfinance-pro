import { z } from "zod";

export const currencyCreateSchema = z.object({
  code: z.string().length(3).toUpperCase(),
  name: z.string().min(1).max(100),
  symbol: z.string().max(10).optional(),
  decimalPlaces: z.number().int().min(0).max(6).default(2),
  isActive: z.boolean().default(true)
});

export const fxRateCreateSchema = z.object({
  fromCurrency: z.string().length(3).toUpperCase(),
  toCurrency: z.string().length(3).toUpperCase(),
  rateType: z.enum(["SPOT", "AVERAGE", "BUDGET", "CLOSING"]),
  rate: z.string().regex(/^\d+(\.\d{1,8})?$/, "Expected a positive decimal string."),
  effectiveDate: z.coerce.date(),
  source: z.enum(["ECB", "OANDA", "MANUAL", "OPEN_ER_API"]).default("MANUAL")
});

export const fxRateQuerySchema = z.object({
  fromCurrency: z.string().length(3).optional(),
  toCurrency: z.string().length(3).optional(),
  rateType: z.enum(["SPOT", "AVERAGE", "BUDGET", "CLOSING"]).optional(),
  effectiveDate: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100)
});

export const convertQuerySchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/),
  rateType: z.enum(["SPOT", "AVERAGE", "BUDGET", "CLOSING"]).default("SPOT"),
  effectiveDate: z.coerce.date().optional()
});

export const revaluationRequestSchema = z.object({
  entityId: z.string().uuid(),
  periodId: z.string().uuid(),
  closingRateDate: z.coerce.date()
});

export type CurrencyCreateInput = z.infer<typeof currencyCreateSchema>;
export type FXRateCreateInput = z.infer<typeof fxRateCreateSchema>;
export type FXRateQuery = z.infer<typeof fxRateQuerySchema>;
export type ConvertQuery = z.infer<typeof convertQuerySchema>;
export type RevaluationRequest = z.infer<typeof revaluationRequestSchema>;
