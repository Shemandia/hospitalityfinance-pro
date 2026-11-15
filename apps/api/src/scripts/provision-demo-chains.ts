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
 *   1. Creates 3 tenant entries in the registry (with deterministic tenantCode),
 *      each with its database location and sealed role passwords
 *   2. Creates each database with its owner and application roles, applies
 *      the migrations and grants the application role its rights
 *   4. Seeds each with its own entities, accounts, periods, and data
 *
 * No hardcoded IDs — everything is auto-generated.
 */

import crypto from "node:crypto";
import { PrismaClient, Prisma } from "../db/client.js";
import { PrismaClient as RegistryPrismaClient } from "../db/registry-client.js";
import { hasRoles, type NewLocation } from "../db/tenant-location.js";
import {
  createDatabase,
  migrateDatabase,
  planTenantDatabase,
  secureDatabase,
  tenantUrls
} from "../modules/tenant/tenant-database.js";
import { ensureSystemCatalog, grantRoleAtEntity } from "../modules/access/setup.js";
import { registryDatabaseUrl } from "../config.js";

/** The demo administrator holds this starting role on the chain's group. */
const DEMO_ADMIN_ROLE = "ADMIN";

const registryUrl = registryDatabaseUrl();

const registry = new RegistryPrismaClient({ datasourceUrl: registryUrl });

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
  const tenantCode = crypto.createHash("sha256").update(chain.slug).digest("hex").substring(0, 8);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Provisioning: ${chain.name} (${chain.slug})`);
  console.log(`${"=".repeat(60)}`);

  // 1. Register the tenant with its database location and sealed role
  //    passwords; a chain registered before keeps its own.
  const existingTenant = await registry.tenant.findUnique({ where: { slug: chain.slug } });
  let location: NewLocation;
  if (existingTenant && hasRoles(existingTenant)) {
    location = existingTenant;
    console.log(`  ✓ Tenant already registered: ${existingTenant.id}`);
  } else if (existingTenant) {
    throw new Error(
      `${chain.slug} was registered before WP-2 (no owner and application roles); adopt it first.`
    );
  } else {
    location = planTenantDatabase(chain.slug, tenantCode);
    const tenant = await registry.tenant.create({
      data: {
        name: chain.name,
        slug: chain.slug,
        tenantCode,
        ...location,
        adminEmail: chain.adminEmail,
        plan: "standard",
        maxProperties: 20,
        isActive: true,
        provisionedAt: new Date()
      }
    });
    console.log(`  ✓ Tenant registered: ${tenant.id}`);
  }
  const tenantId = (await registry.tenant.findUniqueOrThrow({ where: { slug: chain.slug } })).id;
  console.log(`  Database: ${location.dbName}`);

  // 2. Roles, database, migrations (as the owner) and the application role's rights.
  await createDatabase(location);
  const schemaVersion = await migrateDatabase(location);
  await secureDatabase(location);
  await registry.tenant.update({ where: { id: tenantId }, data: { schemaVersion } });
  console.log(`  ✓ Database ready (${schemaVersion})`);

  // 4. Seed data in tenant database
  // The data goes in as the application role, as the API writes it.
  const tenantDb = new PrismaClient({ datasourceUrl: tenantUrls(location).app });
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
  console.log(`Registry: ${new URL(registryUrl).host}${new URL(registryUrl).pathname}`);
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
