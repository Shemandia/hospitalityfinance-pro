/**
 * Restores a backup into a new database and checks it (src/db/tenant-backup.ts).
 *
 *   pnpm --filter @hfp/api db:restore <backup.dump.json> [--into <database>] [--keep]
 *
 * Checks the dump against its manifest (size, checksum), creates a new
 * database (default hfp_restore_<slug>_<time>), restores the dump into it as
 * the tenant's owner role, and compares every table's row count with the
 * manifest. The database is dropped afterwards unless --keep is given. A live
 * database is never written to; putting a restored copy in service is the
 * runbook's procedure (docs/GO-LIVE-RUNBOOK.md, section 3). Exits 1 on any
 * difference.
 *
 * Needs REGISTRY_DATABASE_URL, PLATFORM_ENCRYPTION_KEY and pg_restore.
 */
import { restoreBackup } from "../db/tenant-backup.js";

const args = process.argv.slice(2);
const manifest = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--into");
const intoIndex = args.indexOf("--into");
const into = intoIndex >= 0 ? args[intoIndex + 1] : undefined;

if (!manifest) {
  console.error("Usage: db:restore <backup.dump.json> [--into <database>] [--keep]");
  process.exit(2);
}

try {
  const result = await restoreBackup(manifest, {
    into,
    keep: args.includes("--keep"),
    log: (line) => console.log(line)
  });
  if (result.ok) {
    console.log(`\nRow counts match: ${result.tables} tables, ${result.rows} rows.`);
  } else {
    console.log(`\n${result.differences.length} tables differ from the manifest:`);
    for (const d of result.differences) {
      console.log(
        `  ${d.table}: expected ${d.expected ?? "(absent)"}, restored ${d.actual ?? "(absent)"}`
      );
    }
  }
  if (result.kept) console.log(`Kept ${result.database}; drop it when done.`);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
