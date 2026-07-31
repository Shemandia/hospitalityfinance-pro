/**
 * Integration test helpers — connects to a real PostgreSQL instance.
 *
 * Requires env vars:
 *   TEST_DATABASE_URL — PostgreSQL connection string for a test database
 *
 * The test database should be a clean tenant database (hfp_test).
 * Run: DATABASE_URL=$TEST_DATABASE_URL pnpm db:push:tenant
 */

import { PrismaClient } from "../../src/db/client.js";

let prisma: PrismaClient | null = null;

export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Integration tests require a real PostgreSQL instance.\n" +
        "Set TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/hfp_test"
    );
  }
  return url;
}

export function getTestPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: { db: { url: getTestDatabaseUrl() } }
    });
  }
  return prisma;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/**
 * Create a test entity and return its ID.
 * Cleans up automatically via the returned cleanup function.
 */
export async function createTestEntity(
  client: PrismaClient,
  overrides: Record<string, unknown> = {}
): Promise<{ entityId: string; cleanup: () => Promise<void> }> {
  const entity = await (client as any).entity.create({
    data: {
      name: `Test Entity ${Date.now()}`,
      code: `TE${Date.now().toString(36).slice(-4).toUpperCase()}`,
      // `type` and `countryCode` are required on Entity and have no default.
      type: "PROPERTY",
      countryCode: "TZ",
      functionalCurrency: "USD",
      isActive: true,
      ...overrides
    }
  });

  return {
    entityId: entity.id,
    cleanup: async () => {
      await (client as any).entity.delete({ where: { id: entity.id } }).catch(() => {});
    }
  };
}

/**
 * Create a test period for an entity.
 */
export async function createTestPeriod(
  client: PrismaClient,
  entityId: string,
  year = 2026,
  month = 1
): Promise<string> {
  const period = await (client as any).period.create({
    data: {
      entityId,
      year,
      month,
      name: `${year}-${String(month).padStart(2, "0")}`,
      status: "OPEN"
      // Period has no startDate/endDate columns — it is keyed on (year, month).
    }
  });
  return period.id;
}
