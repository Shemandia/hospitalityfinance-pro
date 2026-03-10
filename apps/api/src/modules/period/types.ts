import { z } from "zod";

export const periodListQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  status: z.enum(["OPEN", "CLOSED", "LOCKED"]).optional()
});

export const periodCreateSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2099),
  month: z.coerce.number().int().min(1).max(12),
  name: z.string().min(1).max(100)
});

export type PeriodListQuery = z.infer<typeof periodListQuerySchema>;
export type PeriodCreateInput = z.infer<typeof periodCreateSchema>;
