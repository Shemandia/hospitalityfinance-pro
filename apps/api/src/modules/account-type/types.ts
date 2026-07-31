import { z } from "zod";

export const accountTypeCategorySchema = z.enum(["BALANCE_SHEET", "INCOME", "STATISTICAL"]);

export const accountTypeCreateSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(30)
    .transform((v) => v.toUpperCase().trim()),
  name: z.string().min(1).max(100),
  category: accountTypeCategorySchema,
  normalBalance: z.enum(["DEBIT", "CREDIT"]),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true)
});

export const accountTypeUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: accountTypeCategorySchema.optional(),
  normalBalance: z.enum(["DEBIT", "CREDIT"]).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional()
});

export type AccountTypeCreateInput = z.infer<typeof accountTypeCreateSchema>;
export type AccountTypeUpdateInput = z.infer<typeof accountTypeUpdateSchema>;
