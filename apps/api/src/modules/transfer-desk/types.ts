import { z } from "zod";

// ── Profile CRUD schemas ─────────────────────────────────────────────────────

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
  savePayload: z.enum(["NONE", "INPUT", "OUTPUT", "BOTH"]).optional()
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
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().max(200).optional()
});

export type ProfileListQuery = z.infer<typeof profileListQuerySchema>;

export const profileStatusChangeSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]),
  changeNote: z.string().max(500).optional()
});

export type ProfileStatusChangeInput = z.infer<typeof profileStatusChangeSchema>;
