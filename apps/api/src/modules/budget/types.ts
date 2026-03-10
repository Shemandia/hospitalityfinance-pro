import { z } from "zod";

const decimalRegex = /^-?\d+(\.\d{1,8})?$/;
const decimalStringSchema = z
  .string()
  .regex(decimalRegex, "Expected a decimal string.")
  .transform((v) => v.trim());

export const budgetDefinitionCreateSchema = z.object({
  name: z.string().min(1).max(200),
  year: z.number().int().min(2000).max(2100)
});

export const budgetLineSchema = z.object({
  accountId: z.string().uuid(),
  month: z.number().int().min(1).max(12),
  amount: decimalStringSchema,
  notes: z.string().max(500).optional()
});

export const budgetLinesBulkSchema = z.object({
  lines: z.array(budgetLineSchema).min(1).max(1000)
});

export const budgetQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  accountId: z.string().uuid().optional()
});

export const budgetVarianceQuerySchema = z.object({
  budgetDefinitionId: z.string().uuid(),
  periodId: z.string().uuid()
});

export type BudgetDefinitionCreateInput = z.infer<typeof budgetDefinitionCreateSchema>;
export type BudgetLineInput = z.infer<typeof budgetLineSchema>;
export type BudgetLinesBulkInput = z.infer<typeof budgetLinesBulkSchema>;
export type BudgetQuery = z.infer<typeof budgetQuerySchema>;
export type BudgetVarianceQuery = z.infer<typeof budgetVarianceQuerySchema>;
