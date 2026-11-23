/**
 * Integration test: one ledger import from file to journals (import plan
 * step 5), with the real posting service, as the application role.
 *
 * A delimited file with its own column names goes through a transformation
 * that writes the contract's fields (the reference is property and business
 * date, the currency a constant, the department a dimension by name). Its
 * two documents land in the periods of their dates; importing the file again
 * posts nothing; a whole-file profile posts nothing when one document cannot
 * post; HOLD stages the documents and a commit posts them.
 *
 * Run: pnpm test:integration
 */

import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../../src/db/client.js";
import { dropTestRole, underGrantLock } from "./grants.js";
import { runWithContext } from "../../src/db/requestContext.js";
import { disconnectAllTenants, getTenantClient } from "../../src/db/tenantPool.js";
import {
  executeImport,
  type PipelineContext,
  type ProfileWithRelations
} from "../../src/jobs/integration-pipeline.js";
import { BatchReviewService } from "../../src/modules/integrations/batch-service.js";

process.env.TML_ALLOW_INSECURE_SANDBOX ??= "true";

const base = process.env.TEST_DATABASE_URL;

if (!base) {
  describe("import pipeline", () => {
    it("requires TEST_DATABASE_URL", () => expect(base).toBeDefined());
  });
} else {
  describe("ledger import end to end, as the application role", () => {
    const owner = new PrismaClient({ datasourceUrl: base });
    const run = Date.now().toString(36).toUpperCase();
    const role = `hfp_it_pipe_${run.toLowerCase()}`;
    const password = randomBytes(18).toString("hex");
    const E = `IP${run}`.slice(0, 20);
    const SOURCE = `IP${run}`.slice(0, 20);
    const dbName = new URL(base).pathname.slice(1).split("?")[0]!;
    const ids = {
      entity: randomUUID(),
      user: randomUUID(),
      mar: randomUUID(),
      apr: randomUUID(),
      feb: randomUUID()
    };
    let app: PrismaClient;
    let appUrl: string;

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

    const FSD = JSON.stringify({
      classification: "DELIMITED",
      fieldSep: ";",
      recordSep: "\n",
      record: {
        name: "row",
        fields: [
          { name: "prop", type: "string" },
          { name: "bizDate", type: "string" },
          { name: "acct", type: "string" },
          { name: "dr", type: "number" },
          { name: "cr", type: "number" },
          { name: "dept", type: "string" }
        ]
      }
    });
    const RULES = [
      { type: "map", target: "entityCode", sources: [{ path: "prop" }] },
      {
        type: "map",
        target: "sourceDocumentRef",
        sources: [{ path: "prop", separator: "-" }, { path: "bizDate" }]
      },
      { type: "map", target: "documentDate", sources: [{ path: "bizDate" }] },
      { type: "set", target: "currency", value: "TZS" },
      { type: "map", target: "accountCode", sources: [{ path: "acct" }] },
      { type: "map", target: "debit", sources: [{ path: "dr" }] },
      { type: "map", target: "credit", sources: [{ path: "cr" }] },
      { type: "map", target: "dimensions.Department", sources: [{ path: "dept" }] }
    ];
    const file = (rows: string[]) => rows.map((r) => r.replaceAll("{E}", E)).join("\n");
    const NIGHT_AUDIT = file([
      "{E};2026-03-31;1200;1180;0;ROOMS",
      "{E};2026-03-31;4000;0;1180;ROOMS",
      "{E};2026-04-01;1200;500.25;0;FNB",
      "{E};2026-04-01;4000;0;500.25;FNB"
    ]);

    async function profileRow(
      name: string,
      overrides: Partial<ProfileWithRelations> = {}
    ): Promise<ProfileWithRelations> {
      const id = randomUUID();
      await ownerSql(
        `INSERT INTO integration_profiles (id, name, profile_type, target_component, source_system_code, review_mode, atomicity, target_params, updated_at)
           VALUES ('${id}', '${name} ${run}', 'IMPORT', 'GL_JOURNAL', '${SOURCE}', '${overrides.reviewMode ?? "AUTO_COMMIT"}', '${overrides.atomicity ?? "PER_DOCUMENT"}', '{"journalSource":"PMS"}', now())`
      );
      return {
        id,
        name,
        profileType: "IMPORT",
        sourceComponent: "FILE",
        targetComponent: "GL_JOURNAL",
        sourceFormatId: "f",
        targetFormatId: null,
        transformationId: "t",
        sourceParams: null,
        targetParams: { journalSource: "PMS" },
        savePayload: "NONE",
        sourceFormat: { id: "f", fsdXml: FSD, classification: "DELIMITED" },
        targetFormat: null,
        transformation: { id: "t", rulesJson: RULES, functionsJson: null },
        reviewMode: "AUTO_COMMIT",
        sourceSystemCode: SOURCE,
        atomicity: "PER_DOCUMENT",
        ...overrides
      };
    }

    async function runImport(profile: ProfileWithRelations, content: string) {
      const executionId = randomUUID();
      await ownerSql(
        `INSERT INTO integration_executions (id, profile_id, status, triggered_by) VALUES ('${executionId}', '${profile.id}', 'RUNNING', '${ids.user}')`
      );
      const ctx: PipelineContext = {
        db: app as any,
        storage: { read: async () => content, write: async () => {} } as any,
        tenantSlug: `it-pipe-${run}`,
        tenantDbUrl: appUrl
      };
      const result = await runWithContext({ userId: ids.user }, () =>
        executeImport(ctx, executionId, profile, {
          entityId: ids.entity,
          triggeredBy: ids.user,
          filePath: "in.txt"
        })
      );
      return { executionId, result };
    }

    const journalsOf = (ref: string) =>
      ownerRows<{ id: string; period_id: string; status: string }>(
        `SELECT id, period_id, status FROM journals WHERE entity_id = '${ids.entity}' AND source_document_ref = '${ref}' ORDER BY source_revision`
      );

    beforeAll(async () => {
      await underGrantLock(owner, [
        `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
        `GRANT CONNECT ON DATABASE "${dbName}" TO ${role}`,
        `GRANT USAGE ON SCHEMA public TO ${role}`,
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
        `GRANT EXECUTE ON FUNCTION app_begin_rls_bypass() TO ${role}`
      ]);
      const url = new URL(base);
      url.username = role;
      url.password = password;
      appUrl = url.toString();
      app = getTenantClient(`it-pipe-${run}`, appUrl) as unknown as PrismaClient;

      await ownerSql(
        `INSERT INTO entities (id, code, name, type, country_code, functional_currency, updated_at)
           VALUES ('${ids.entity}', '${E}', 'Pipeline IT ${run}', 'PROPERTY', 'TZ', 'TZS', now())`,
        `INSERT INTO users (id, email, name, updated_at) VALUES ('${ids.user}', 'pipe-${run.toLowerCase()}@it.test', 'Night auditor', now())`,
        `INSERT INTO periods (id, entity_id, year, month, name, status, updated_at) VALUES
           ('${ids.feb}', '${ids.entity}', 2026, 2, '2026-02', 'CLOSED', now()),
           ('${ids.mar}', '${ids.entity}', 2026, 3, '2026-03', 'OPEN', now()),
           ('${ids.apr}', '${ids.entity}', 2026, 4, '2026-04', 'OPEN', now())`,
        `INSERT INTO accounts (id, entity_id, code, name, type, normal_balance, updated_at) VALUES
           ('${randomUUID()}', '${ids.entity}', '1200', 'Guest ledger', 'ASSET', 'DEBIT', now()),
           ('${randomUUID()}', '${ids.entity}', '4000', 'Room revenue', 'REVENUE', 'CREDIT', now())`,
        `INSERT INTO analysis_dimensions (id, entity_id, dimension_number, dimension_name, updated_at)
           VALUES ('${randomUUID()}', '${ids.entity}', 1, 'Department', now())`,
        `INSERT INTO source_systems (id, code, name, updated_at) VALUES ('${randomUUID()}', '${SOURCE}', 'Opera (IT)', now())`
      );
    }, 120_000);

    afterAll(async () => {
      await disconnectAllTenants();
      await dropTestRole(owner, role, [
        `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`,
        `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role}`,
        `REVOKE ALL ON FUNCTION app_begin_rls_bypass() FROM ${role}`,
        `REVOKE ALL ON SCHEMA public FROM ${role}`,
        `REVOKE ALL ON DATABASE "${dbName}" FROM ${role}`,
        `DROP ROLE IF EXISTS ${role}`
      ]);
      await owner.$disconnect();
    }, 60_000);

    it("posts each document into the period of its date, and logs every record", async () => {
      const profile = await profileRow("Night audit");
      const { executionId, result } = await runImport(profile, NIGHT_AUDIT);
      expect(result).toMatchObject({ recordsTotal: 4, recordsSucceeded: 4, recordsFailed: 0 });

      const march = await journalsOf(`${E}-2026-03-31`);
      const april = await journalsOf(`${E}-2026-04-01`);
      expect(march).toMatchObject([{ period_id: ids.mar, status: "POSTED" }]);
      expect(april).toMatchObject([{ period_id: ids.apr, status: "POSTED" }]);
      const lines = await ownerRows<{ debit: string; dimension1: string }>(
        `SELECT debit::text, dimension1 FROM journal_lines WHERE journal_id = '${april[0]!.id}' ORDER BY line_number`
      );
      expect(lines).toEqual([
        { debit: "500.2500", dimension1: "FNB" },
        { debit: "0.0000", dimension1: "FNB" }
      ]);

      const logs = await ownerRows<{
        record_index: number;
        status: string;
        document_ref: string;
        journal_id: string;
      }>(
        `SELECT record_index, status, document_ref, journal_id FROM integration_execution_logs WHERE execution_id = '${executionId}' ORDER BY record_index`
      );
      expect(logs.map((l) => [l.record_index, l.status, l.document_ref, l.journal_id])).toEqual([
        [0, "SUCCESS", `${E}-2026-03-31`, march[0]!.id],
        [1, "SUCCESS", `${E}-2026-03-31`, march[0]!.id],
        [2, "SUCCESS", `${E}-2026-04-01`, april[0]!.id],
        [3, "SUCCESS", `${E}-2026-04-01`, april[0]!.id]
      ]);

      // The same file again: every document is a duplicate, nothing posts.
      const again = await runImport(profile, NIGHT_AUDIT);
      expect(again.result).toMatchObject({ status: "DUPLICATE", recordsSucceeded: 0 });
      expect(await journalsOf(`${E}-2026-03-31`)).toHaveLength(1);
    });

    it("posts nothing of a whole-file profile's file when one document cannot post", async () => {
      const profile = await profileRow("Whole file", { atomicity: "WHOLE_FILE" });
      const content = file([
        "{E};2026-04-02;1200;10;0;ROOMS",
        "{E};2026-04-02;4000;0;10;ROOMS",
        "{E};2026-02-27;1200;10;0;ROOMS",
        "{E};2026-02-27;4000;0;10;ROOMS"
      ]);
      const { executionId, result } = await runImport(profile, content);
      expect(result).toMatchObject({ recordsSucceeded: 0, recordsFailed: 4 });
      expect(await journalsOf(`${E}-2026-04-02`)).toEqual([]);
      const codes = await ownerRows<{ error_code: string }>(
        `SELECT DISTINCT error_code FROM integration_execution_logs WHERE execution_id = '${executionId}' ORDER BY error_code`
      );
      expect(codes.map((c) => c.error_code)).toEqual(["FILE_NOT_POSTED", "PERIOD_NOT_OPEN"]);
    });

    it("HOLD stages the documents after a dry run, and the commit posts them", async () => {
      const profile = await profileRow("Held", { reviewMode: "HOLD" });
      const content = file(["{E};2026-04-03;1200;7;0;ROOMS", "{E};2026-04-03;4000;0;7;ROOMS"]);
      await runImport(profile, content);
      expect(await journalsOf(`${E}-2026-04-03`)).toEqual([]);
      const [batch] = await ownerRows<{ id: string; held_items: number }>(
        `SELECT id, held_items FROM integration_batches WHERE profile_id = '${profile.id}'`
      );
      expect(batch!.held_items).toBe(1);

      const summary = await runWithContext({ userId: ids.user, entityId: ids.entity }, () =>
        new BatchReviewService(app).commitBatch(ids.entity, batch!.id, ids.user)
      );
      expect(summary).toMatchObject({ committed: 1, errors: 0 });
      expect(await journalsOf(`${E}-2026-04-03`)).toMatchObject([
        { period_id: ids.apr, status: "POSTED" }
      ]);
    });

    it("maps source codes through the tenant's lookup table, and SUSPENSE posts the unmapped one to suspense", async () => {
      const table = `Revenue codes ${run}`;
      const [t, c, r1, r2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      await ownerSql(
        `INSERT INTO accounts (id, entity_id, code, name, type, normal_balance, updated_at)
           VALUES ('${randomUUID()}', '${ids.entity}', '1999', 'Suspense', 'LIABILITY', 'CREDIT', now())`,
        `INSERT INTO integration_lookup_tables (id, name, updated_at) VALUES ('${t}', '${table}', now())`,
        `INSERT INTO integration_lookup_columns (id, table_id, name, column_order) VALUES ('${c}', '${t}', 'Account', 1)`,
        `INSERT INTO integration_lookup_rows (id, table_id, range_from, range_to, row_order) VALUES
           ('${r1}', '${t}', 'GL', 'GL', 1), ('${r2}', '${t}', 'RM', 'RM', 2)`,
        `INSERT INTO integration_lookup_values (id, row_id, column_id, value_type, value_param) VALUES
           ('${randomUUID()}', '${r1}', '${c}', 'MAP_TO', '1200'), ('${randomUUID()}', '${r2}', '${c}', 'MAP_TO', '4000')`
      );
      const rules = RULES.map((rule) =>
        rule.target === "accountCode"
          ? { type: "lookup", table, source: "acct", target: "accountCode" }
          : rule
      );
      const base = await profileRow("Mapped", {
        unmappedPolicy: "SUSPENSE",
        suspenseAccountCode: "1999"
      });
      const profile = {
        ...base,
        transformation: { id: "t", rulesJson: rules, functionsJson: null }
      };
      const content = file([
        "{E};2026-04-04;GL;30;0;ROOMS",
        "{E};2026-04-04;RM;0;20;ROOMS",
        "{E};2026-04-04;SPA;0;10;ROOMS"
      ]);
      const { result } = await runImport(profile, content);
      expect(result).toMatchObject({ recordsSucceeded: 3, recordsFailed: 0 });
      const [journal] = await journalsOf(`${E}-2026-04-04`);
      const lines = await ownerRows<{ code: string; credit: string; description: string | null }>(
        `SELECT a.code, l.credit::text, l.description FROM journal_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.journal_id = '${journal!.id}' ORDER BY l.line_number`
      );
      expect(lines.map((l) => [l.code, l.description])).toEqual([
        ["1200", null],
        ["4000", null],
        ["1999", "Unmapped " + table + " SPA"]
      ]);
    });
  });
}
