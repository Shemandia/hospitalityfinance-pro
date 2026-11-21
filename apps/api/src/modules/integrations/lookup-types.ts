import { z } from "zod";

// ── Lookup Table schemas ─────────────────────────────────────────────────────

export const lookupTableCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  columns: z.array(z.string().min(1).max(100)).min(2, "At least two columns required"),
  rows: z
    .array(
      z.object({
        businessUnit: z.string().max(50).optional(),
        rangeFrom: z.string().min(1).max(200),
        rangeTo: z.string().min(1).max(200),
        values: z.record(z.string())
      })
    )
    .optional()
});

export type LookupTableCreateInput = z.infer<typeof lookupTableCreateSchema>;

export const lookupTableUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  columns: z.array(z.string().min(1).max(100)).min(2).optional(),
  rows: z
    .array(
      z.object({
        businessUnit: z.string().max(50).optional(),
        rangeFrom: z.string().min(1).max(200),
        rangeTo: z.string().min(1).max(200),
        values: z.record(z.string())
      })
    )
    .optional()
});

export type LookupTableUpdateInput = z.infer<typeof lookupTableUpdateSchema>;
