import { z } from "zod";

// ── IC Entity Pair Schemas ───────────────────────────────────────────────────

export const createICEntityPairSchema = z.object({
  entityAId: z.string().uuid(),
  entityBId: z.string().uuid(),
  description: z.string().max(500).optional(),
  autoApproveThreshold: z.number().nonnegative().optional()
});

export const updateICEntityPairSchema = z.object({
  description: z.string().max(500).optional(),
  autoApproveThreshold: z.number().nonnegative().nullable().optional(),
  isActive: z.boolean().optional()
});

export type CreateICEntityPairInput = z.infer<typeof createICEntityPairSchema>;
export type UpdateICEntityPairInput = z.infer<typeof updateICEntityPairSchema>;

// ── IC Account Mapping Schemas ───────────────────────────────────────────────

export const createICAccountMappingSchema = z.object({
  pairId: z.string().uuid(),
  name: z.string().min(1).max(100),
  entityADebitCode: z.string().min(1).max(15),
  entityACreditCode: z.string().min(1).max(15),
  entityBDebitCode: z.string().min(1).max(15),
  entityBCreditCode: z.string().min(1).max(15)
});

export const updateICAccountMappingSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  entityADebitCode: z.string().min(1).max(15).optional(),
  entityACreditCode: z.string().min(1).max(15).optional(),
  entityBDebitCode: z.string().min(1).max(15).optional(),
  entityBCreditCode: z.string().min(1).max(15).optional(),
  isActive: z.boolean().optional()
});

export type CreateICAccountMappingInput = z.infer<typeof createICAccountMappingSchema>;
export type UpdateICAccountMappingInput = z.infer<typeof updateICAccountMappingSchema>;

// ── IC Transaction Schemas ───────────────────────────────────────────────────

export const createICTransactionSchema = z.object({
  pairId: z.string().uuid(),
  mappingId: z.string().uuid().optional(),
  counterpartyEntityId: z.string().uuid(),
  amount: z.string().or(z.number()).transform(String),
  currency: z.string().length(3),
  reference: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  periodId: z.string().uuid(),
  /** FX rate from transaction currency to initiator functional currency */
  fxRateInitiator: z.string().or(z.number()).transform(String).optional(),
  /** FX rate from transaction currency to counterparty functional currency */
  fxRateCounterparty: z.string().or(z.number()).transform(String).optional()
});

export type CreateICTransactionInput = z.infer<typeof createICTransactionSchema>;

export const rejectICTransactionSchema = z.object({
  reason: z.string().max(500).optional()
});

// ── Legacy IC Account Pair Schemas (kept for backward compatibility) ─────────

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

export const createICJournalSchema = z.object({
  mirrorEntityId: z.string().uuid(),
  periodId: z.string().uuid(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  reference: z.string().min(1).max(60),
  description: z.string().max(500).optional(),
  sourceDebitAccountCode: z.string().max(15).optional(),
  sourceCreditAccountCode: z.string().max(15).optional()
});

export type CreateICJournalInput = z.infer<typeof createICJournalSchema>;

// ── Result Types ─────────────────────────────────────────────────────────────

export type ICEntityPairSummary = {
  id: string;
  entityAId: string;
  entityBId: string;
  entityAName?: string;
  entityBName?: string;
  isActive: boolean;
  autoApproveThreshold: string | null;
  description: string | null;
  mappingCount: number;
};

export type ICAccountMappingSummary = {
  id: string;
  pairId: string;
  name: string;
  entityADebitCode: string;
  entityACreditCode: string;
  entityBDebitCode: string;
  entityBCreditCode: string;
  isActive: boolean;
};

export type ICTransactionSummary = {
  id: string;
  pairId: string;
  mappingId: string | null;
  initiatingEntityId: string;
  counterpartyEntityId: string;
  status: string;
  amount: string;
  currency: string;
  fxRateInitiator: string;
  fxRateCounterparty: string;
  functionalAmountInitiator: string;
  functionalAmountCounterparty: string;
  reference: string;
  description: string | null;
  periodId: string;
  initiatorJournalId: string | null;
  counterpartyJournalId: string | null;
  reversalOfId: string | null;
  createdById: string;
  approvedById: string | null;
  approvedAt: string | null;
  rejectedById: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  postedAt: string | null;
  createdAt: string;
};

export type ICReconciliationPairBalance = {
  pairId: string;
  entityAId: string;
  entityBId: string;
  entityAName?: string;
  entityBName?: string;
  /** Net balance: positive = A owes B */
  balanceEntityA: string;
  /** Net balance: positive = B owes A */
  balanceEntityB: string;
  difference: string;
  currency: string;
  status: "RECONCILED" | "UNRECONCILED";
  transactionCount: number;
};

export type ICReconciliationResult = {
  pairs: ICReconciliationPairBalance[];
  totalUnreconciled: number;
};

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
