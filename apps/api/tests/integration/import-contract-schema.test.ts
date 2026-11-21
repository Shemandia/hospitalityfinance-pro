/**
 * Integration test: what the import contract needs from the database
 * (docs/IMPORT-PLAN.md section 3; migration 3_import_posting_contract).
 *
 *   * Upgrading a tenant: refused while an entity has no code (the message
 *     names it); journals get a document date inside their period.
 *   * A source document posts once per entity: the unique index refuses the
 *     second, also when two transactions race.
 *   * The source system and the reference come together, and the source
 *     system must exist.
 *   * documentDate is filled when left out, and refused outside its period.
 *   * Entity codes are required and unique in the tenant.
 *   * A SUSPENSE policy needs a suspense account.
 *
 * Statements run as the connecting role, which owns the test database and so
 * may lift the row-level security policies (SEC-11).
 *
 * Run: pnpm test:integration
 */

import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/db/client.js";
import { clearFailedMigrations, deployMigrations, schemaPath } from "../../src/db/migrate.js";

const base = process.env.TEST_DATABASE_URL;
const MIGRATION = "3_import_posting_contract";

/** Runs `sql` statements in one transaction with the policies lifted (as the owner). */
async function asOwner(db: PrismaClient, ...sql: string[]): Promise<void> {
  await db.$transaction([
    db.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'true', true)`),
    ...sql.map((s) => db.$executeRawUnsafe(s))
  ]);
}

async function rowsAsOwner<T>(db: PrismaClient, sql: string): Promise<T[]> {
  const [, rows] = await db.$transaction([
    db.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'true', true)`),
    db.$queryRawUnsafe<T[]>(sql)
  ]);
  return rows as T[];
}

if (!base) {
  describe("import contract schema", () => {
    it("requires TEST_DATABASE_URL", () => expect(base).toBeDefined());
  });
} else {
  describe("upgrading a tenant to the import contract", () => {
    const name = `hfp_it_contract_${Date.now().toString(36)}`;
    const url = new URL(base);
    url.pathname = `/${name}`;
    const admin = new PrismaClient({ datasourceUrl: base });
    const tenant = new PrismaClient({ datasourceUrl: url.toString() });
    let previousRelease = "";

    beforeAll(async () => {
      // The previous release: every migration before this one.
      previousRelease = mkdtempSync(join(tmpdir(), "hfp-previous-"));
      cpSync(dirname(schemaPath("tenant")), previousRelease, {
        recursive: true,
        filter: (p) => !p.includes(MIGRATION)
      });
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
      await deployMigrations("tenant", url.toString(), join(previousRelease, "schema.prisma"));

      await asOwner(
        tenant,
        `INSERT INTO entities (id, code, name, type, country_code, updated_at)
           VALUES ('e1', NULL, 'Harbour Hotel', 'PROPERTY', 'TZ', now())`,
        `INSERT INTO users (id, email, name, updated_at) VALUES ('u1', 'ada@it.test', 'Ada', now())`,
        `INSERT INTO periods (id, entity_id, year, month, name, updated_at)
           VALUES ('p1', 'e1', 2026, 3, '2026-03', now())`,
        // Posted in its month; and one created two months after its period.
        `INSERT INTO journals (id, entity_id, period_id, source, functional_currency, created_by,
                               posted_at, created_at, updated_at)
           VALUES ('j1', 'e1', 'p1', 'MANUAL', 'USD', 'u1', '2026-03-15 10:00', '2026-03-14', now()),
                  ('j2', 'e1', 'p1', 'MANUAL', 'USD', 'u1', NULL, '2026-05-02', now())`
      );
    }, 300_000);

    afterAll(async () => {
      await tenant.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.$disconnect();
      rmSync(previousRelease, { recursive: true, force: true });
    }, 60_000);

    it("refuses while an entity has no code, and names it", async () => {
      await expect(deployMigrations("tenant", url.toString())).rejects.toThrow(
        /Every entity needs a code unique in the tenant.*Harbour Hotel \(no code\)/s
      );
    }, 300_000);

    it("upgrades once the codes are fixed, with document dates inside the periods", async () => {
      await asOwner(tenant, `UPDATE entities SET code = 'HH' WHERE id = 'e1'`);
      // As the runner does after a failed run: mark the refused migration for retry.
      await clearFailedMigrations("tenant", tenant, url.toString());
      await deployMigrations("tenant", url.toString());
      const rows = await rowsAsOwner<{ id: string; document_date: Date }>(
        tenant,
        `SELECT id, document_date FROM journals ORDER BY id`
      );
      expect(rows.map((r) => [r.id, r.document_date.toISOString().slice(0, 10)])).toEqual([
        ["j1", "2026-03-15"],
        ["j2", "2026-03-31"]
      ]);
    }, 300_000);
  });

  describe("import contract rules in the database", () => {
    const db = new PrismaClient({ datasourceUrl: base });
    const run = Date.now().toString(36).toUpperCase();
    const ids = {
      entityA: randomUUID(),
      entityB: randomUUID(),
      user: randomUUID(),
      periodA: randomUUID(),
      periodB: randomUUID()
    };
    const SOURCE = `IT${run}`.slice(0, 20);
    const OTHER_SOURCE = `IU${run}`.slice(0, 20);

    const journal = (
      id: string,
      opts: {
        entity?: string;
        period?: string;
        source?: string | null;
        ref?: string | null;
        date?: string | null;
      } = {}
    ) => {
      const source = opts.source === undefined ? SOURCE : opts.source;
      const ref = opts.ref === undefined ? "EZZ-2026-03-05-FIDEL" : opts.ref;
      const date = opts.date === undefined ? "2026-03-05" : opts.date;
      const lit = (v: string | null) => (v === null ? "NULL" : `'${v}'`);
      return `INSERT INTO journals (id, entity_id, period_id, source, functional_currency, created_by,
                                    document_date, source_system, source_document_ref, updated_at)
              VALUES ('${id}', '${opts.entity ?? ids.entityA}', '${opts.period ?? ids.periodA}', 'IMPORT', 'USD',
                      '${ids.user}', ${lit(date)}, ${lit(source)}, ${lit(ref)}, now())`;
    };

    beforeAll(async () => {
      await asOwner(
        db,
        `INSERT INTO entities (id, code, name, type, country_code, updated_at) VALUES
           ('${ids.entityA}', 'CA${run}', 'Contract A', 'PROPERTY', 'TZ', now()),
           ('${ids.entityB}', 'CB${run}', 'Contract B', 'PROPERTY', 'TZ', now())`,
        `INSERT INTO users (id, email, name, updated_at)
           VALUES ('${ids.user}', 'contract-${run.toLowerCase()}@it.test', 'Contract', now())`,
        `INSERT INTO periods (id, entity_id, year, month, name, updated_at) VALUES
           ('${ids.periodA}', '${ids.entityA}', 2026, 3, '2026-03', now()),
           ('${ids.periodB}', '${ids.entityB}', 2026, 3, '2026-03', now())`,
        `INSERT INTO source_systems (id, code, name, updated_at) VALUES
           ('${randomUUID()}', '${SOURCE}', 'Opera (test)', now()),
           ('${randomUUID()}', '${OTHER_SOURCE}', 'Jana (test)', now())`
      );
    }, 60_000);

    afterAll(async () => {
      await asOwner(
        db,
        `DELETE FROM journals WHERE entity_id IN ('${ids.entityA}', '${ids.entityB}')`,
        `DELETE FROM periods WHERE entity_id IN ('${ids.entityA}', '${ids.entityB}')`,
        `DELETE FROM source_systems WHERE code IN ('${SOURCE}', '${OTHER_SOURCE}')`,
        `DELETE FROM entities WHERE id IN ('${ids.entityA}', '${ids.entityB}')`,
        `DELETE FROM users WHERE id = '${ids.user}'`
      ).catch(() => {});
      await db.$disconnect();
    }, 60_000);

    it("refuses a second journal for the same source document of an entity", async () => {
      await asOwner(db, journal(randomUUID()));
      await expect(asOwner(db, journal(randomUUID()))).rejects.toThrow(/Code: `23505`/);
    });

    it("refuses the second of two concurrent posts of the same document", async () => {
      const ref = `RACE-${run}`;
      const post = () =>
        db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'true', true)`);
          await tx.$executeRawUnsafe(journal(randomUUID(), { ref }));
          await tx.$executeRawUnsafe(`SELECT pg_sleep(0.3)`);
        });
      const results = await Promise.allSettled([post(), post()]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const posted = await rowsAsOwner<{ n: number }>(
        db,
        `SELECT count(*)::int AS n FROM journals WHERE source_document_ref = '${ref}'`
      );
      expect(posted[0]!.n).toBe(1);
    });

    it("lets the same reference post for another entity or another source system", async () => {
      const ref = `SHARED-${run}`;
      await asOwner(db, journal(randomUUID(), { ref }));
      await expect(
        asOwner(db, journal(randomUUID(), { ref, entity: ids.entityB, period: ids.periodB }))
      ).resolves.toBeUndefined();
      await expect(
        asOwner(db, journal(randomUUID(), { ref, source: OTHER_SOURCE }))
      ).resolves.toBeUndefined();
    });

    it("leaves journals without a source alone (no duplicate check)", async () => {
      await asOwner(db, journal(randomUUID(), { source: null, ref: null }));
      await expect(
        asOwner(db, journal(randomUUID(), { source: null, ref: null }))
      ).resolves.toBeUndefined();
    });

    it("needs the source system and the reference together", async () => {
      await expect(asOwner(db, journal(randomUUID(), { ref: null }))).rejects.toThrow(
        /journals_source_ref_pair/
      );
      await expect(
        asOwner(db, journal(randomUUID(), { source: null, ref: `ALONE-${run}` }))
      ).rejects.toThrow(/journals_source_ref_pair/);
    });

    it("refuses a source system the tenant has not defined", async () => {
      await expect(
        asOwner(db, journal(randomUUID(), { source: "NOPE", ref: `NOPE-${run}` }))
      ).rejects.toThrow(/journals_source_system_fkey|Foreign key/);
    });

    it("fills a missing document date inside the period, and refuses one outside it", async () => {
      const id = randomUUID();
      await asOwner(db, journal(id, { source: null, ref: null, date: null }));
      const [row] = await rowsAsOwner<{ d: Date }>(
        db,
        `SELECT document_date AS d FROM journals WHERE id = '${id}'`
      );
      // Today is not in March 2026 (the test period), so the period's last day.
      expect(row!.d.toISOString().slice(0, 10)).toBe("2026-03-31");

      await expect(
        asOwner(db, journal(randomUUID(), { ref: `APRIL-${run}`, date: "2026-04-01" }))
      ).rejects.toThrow(/not in its period 2026-03/);
      await expect(
        asOwner(db, `UPDATE journals SET document_date = '2026-02-28' WHERE id = '${id}'`)
      ).rejects.toThrow(/not in its period 2026-03/);
    });

    it("requires an entity code, unique in the tenant", async () => {
      await expect(
        asOwner(
          db,
          `INSERT INTO entities (id, code, name, type, country_code, updated_at)
             VALUES ('${randomUUID()}', NULL, 'No code', 'PROPERTY', 'TZ', now())`
        )
      ).rejects.toThrow(/Code: `23502`/);
      await expect(
        asOwner(
          db,
          `INSERT INTO entities (id, code, name, type, country_code, updated_at)
             VALUES ('${randomUUID()}', 'CA${run}', 'Same code', 'PROPERTY', 'TZ', now())`
        )
      ).rejects.toThrow(/Code: `23505`/);
    });

    it("needs a suspense account for the SUSPENSE policy", async () => {
      await expect(
        asOwner(
          db,
          `INSERT INTO transfer_profiles (id, name, profile_type, unmapped_policy, updated_at)
             VALUES ('${randomUUID()}', 'Suspense ${run}', 'IMPORT', 'SUSPENSE', now())`
        )
      ).rejects.toThrow(/transfer_profiles_suspense_needs_account/);
    });
  });
}
