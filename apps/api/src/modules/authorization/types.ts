import { z } from "zod";

// ── Authorization Stages ───────────────────────────────────────────────────

export const stageCreateSchema = z.object({
  stageCode: z.string().min(1).max(20),
  stageName: z.string().min(1).max(100),
  stageOrder: z.coerce.number().int().positive(),
  requiredApprovers: z.coerce.number().int().positive().default(1),
  autoAdvance: z.boolean().default(true),
  rejectionReturnsTo: z
    .enum(["PREVIOUS_STAGE", "ORIGINATOR", "SPECIFIC_STAGE"])
    .default("ORIGINATOR"),
  returnToStageId: z.string().uuid().optional(),
  journalTypeId: z.string().uuid().optional(),
  amountThreshold: z.coerce.number().min(0).optional(),
  userTeamId: z.string().uuid(),
  isActive: z.boolean().default(true)
});

export const stageUpdateSchema = z.object({
  stageName: z.string().min(1).max(100).optional(),
  stageOrder: z.coerce.number().int().positive().optional(),
  requiredApprovers: z.coerce.number().int().positive().optional(),
  autoAdvance: z.boolean().optional(),
  rejectionReturnsTo: z.enum(["PREVIOUS_STAGE", "ORIGINATOR", "SPECIFIC_STAGE"]).optional(),
  returnToStageId: z.string().uuid().nullable().optional(),
  journalTypeId: z.string().uuid().nullable().optional(),
  amountThreshold: z.coerce.number().min(0).nullable().optional(),
  userTeamId: z.string().uuid().optional(),
  isActive: z.boolean().optional()
});

// ── Authorization Teams ────────────────────────────────────────────────────

export const teamCreateSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  memberIds: z.array(z.string().uuid()).default([]),
  isActive: z.boolean().default(true)
});

export const teamUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  memberIds: z.array(z.string().uuid()).optional(),
  isActive: z.boolean().optional()
});

// ── Delegations ────────────────────────────────────────────────────────────

export const delegationCreateSchema = z.object({
  delegatorId: z.string().uuid(),
  delegateId: z.string().uuid(),
  teamId: z.string().uuid(),
  validFrom: z.string().min(10),
  validTo: z.string().min(10)
});

// ── Rejection Codes ────────────────────────────────────────────────────────

export const rejectionCodeCreateSchema = z.object({
  code: z.string().min(1).max(20),
  description: z.string().min(1).max(255),
  isActive: z.boolean().default(true)
});

// ── Workflow Actions ───────────────────────────────────────────────────────

export const approveSchema = z.object({
  comments: z.string().max(500).optional()
});

export const rejectSchema = z.object({
  rejectionCodeId: z.string().uuid(),
  comments: z.string().max(500).optional()
});

export const returnSchema = z.object({
  comments: z.string().max(500).optional()
});

export const voidSchema = z.object({
  comments: z.string().max(500).optional()
});

export const bulkApproveSchema = z.object({
  journalIds: z.array(z.string().uuid()).min(1),
  comments: z.string().max(500).optional()
});

export const bulkRejectSchema = z.object({
  journalIds: z.array(z.string().uuid()).min(1),
  rejectionCodeId: z.string().uuid(),
  comments: z.string().max(500).optional()
});

// ── Authorization Sets ─────────────────────────────────────────────────────

export const setCreateSchema = z.object({
  name: z.string().min(1).max(200)
});

export const setAddJournalsSchema = z.object({
  journalIds: z.array(z.string().uuid()).min(1)
});

export const setRejectSchema = z.object({
  rejectionCodeId: z.string().uuid(),
  comments: z.string().max(500).optional()
});

// ── Queue Filters ──────────────────────────────────────────────────────────

export const queueFilterSchema = z.object({
  journalTypeId: z.string().uuid().optional(),
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
  createdById: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional()
});

// ── Inferred types ─────────────────────────────────────────────────────────

export type StageCreateInput = z.infer<typeof stageCreateSchema>;
export type StageUpdateInput = z.infer<typeof stageUpdateSchema>;
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>;
export type DelegationCreateInput = z.infer<typeof delegationCreateSchema>;
export type RejectionCodeCreateInput = z.infer<typeof rejectionCodeCreateSchema>;
export type ApproveInput = z.infer<typeof approveSchema>;
export type RejectInput = z.infer<typeof rejectSchema>;
export type BulkApproveInput = z.infer<typeof bulkApproveSchema>;
export type BulkRejectInput = z.infer<typeof bulkRejectSchema>;
export type QueueFilterInput = z.infer<typeof queueFilterSchema>;
