import { z } from "zod";

// ── Auto-detect ──────────────────────────────────────────────────────────────

export const fsdAutoDetectSchema = z.object({
  /** Base64-encoded file content */
  file: z.string().min(1),
  /** Original filename (used for extension-based hints) */
  filename: z.string().min(1).max(255)
});

export type FsdAutoDetectInput = z.infer<typeof fsdAutoDetectSchema>;

// ── Validate schema ──────────────────────────────────────────────────────────

export const fsdValidateSchemaInput = z.object({
  /** The FSD schema JSON to validate */
  schema: z.record(z.unknown())
});

export type FsdValidateSchemaInput = z.infer<typeof fsdValidateSchemaInput>;

// ── Parse preview ────────────────────────────────────────────────────────────

export const fsdParsePreviewSchema = z.object({
  /** Base64-encoded file content */
  file: z.string().min(1),
  /** Original filename */
  filename: z.string().min(1).max(255),
  /** The FSD schema to parse with */
  schema: z.record(z.unknown()),
  /** Maximum rows to return (default 10) */
  maxRows: z.coerce.number().int().min(1).max(1000).default(10)
});

export type FsdParsePreviewInput = z.infer<typeof fsdParsePreviewSchema>;
