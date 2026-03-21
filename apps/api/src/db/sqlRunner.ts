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

export async function executeSqlFile(prisma: SqlExecutor, sqlFilePath: string): Promise<number> {
  const sql = await readFile(sqlFilePath, "utf-8");
  const statements = splitSqlStatements(sql);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  return statements.length;
}
