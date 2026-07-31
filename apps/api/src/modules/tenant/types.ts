import { z } from "zod";

// ── Provisioning request schemas ────────────────────────────────────────────

export const provisionTenantSchema = z.object({
  tenant: z.object({
    name: z.string().min(1).max(200),
    slug: z
      .string()
      .min(3)
      .max(50)
      .regex(
        /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/,
        "Slug must be 3-50 chars, lowercase alphanumeric with hyphens."
      ),
    domain: z.string().max(253).optional(),
    adminEmail: z.string().email(),
    countryCode: z.string().length(2)
  }),
  entitlements: z.object({
    licenseType: z.enum(["TRIAL", "STANDARD", "ENTERPRISE"]),
    maxProperties: z.number().int().min(1),
    maxUsers: z.number().int().min(1),
    enabledModules: z.array(z.string().min(1)).min(1),
    maxConcurrentSessions: z.number().int().min(1),
    subscriptionStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date required"),
    subscriptionEndDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date required")
      .optional()
      .nullable()
      .or(z.literal(""))
  }),
  adminUser: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email(),
    temporaryPassword: z.string().min(12),
    phone: z.string().max(50).optional()
  })
});

export type ProvisionTenantInput = z.infer<typeof provisionTenantSchema>;

// ── Provisioning step names (ordered) ───────────────────────────────────────

export const PROVISIONING_STEPS = [
  { name: "creating_database", order: 1, label: "Creating database" },
  { name: "running_migrations", order: 2, label: "Running migrations" },
  { name: "applying_security", order: 3, label: "Applying security policies" },
  { name: "creating_auth", order: 4, label: "Creating native auth user" },
  { name: "seeding_data", order: 5, label: "Seeding initial data" },
  { name: "sending_email", order: 6, label: "Sending activation email" }
] as const;

export type ProvisioningStepName = (typeof PROVISIONING_STEPS)[number]["name"];
