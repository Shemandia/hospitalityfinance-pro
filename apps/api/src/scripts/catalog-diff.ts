/**
 * Compares the structure and security of two databases (src/db/catalog.ts).
 *
 *   pnpm --filter @hfp/api db:catalog-diff <expected-url> <actual-url>
 *
 * Prints every line the second database lacks (-) or has in addition (+), and
 * exits 1 when they differ.
 */
import { PrismaClient } from "../db/client.js";
import { catalogLines, diffCatalogs } from "../db/catalog.js";

async function lines(url: string): Promise<string[]> {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    return await catalogLines((sql) => client.$queryRawUnsafe(sql));
  } finally {
    await client.$disconnect();
  }
}

const [expectedUrl, actualUrl] = process.argv.slice(2);
if (!expectedUrl || !actualUrl) {
  console.error("Usage: db:catalog-diff <expected-database-url> <actual-database-url>");
  process.exit(2);
}

const [expected, actual] = await Promise.all([lines(expectedUrl), lines(actualUrl)]);
const { missing, extra } = diffCatalogs(expected, actual);
for (const line of missing) console.log(`- ${line}`);
for (const line of extra) console.log(`+ ${line}`);
console.log(
  missing.length + extra.length === 0
    ? `Same structure and security (${expected.length} lines).`
    : `${missing.length} missing, ${extra.length} extra (of ${expected.length} expected lines).`
);
process.exit(missing.length + extra.length === 0 ? 0 : 1);
