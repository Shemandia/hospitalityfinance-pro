/**
 * Provisions a tenant from the command line, exactly as the platform's
 * onboarding screen does (ProvisioningService): registry entry, a database
 * with its own owner and application roles, the tenant migrations, the
 * application role's rights, the first administrator and the welcome e-mail.
 *
 * Usage:
 *   pnpm --filter @hfp/api exec tsx src/scripts/provision-tenant.ts \
 *     --name "Jumeirah Group" --slug jumeirah --admin-email admin@jumeirah.com \
 *     [--admin-first-name Ada] [--admin-last-name Admin] \
 *     [--admin-password <temporary password, 12+ chars>] \
 *     [--country AE] [--plan <plan code, default: the default plan>] \
 *     [--max-properties <n>] [--max-users <n>] [--modules GL,AP,...] \
 *     [--upload-max-mb <n>] [--import-concurrency <n>]
 *
 * Limits not given are the plan's (registry table plans).
 *
 * Needs REGISTRY_DATABASE_URL (its role creates roles and databases: CREATEDB
 * and CREATEROLE) and PLATFORM_ENCRYPTION_KEY. TENANT_DB_HOST/PORT place the
 * database on another server.
 */

import crypto from "node:crypto";
import { provisionTenantSchema } from "../modules/tenant/types.js";
import { ProvisioningService } from "../modules/tenant/provisioning-service.js";
import { registryPrisma } from "../db/prisma.js";

function args(): Map<string, string> {
  const list = process.argv.slice(2);
  const map = new Map<string, string>();
  for (let i = 0; i < list.length; i += 2) {
    const key = list[i]?.replace(/^--/, "");
    const value = list[i + 1];
    if (key && value) map.set(key, value);
  }
  return map;
}

const a = args();
const number = (key: string) => (a.has(key) ? Number(a.get(key)) : undefined);
const planCode =
  a.get("plan")?.toUpperCase() ??
  (await registryPrisma.plan.findFirst({ where: { isDefault: true, isActive: true } }))?.code;
const generatedPassword = !a.has("admin-password");
const parsed = provisionTenantSchema.safeParse({
  tenant: {
    name: a.get("name"),
    slug: a.get("slug"),
    adminEmail: a.get("admin-email"),
    countryCode: a.get("country") ?? "AE"
  },
  entitlements: {
    planCode,
    maxProperties: number("max-properties"),
    maxUsers: number("max-users"),
    enabledModules: a.get("modules")?.split(","),
    uploadMaxMb: number("upload-max-mb"),
    importConcurrency: number("import-concurrency"),
    subscriptionStartDate: new Date().toISOString().slice(0, 10)
  },
  adminUser: {
    firstName: a.get("admin-first-name") ?? "Tenant",
    lastName: a.get("admin-last-name") ?? "Administrator",
    email: a.get("admin-email"),
    temporaryPassword:
      a.get("admin-password") ?? `${crypto.randomBytes(18).toString("base64url")}Aa1`
  }
});

if (!parsed.success) {
  console.error("Usage: provision-tenant --name <name> --slug <slug> --admin-email <email> [...]");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

let failed = false;
await new ProvisioningService()
  .provision(parsed.data, (event, data) => {
    if (event === "step") console.log(`  ${data.status === "COMPLETED" ? "✓" : "…"} ${data.step}`);
    if (event === "error") {
      failed = true;
      console.error(`  ✗ ${data.step}: ${data.error}`);
    }
    if (event === "complete") console.log(`\nTenant ready. Sign-in: ${data.url}`);
  })
  .catch(() => {
    failed = true;
  });

if (!failed && generatedPassword) {
  console.log(`Temporary administrator password: ${parsed.data.adminUser.temporaryPassword}`);
  console.log("It must be changed at first sign-in.");
}
process.exit(failed ? 1 : 0);
