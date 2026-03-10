import { z } from "zod";

export const auditQuerySchema = z.object({
  resource_type: z.string().min(1),
  resource_id: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).default(100)
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;
