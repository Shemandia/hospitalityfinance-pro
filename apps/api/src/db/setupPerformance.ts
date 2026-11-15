import { join } from "node:path";
import { PrismaClient } from "./client.js";

// A setup script works on the one database DATABASE_URL names, explicitly:
// the shared tenant-aware client has no default database.
const prisma = new PrismaClient({
  datasourceUrl: requireConfig(["DATABASE_URL"], "db:setup:performance").DATABASE_URL
});
import { executeSqlFile } from "./sqlRunner.js";
import { requireConfig } from "../config.js";

async function main() {
  const sqlPath = join(process.cwd(), "src", "db", "sql", "performance.sql");
  const { total, executed, skipped } = await executeSqlFile(prisma, sqlPath);
  console.log(
    `Performance indexes and materialized view applied (${executed}/${total} statements).`
  );
  if (skipped.length > 0) {
    console.warn(`${skipped.length} statement(s) skipped as already-applied or not applicable.`);
  }

  // The materialized view is the reason this file exists — every KPI, balance
  // sheet and cash flow query reads it. Fail loudly if it is not there.
  const [{ exists }] = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_matviews WHERE matviewname = 'mv_period_account_balances'
    ) AS exists
  `;
  if (!exists) {
    throw new Error(
      "mv_period_account_balances was not created — KPI, balance sheet and cash flow endpoints will return 500."
    );
  }
  console.log("Verified: mv_period_account_balances exists.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
