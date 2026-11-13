/**
 * Provision 3 Demo Chains
 *
 * Convenience script that provisions 3 test hotel chains for UAT/demo.
 * Each chain gets its own database with full schema + demo data.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/hfp_registry \
 *   npx tsx src/scripts/provision-demo-chains.ts
 *
 * This script:
 *   1. Creates 3 tenant entries in the registry (with deterministic tenantCode)
 *   2. Creates 3 PostgreSQL databases
 *   3. Runs migrations on each
 *   4. Seeds each with its own entities, accounts, periods, and data
 *
 * No hardcoded IDs — everything is auto-generated.
 */

import crypto from "node:crypto";
import { PrismaClient, Prisma } from "../db/client.js";
import { PrismaClient as RegistryPrismaClient } from "../db/registry-client.js";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import {
  applyAccessMigration,
  ensureSystemCatalog,
  grantRoleAtEntity
} from "../modules/access/setup.js";

/** The demo administrator holds this starting role on the chain's group. */
const DEMO_ADMIN_ROLE = "ADMIN";

const registryUrl = process.env.REGISTRY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!registryUrl) {
  console.error("DATABASE_URL or REGISTRY_DATABASE_URL must be set.");
  process.exit(1);
}

const registry = new RegistryPrismaClient({ datasourceUrl: registryUrl });

function parseDbUrl(url: string) {
  const parsed = new URL(url);
  return {
    user: parsed.username,
    password: parsed.password,
    host: parsed.hostname,
    port: parsed.port || "5432"
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

const apiRoot = resolve(import.meta.dirname ?? __dirname, "../..");

// ── Chain definitions (no hardcoded IDs) ──────────────────────────────────────

const chains = [
  {
    slug: "sunrise-hotels",
    name: "Sunrise Hotels & Resorts",
    adminEmail: "admin@sunrise-hotels.com",
    currency: "AED",
    country: "AE",
    timezone: "Asia/Dubai",
    properties: [
      { name: "Sunrise Beach Resort", code: "SBR", city: "Dubai" },
      { name: "Sunrise Marina Hotel", code: "SMH", city: "Abu Dhabi" }
    ]
  },
  {
    slug: "ocean-resorts",
    name: "Ocean Resorts International",
    adminEmail: "admin@ocean-resorts.com",
    currency: "USD",
    country: "MV",
    timezone: "Indian/Maldives",
    properties: [
      { name: "Ocean Coral Villas", code: "OCV", city: "Malé" },
      { name: "Ocean Lagoon Retreat", code: "OLR", city: "Baa Atoll" },
      { name: "Ocean Sunset Spa", code: "OSS", city: "Ari Atoll" }
    ]
  },
  {
    slug: "mountain-lodges",
    name: "Mountain Lodges Collection",
    adminEmail: "admin@mountain-lodges.com",
    currency: "CHF",
    country: "CH",
    timezone: "Europe/Zurich",
    properties: [
      { name: "Alpine Peak Lodge", code: "APL", city: "Zermatt" },
      { name: "Glacier View Chalet", code: "GVC", city: "Grindelwald" }
    ]
  }
];

async function provisionChain(chain: (typeof chains)[0]) {
  const dbConn = parseDbUrl(registryUrl!);
  const tenantDbName = `hfp_${chain.slug.replace(/-/g, "_")}`;
  const tenantDbUrl = buildDbUrl(
    dbConn.user,
    dbConn.password,
    dbConn.host,
    dbConn.port,
    tenantDbName
  );

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Provisioning: ${chain.name} (${chain.slug})`);
  console.log(`Database: ${tenantDbName}`);
  console.log(`${"=".repeat(60)}`);

  // 1. Create database
  // Validate identifiers to prevent SQL injection (allowlist: letters, digits, underscores)
  const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;
  if (!identifierRegex.test(tenantDbName)) {
    throw new Error(
      `Invalid database name: ${tenantDbName}. Only alphanumeric and underscores allowed.`
    );
  }
  if (!identifierRegex.test(dbConn.user)) {
    throw new Error(
      `Invalid database user: ${dbConn.user}. Only alphanumeric and underscores allowed.`
    );
  }

  try {
    await registry.$executeRawUnsafe(`CREATE DATABASE "${tenantDbName}" OWNER "${dbConn.user}"`);
    console.log(`  ✓ Database created`);
  } catch (e: any) {
    if (e.message?.includes("already exists")) {
      console.log(`  ✓ Database exists`);
    } else {
      throw e;
    }
  }

  // 2. Run migrations
  console.log(`  Running migrations...`);
  execSync(`npx prisma db push --schema src/db/schema-tenant.prisma --skip-generate`, {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: tenantDbUrl },
    stdio: "pipe"
  });
  console.log(`  ✓ Migrations applied`);

  // 3. Register tenant
  const existingTenant = await registry.tenant.findUnique({ where: { slug: chain.slug } });
  let tenantId: string;
  if (existingTenant) {
    tenantId = existingTenant.id;
    console.log(`  ✓ Tenant already registered: ${tenantId}`);
  } else {
    const tenant = await registry.tenant.create({
      data: {
        name: chain.name,
        slug: chain.slug,
        tenantCode: crypto.createHash("sha256").update(chain.slug).digest("hex").substring(0, 8),
        databaseUrl: tenantDbUrl,
        adminEmail: chain.adminEmail,
        plan: "standard",
        maxProperties: 20,
        isActive: true,
        provisionedAt: new Date()
      }
    });
    tenantId = tenant.id;
    console.log(`  ✓ Tenant registered: ${tenantId}`);
  }

  // 4. Seed data in tenant database
  const tenantDb = new PrismaClient({ datasourceUrl: tenantDbUrl });
  await applyAccessMigration(tenantDb);
  await ensureSystemCatalog(tenantDb);

  // Admin user
  const adminUser = await tenantDb.user.upsert({
    where: { email: chain.adminEmail },
    update: {},
    create: {
      email: chain.adminEmail,
      keycloakId: `kc-${chain.slug}-admin`,
      name: `${chain.name} Admin`,
      isActive: true
    }
  });
  console.log(`  ✓ Admin user: ${adminUser.email} (${adminUser.id})`);

  // Group entity
  const group = await tenantDb.entity.findFirst({ where: { type: "GROUP" } });
  let groupId: string;
  if (group) {
    groupId = group.id;
    console.log(`  ✓ Group exists: ${group.name} (${groupId})`);
  } else {
    const created = await tenantDb.entity.create({
      data: {
        name: chain.name,
        code: chain.slug.split("-")[0]!.toUpperCase(),
        type: "GROUP",
        functionalCurrency: chain.currency,
        reportingCurrency: "USD",
        timezone: chain.timezone,
        countryCode: chain.country,
        isActive: true
      }
    });
    groupId = created.id;
    console.log(`  ✓ Group created: ${created.name} (${groupId})`);
  }

  // Assign admin to group
  // A grant on the group reaches every property below it.
  await grantRoleAtEntity(tenantDb, adminUser.id, DEMO_ADMIN_ROLE, groupId);

  // Properties
  for (const prop of chain.properties) {
    const existing = await tenantDb.entity.findFirst({
      where: { parentId: groupId, code: prop.code }
    });
    if (existing) {
      console.log(`  ✓ Property exists: ${prop.name} (${existing.id})`);
      continue;
    }

    const property = await tenantDb.entity.create({
      data: {
        name: prop.name,
        code: prop.code,
        type: "PROPERTY",
        parentId: groupId,
        functionalCurrency: chain.currency,
        reportingCurrency: "USD",
        timezone: chain.timezone,
        countryCode: chain.country,
        city: prop.city,
        isActive: true
      }
    });
    console.log(`  ✓ Property created: ${prop.name} (${property.id})`);

    // The admin's grant on the group reaches this property.

    // Create basic COA for each property
    const accounts = [
      { code: "1001", name: "Cash", type: "ASSET", nb: "DEBIT" },
      { code: "1100", name: "Accounts Receivable", type: "ASSET", nb: "DEBIT" },
      { code: "2001", name: "Accounts Payable", type: "LIABILITY", nb: "CREDIT" },
      { code: "3001", name: "Owner's Equity", type: "EQUITY", nb: "CREDIT" },
      { code: "4001", name: "Room Revenue", type: "REVENUE", nb: "CREDIT", dept: "Rooms" },
      { code: "4101", name: "F&B Revenue", type: "REVENUE", nb: "CREDIT", dept: "Food & Beverage" },
      { code: "5001", name: "Rooms Expenses", type: "EXPENSE", nb: "DEBIT", dept: "Rooms" },
      {
        code: "5101",
        name: "F&B Cost of Sales",
        type: "EXPENSE",
        nb: "DEBIT",
        dept: "Food & Beverage"
      },
      {
        code: "6001",
        name: "Admin & General",
        type: "EXPENSE",
        nb: "DEBIT",
        dept: "Administrative & General"
      }
    ];

    for (const a of accounts) {
      await tenantDb.account.create({
        data: {
          entityId: property.id,
          code: a.code,
          name: a.name,
          type: a.type as any,
          normalBalance: a.nb as any,
          usaliDepartment: (a as any).dept ?? null,
          allowPosting: true,
          isActive: true,
          level: 1
        }
      });
    }
    console.log(`  ✓ ${accounts.length} accounts created for ${prop.code}`);

    // Create an open period
    const period = await tenantDb.period.create({
      data: {
        entityId: property.id,
        year: 2026,
        month: 3,
        name: "March 2026",
        status: "OPEN",
        openedAt: new Date("2026-03-01")
      }
    });
    console.log(`  ✓ Period created: March 2026 (${period.id})`);
  }

  await tenantDb.$disconnect();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== HFP Multi-Tenant Demo Provisioning ===");
  console.log(`Registry: ${registryUrl}`);
  console.log(`Chains to provision: ${chains.length}\n`);

  for (const chain of chains) {
    await provisionChain(chain);
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log("Provisioning complete!\n");
  console.log("Tenants created:");
  for (const chain of chains) {
    const dbName = `hfp_${chain.slug.replace(/-/g, "_")}`;
    console.log(`  ${chain.slug.padEnd(20)} → ${dbName} (${chain.properties.length} properties)`);
  }
  console.log(`\nTo test, send API requests with:`);
  console.log(`  Authorization: Bearer dev-token`);
  console.log(`  X-Tenant-Slug: <slug>      (e.g. sunrise-hotels)`);
  console.log(`  X-Entity-ID: <entity-uuid>  (from the property created above)`);

  await registry.$disconnect();
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
