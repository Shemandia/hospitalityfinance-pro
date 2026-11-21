import { z } from "zod";
import { pageFields } from "../../shared/pagination.js";

// ── Profile CRUD schemas ─────────────────────────────────────────────────────

/**
 * How a ledger import posts (docs/IMPORT-PLAN.md sections 4 and 5): review
 * mode, the tenant's source system, per-document or whole-file posting, the
 * unmapped-data policy and its suspense account, and the rate type for
 * documents without a rate. Shared by both profile APIs.
 */
export const importPolicyFields = {
  reviewMode: z.enum(["HOLD", "AUTO_COMMIT"]).optional(),
  sourceSystemCode: z.string().trim().min(1).max(20).nullable().optional(),
  atomicity: z.enum(["PER_DOCUMENT", "WHOLE_FILE"]).optional(),
  unmappedPolicy: z.enum(["REJECT", "HOLD", "SUSPENSE"]).optional(),
  suspenseAccountCode: z.string().trim().min(1).max(30).nullable().optional(),
  fxRateType: z.enum(["SPOT", "AVERAGE", "BUDGET", "CLOSING"]).nullable().optional()
};

const IMPORT_POLICY_KEYS = Object.keys(importPolicyFields) as Array<
  keyof typeof importPolicyFields
>;

/** The import policy fields present in `input`, for a create or an update. */
export function importPolicyData(input: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of IMPORT_POLICY_KEYS) if (input[key] !== undefined) data[key] = input[key];
  return data;
}

/** A source system code the tenant has not defined; null when it is fine (or not given). */
export async function unknownSourceSystem(
  db: { sourceSystem: { findUnique(args: { where: { code: string } }): Promise<unknown> } },
  code: string | null | undefined
): Promise<string | null> {
  if (!code) return null;
  return (await db.sourceSystem.findUnique({ where: { code } }))
    ? null
    : `No source system ${code}; define it under Integrations, Sources first.`;
}

/** A SUSPENSE policy needs a suspense account (the database refuses one without). */
export function suspenseProblem(policy: unknown, account: unknown): string | null {
  return policy === "SUSPENSE" && !account
    ? "The SUSPENSE policy needs suspenseAccountCode: the account that takes unmapped amounts."
    : null;
}

export const profileCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  profileType: z.enum(["IMPORT", "EXPORT", "PROCESS", "INTERNAL_TRANSFER", "EXTERNAL_TRANSFER"]),
  sourceComponent: z.string().max(100).optional(),
  targetComponent: z.string().max(100).optional(),
  sourceFormatId: z.string().uuid().optional(),
  targetFormatId: z.string().uuid().optional(),
  transformationId: z.string().uuid().optional(),
  filterId: z.string().uuid().optional(),
  sourceParams: z.record(z.unknown()).optional(),
  targetParams: z.record(z.unknown()).optional(),
  savePayload: z.enum(["NONE", "INPUT", "OUTPUT", "BOTH"]).optional(),
  ...importPolicyFields
});

export type ProfileCreateInput = z.infer<typeof profileCreateSchema>;

export const profileUpdateSchema = profileCreateSchema.partial().extend({
  /** FSD schema from wizard Step 2 — stored in sourceParams.__fsdSchema */
  fsdSchema: z.record(z.unknown()).optional(),
  /** TML mappings from wizard Step 3 — stored in sourceParams.__tmlMappings */
  tmlMappings: z.array(z.record(z.unknown())).optional(),
  /** Validation rules from wizard Step 4 */
  validationRules: z.array(z.record(z.unknown())).optional(),
  /** Error handling config from wizard Step 4 */
  errorHandling: z.record(z.unknown()).optional(),
  /** Duplicate detection config from wizard Step 4 */
  duplicateDetection: z.record(z.unknown()).optional(),
  /** Posting options from wizard Step 4 */
  postingOptions: z.record(z.unknown()).optional()
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const profileListQuerySchema = z.object({
  profileType: z
    .enum(["IMPORT", "EXPORT", "PROCESS", "INTERNAL_TRANSFER", "EXTERNAL_TRANSFER"])
    .optional(),
  isActive: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  isSystem: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  limit: pageFields.limit,
  offset: pageFields.offset,
  search: z.string().max(200).optional()
});

export type ProfileListQuery = z.infer<typeof profileListQuerySchema>;

export const profileStatusChangeSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]),
  changeNote: z.string().max(500).optional()
});

export type ProfileStatusChangeInput = z.infer<typeof profileStatusChangeSchema>;
