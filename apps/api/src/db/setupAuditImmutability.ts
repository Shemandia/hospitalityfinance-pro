import { join } from "node:path";
import { PrismaClient } from "./client.js";

// A setup script works on the one database DATABASE_URL names, explicitly:
// the shared tenant-aware client has no default database.
const prisma = new PrismaClient({
  datasourceUrl: requireConfig(["DATABASE_URL"], "db:setup:audit").DATABASE_URL
});
import { executeSqlFile } from "./sqlRunner.js";
import { requireConfig } from "../config.js";

async function main() {
  const sqlPath = join(process.cwd(), "src", "db", "sql", "audit-events-immutable.sql");
  const { total, executed, skipped } = await executeSqlFile(prisma, sqlPath);
  console.log(`Audit immutability trigger configured (${executed}/${total} statements).`);
  if (skipped.length > 0) {
    console.warn(`${skipped.length} statement(s) skipped as already-applied or not applicable.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
