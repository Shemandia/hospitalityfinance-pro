import { z } from "zod";

// ── IC Account Pair Schemas ────────────────────────────────────────────────────

export const createICAccountPairSchema = z.object({
  counterpartyEntityId: z.string().uuid(),
  icReceivableCode: z.string().min(1).max(15),
  icPayableCode: z.string().min(1).max(15)
});

export const updateICAccountPairSchema = z.object({
  icReceivableCode: z.string().min(1).max(15).optional(),
  icPayableCode: z.string().min(1).max(15).optional()
});

export type CreateICAccountPairInput = z.infer<typeof createICAccountPairSchema>;
export type UpdateICAccountPairInput = z.infer<typeof updateICAccountPairSchema>;

// ── IC Journal Schemas ─────────────────────────────────────────────────────────

export const createICJournalSchema = z.object({
  mirrorEntityId: z.string().uuid(),
  periodId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  reference: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  /** Account code in source entity to debit (defaults to IC Receivable from pair) */
  sourceDebitAccountCode: z.string().max(15).optional(),
  /** Account code in source entity to credit */
  sourceCreditAccountCode: z.string().max(15).optional()
});

export type CreateICJournalInput = z.infer<typeof createICJournalSchema>;

// ── Result Types ───────────────────────────────────────────────────────────────

export type ICJournalSummary = {
  id: string;
  sourceEntityId: string;
  mirrorEntityId: string;
  sourceJournalId: string | null;
  mirrorJournalId: string | null;
  status: string;
  amount: number;
  currency: string;
  reference: string;
  description: string | null;
  createdAt: string;
};
