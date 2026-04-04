import { z } from "zod";

export const stepSchemas: Record<number, z.ZodType> = {
  1: z.object({
    corporate: z.object({
      name: z.string().min(1),
      code: z.string().min(1).max(20),
      countryCode: z.string().length(2),
      functionalCurrency: z.string().length(3),
      reportingCurrency: z.string().length(3),
      timezone: z.string().min(1)
    }),
    properties: z
      .array(
        z.object({
          name: z.string().min(1),
          code: z.string().min(1).max(20),
          countryCode: z.string().length(2),
          currency: z.string().length(3),
          timezone: z.string().min(1)
        })
      )
      .min(1)
  }),
  2: z.object({
    departments: z
      .array(
        z.object({
          name: z.string().min(1),
          code: z.string().min(1).max(50),
          isActive: z.boolean().default(true)
        })
      )
      .min(1)
  }),
  3: z.object({
    importMethod: z.enum(["usali_template", "upload", "blank"]),
    accountCount: z.number().int().optional()
  }),
  4: z.object({
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    years: z.array(z.number().int().min(2020).max(2100)).min(1)
  }),
  5: z.object({
    additionalCurrencies: z.array(z.string().length(3)),
    autoImportEcb: z.boolean()
  }),
  6: z.object({
    invitations: z.array(
      z.object({
        email: z.string().email(),
        name: z.string().min(1),
        role: z.enum(["VIEWER", "CONTROLLER", "ADMIN"]),
        entityIds: z.array(z.string().uuid())
      })
    )
  })
};
