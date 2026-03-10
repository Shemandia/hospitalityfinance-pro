import { z } from "zod";

export const createReportRunSchema = z.object({
  definitionId: z.string().uuid(),
  parameters: z.record(z.unknown()).default({})
});

export type CreateReportRunInput = z.infer<typeof createReportRunSchema>;
