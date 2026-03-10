import { join } from "node:path";
import { prisma } from "./prisma.js";
import { executeSqlFile } from "./sqlRunner.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Set it before running db:setup:audit."
    );
  }

  const sqlPath = join(
    process.cwd(),
    "src",
    "db",
    "sql",
    "audit-events-immutable.sql"
  );
  const statementCount = await executeSqlFile(prisma, sqlPath);
  console.log(`Audit immutability trigger configured (${statementCount} statements).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
