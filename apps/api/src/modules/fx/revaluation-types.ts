import { z } from "zod";

// ── Revaluation Profile Schemas ─────────────────────────────────────────────

export const createRevaluationProfileSchema = z.object({
  name: z.string().min(1).max(200),
  accountTypeFilter: z
    .array(z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]))
    .default([]),
  accountCodeFrom: z.string().max(15).optional(),
  accountCodeTo: z.string().max(15).optional(),
  currencyFilter: z.string().length(3).optional(),
  rateType: z.enum(["CLOSING", "AVERAGE", "CUSTOM"]).default("CLOSING"),
  gainAccountCode: z.string().min(1).max(15),
  lossAccountCode: z.string().min(1).max(15),
  autoReverse: z.boolean().default(true),
  postDifferences: z.boolean().default(true),
  description: z.string().max(500).optional()
});

export const updateRevaluationProfileSchema = createRevaluationProfileSchema.partial();

export type CreateRevaluationProfileInput = z.infer<typeof createRevaluationProfileSchema>;
export type UpdateRevaluationProfileInput = z.infer<typeof updateRevaluationProfileSchema>;

// ── Revaluation Execution Schema ────────────────────────────────────────────

export const runLedgerRevaluationSchema = z.object({
  profileId: z.string().uuid(),
  periodId: z.string().uuid(),
  closingDate: z.string(),
  /** Custom rate override — only used when profile.rateType = CUSTOM */
  customRate: z.number().positive().optional()
});

export type RunLedgerRevaluationInput = z.infer<typeof runLedgerRevaluationSchema>;

// ── Revaluation Result Types ────────────────────────────────────────────────

export type RevaluationLineResult = {
  accountCode: string;
  accountName: string;
  currency: string;
  originalFunctionalBalance: number;
  revaluedFunctionalBalance: number;
  difference: number;
  fxRate: number;
};

export type RevaluationResult = {
  profileName: string;
  periodName: string;
  closingDate: string;
  rateType: string;
  totalGain: number;
  totalLoss: number;
  netGainLoss: number;
  lines: RevaluationLineResult[];
  journalId: string | null;
  reversalJournalId: string | null;
};
