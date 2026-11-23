/**
 * Integration test: what a tenant configures for ledger imports through the
 * API (import plan steps 3 to 6): source systems, and the import settings of
 * a profile (source system, review mode, atomicity, unmapped policy and
 * suspense account, rate type), through both profile APIs.
 *
 * The real application answers (auth, guard, tenant client); only the
 * tenant registry is pointed at the test database.
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
    process.env.JWT_SECRET ??= "settings-test-secret-settings-test-secret-xx";
    process.env.PLATFORM_API_KEY ??= "settings-test-platform-key";
  }
  return ready;
});

vi.mock("../../src/db/tenantRegistry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/tenantRegistry.js")>()),
  resolveTenantById: async (id: string) =>
    id.startsWith("it-settings-")
      ? {
          id,
          slug: id,
          tenantCode: "itsett01",
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

if (!environmentReady || !redisUrl) {
  describe.skip("integration settings API", () => {
    it("requires TEST_DATABASE_URL and REDIS_URL", () => expect(environmentReady).toBe(true));
  });
} else {
  const prisma = getTestPrisma();
  const run = Date.now().toString(36).toUpperCase();
  const tenantId = `it-settings-${run.toLowerCase()}`;
  const CODES = ["INTEGRATIONS_READ", "INTEGRATIONS_CONFIG"] as const;
  const SOURCE = `ST${run}`.slice(0, 20);

  describe("integration settings API", () => {
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    let app: FastifyInstance;
    let entityId = "";
    const users: Record<"admin" | "reader", string> = { admin: "", reader: "" };
    const roles: string[] = [];
    const tokens: Record<"admin" | "reader", string> = { admin: "", reader: "" };
    const profiles: string[] = [];

    function bypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });
    }

    async function call(
      as: "admin" | "reader",
      method: "GET" | "POST" | "PUT",
      url: string,
      payload?: unknown
    ) {
      const response = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${tokens[as]}`, "x-entity-id": entityId },
        // The integrations routes allow 10 calls a minute per client address.
        remoteAddress: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
        ...(payload !== undefined && { payload: payload as Record<string, unknown> })
      });
      const json = response.json() as {
        data: any;
        errors: Array<{ code: string; message: string }>;
      };
      return { status: response.statusCode, data: json.data, code: json.errors?.[0]?.code };
    }

    beforeAll(async () => {
      await redis.connect();
      const { createApp } = await import("../../src/app.js");
      app = await createApp();
      await app.ready();
      const permissionIds = await ensurePermissions(prisma, CODES);
      await bypass(async (tx) => {
        entityId = (
          await tx.entity.create({
            data: {
              name: `Settings IT ${run}`,
              code: `SE${run}`.slice(0, 20),
              type: "PROPERTY",
              countryCode: "TZ"
            }
          })
        ).id;
        for (const [who, codes] of [
          ["admin", CODES],
          ["reader", ["INTEGRATIONS_READ"]]
        ] as const) {
          users[who] = (
            await tx.user.create({
              data: { email: `${who}-${run.toLowerCase()}@settings.test`, name: who }
            })
          ).id;
          const role = await tx.role.create({
            data: {
              code: `SE${run}_${who.toUpperCase()}`,
              name: `Settings IT ${who}`,
              permissions: { create: codes.map((code) => ({ permissionId: permissionIds[code] })) }
            }
          });
          roles.push(role.id);
          await tx.roleAssignment.create({
            data: { userId: users[who], roleId: role.id, scopeType: "ENTITY", entityId }
          });
        }
      });
      for (const who of ["admin", "reader"] as const) {
        await getAccessService().invalidateUser({ tenantId, userId: users[who] });
        const sessionId = `s-${users[who]}`;
        await redis.set(`session:${tenantId}:${users[who]}:${sessionId}`, "1", "EX", 600);
        tokens[who] = jwt.sign(
          { sub: users[who], tenantId, sessionId, type: "access" },
          process.env.JWT_SECRET as string,
          {
            algorithm: "HS256",
            expiresIn: 600
          }
        );
      }
    }, 120_000);

    afterAll(async () => {
      setAccessService(null);
      await app?.close();
      await bypass(async (tx) => {
        await tx.integrationProfileVersion.deleteMany({ where: { profileId: { in: profiles } } });
        await tx.integrationProfile.deleteMany({ where: { id: { in: profiles } } });
        await tx.sourceSystem.deleteMany({ where: { code: SOURCE } });
        await tx.roleAssignment.deleteMany({ where: { userId: { in: Object.values(users) } } });
        await tx.user.deleteMany({ where: { id: { in: Object.values(users) } } });
        await tx.rolePermission.deleteMany({ where: { roleId: { in: roles } } });
        await tx.role.deleteMany({ where: { id: { in: roles } } });
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
    }, 60_000);

    it("creates, lists and deactivates source systems; codes are unique and well formed", async () => {
      expect(
        await call("admin", "POST", "/api/v1/integrations/source-systems", {
          code: SOURCE,
          name: "Opera PMS"
        })
      ).toMatchObject({
        status: 201,
        data: { code: SOURCE, name: "Opera PMS", isActive: true }
      });
      expect(
        await call("admin", "POST", "/api/v1/integrations/source-systems", {
          code: SOURCE,
          name: "Again"
        })
      ).toMatchObject({
        status: 409,
        code: "SOURCE_SYSTEM_EXISTS"
      });
      expect(
        await call("admin", "POST", "/api/v1/integrations/source-systems", {
          code: "opera pms",
          name: "x"
        })
      ).toMatchObject({ status: 400 });
      const list = await call("reader", "GET", "/api/v1/integrations/source-systems");
      expect(list.data.map((s: { code: string }) => s.code)).toContain(SOURCE);
      expect(
        await call("admin", "PUT", `/api/v1/integrations/source-systems/${SOURCE}`, {
          isActive: false
        })
      ).toMatchObject({
        status: 200,
        data: { isActive: false }
      });
      expect(
        await call("admin", "PUT", "/api/v1/integrations/source-systems/NOPE", { isActive: false })
      ).toMatchObject({ status: 404 });
      await call("admin", "PUT", `/api/v1/integrations/source-systems/${SOURCE}`, {
        isActive: true
      });
    });

    it("lets only INTEGRATIONS_CONFIG change source systems", async () => {
      expect(
        (
          await call("reader", "POST", "/api/v1/integrations/source-systems", {
            code: `R${run}`.slice(0, 20),
            name: "x"
          })
        ).status
      ).toBe(403);
    });

    it("saves a profile's import settings through both profile APIs", async () => {
      const settings = {
        sourceSystemCode: SOURCE,
        reviewMode: "AUTO_COMMIT",
        atomicity: "WHOLE_FILE",
        unmappedPolicy: "SUSPENSE",
        suspenseAccountCode: "1999",
        fxRateType: "AVERAGE"
      };
      const created = await call("admin", "POST", "/api/v1/integrations/profiles", {
        name: `Settings IT ${run}`,
        profileType: "IMPORT",
        targetComponent: "GL_JOURNAL",
        ...settings
      });
      expect(created.status).toBe(201);
      profiles.push(created.data.id);
      const stored = await bypass((tx) =>
        tx.integrationProfile.findUniqueOrThrow({ where: { id: created.data.id } })
      );
      expect(stored).toMatchObject(settings);

      const updated = await call(
        "admin",
        "PUT",
        `/api/v1/integrations/profiles/${created.data.id}`,
        {
          unmappedPolicy: "HOLD",
          atomicity: "PER_DOCUMENT"
        }
      );
      expect(updated.status, JSON.stringify(updated)).toBe(200);
      const after = await bypass((tx) =>
        tx.integrationProfile.findUniqueOrThrow({ where: { id: created.data.id } })
      );
      expect(after).toMatchObject({
        unmappedPolicy: "HOLD",
        atomicity: "PER_DOCUMENT",
        sourceSystemCode: SOURCE
      });
    });

    it("refuses a source system the tenant has not defined", async () => {
      expect(
        await call("admin", "POST", "/api/v1/integrations/profiles", {
          name: `Settings IT ${run} C`,
          profileType: "IMPORT",
          targetComponent: "GL_JOURNAL",
          sourceSystemCode: "NOPE"
        })
      ).toMatchObject({ status: 400, code: "SOURCE_SYSTEM_NOT_FOUND" });
    });

    it("refuses a SUSPENSE policy without a suspense account", async () => {
      expect(
        await call("admin", "POST", "/api/v1/integrations/profiles", {
          name: `Settings IT ${run} B`,
          profileType: "IMPORT",
          targetComponent: "GL_JOURNAL",
          unmappedPolicy: "SUSPENSE"
        })
      ).toMatchObject({ status: 400, code: "PROFILE_SUSPENSE_ACCOUNT_REQUIRED" });
    });
  });
}
