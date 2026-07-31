/**
 * Regression tests for the performance SQL / materialized view.
 *
 * Guards the defect that made every KPI, balance-sheet and cash-flow endpoint
 * return 500: performance.sql (and the 20260322 migration) addressed tables as
 * quoted PascalCase — "AccountPeriodBalance", "Journal", "ARInvoice" — while
 * Prisma maps every model to snake_case. Postgres raised 42P01 on the first
 * statement, and because executeSqlFile had no per-statement error handling the
 * whole file aborted, so mv_period_account_balances was never created.
 *
 * These tests need no database: they check the SQL against the Prisma schema
 * that defines the real names, and check the runner's failure behaviour.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { executeSqlFile } from "../src/db/sqlRunner.js";

const API_ROOT = join(__dirname, "..");
const SCHEMA_PATH = join(API_ROOT, "src", "db", "schema-tenant.prisma");
const PERFORMANCE_SQL = join(API_ROOT, "src", "db", "sql", "performance.sql");
const PERFORMANCE_MIGRATION = join(
  API_ROOT,
  "src",
  "db",
  "migrations",
  "20260322000000_performance_indexes",
  "migration.sql"
);

/** Table names Prisma actually creates, from every @@map in the tenant schema. */
function mappedTableNames(): Set<string> {
  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  const names = new Set<string>();
  for (const m of schema.matchAll(/@@map\("([^"]+)"\)/g)) {
    names.add(m[1]!);
  }
  return names;
}

function statementsOf(sqlPath: string): string[] {
  return readFileSync(sqlPath, "utf-8")
    .split(";")
    .map((s) =>
      s
        // strip line comments so commented-out examples aren't parsed as SQL
        .replace(/^\s*--.*$/gm, "")
        .trim()
    )
    .filter((s) => s.length > 0);
}

/** Objects a CREATE INDEX / MATERIALIZED VIEW statement reads or writes. */
function relationsReferencedBy(statement: string): string[] {
  const rels: string[] = [];
  const idx = statement.match(/CREATE\s+(?:UNIQUE\s+)?INDEX[\s\S]*?\sON\s+("?[\w]+"?)/i);
  if (idx) rels.push(idx[1]!);
  for (const m of statement.matchAll(/\b(?:FROM|JOIN)\s+("?[\w]+"?)/gi)) {
    rels.push(m[1]!);
  }
  return rels.map((r) => r.replace(/"/g, ""));
}

const SQL_FILES: Array<[string, string]> = [
  ["performance.sql", PERFORMANCE_SQL],
  ["20260322000000_performance_indexes/migration.sql", PERFORMANCE_MIGRATION]
];

/** File contents with -- line comments removed, so prose about the old bug
 *  (which necessarily quotes PascalCase names) isn't mistaken for live SQL. */
function executableSql(sqlPath: string): string {
  return readFileSync(sqlPath, "utf-8").replace(/--.*$/gm, "");
}

describe.each(SQL_FILES)("%s", (_label, sqlPath) => {
  it("addresses no quoted PascalCase relation (the 42P01 bug)", () => {
    const offenders = [...executableSql(sqlPath).matchAll(/"([A-Z][A-Za-z0-9_]*)"/g)].map(
      (m) => m[1]!
    );
    expect(offenders).toEqual([]);
  });

  it("references only tables Prisma actually creates", () => {
    const known = mappedTableNames();
    // Created by these files themselves, so absent from the Prisma schema.
    known.add("mv_period_account_balances");

    const unknown = new Set<string>();
    for (const statement of statementsOf(sqlPath)) {
      for (const rel of relationsReferencedBy(statement)) {
        if (!known.has(rel)) unknown.add(rel);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it("creates mv_period_account_balances", () => {
    const sql = readFileSync(sqlPath, "utf-8");
    expect(sql).toMatch(
      /CREATE\s+MATERIALIZED\s+VIEW\s+IF\s+NOT\s+EXISTS\s+mv_period_account_balances/i
    );
  });

  it("gives the materialized view a unique index so CONCURRENTLY refresh works", () => {
    // jobs/mv-refresh-job.ts issues REFRESH MATERIALIZED VIEW CONCURRENTLY,
    // which Postgres rejects unless the view has a unique index.
    const sql = readFileSync(sqlPath, "utf-8");
    expect(sql).toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]*?ON\s+mv_period_account_balances/i);
  });
});

describe("materialized view column contract", () => {
  it("exposes the exact columns its consumers select", () => {
    const sql = readFileSync(PERFORMANCE_SQL, "utf-8");
    // Consumers: kpi/service.ts, consolidation/service.ts, budget/service.ts,
    // jobs/report-generation-job.ts. The three ids are quoted camelCase; the
    // rest are unquoted snake_case. Changing either breaks those raw queries.
    for (const quoted of ['"entityId"', '"periodId"', '"accountId"']) {
      expect(sql).toContain(`AS ${quoted}`);
    }
    for (const col of [
      "account_code",
      "account_name",
      "account_type",
      "usali_category",
      "usali_department",
      "is_active",
      "opening_balance",
      "period_debits",
      "period_credits",
      "closing_balance"
    ]) {
      expect(sql).toContain(col);
    }
  });
});

describe("executeSqlFile resilience", () => {
  function fakeExecutor(failOn: (stmt: string) => Error | null) {
    const ran: string[] = [];
    return {
      ran,
      async $executeRawUnsafe(query: string) {
        const err = failOn(query);
        if (err) throw err;
        ran.push(query);
        return 0;
      }
    };
  }

  it("continues past an already-exists statement and still creates the view", async () => {
    const exec = fakeExecutor((stmt) => {
      if (stmt.includes("idx_journal_entity_source")) {
        return Object.assign(new Error("relation already exists"), { code: "42P07" });
      }
      return null;
    });

    const result = await executeSqlFile(exec, PERFORMANCE_SQL);

    expect(result.skipped).toHaveLength(1);
    expect(result.executed).toBe(result.total - 1);
    // The whole point: the view is still created after an earlier failure.
    expect(exec.ran.some((s) => /CREATE MATERIALIZED VIEW/i.test(s))).toBe(true);
  });

  it("continues past an undefined-table statement (42P01)", async () => {
    const exec = fakeExecutor((stmt) =>
      stmt.includes("ar_invoices")
        ? Object.assign(new Error('relation "ar_invoices" does not exist'), { code: "42P01" })
        : null
    );

    const result = await executeSqlFile(exec, PERFORMANCE_SQL);

    expect(result.skipped.length).toBeGreaterThan(0);
    expect(exec.ran.some((s) => /CREATE MATERIALIZED VIEW/i.test(s))).toBe(true);
  });

  it("still throws on a genuine error", async () => {
    const exec = fakeExecutor((stmt) =>
      /CREATE MATERIALIZED VIEW/i.test(stmt)
        ? Object.assign(new Error("syntax error at or near"), { code: "42601" })
        : null
    );

    await expect(executeSqlFile(exec, PERFORMANCE_SQL)).rejects.toThrow("syntax error");
  });
});
