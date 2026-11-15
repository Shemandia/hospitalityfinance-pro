import { z } from "zod";
import { pageFields } from "../../shared/pagination.js";

export const auditQuerySchema = z.object({
  resource_type: z.string().min(1),
  resource_id: z.string().min(1),
  limit: pageFields.limit
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;
