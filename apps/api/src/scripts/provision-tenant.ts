/**
 * Tenant Provisioning Script
 *
 * Creates a new tenant: registers in the shared registry, creates a PostgreSQL
 * database, runs Prisma migrations, applies performance indexes and RLS.
 *
 * Usage:
 *   npx tsx src/scripts/provision-tenant.ts \
 *     --name "Jumeirah Group" \
 *     --slug "jumeirah" \
 *     --admin-email "admin@jumeirah.com" \
 *     --admin-password "TemporaryPassword123" \
 *     --plan standard \
 *     --max-properties 20
 *
 * Environment:
 *   REGISTRY_DATABASE_URL  — shared registry DB (default: DATABASE_URL)
 *   TENANT_DB_HOST         — host for new tenant DBs (default: localhost)
 *   TENANT_DB_PORT         — port (default: 5432)
 *   TENANT_DB_USER         — superuser to create DBs (default: from DATABASE_URL)
 *   TENANT_DB_PASSWORD     — password (default: from DATABASE_URL)
 */

import crypto from "node:crypto";
import { PrismaClient } from "../db/client.js";
import { PrismaClient as RegistryPrismaClient } from "../db/registry-client.js";
import { assertTenantSecurity, deployMigrations } from "../db/migrate.js";
import { ensureSystemCatalog, grantTenantAdministrator } from "../modules/access/setup.js";
import { hashPassword } from "../services/password-policy.js";
import { config as appConfig, registryDatabaseUrl } from "../config.js";

// ── Parse args ────────────────────────────────────────────────────────────────

function parseArgs(): {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
  generatedPassword: boolean;
  plan: string;
  maxProperties: number;
} {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    const val = args[i + 1];
    if (key && val) map.set(key, val);
  }

  const name = map.get("name");
  const slug = map.get("slug");
  const adminEmail = map.get("admin-email");

  if (!name || !slug || !adminEmail) {
    console.error("Usage: provision-tenant --name <name> --slug <slug> --admin-email <email>");
    console.error(
      "  Optional: --admin-password <temporary-password> --plan <standard|enterprise|trial> --max-properties <n>"
    );
    process.exit(1);
  }

  // Validate slug: lowercase, alphanumeric + hyphens
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    console.error(
      "Slug must be 3-50 chars, lowercase alphanumeric with hyphens, no leading/trailing hyphen."
    );
    process.exit(1);
  }

  return {
    name,
    slug,
    adminEmail,
    adminPassword: map.get("admin-password") ?? crypto.randomBytes(18).toString("base64url"),
    generatedPassword: !map.has("admin-password"),
    plan: map.get("plan") ?? "standard",
    maxProperties: parseInt(map.get("max-properties") ?? "10", 10)
  };
}

// ── Parse connection URL ──────────────────────────────────────────────────────

function parseDbUrl(url: string): {
  user: string;
  password: string;
  host: string;
  port: string;
  database: string;
} {
  const parsed = new URL(url);
  return {
    user: parsed.username,
    password: parsed.password,
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.slice(1) // remove leading /
  };
}

function buildDbUrl(
  user: string,
  password: string,
  host: string,
  port: string,
  database: string
): string {
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();
  const registryUrl = registryDatabaseUrl();

  const registry = new RegistryPrismaClient({ datasourceUrl: registryUrl });

  console.log(`\n=== Provisioning tenant: ${config.name} (${config.slug}) ===\n`);

  // 1. Check if slug already exists
  const existing = await registry.tenant.findUnique({ where: { slug: config.slug } });
  if (existing) {
    console.error(`Tenant with slug '${config.slug}' already exists (id: ${existing.id}).`);
    process.exit(1);
  }

  // 2. Determine tenant database name and URL
  const dbConn = parseDbUrl(registryUrl);
  const settings = appConfig();
  const tenantDbHost = settings.TENANT_DB_HOST ?? dbConn.host;
  const tenantDbPort = settings.TENANT_DB_PORT ?? dbConn.port;
  const tenantDbUser = settings.TENANT_DB_USER ?? dbConn.user;
  const tenantDbPassword = settings.TENANT_DB_PASSWORD ?? dbConn.password;
  const tenantDbName = `hfp_${config.slug.replace(/-/g, "_")}`;
  const tenantDbUrl = buildDbUrl(
    tenantDbUser,
    tenantDbPassword,
    tenantDbHost,
    tenantDbPort,
    tenantDbName
  );

  console.log(`  Database: ${tenantDbName}`);
  console.log(`  Host: ${tenantDbHost}:${tenantDbPort}`);

  // 3. Create the database (using psql or raw connection via registry)
  console.log("\n1. Creating database...");

  // Validate identifiers to prevent SQL injection (allowlist: letters, digits, underscores)
  const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
  if (!identifierRegex.test(tenantDbName)) {
    throw new Error(
      `Invalid database name: ${tenantDbName}. Only alphanumeric and underscores allowed.`
    );
  }
  if (!identifierRegex.test(tenantDbUser)) {
    throw new Error(
      `Invalid database user: ${tenantDbUser}. Only alphanumeric and underscores allowed.`
    );
  }

  try {
    await registry.$executeRawUnsafe(`CREATE DATABASE "${tenantDbName}" OWNER "${tenantDbUser}"`);
    console.log(`   Created database: ${tenantDbName}`);
  } catch (error: any) {
    if (error.message?.includes("already exists")) {
      console.log(`   Database ${tenantDbName} already exists, continuing...`);
    } else {
      throw error;
    }
  }

  // 4. Apply the tenant migrations: tables, security policies and constraints.
  console.log("\n2. Running migrations...");
  await deployMigrations("tenant", tenantDbUrl);
  const tenantClient = new PrismaClient({ datasourceUrl: tenantDbUrl });
  await assertTenantSecurity(tenantClient);
  console.log("   Migrations applied; security policies present.");

  // 6. Register in tenant registry
  console.log("\n3. Registering tenant...");
  const tenant = await registry.tenant.create({
    data: {
      name: config.name,
      slug: config.slug,
      tenantCode: crypto
        .createHash("sha256")
        .update(config.slug + ":" + Date.now() + ":" + Math.random())
        .digest("hex")
        .substring(0, 8),
      databaseUrl: tenantDbUrl,
      adminEmail: config.adminEmail,
      plan: config.plan,
      maxProperties: config.maxProperties,
      isActive: true,
      provisionedAt: new Date()
    }
  });

  console.log(`   Registered: ${tenant.id}`);

  // 7. Create admin user in tenant database
  console.log("\n4. Creating admin user...");
  await ensureSystemCatalog(tenantClient);
  const passwordHash = await hashPassword(config.adminPassword);
  const adminUser = await tenantClient.user.upsert({
    where: { email: config.adminEmail.toLowerCase() },
    update: {
      name: config.name + " Admin",
      passwordHash,
      mustChangePassword: true,
      isActive: true
    },
    create: {
      email: config.adminEmail.toLowerCase(),
      name: config.name + " Admin",
      passwordHash,
      mustChangePassword: true,
      isActive: true
    }
  });
  await grantTenantAdministrator(tenantClient, adminUser.id);
  console.log(`   Admin user created: ${config.adminEmail}`);

  await tenantClient.$disconnect();
  await registry.$disconnect();

  console.log(`\n=== Tenant '${config.slug}' provisioned successfully ===`);
  console.log(`  ID: ${tenant.id}`);
  console.log(`  Database: ${tenantDbName}`);
  console.log(`  URL: ${tenantDbUrl}`);
  if (config.generatedPassword) {
    console.log(`  Temporary admin password: ${config.adminPassword}`);
  }
  console.log(`\nNext steps:`);
  console.log(`  1. Sign in at /t/${tenant.tenantCode}/login with ${config.adminEmail}`);
  console.log(`  2. Change the temporary password on first login`);
  console.log(
    `  3. Run seed-uat.ts with DATABASE_URL=${tenantDbUrl} to populate demo data if needed`
  );
}

main().catch((error) => {
  console.error("\nProvisioning failed:", error);
  process.exit(1);
});
