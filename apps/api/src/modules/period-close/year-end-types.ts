import { z } from "zod";

// ── Year-End Config Schemas ────────────────────────────────────────────────────

export const createYearEndConfigSchema = z.object({
  retainedEarningsCode: z.string().min(1).max(15),
  journalTypeCode: z.string().max(20).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
  description: z.string().max(500).optional()
});

export const updateYearEndConfigSchema = createYearEndConfigSchema.partial();

export type CreateYearEndConfigInput = z.infer<typeof createYearEndConfigSchema>;
export type UpdateYearEndConfigInput = z.infer<typeof updateYearEndConfigSchema>;

// ── Year-End Cleardown Execution Schema ────────────────────────────────────────

export const runYearEndCleardownSchema = z.object({
  periodId: z.string().uuid(),
  /** Override retained earnings account code (uses config default if omitted) */
  retainedEarningsCode: z.string().min(1).max(15).optional()
});

export type RunYearEndCleardownInput = z.infer<typeof runYearEndCleardownSchema>;

// ── Result Types ───────────────────────────────────────────────────────────────

export type YearEndCleardownLineResult = {
  accountCode: string;
  accountName: string;
  accountType: string;
  closingBalance: number;
  cleardownAmount: number;
};

export type YearEndCleardownResult = {
  periodName: string;
  fiscalYear: number;
  retainedEarningsCode: string;
  totalRevenue: number;
  totalExpense: number;
  netProfitLoss: number;
  lines: YearEndCleardownLineResult[];
  journalId: string | null;
};
