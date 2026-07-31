import { readFile } from "node:fs/promises";

type SqlExecutor = {
  $executeRawUnsafe(query: string): Promise<unknown>;
};

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      current += char;
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === "-" && next === "-") {
        current += "--";
        inLineComment = true;
        i += 1;
        continue;
      }

      if (char === "/" && next === "*") {
        current += "/*";
        inBlockComment = true;
        i += 1;
        continue;
      }

      if (char === "$") {
        const closingDollar = sql.indexOf("$", i + 1);
        if (closingDollar > i) {
          const candidate = sql.slice(i, closingDollar + 1);
          if (/^(\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$)$/.test(candidate)) {
            current += candidate;
            dollarTag = candidate;
            i = closingDollar;
            continue;
          }
        }
      }
    }

    if (char === "'" && !inDoubleQuote) {
      current += char;
      if (inSingleQuote && next === "'") {
        current += next;
        i += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      current += char;
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const final = current.trim();
  if (final.length > 0) {
    statements.push(final);
  }

  return statements;
}

/**
 * Postgres SQLSTATEs that mean "this statement had nothing to do", not
 * "something is broken":
 *   42P01 undefined_table    — relation referenced before it exists
 *   42P07 duplicate_table    — index/view/table already present
 * Matches the tolerance already applied in
 * modules/tenant/provisioning-service.ts when it runs these same files.
 */
const SKIPPABLE_SQLSTATES = new Set(["42P01", "42P07"]);

function isSkippable(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  const code = e?.code ?? e?.meta?.code ?? "";
  if (SKIPPABLE_SQLSTATES.has(code)) return true;
  // Prisma wraps driver errors inconsistently across versions; fall back to
  // the message when no SQLSTATE survived the wrapping.
  const msg = e?.message ?? "";
  return msg.includes("does not exist") || msg.includes("already exists");
}

export type SqlFileResult = {
  /** Statements parsed out of the file. */
  total: number;
  /** Statements that applied cleanly. */
  executed: number;
  /** Statements skipped as already-applied or not-yet-applicable. */
  skipped: string[];
};

/**
 * Execute every statement in a SQL file, continuing past statements that are
 * merely redundant or not yet applicable.
 *
 * Deliberately NOT all-or-nothing: these files end with the
 * mv_period_account_balances materialized view that all KPI, balance-sheet and
 * cash-flow reporting reads from. A single failing index statement earlier in
 * the file must never again prevent the view from being created — that failure
 * mode is what made every KPI endpoint return 500. Genuine errors still throw.
 */
export async function executeSqlFile(
  prisma: SqlExecutor,
  sqlFilePath: string
): Promise<SqlFileResult> {
  const sql = await readFile(sqlFilePath, "utf-8");
  const statements = splitSqlStatements(sql);
  const skipped: string[] = [];
  let executed = 0;

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
      executed += 1;
    } catch (err) {
      if (!isSkippable(err)) throw err;
      // Strip leading comments: splitSqlStatements keeps the comment block that
      // precedes a statement, which would otherwise fill the whole preview.
      const preview = statement.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim().slice(0, 120);
      skipped.push(preview);
      console.warn(`[sqlRunner] skipped statement in ${sqlFilePath}: ${preview}`);
    }
  }

  return { total: statements.length, executed, skipped };
}
