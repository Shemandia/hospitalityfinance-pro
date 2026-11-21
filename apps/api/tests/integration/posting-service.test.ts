/**
 * Integration test: the posting service (import plan step 4).
 *
 * Runs as a real login role with application-role rights only (not the
 * owner), through the tenant client the API uses, so row-level security,
 * the RLS middleware and the database constraints all apply. Fixtures are
 * written by the owner.
 *
 *   * a document posts into the period of its date, with its dimensions by
 *     name, its source fields, and the account balances updated;
 *   * a document dated in a prior open period lands in that period;
 *   * no period for the month, or a period that is not open: refused;
 *   * unbalanced, unknown codes, wrong dimension values: refused, nothing
 *     written;
 *   * a foreign currency takes the latest rate on or before the date, or is
 *     refused without one;
 *   * a second post of the same document is a duplicate, also when two race;
 *   * reverse-and-replace reverses the original and posts the next revision
 *     in one transaction, with an audit event; a plain post stays a duplicate.
 *
 * Run: pnpm test:integration
 */

import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/db/client.js";
import { runWithContext } from "../../src/db/requestContext.js";
import { disconnectAllTenants, getTenantClient } from "../../src/db/tenantPool.js";
import { PostingService } from "../../src/modules/posting/service.js";

const base = process.env.TEST_DATABASE_URL;

if (!base) {
  describe("posting service", () => {
    it("requires TEST_DATABASE_URL", () => expect(base).toBeDefined());
  });
} else {
  describe("posting service against real Postgres, as the application role", () => {
    const owner = new PrismaClient({ datasourceUrl: base });
    const run = Date.now().toString(36).toUpperCase();
    const role = `hfp_it_post_${run.toLowerCase()}`;
    const password = randomBytes(18).toString("hex");
    const E = `PS${run}`.slice(0, 20);
    const SOURCE = `PS${run}`.slice(0, 20);
    const ids = {
      entity: randomUUID(),
      user: randomUUID(),
      feb: randomUUID(),
      mar: randomUUID(),
      apr: randomUUID(),
      cash: randomUUID(),
      revenue: randomUUID(),
      vat: randomUUID(),
      stat: randomUUID(),
      dept: randomUUID()
    };
    let service: PostingService;

    const ownerSql = (...sql: string[]) =>
      owner.$transaction([
        owner.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'true', true)`),
        ...sql.map((s) => owner.$executeRawUnsafe(s))
      ]);
    const ownerRows = async <T>(sql: string): Promise<T[]> => {
      const [, rows] = await owner.$transaction([
        owner.$executeRawUnsafe(`SELECT set_config('app.bypass_rls', 'true', true)`),
        owner.$queryRawUnsafe<T[]>(sql)
      ]);
      return rows as T[];
    };

    /** Each call is its own request, as two imports would be. */
    const asImport = <T>(fn: () => Promise<T>) => runWithContext({ userId: ids.user }, fn);
    const options = { actorUserId: ids.user, journalSource: "PMS" as const };

    const doc = (overrides: Record<string, unknown> = {}) => ({
      contractVersion: 1,
      documentType: "GL_JOURNAL",
      sourceSystem: SOURCE,
      sourceDocumentRef: `EZZ-${randomUUID().slice(0, 8)}`,
      documentDate: "2026-04-14",
      entityCode: E,
      currency: "TZS",
      lines: [
        {
          accountCode: "1200",
          debit: "1180",
          dimensions: { Department: "ROOMS", Market: "LEISURE" }
        },
        { accountCode: "4000", credit: "1000", dimensions: { Department: "ROOMS" } },
        { accountCode: "2300", credit: "180" }
      ],
      ...overrides
    });

    beforeAll(async () => {
      const db = new URL(base).pathname.slice(1).split("?")[0]!;
      await owner.$executeRawUnsafe(
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`
      );
      for (const sql of [
        `GRANT CONNECT ON DATABASE "${db}" TO ${role}`,
        `GRANT USAGE ON SCHEMA public TO ${role}`,
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
        `GRANT EXECUTE ON FUNCTION app_begin_rls_bypass() TO ${role}`
      ]) {
        await owner.$executeRawUnsafe(sql);
      }
      const appUrl = new URL(base);
      appUrl.username = role;
      appUrl.password = password;
      service = new PostingService(
        // The API casts the extended tenant client the same way (ap/router.ts).
        getTenantClient(`it-post-${run}`, appUrl.toString()) as unknown as PrismaClient
      );

      await ownerSql(
        `INSERT INTO entities (id, code, name, type, country_code, functional_currency, updated_at)
           VALUES ('${ids.entity}', '${E}', 'Posting IT ${run}', 'PROPERTY', 'TZ', 'TZS', now())`,
        `INSERT INTO users (id, email, name, updated_at) VALUES ('${ids.user}', 'post-${run.toLowerCase()}@it.test', 'Importer', now())`,
        `INSERT INTO periods (id, entity_id, year, month, name, status, updated_at) VALUES
           ('${ids.feb}', '${ids.entity}', 2026, 2, '2026-02', 'CLOSED', now()),
           ('${ids.mar}', '${ids.entity}', 2026, 3, '2026-03', 'OPEN', now()),
           ('${ids.apr}', '${ids.entity}', 2026, 4, '2026-04', 'OPEN', now())`,
        `INSERT INTO accounts (id, entity_id, code, name, type, normal_balance, updated_at) VALUES
           ('${ids.cash}', '${ids.entity}', '1200', 'Guest ledger', 'ASSET', 'DEBIT', now()),
           ('${ids.revenue}', '${ids.entity}', '4000', 'Room revenue', 'REVENUE', 'CREDIT', now()),
           ('${ids.vat}', '${ids.entity}', '2300', 'VAT payable', 'LIABILITY', 'CREDIT', now()),
           ('${ids.stat}', '${ids.entity}', '9100', 'Rooms sold', 'STATISTICAL', 'DEBIT', now()),
           ('${randomUUID()}', '${ids.entity}', '1999', 'Closed account', 'ASSET', 'DEBIT', now())`,
        `UPDATE accounts SET is_active = false WHERE entity_id = '${ids.entity}' AND code = '1999'`,
        `INSERT INTO analysis_dimensions (id, entity_id, dimension_number, dimension_name, validation_type, updated_at) VALUES
           ('${ids.dept}', '${ids.entity}', 3, 'Department', 'LIST', now()),
           ('${randomUUID()}', '${ids.entity}', 7, 'Market', 'NONE', now())`,
        `INSERT INTO analysis_codes (id, dimension_id, code) VALUES
           ('${randomUUID()}', '${ids.dept}', 'ROOMS'), ('${randomUUID()}', '${ids.dept}', 'FNB')`,
        `INSERT INTO source_systems (id, code, name, updated_at) VALUES ('${randomUUID()}', '${SOURCE}', 'Opera (IT)', now())`,
        `INSERT INTO fx_rates (id, from_currency, to_currency, rate_type, rate, effective_date) VALUES
           ('${randomUUID()}', 'USD', 'TZS', 'SPOT', 2500, '2026-03-01'),
           ('${randomUUID()}', 'USD', 'TZS', 'SPOT', 2600, '2026-04-20')
           ON CONFLICT (from_currency, to_currency, rate_type, effective_date) DO NOTHING`
      );
    }, 120_000);

    afterAll(async () => {
      await disconnectAllTenants();
      for (const sql of [
        `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
        `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
        `REVOKE ALL ON FUNCTION app_begin_rls_bypass() FROM ${role}`,
        `REVOKE ALL ON SCHEMA public FROM ${role}`,
        `REVOKE ALL ON DATABASE "${new URL(base).pathname.slice(1).split("?")[0]}" FROM ${role}`,
        `DROP ROLE IF EXISTS ${role}`
      ]) {
        await owner.$executeRawUnsafe(sql).catch(() => {});
      }
      await owner.$disconnect();
    }, 60_000);

    const journal = (id: string) =>
      ownerRows<{
        status: string;
        period_id: string;
        document_date: Date;
        source_system: string;
        source_document_ref: string;
        source_revision: number;
        replaces_journal_id: string | null;
        reversal_of_id: string | null;
        created_by: string;
      }>(`SELECT * FROM journals WHERE id = '${id}'`).then((r) => r[0]!);

    it("posts a document into the period of its date, with dimensions by name and the balances updated", async () => {
      const document = doc();
      const outcome = await asImport(() => service.post(document, options));
      expect(outcome).toMatchObject({ status: "POSTED" });
      const id = (outcome as { journalId: string }).journalId;
      const row = await journal(id);
      expect(row).toMatchObject({
        status: "POSTED",
        period_id: ids.apr,
        source_system: SOURCE,
        source_document_ref: document.sourceDocumentRef,
        source_revision: 0,
        created_by: ids.user
      });
      expect(row.document_date.toISOString().slice(0, 10)).toBe("2026-04-14");
      const lines = await ownerRows<{
        account_id: string;
        debit: string;
        credit: string;
        dimension3: string | null;
        dimension7: string | null;
      }>(
        `SELECT account_id, debit::text, credit::text, dimension3, dimension7 FROM journal_lines WHERE journal_id = '${id}' ORDER BY line_number`
      );
      expect(lines).toEqual([
        {
          account_id: ids.cash,
          debit: "1180.0000",
          credit: "0.0000",
          dimension3: "ROOMS",
          dimension7: "LEISURE"
        },
        {
          account_id: ids.revenue,
          debit: "0.0000",
          credit: "1000.0000",
          dimension3: "ROOMS",
          dimension7: null
        },
        {
          account_id: ids.vat,
          debit: "0.0000",
          credit: "180.0000",
          dimension3: null,
          dimension7: null
        }
      ]);
      const [balance] = await ownerRows<{ period_debits: string }>(
        `SELECT period_debits::text FROM account_period_balances WHERE account_id = '${ids.cash}' AND period_id = '${ids.apr}'`
      );
      expect(Number(balance!.period_debits)).toBeGreaterThanOrEqual(1180);
    });

    it("posts a document dated in a prior open period into that period", async () => {
      const outcome = await asImport(() =>
        service.post(doc({ documentDate: "2026-03-31" }), options)
      );
      expect(outcome.status).toBe("POSTED");
      expect((await journal((outcome as { journalId: string }).journalId)).period_id).toBe(ids.mar);
    });

    it("refuses a document with no period for its month, or whose period is not open", async () => {
      const none = await asImport(() => service.post(doc({ documentDate: "2026-07-01" }), options));
      expect(none).toMatchObject({ status: "REFUSED", errors: [{ code: "NO_PERIOD" }] });
      const closed = await asImport(() =>
        service.post(doc({ documentDate: "2026-02-10" }), options)
      );
      expect(closed).toMatchObject({ status: "REFUSED", errors: [{ code: "PERIOD_NOT_OPEN" }] });
    });

    it("refuses an unbalanced document, and bad codes all at once, writing nothing", async () => {
      const unbalanced = await asImport(() =>
        service.post(
          doc({
            lines: [
              { accountCode: "1200", debit: "100" },
              { accountCode: "4000", credit: "99.99" }
            ]
          }),
          options
        )
      );
      expect(unbalanced).toMatchObject({ status: "REFUSED", errors: [{ code: "UNBALANCED" }] });

      const ref = `BAD-${run}`;
      const bad = await asImport(() =>
        service.post(
          doc({
            sourceDocumentRef: ref,
            lines: [
              { accountCode: "1299", debit: "10", dimensions: { Department: "SPA" } },
              { accountCode: "1999", debit: "5", dimensions: { Region: "X" } },
              { accountCode: "9100", credit: "15" }
            ]
          }),
          options
        )
      );
      expect(bad.status).toBe("REFUSED");
      expect((bad as { errors: Array<{ code: string }> }).errors.map((e) => e.code).sort()).toEqual(
        [
          "ACCOUNT_NOT_FOUND",
          "ACCOUNT_NOT_POSTABLE",
          "AMOUNT_ON_STATISTICAL_ACCOUNT",
          "DIMENSION_NOT_FOUND",
          "DIMENSION_VALUE_NOT_FOUND"
        ]
      );
      expect(
        await ownerRows(`SELECT id FROM journals WHERE source_document_ref = '${ref}'`)
      ).toEqual([]);
    });

    it("takes the latest rate on or before the date for a foreign currency, and refuses without one", async () => {
      const outcome = await asImport(() =>
        service.post(
          doc({
            currency: "USD",
            lines: [
              { accountCode: "1200", debit: "10" },
              { accountCode: "4000", credit: "10" }
            ]
          }),
          options
        )
      );
      expect(outcome.status).toBe("POSTED");
      const [line] = await ownerRows<{ fx_rate: string; debit_functional: string }>(
        `SELECT fx_rate::text, debit_functional::text FROM journal_lines
          WHERE journal_id = '${(outcome as { journalId: string }).journalId}' AND line_number = 1`
      );
      expect([Number(line!.fx_rate), Number(line!.debit_functional)]).toEqual([2500, 25000]);

      const early = await asImport(() =>
        service.post(
          doc({
            currency: "USD",
            documentDate: "2026-03-01",
            lines: [
              { accountCode: "1200", debit: "1" },
              { accountCode: "4000", credit: "1" }
            ]
          }),
          options
        )
      );
      expect(early.status).toBe("POSTED");
      const none = await asImport(() =>
        service.post(
          doc({
            currency: "EUR",
            lines: [
              { accountCode: "1200", debit: "1" },
              { accountCode: "4000", credit: "1" }
            ]
          }),
          options
        )
      );
      expect(none).toMatchObject({ status: "REFUSED", errors: [{ code: "NO_RATE" }] });
    });

    it("posts statistics on statistical accounts", async () => {
      const outcome = await asImport(() =>
        service.post(
          doc({
            lines: [{ accountCode: "9100", statValue: "212", dimensions: { Department: "ROOMS" } }]
          }),
          options
        )
      );
      expect(outcome.status).toBe("POSTED");
      const [line] = await ownerRows<{ stat_value: string }>(
        `SELECT stat_value::text FROM journal_lines WHERE journal_id = '${(outcome as { journalId: string }).journalId}'`
      );
      expect(Number(line!.stat_value)).toBe(212);
    });

    it("reports a second post of the same document as a duplicate, also when two race", async () => {
      const document = doc();
      const first = await asImport(() => service.post(document, options));
      expect(first.status).toBe("POSTED");
      expect(await asImport(() => service.post(document, options))).toEqual({
        status: "DUPLICATE",
        journalId: (first as { journalId: string }).journalId
      });

      const raced = doc();
      const both = await Promise.all([
        asImport(() => service.post(raced, options)),
        asImport(() => service.post(raced, options))
      ]);
      expect(both.map((o) => o.status).sort()).toEqual(["DUPLICATE", "POSTED"]);
      expect(
        await ownerRows(
          `SELECT id FROM journals WHERE source_document_ref = '${raced.sourceDocumentRef}'`
        )
      ).toHaveLength(1);
    });

    it("checks without writing on a dry run", async () => {
      const document = doc();
      expect(await asImport(() => service.post(document, { ...options, dryRun: true }))).toEqual({
        status: "VALID"
      });
      expect(
        await ownerRows(
          `SELECT id FROM journals WHERE source_document_ref = '${document.sourceDocumentRef}'`
        )
      ).toEqual([]);
    });

    it("replaces a posted document: reversal and next revision in one transaction, audited", async () => {
      const original = doc();
      const posted = await asImport(() => service.post(original, options));
      const originalId = (posted as { journalId: string }).journalId;

      expect(
        await asImport(() => service.replace(original, { ...options, reason: " " }))
      ).toMatchObject({
        status: "REFUSED",
        errors: [{ code: "REASON_REQUIRED" }]
      });
      expect(
        await asImport(() => service.replace(doc(), { ...options, reason: "Night audit rerun" }))
      ).toMatchObject({ status: "REFUSED", errors: [{ code: "NOTHING_TO_REPLACE" }] });

      const corrected = {
        ...original,
        lines: [
          { accountCode: "1200", debit: "1416", dimensions: { Department: "ROOMS" } },
          { accountCode: "4000", credit: "1200", dimensions: { Department: "ROOMS" } },
          { accountCode: "2300", credit: "216" }
        ]
      };
      const replaced = await asImport(() =>
        service.replace(corrected, { ...options, reason: "Night audit rerun" })
      );
      expect(replaced).toMatchObject({
        status: "REPLACED",
        originalJournalId: originalId,
        revision: 1,
        replacementStatus: "POSTED"
      });
      const r = replaced as { reversalJournalId: string; journalId: string };

      expect(await journal(r.reversalJournalId)).toMatchObject({
        status: "POSTED",
        reversal_of_id: originalId,
        period_id: ids.apr
      });
      expect(await journal(r.journalId)).toMatchObject({
        status: "POSTED",
        source_revision: 1,
        replaces_journal_id: originalId,
        source_document_ref: original.sourceDocumentRef
      });
      const net = await ownerRows<{ net: string }>(
        `SELECT sum(debit - credit)::text AS net FROM journal_lines
          WHERE journal_id IN ('${originalId}', '${r.reversalJournalId}', '${r.journalId}') AND account_id = '${ids.cash}'`
      );
      expect(Number(net[0]!.net)).toBe(1416);
      const [event] = await ownerRows<{
        event_type: string;
        resource_id: string;
        after_state: { reason: string; reversalJournalId: string };
      }>(
        `SELECT event_type, resource_id, after_state FROM audit_events WHERE event_type = 'JOURNAL_REPLACED' AND resource_id = '${r.journalId}'`
      );
      expect(event).toMatchObject({
        event_type: "JOURNAL_REPLACED",
        after_state: { reason: "Night audit rerun", reversalJournalId: r.reversalJournalId }
      });

      // A plain post of the same document is still a duplicate (of the latest revision).
      expect(await asImport(() => service.post(original, options))).toEqual({
        status: "DUPLICATE",
        journalId: r.journalId
      });
    });
  });
}
