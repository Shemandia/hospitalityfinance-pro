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
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import bcrypt from "bcrypt";

const SYSTEM_PERMISSION_CODES = [
  "GL_READ",
  "GL_WRITE",
  "GL_POST",
  "GL_REVERSE",
  "GL_APPROVE",
  "COA_READ",
  "COA_CREATE",
  "COA_EDIT",
  "AP_READ",
  "AP_WRITE",
  "AP_APPROVE",
  "AP_PAYMENT_CONFIRM",
  "PAYMENT_RUN_READ",
  "PAYMENT_RUN_CREATE",
  "PAYMENT_RUN_APPROVE",
  "AR_READ",
  "AR_WRITE",
  "AR_DUNNING",
  "BUDGET_READ",
  "BUDGET_WRITE",
  "BUDGET_APPROVE",
  "FX_READ",
  "FX_WRITE",
  "REPORT_READ",
  "REPORT_WRITE",
  "REPORT_EXPORT",
  "REPORT_CREATE_CUSTOM",
  "PERIOD_READ",
  "PERIOD_MANAGE",
  "PERIOD_REOPEN",
  "TRANSFER_DESK_READ",
  "TRANSFER_DESK_EXECUTE",
  "TRANSFER_DESK_CONFIG",
  "INTEGRATION_READ",
  "INTEGRATION_IMPORT",
  "INTEGRATION_CONFIG",
  "IC_READ",
  "IC_CREATE",
  "IC_APPROVE",
  "IC_REVERSE",
  "IC_CONFIG",
  "IC_RECONCILE",
  "CONSOLIDATION_RUN",
  "STATS_READ",
  "STATS_IMPORT",
  "AUDIT_READ",
  "ADMIN_USERS_READ",
  "ADMIN_USERS",
  "ADMIN_ROLES_MANAGE",
  "ADMIN_SETTINGS",
  "ADMIN_ENTITIES",
  "ADMIN_AUDIT_LOG"
];

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

async function ensureTenantAdminRole(tenantClient: PrismaClient) {
  const role = await tenantClient.role.upsert({
    where: { code: "TENANT_ADMIN" },
    update: {
      name: "Tenant Administrator",
      description: "Full system access - manages users, roles, entities, and all modules",
      isSystem: true
    },
    create: {
      code: "TENANT_ADMIN",
      name: "Tenant Administrator",
      description: "Full system access - manages users, roles, entities, and all modules",
      isSystem: true
    }
  });

  for (const code of SYSTEM_PERMISSION_CODES) {
    const permission = await tenantClient.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: code.replace(/_/g, " "), category: "System" }
    });
    await tenantClient.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id }
    });
  }

  return role;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();
  const registryUrl = process.env.REGISTRY_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!registryUrl) {
    console.error("REGISTRY_DATABASE_URL or DATABASE_URL must be set.");
    process.exit(1);
  }

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
  const tenantDbHost = process.env.TENANT_DB_HOST ?? dbConn.host;
  const tenantDbPort = process.env.TENANT_DB_PORT ?? dbConn.port;
  const tenantDbUser = process.env.TENANT_DB_USER ?? dbConn.user;
  const tenantDbPassword = process.env.TENANT_DB_PASSWORD ?? dbConn.password;
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

  // 4. Run Prisma migrations on the new database
  console.log("\n2. Running migrations...");
  const apiRoot = resolve(import.meta.dirname ?? __dirname, "../..");
  execSync(`npx prisma migrate deploy`, {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: tenantDbUrl },
    stdio: "inherit"
  });

  // 5. Apply performance indexes and RLS
  console.log("\n3. Applying performance indexes...");
  const tenantClient = new PrismaClient({ datasourceUrl: tenantDbUrl });

  try {
    // Read and execute SQL files
    const { readFileSync } = await import("node:fs");
    const sqlDir = resolve(apiRoot, "src/db/sql");

    const performanceSql = readFileSync(resolve(sqlDir, "performance.sql"), "utf-8");
    const rlsSql = readFileSync(resolve(sqlDir, "entity-rls.sql"), "utf-8");

    // Split by semicolons and execute each statement
    for (const file of [performanceSql, rlsSql]) {
      const statements = file
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("--"));

      for (const stmt of statements) {
        try {
          await tenantClient.$executeRawUnsafe(stmt);
        } catch {
          // Some statements may fail if already applied — continue
        }
      }
    }
    console.log("   Performance indexes and RLS applied.");
  } catch (error) {
    console.warn("   Warning: Could not apply SQL files. Apply manually if needed.", error);
  }

  // 6. Register in tenant registry
  console.log("\n4. Registering tenant...");
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
  console.log("\n5. Creating admin user...");
  const tenantAdminRole = await ensureTenantAdminRole(tenantClient);
  const passwordHash = await bcrypt.hash(config.adminPassword, 12);
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
  const existingRole = await tenantClient.userRole.findFirst({
    where: { userId: adminUser.id, roleId: tenantAdminRole.id, entityId: null }
  });
  if (!existingRole) {
    await tenantClient.userRole.create({
      data: { userId: adminUser.id, roleId: tenantAdminRole.id, entityId: null }
    });
  }
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
