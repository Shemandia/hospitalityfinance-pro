/**
 * Every entity-linked table is under forced row-level security with a policy
 * (roadmap Stage 1 item 7, SEC-04).
 *
 * "Entity-linked" is read from the catalog, so a new table is covered the day
 * it is added: the entities table, every table with an entity_id column, and
 * every table with a foreign key to an entity-linked table (child tables,
 * followed to any depth). Each must have row-level security enabled and
 * forced and at least one policy.
 *
 * The exemptions below are the only tables allowed through, each with its
 * reason; an exemption that no longer matches an entity-linked table fails
 * too, so the list cannot go stale.
 *
 * A child table's policy is checked in action too (tax_rates under
 * tax_codes): as a non-owner role with entity A selected, entity B's child
 * rows can be neither seen nor written.
 *
 * Run: pnpm test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma } from "../../src/db/client.js";
import { disconnectTestPrisma, getTestPrisma } from "./helpers.js";

const EXEMPT: Record<string, string> = {
  login_audits:
    "The users' sign-in log: written at sign-in, before any entity is chosen; its entity_id is optional attribution. Read only through the admin service, which filters by the admin's reach."
};

type Row = { table: string; rls: boolean; forced: boolean; policies: number };

if (!process.env.TEST_DATABASE_URL) {
  describe("row-level security coverage", () => {
    it("requires TEST_DATABASE_URL", () => {
      expect(process.env.TEST_DATABASE_URL).toBeDefined();
    });
  });
} else {
  describe("row-level security coverage", () => {
    const db = getTestPrisma();

    afterAll(async () => {
      await disconnectTestPrisma();
    });

    const linked = () =>
      db.$queryRaw<Row[]>`
        WITH RECURSIVE tables AS (
          SELECT c.oid, c.relname::text AS name, c.relrowsecurity, c.relforcerowsecurity
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        ),
        linked(oid) AS (
          SELECT oid FROM tables t
           WHERE t.name = 'entities'
              OR EXISTS (SELECT 1 FROM pg_attribute a
                          WHERE a.attrelid = t.oid AND a.attname = 'entity_id' AND NOT a.attisdropped)
          UNION
          SELECT con.conrelid FROM pg_constraint con JOIN linked l ON l.oid = con.confrelid
           WHERE con.contype = 'f' AND con.conrelid <> con.confrelid
        )
        SELECT t.name AS table, t.relrowsecurity AS rls, t.relforcerowsecurity AS forced,
               (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = t.oid) AS policies
          FROM tables t WHERE t.oid IN (SELECT oid FROM linked)
         ORDER BY t.name`;

    it("finds the entity-linked tables (the query itself works)", async () => {
      const names = (await linked()).map((row) => row.table);
      expect(names).toEqual(expect.arrayContaining(["entities", "journals", "journal_lines"]));
    });

    it("puts every entity-linked table under forced row-level security with a policy", async () => {
      const unprotected = (await linked())
        .filter((row) => !(row.table in EXEMPT))
        .filter((row) => !row.rls || !row.forced || row.policies === 0)
        .map(
          (row) =>
            `${row.table}: ${[
              row.rls ? "" : "row-level security off",
              row.forced ? "" : "not forced",
              row.policies ? "" : "no policy"
            ]
              .filter(Boolean)
              .join(", ")}`
        );
      expect(unprotected).toEqual([]);
    });

    it("exempts only tables that are entity-linked", async () => {
      const names = new Set((await linked()).map((row) => row.table));
      expect(Object.keys(EXEMPT).filter((table) => !names.has(table))).toEqual([]);
    });

    describe("a child table follows its parent's entity", () => {
      const APP_ROLE = "hfp_rls_test_app";
      const run = Date.now().toString(36);
      const ids = { a: "", b: "", codeB: "", rateB: "" };
      type Tx = Prisma.TransactionClient;

      const bypassed = <T>(fn: (tx: Tx) => Promise<T>) =>
        db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
          return fn(tx);
        });

      /** Runs `fn` as the non-owner role with entity A selected. */
      const asAppRoleForA = <T>(fn: (tx: Tx) => Promise<T>) =>
        db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_ROLE}`);
          await tx.$executeRaw`SELECT set_config('app.current_entity_id', ${ids.a}, true)`;
          return fn(tx);
        });

      beforeAll(async () => {
        const [role] = await db.$queryRaw<
          Array<{ found: boolean }>
        >`SELECT exists (SELECT 1 FROM pg_roles WHERE rolname = ${APP_ROLE}) AS found`;
        if (!role?.found) {
          await db.$executeRawUnsafe(
            `CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
          );
        }
        await db.$executeRawUnsafe(`GRANT ${APP_ROLE} TO CURRENT_USER`);
        await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
        await db.$executeRawUnsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`
        );
        await bypassed(async (tx) => {
          const entity = (label: string) =>
            tx.entity.create({
              data: {
                name: `Coverage IT ${label} ${run}`,
                code: `CV${label}${run}`.slice(0, 20),
                type: "PROPERTY",
                countryCode: "TZ"
              }
            });
          ids.a = (await entity("A")).id;
          ids.b = (await entity("B")).id;
          ids.codeB = (
            await tx.taxCode.create({
              data: { entityId: ids.b, code: `CV${run}`.slice(0, 20), taxType: "VAT" }
            })
          ).id;
          ids.rateB = (
            await tx.taxRate.create({
              data: { taxCodeId: ids.codeB, rate: 18, effectiveFrom: new Date("2026-01-01") }
            })
          ).id;
        });
      });

      afterAll(async () => {
        await bypassed(async (tx) => {
          await tx.taxCode.deleteMany({ where: { id: ids.codeB } });
          await tx.entity.deleteMany({
            where: { name: { startsWith: "Coverage IT", endsWith: run } }
          });
        });
      });

      it("cannot see entity B's child rows", async () => {
        const seen = await asAppRoleForA(
          (tx) =>
            tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM tax_rates WHERE id = ${ids.rateB}`
        );
        expect(seen).toEqual([]);
      });

      it("cannot add a child row under entity B's parent", async () => {
        await expect(
          asAppRoleForA(
            (tx) =>
              tx.$executeRaw`INSERT INTO tax_rates (id, tax_code_id, rate, effective_from)
                           VALUES (${randomUUID()}, ${ids.codeB}, 5, DATE '2026-02-01')`
          )
        ).rejects.toThrow(/row-level security/);
      });

      it("cannot change or delete entity B's child rows", async () => {
        const changed = await asAppRoleForA(async (tx) => {
          const updated =
            await tx.$executeRaw`UPDATE tax_rates SET rate = 0 WHERE id = ${ids.rateB}`;
          const deleted = await tx.$executeRaw`DELETE FROM tax_rates WHERE id = ${ids.rateB}`;
          return updated + deleted;
        });
        expect(changed).toBe(0);
        const still = await bypassed((tx) => tx.taxRate.findUnique({ where: { id: ids.rateB } }));
        expect(Number(still?.rate)).toBe(18);
      });
    });
  });
}
