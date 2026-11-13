/**
 * Integration test: withBypassRLS really bypasses, inside one transaction (AUT-14).
 *
 * The client is built the way the API builds tenant clients — RLS middleware,
 * audit middleware and the entity-scope extension — and the request context
 * has an entity selected, which is the situation every admin screen is in.
 *
 * Before the fix, a model query made through `tx` in that situation was moved
 * by the RLS middleware to a second transaction scoped to the selected entity.
 * So on tables under FORCE row-level security the "bypass" saw one entity, the
 * query could not see what the bypass transaction had written, and its writes
 * committed on their own even when the caller rolled back. The tests marked
 * (AUT-14) fail on that code.
 *
 * Statements that must be judged by the policies run as a non-owner
 * application role (SET LOCAL ROLE), as in rls-enforcement.test.ts.
 *
 * Run: pnpm test:integration
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/db/client.js";
import { getRequestContext, runWithContext } from "../../src/db/requestContext.js";
import { withBypassRLS } from "../../src/db/rls-bypass.js";
import { disconnectAllTenants, getTenantClient } from "../../src/db/tenantPool.js";
import { disconnectTestPrisma, getTestDatabaseUrl, getTestPrisma } from "./helpers.js";

const APP_ROLE = "hfp_rls_test_app";

type Tx = Prisma.TransactionClient;

class Rollback extends Error {}

if (!process.env.TEST_DATABASE_URL) {
  describe.skip("withBypassRLS against real Postgres", () => {
    it("requires TEST_DATABASE_URL to run", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("withBypassRLS against real Postgres", () => {
    const fixtures = getTestPrisma();
    const run = Date.now().toString(36);
    const ids = { entityA: "", entityB: "", user: "" };

    /** The client a request handler gets: middleware and extension included. */
    const appClient = () => getTenantClient(`it-bypass-${run}`, getTestDatabaseUrl());

    /** Runs `fn` as a request that has entity A selected. */
    const inRequestForEntityA = <T>(fn: () => Promise<T>): Promise<T> =>
      runWithContext({ entityId: ids.entityA, userId: ids.user }, fn);

    const asAppRole = (tx: Tx) => tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);

    function fixture<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return fixtures.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
        return fn(tx);
      });
    }

    beforeAll(async () => {
      const existing = await fixtures.$queryRaw<
        Array<{ rolname: string }>
      >`SELECT rolname FROM pg_roles WHERE rolname = ${APP_ROLE}`;
      if (existing.length === 0) {
        await fixtures.$executeRawUnsafe(
          `CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
        );
      }
      await fixtures.$executeRawUnsafe(`GRANT ${APP_ROLE} TO CURRENT_USER`);
      await fixtures.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
      await fixtures.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`
      );

      await fixture(async (tx) => {
        const entity = (label: string) =>
          tx.entity.create({
            data: {
              name: `Bypass IT ${label} ${run}`,
              code: `BP${label}${run}`.slice(0, 20),
              type: "PROPERTY",
              countryCode: "TZ"
            }
          });
        // Two separate roots: neither is the other's parent or child.
        ids.entityA = (await entity("A")).id;
        ids.entityB = (await entity("B")).id;
        ids.user = (
          await tx.user.create({ data: { email: `bypass-${run}@bypass.test`, name: "Bypass IT" } })
        ).id;
        // accounts is under FORCE row-level security, so even the owning role is filtered.
        await tx.account.createMany({
          data: [ids.entityA, ids.entityB].map((entityId) => ({
            entityId,
            code: "1000",
            name: `Bypass IT cash ${run}`,
            type: "ASSET" as const,
            normalBalance: "DEBIT" as const
          }))
        });
      });
    });

    afterAll(async () => {
      await fixture(async (tx) => {
        await tx.account.deleteMany({ where: { name: `Bypass IT cash ${run}` } });
        await tx.user.deleteMany({ where: { id: ids.user } });
        // Every entity this file creates is named "Bypass IT … <run>".
        await tx.entity.deleteMany({
          where: { name: { startsWith: "Bypass IT", endsWith: run } }
        });
      });
      await disconnectAllTenants();
      await disconnectTestPrisma();
    });

    const bothEntities = () => ({ entityId: { in: [ids.entityA, ids.entityB] } });

    it("without the bypass, a request for entity A sees only entity A's rows (the baseline)", async () => {
      // Awaited inside the request: a Prisma query only starts when it is awaited.
      const visible = await inRequestForEntityA(async () => {
        return await appClient().account.findMany({
          where: bothEntities(),
          select: { entityId: true }
        });
      });
      expect(visible.map((row) => row.entityId)).toEqual([ids.entityA]);
    });

    it("lets model queries see every entity's rows while entity A is selected (AUT-14)", async () => {
      const seen = await inRequestForEntityA(() =>
        withBypassRLS(appClient(), async (tx: Tx) => {
          await asAppRole(tx);
          const rows = await tx.account.findMany({
            where: bothEntities(),
            select: { entityId: true }
          });
          return rows.map((row) => row.entityId).sort();
        })
      );
      expect(seen).toEqual([ids.entityA, ids.entityB].sort());
    });

    it("lets model queries on the entity table see separate trees", async () => {
      const seen = await inRequestForEntityA(() =>
        withBypassRLS(appClient(), async (tx: Tx) => {
          await asAppRole(tx);
          const rows = await tx.entity.findMany({
            where: { id: { in: [ids.entityA, ids.entityB] } },
            select: { id: true }
          });
          return rows.map((row) => row.id).sort();
        })
      );
      expect(seen).toEqual([ids.entityA, ids.entityB].sort());
    });

    it("keeps model queries on the bypass transaction: they see its uncommitted rows (AUT-14)", async () => {
      const uncommittedId = randomUUID();
      let seenInside: string | undefined;

      await expect(
        inRequestForEntityA(() =>
          withBypassRLS(appClient(), async (tx: Tx) => {
            await asAppRole(tx);
            // Raw, so it is on the bypass transaction whatever the middleware does.
            await tx.$executeRaw`
              INSERT INTO entities (id, name, type, country_code, updated_at)
              VALUES (${uncommittedId}, ${`Bypass IT uncommitted ${run}`}, 'PROPERTY'::"EntityType", 'TZ', now())`;
            // A model query on another connection could not see that row.
            const found = await tx.entity.findUnique({
              where: { id: uncommittedId },
              select: { id: true }
            });
            seenInside = found?.id;
            throw new Rollback();
          })
        )
      ).rejects.toBeInstanceOf(Rollback);

      expect(seenInside).toBe(uncommittedId);
    });

    it("rolls back model writes when the callback throws (AUT-14)", async () => {
      const name = `Bypass IT rolled back ${run}`;

      await expect(
        inRequestForEntityA(() =>
          withBypassRLS(appClient(), async (tx: Tx) => {
            await tx.entity.create({
              data: { name, code: `BPR${run}`.slice(0, 20), type: "PROPERTY", countryCode: "TZ" }
            });
            await tx.account.deleteMany({
              where: { entityId: ids.entityB, name: `Bypass IT cash ${run}` }
            });
            throw new Rollback();
          })
        )
      ).rejects.toBeInstanceOf(Rollback);

      const after = await fixture(async (tx) => ({
        created: await tx.entity.count({ where: { name } }),
        accounts: await tx.account.count({ where: { name: `Bypass IT cash ${run}` } })
      }));
      expect(after).toEqual({ created: 0, accounts: 2 });
    });

    it("ends with the callback: the rest of the request is scoped as before", async () => {
      await inRequestForEntityA(async () => {
        await withBypassRLS(appClient(), async (tx: Tx) => {
          expect(getRequestContext().rlsBypass).toBe(true);
          await tx.entity.count();
        });
        expect(getRequestContext().rlsBypass).toBe(false);

        const scoped = await appClient().account.findMany({
          where: bothEntities(),
          select: { entityId: true }
        });
        expect(scoped.map((row) => row.entityId)).toEqual([ids.entityA]);
      });
    });

    it("does not leak the bypass to a query made alongside it in the same request", async () => {
      await inRequestForEntityA(async () => {
        let release: () => void = () => undefined;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });

        const bypass = withBypassRLS(appClient(), async (tx: Tx) => {
          await tx.entity.count();
          await held; // keep the bypass open while the other query runs
        });

        const alongside = await appClient().account.findMany({
          where: bothEntities(),
          select: { entityId: true }
        });
        release();
        await bypass;

        expect(alongside.map((row) => row.entityId)).toEqual([ids.entityA]);
      });
    });
  });
}
