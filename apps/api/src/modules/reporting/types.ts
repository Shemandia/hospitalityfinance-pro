import { z } from "zod";

export const createReportRunSchema = z.object({
  definitionId: z.string().uuid(),
  parameters: z.record(z.unknown()).default({})
});

export const createReportDefinitionSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["USALI_PL", "TRIAL_BALANCE", "BALANCE_SHEET", "CASHFLOW", "CUSTOM"]),
  template: z.object({
    report: z.string(),
    sections: z.array(z.string()).optional(),
    columns: z.array(z.string()).optional(),
    filters: z.record(z.unknown()).optional(),
    groupBy: z.array(z.string()).optional(),
    sortBy: z.string().optional(),
    sortDirection: z.enum(["ASC", "DESC"]).optional(),
    showZeroBalances: z.boolean().optional(),
    accountTypes: z.array(z.string()).optional(),
    usaliDepartments: z.array(z.string()).optional(),
    dateRange: z
      .object({
        from: z.string().optional(),
        to: z.string().optional()
      })
      .optional(),
    comparativePeriods: z
      .object({
        ytd: z.boolean().optional(),
        priorYear: z.boolean().optional(),
        budget: z.boolean().optional()
      })
      .optional()
  }),
  isSystem: z.boolean().default(false),
  description: z.string().max(500).optional()
});

export const updateReportDefinitionSchema = createReportDefinitionSchema.partial();

export const scheduleReportSchema = z.object({
  definitionId: z.string().uuid(),
  cronPattern: z.string().min(1).max(50),
  parameters: z.record(z.unknown()).default({}),
  notifyEmail: z.string().email().optional(),
  isActive: z.boolean().default(true)
});

export type CreateReportRunInput = z.infer<typeof createReportRunSchema>;
export type CreateReportDefinitionInput = z.infer<typeof createReportDefinitionSchema>;
export type ScheduleReportInput = z.infer<typeof scheduleReportSchema>;
