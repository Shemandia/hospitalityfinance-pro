/**
 * Integration test: the six lists the web app pages through on the server
 * (journals, AP invoices, suppliers, payment runs, Integrations executions
 * and automations) take `limit` and `offset` and report the total, and their
 * filters and figures cover every row, not one page.
 *
 * The real application answers the requests (auth, guard, tenant client,
 * row-level security); only the tenant registry is pointed at the test
 * database.
 *
 * Run: pnpm test:integration (the environment must be set before the app is imported)
 */

import jwt from "jsonwebtoken";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma } from "../../src/db/client.js";
import { getAccessService, setAccessService } from "../../src/modules/access/runtime.js";
import { disconnectTestPrisma, ensurePermissions, getTestPrisma } from "./helpers.js";

type Tx = Prisma.TransactionClient;

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;

const environmentReady = vi.hoisted(() => {
  const ready = Boolean(
    process.env.TEST_DATABASE_URL && (process.env.TEST_REDIS_URL ?? process.env.REDIS_URL)
  );
  if (ready) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    process.env.JWT_SECRET ??= "list-pages-test-secret-list-pages-test-secret";
    process.env.PLATFORM_API_KEY ??= "list-pages-test-platform-key";
  }
  return ready;
});

vi.mock("../../src/db/tenantRegistry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/tenantRegistry.js")>()),
  resolveTenantById: async (id: string) =>
    id.startsWith("it-pages-")
      ? {
          id,
          slug: id,
          tenantCode: "itpage01",
          name: "Integration test tenant",
          databaseUrl: process.env.TEST_DATABASE_URL as string,
          domain: null,
          adminEmail: "",
          plan: "test",
          maxProperties: 0,
          isActive: true,
          provisionedAt: null
        }
      : null
}));

type Body<T = Record<string, unknown>> = {
  data: T[];
  meta: { total: number; limit: number; offset: number; summary?: Record<string, unknown> };
};

if (!environmentReady || !redisUrl) {
  describe.skip("server-side list pages", () => {
    it("requires TEST_DATABASE_URL and REDIS_URL in the environment; run pnpm test:integration", () => {
      expect(environmentReady).toBe(true);
    });
  });
} else {
  const prisma = getTestPrisma();
  const run = Date.now().toString(36);
  const tenantId = `it-pages-${run}`;
  const CODES = ["GL_READ", "AP_READ", "PAYMENT_RUN_READ", "INTEGRATIONS_READ"] as const;
  const DAY = 86_400_000;

  describe("server-side list pages", () => {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    let app: FastifyInstance;
    let entityId = "";
    let userId = "";
    let roleId = "";
    let profileId = "";
    let token = "";

    function bypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
          return fn(tx);
        },
        { timeout: 60_000 }
      );
    }

    async function get<T = Record<string, unknown>>(url: string): Promise<Body<T>> {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token}`, "x-entity-id": entityId }
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json() as Body<T>;
    }

    /** Two pages of a list, and the same list in one page: the pages make up the whole. */
    async function expectPagesCoverList(path: string, sep = path.includes("?") ? "&" : "?") {
      const first = await get<{ id: string }>(`${path}${sep}limit=3&offset=0`);
      const second = await get<{ id: string }>(`${path}${sep}limit=3&offset=3`);
      const whole = await get<{ id: string }>(`${path}${sep}limit=6&offset=0`);
      expect(first.meta).toMatchObject({ limit: 3, offset: 0 });
      expect(second.meta).toMatchObject({ limit: 3, offset: 3, total: first.meta.total });
      expect([...first.data, ...second.data].map((r) => r.id)).toEqual(whole.data.map((r) => r.id));
      return first.meta.total;
    }

    beforeAll(async () => {
      if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
        throw new Error("list-pages test: the application is not bound to the test database.");
      }
      await redis.connect();
      const { createApp } = await import("../../src/app.js");
      app = await createApp();
      await app.ready();

      const permissionIds = await ensurePermissions(prisma, CODES);
      await bypass(async (tx) => {
        entityId = (
          await tx.entity.create({
            data: {
              name: `Pages IT ${run}`,
              code: `PG${run}`.slice(0, 20),
              type: "PROPERTY",
              countryCode: "TZ",
              functionalCurrency: "TZS"
            }
          })
        ).id;
        const periodId = (
          await tx.period.create({
            data: { entityId, year: 2026, month: 10, name: "2026-10", status: "OPEN" }
          })
        ).id;
        userId = (await tx.user.create({ data: { email: `pg-${run}@pages.test`, name: "pg" } })).id;
        roleId = (
          await tx.role.create({
            data: {
              code: `PG${run}_READ`,
              name: "Pages IT reader",
              permissions: {
                create: CODES.map((code) => ({ permissionId: permissionIds[code] }))
              }
            }
          })
        ).id;
        await tx.roleAssignment.create({
          data: { userId, roleId, scopeType: "ENTITY", entityId }
        });

        // 12 journals; 4 of them mention "accrual".
        for (let i = 0; i < 12; i++) {
          await tx.journal.create({
            data: {
              entityId,
              periodId,
              source: "MANUAL",
              functionalCurrency: "TZS",
              createdById: userId,
              reference: `PG-J-${String(i).padStart(2, "0")}`,
              description: i % 3 === 0 ? `Monthly accrual ${i}` : `Entry ${i}`,
              status: i < 8 ? "DRAFT" : "POSTED"
            }
          });
        }

        // 10 suppliers, 3 of them inactive; 2 match "lodge" (one of those inactive).
        const supplierIds: string[] = [];
        for (let i = 0; i < 10; i++) {
          const supplier = await tx.supplier.create({
            data: {
              entityId,
              name: i === 1 || i === 7 ? `Serengeti Lodge Supplies ${i}` : `Supplier ${i}`,
              code: `S${String(i).padStart(2, "0")}`,
              currency: "TZS",
              isActive: i < 7
            }
          });
          supplierIds.push(supplier.id);
        }

        // 9 invoices: 3 overdue, 2 due within the week, 2 later, 2 paid (overdue but closed).
        const now = Date.now();
        const due = [-10, -5, -1, 0, 6, 20, 40, -30, -20];
        for (let i = 0; i < due.length; i++) {
          await tx.aPInvoice.create({
            data: {
              entityId,
              supplierId: supplierIds[i % supplierIds.length]!,
              periodId,
              invoiceNumber: `PG-INV-${i}`,
              invoiceDate: new Date(now - 40 * DAY),
              dueDate: new Date(now + due[i]! * DAY),
              currency: i === 0 ? "USD" : "TZS",
              grossAmount: new Prisma.Decimal(100),
              taxAmount: new Prisma.Decimal(0),
              netAmount: new Prisma.Decimal(100),
              functionalAmount: new Prisma.Decimal(i === 0 ? 250000 : 1000),
              fxRate: new Prisma.Decimal(i === 0 ? 2500 : 1),
              status: i >= 7 ? "PAID" : "APPROVED"
            }
          });
        }

        for (let i = 0; i < 7; i++) {
          await tx.paymentRun.create({
            data: {
              entityId,
              startDate: new Date(now - (i + 1) * DAY),
              endDate: new Date(now),
              status: "PROPOSED",
              bankFileFormat: "CSV"
            }
          });
        }

        profileId = (
          await tx.integrationProfile.create({
            data: { name: `PG profile ${run}`, profileType: "IMPORT" }
          })
        ).id;
        for (let i = 0; i < 7; i++) {
          await tx.integrationExecution.create({ data: { profileId } });
          await tx.integrationAutomation.create({ data: { name: `PG automation ${run} ${i}` } });
        }
      });
      await getAccessService().invalidateUser({ tenantId, userId });

      const sessionId = `s-${userId}`;
      await redis.set(`session:${tenantId}:${userId}:${sessionId}`, "1", "EX", 600);
      token = jwt.sign(
        { sub: userId, tenantId, sessionId, type: "access" },
        process.env.JWT_SECRET as string,
        { algorithm: "HS256", expiresIn: 600 }
      );
    }, 120_000);

    afterAll(async () => {
      setAccessService(null);
      await app?.close();
      await bypass(async (tx) => {
        await tx.integrationExecution.deleteMany({ where: { profileId } });
        await tx.integrationProfile.deleteMany({ where: { id: profileId } });
        await tx.integrationAutomation.deleteMany({
          where: { name: { startsWith: `PG automation ${run} ` } }
        });
        await tx.paymentRun.deleteMany({ where: { entityId } });
        await tx.aPInvoice.deleteMany({ where: { entityId } });
        await tx.supplier.deleteMany({ where: { entityId } });
        await tx.journal.deleteMany({ where: { entityId } });
        await tx.period.deleteMany({ where: { entityId } });
        await tx.roleAssignment.deleteMany({ where: { userId } });
        await tx.user.deleteMany({ where: { id: userId } });
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.role.deleteMany({ where: { id: roleId } });
        await tx.entity.deleteMany({ where: { id: entityId } });
      });
      const keys = [
        ...(await redis.keys(`access:${tenantId}:*`)),
        ...(await redis.keys(`session:${tenantId}:*`))
      ];
      if (keys.length > 0) await redis.del(...keys);
      await redis.quit();
      const { disconnectRedis } = await import("../../src/db/redis.js");
      await disconnectRedis();
      await disconnectTestPrisma();
    });

    it("journals: pages with the total, search and status over every journal", async () => {
      expect(await expectPagesCoverList("/api/v1/gl/journals")).toBe(12);
      const searched = await get("/api/v1/gl/journals?search=accrual&limit=2");
      expect(searched.meta.total).toBe(4);
      expect(searched.data).toHaveLength(2);
      expect((await get("/api/v1/gl/journals?status=POSTED&limit=1")).meta.total).toBe(4);
    });

    it("AP invoices: pages with the total and figures over every matching invoice", async () => {
      expect(await expectPagesCoverList("/api/v1/ap/invoices")).toBe(9);
      const page = await get("/api/v1/ap/invoices?limit=2");
      expect(page.data).toHaveLength(2);
      // All nine, in the functional currency (the USD invoice counts at its TZS value).
      expect(page.meta.summary).toEqual({
        functionalValue: "258000",
        overdue: 3,
        dueThisWeek: 2
      });
      const paid = await get("/api/v1/ap/invoices?status=PAID&limit=1");
      expect(paid.meta.total).toBe(2);
      expect(paid.meta.summary).toMatchObject({ overdue: 0, dueThisWeek: 0 });
    });

    it("suppliers: the whole list by default, pages with search and status on request", async () => {
      const all = await get<{ id: string }>("/api/v1/ap/suppliers");
      expect(all.data).toHaveLength(10); // inactive included, as pickers expect
      expect(all.meta.total).toBe(10);

      expect(await expectPagesCoverList("/api/v1/ap/suppliers?status=all")).toBe(10);
      expect((await get("/api/v1/ap/suppliers?status=active&limit=2")).meta.total).toBe(7);
      expect((await get("/api/v1/ap/suppliers?status=inactive&limit=2")).meta.total).toBe(3);

      const lodge = await get<{ name: string }>("/api/v1/ap/suppliers?search=LODGE&limit=5");
      expect(lodge.meta.total).toBe(2);
      const activeLodge = await get("/api/v1/ap/suppliers?search=lodge&status=active&limit=5");
      expect(activeLodge.meta.total).toBe(1);
      expect((await get("/api/v1/ap/suppliers?search=s07&limit=5")).meta.total).toBe(1);
    });

    it("payment runs: pages with the total", async () => {
      expect(await expectPagesCoverList("/api/v1/ap/payment-runs")).toBe(7);
    });

    it("Integrations executions: pages with the total of the filter", async () => {
      expect(
        await expectPagesCoverList(`/api/v1/integrations/executions?profileId=${profileId}`)
      ).toBe(7);
    });

    it("Integrations automations: pages with the total", async () => {
      const total = await expectPagesCoverList("/api/v1/integrations/automations");
      // Automations are tenant-wide: other test files may have left some of their own.
      expect(total).toBeGreaterThanOrEqual(7);
      expect(total).toBe(await prisma.integrationAutomation.count());
    });
  });
}
