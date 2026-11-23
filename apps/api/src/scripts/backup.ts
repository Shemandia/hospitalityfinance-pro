/**
 * Backs up every tenant database and the registry (src/db/tenant-backup.ts).
 *
 *   pnpm --filter @hfp/api db:backup [--tenant <slug>]... [--no-registry] [--prune]
 *
 * Writes under BACKUP_DIR and records each backup in the registry
 * (database_backups). --prune then deletes backups older than
 * BACKUP_RETENTION_DAYS (never the newest of a database). Exits 1 when any
 * database could not be backed up. The backup worker runs the same on
 * BACKUP_SCHEDULE. docs/GO-LIVE-RUNBOOK.md, section 3.
 *
 * Needs REGISTRY_DATABASE_URL, PLATFORM_ENCRYPTION_KEY and BACKUP_DIR, and
 * pg_dump (PG_BIN_DIR) of the server's major version or newer.
 */
import { BackupBusyError, pruneBackups, runBackups } from "../db/tenant-backup.js";

const args = process.argv.slice(2);
const only: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--tenant" && args[i + 1]) only.push(args[++i]!);
}

try {
  const result = await runBackups({
    only: only.length > 0 ? only : undefined,
    registry: !args.includes("--no-registry"),
    log: (line) => console.log(line)
  });
  const failed = result.outcomes.filter((o) => o.status === "FAILED").length;
  console.log(
    `\n${result.outcomes.length - failed} backed up, ${failed} failed (run ${result.runId}).`
  );
  if (args.includes("--prune")) {
    const pruned = await pruneBackups({ log: (line) => console.log(line) });
    console.log(`${pruned.length} old backups deleted.`);
  }
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof BackupBusyError ? error.message : error);
  process.exit(1);
}
