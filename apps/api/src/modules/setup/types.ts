import { z } from "zod";

export const stepSchemas: Record<number, z.ZodType> = {
  1: z
    .object({
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
    })
    // Entity codes are unique in the tenant: imported documents name their
    // entity by code.
    .superRefine((value, ctx) => {
      const seen = new Map<string, string>();
      const codes: Array<[string, (string | number)[]]> = [
        [value.corporate.code, ["corporate", "code"]],
        ...value.properties.map(
          (p, i) => [p.code, ["properties", i, "code"]] as [string, (string | number)[]]
        )
      ];
      for (const [raw, path] of codes) {
        const code = raw.trim();
        if (seen.has(code)) {
          ctx.addIssue({
            code: "custom",
            path,
            message: `The code ${code} is already used by ${seen.get(code)}; every code must be unique.`
          });
        } else {
          seen.set(code, path[0] === "corporate" ? "the company" : "another property");
        }
      }
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
        // A role code of this tenant; checked against its roles when saved.
        role: z.string().min(1).max(50),
        entityIds: z.array(z.string().uuid())
      })
    )
  })
};
