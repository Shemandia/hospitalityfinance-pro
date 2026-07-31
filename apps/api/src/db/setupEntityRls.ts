import { join } from "node:path";
import { prisma } from "./prisma.js";
import { executeSqlFile } from "./sqlRunner.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Set it before running db:setup:rls.");
  }

  const sqlPath = join(process.cwd(), "src", "db", "sql", "entity-rls.sql");
  const { total, executed, skipped } = await executeSqlFile(prisma, sqlPath);
  console.log(`Entity RLS policies configured (${executed}/${total} statements).`);
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
