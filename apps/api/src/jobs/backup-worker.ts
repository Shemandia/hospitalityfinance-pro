/**
 * Backup worker (WP-2 item 9, OPS-07).
 *
 * On BACKUP_SCHEDULE (cron, UTC) it backs up every tenant database and the
 * registry into BACKUP_DIR, then deletes backups older than
 * BACKUP_RETENTION_DAYS when that is set (src/db/tenant-backup.ts). A run in
 * which any database could not be backed up fails the job, so it shows as
 * failed in the queue and in the log; each failure is also a FAILED row in
 * database_backups.
 *
 * Without BACKUP_DIR (allowed outside production only) the worker removes the
 * schedule, says that backups are off, and stays idle; the supervisor would
 * otherwise restart it in a loop.
 */

import { createQueue, createWorker } from "./queues.js";
import { config } from "../config.js";
import { pruneBackups, runBackups } from "../db/tenant-backup.js";
import { moduleLogger } from "../shared/logger.js";

const log = moduleLogger("backup-worker");

export const BACKUP_QUEUE = "database-backups";

type BackupJob = { reason: "scheduled" };

const queue = createQueue<BackupJob>(BACKUP_QUEUE);

async function clearSchedule(): Promise<void> {
  for (const job of await queue.getRepeatableJobs()) {
    await queue.removeRepeatableByKey(job.key);
  }
}

async function start(): Promise<void> {
  const settings = config();
  await clearSchedule();
  if (!settings.BACKUP_DIR) {
    log.warn("Backups are off: BACKUP_DIR is not set. Backup worker started (idle).");
    setInterval(() => {}, 1 << 30);
    return;
  }

  const worker = createWorker<BackupJob>(
    BACKUP_QUEUE,
    async () => {
      const result = await runBackups({ log: (line) => log.info(line) });
      const failed = result.outcomes.filter((o) => o.status === "FAILED");
      if (failed.length > 0) {
        throw new Error(
          `Backup run ${result.runId}: ${failed.length} of ${result.outcomes.length} failed: ` +
            failed.map((o) => `${o.label} (${o.detail?.split("\n")[0]})`).join("; ")
        );
      }
      const pruned = await pruneBackups({ log: (line) => log.info(line) });
      return { runId: result.runId, backedUp: result.outcomes.length, pruned: pruned.length };
    },
    { concurrency: 1 }
  );
  worker.on("completed", (job, result) => log.info({ result }, `Backup job ${job.id} completed.`));
  worker.on("failed", (job, error) => log.error({ err: error }, `Backup job ${job?.id} failed`));

  await queue.add(
    "backup-scheduled",
    { reason: "scheduled" },
    {
      repeat: { pattern: settings.BACKUP_SCHEDULE, tz: "UTC" },
      attempts: 1,
      removeOnComplete: 50,
      removeOnFail: 100
    }
  );
  log.info(
    `Backup worker started; schedule ${settings.BACKUP_SCHEDULE} (UTC) into ${settings.BACKUP_DIR}.`
  );
}

start().catch((err) => {
  log.error({ err }, "The backup worker could not start");
  process.exit(1);
});
