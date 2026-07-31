/**
 * Integration Test: Row-Level Security Enforcement
 *
 * Verifies that RLS policies on the actual database correctly isolate
 * entity data. This test MUST run against a real PostgreSQL instance
 * with RLS policies applied (via db:setup:rls).
 *
 * Run: TEST_DATABASE_URL=... pnpm vitest run tests/integration/rls-enforcement.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getTestPrisma,
  disconnectTestPrisma,
  createTestEntity,
  createTestPeriod
} from "./helpers.js";

if (!process.env.TEST_DATABASE_URL) {
  describe.skip("RLS enforcement against real Postgres", () => {
    it("requires TEST_DATABASE_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("RLS enforcement against real Postgres", () => {
    let prisma: ReturnType<typeof getTestPrisma>;
    let entityA: { entityId: string; cleanup: () => Promise<void> };
    let entityB: { entityId: string; cleanup: () => Promise<void> };

    beforeAll(async () => {
      prisma = getTestPrisma();
      entityA = await createTestEntity(prisma, { name: "RLS Test Hotel A" });
      entityB = await createTestEntity(prisma, { name: "RLS Test Hotel B" });
    });

    afterAll(async () => {
      await entityA?.cleanup();
      await entityB?.cleanup();
      await disconnectTestPrisma();
    });

    it("entity A cannot see entity B accounts when RLS context is set", async () => {
      // Create accounts in each entity
      const accountA = await (prisma as any).account.create({
        data: {
          entityId: entityA.entityId,
          code: "1000",
          name: "Cash - Entity A",
          type: "ASSET",
          isActive: true
        }
      });

      const accountB = await (prisma as any).account.create({
        data: {
          entityId: entityB.entityId,
          code: "1000",
          name: "Cash - Entity B",
          type: "ASSET",
          isActive: true
        }
      });

      try {
        // Query with RLS context set to entity A
        const results = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${entityA.entityId}, true)`;
          return (tx as any).account.findMany({
            where: { code: "1000" }
          });
        });

        // Should only see entity A's account
        expect(results).toHaveLength(1);
        expect(results[0].entityId).toBe(entityA.entityId);
        expect(results[0].name).toBe("Cash - Entity A");
      } finally {
        await (prisma as any).account.delete({ where: { id: accountA.id } }).catch(() => {});
        await (prisma as any).account.delete({ where: { id: accountB.id } }).catch(() => {});
      }
    });

    it("withBypassRLS can see all entities", async () => {
      const accountA = await (prisma as any).account.create({
        data: {
          entityId: entityA.entityId,
          code: "2000",
          name: "AP Control - A",
          type: "LIABILITY",
          isActive: true
        }
      });

      const accountB = await (prisma as any).account.create({
        data: {
          entityId: entityB.entityId,
          code: "2000",
          name: "AP Control - B",
          type: "LIABILITY",
          isActive: true
        }
      });

      try {
        // Query with RLS bypass
        const results = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
          return (tx as any).account.findMany({
            where: {
              code: "2000",
              entityId: { in: [entityA.entityId, entityB.entityId] }
            }
          });
        });

        // Should see both entities' accounts
        expect(results).toHaveLength(2);
        const entityIds = results.map((r: any) => r.entityId);
        expect(entityIds).toContain(entityA.entityId);
        expect(entityIds).toContain(entityB.entityId);
      } finally {
        await (prisma as any).account.delete({ where: { id: accountA.id } }).catch(() => {});
        await (prisma as any).account.delete({ where: { id: accountB.id } }).catch(() => {});
      }
    });

    it("balance updates are isolated by entity", async () => {
      const periodIdA = await createTestPeriod(prisma, entityA.entityId, 2026, 3);
      const periodIdB = await createTestPeriod(prisma, entityB.entityId, 2026, 3);

      const accountA = await (prisma as any).account.create({
        data: {
          entityId: entityA.entityId,
          code: "4000",
          name: "Revenue - A",
          type: "REVENUE",
          isActive: true
        }
      });

      const accountB = await (prisma as any).account.create({
        data: {
          entityId: entityB.entityId,
          code: "4000",
          name: "Revenue - B",
          type: "REVENUE",
          isActive: true
        }
      });

      try {
        // Create balances for both entities
        await (prisma as any).accountPeriodBalance.create({
          data: {
            entityId: entityA.entityId,
            accountId: accountA.id,
            periodId: periodIdA,
            openingBalance: 0,
            periodDebits: 1000,
            periodCredits: 0,
            closingBalance: 1000
          }
        });

        await (prisma as any).accountPeriodBalance.create({
          data: {
            entityId: entityB.entityId,
            accountId: accountB.id,
            periodId: periodIdB,
            openingBalance: 0,
            periodDebits: 5000,
            periodCredits: 0,
            closingBalance: 5000
          }
        });

        // Query with entity A context
        const balancesA = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${entityA.entityId}, true)`;
          return (tx as any).accountPeriodBalance.findMany({});
        });

        // Entity A should only see its own balances
        for (const bal of balancesA) {
          expect(bal.entityId).toBe(entityA.entityId);
        }
      } finally {
        await (prisma as any).accountPeriodBalance
          .deleteMany({
            where: { entityId: { in: [entityA.entityId, entityB.entityId] } }
          })
          .catch(() => {});
        await (prisma as any).account.delete({ where: { id: accountA.id } }).catch(() => {});
        await (prisma as any).account.delete({ where: { id: accountB.id } }).catch(() => {});
        await (prisma as any).period
          .deleteMany({
            where: { id: { in: [periodIdA, periodIdB] } }
          })
          .catch(() => {});
      }
    });
  });
}
