/**
 * Worker Process Supervisor
 *
 * Runs every background worker as a child process and restarts it on a crash.
 * Run as: node dist/jobs/worker-supervisor.js (pnpm workers:prod), or
 * pnpm workers in development.
 *
 * - Restart with exponential backoff (1s → 2s → 4s → max 30s); the backoff
 *   resets after 60s of stable running.
 * - A worker that exits cleanly WORKER_MAX_CLEAN_EXITS times in a row (default
 *   3) is not restarted again. The supervisor then stops every worker and exits
 *   with code 1, so the service manager (systemd, Docker) reports the failure
 *   instead of the supervisor restarting a broken worker forever (OPS-10).
 * - Graceful shutdown on SIGTERM/SIGINT.
 */

import { createSupervisor, exponentialBackoff, workerEntryPoints } from "./supervisor.js";

const MAX_BACKOFF_MS = 30_000;
const STABLE_THRESHOLD_MS = 60_000;
const SHUTDOWN_GRACE_MS = 10_000;

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got "${raw}".`);
  }
  return value;
}

const workers = workerEntryPoints();
let exiting = false;

async function exit(code: number): Promise<void> {
  if (exiting) return;
  exiting = true;
  console.log("[supervisor] Shutting down all workers...");
  await supervisor.stop(SHUTDOWN_GRACE_MS);
  process.exit(code);
}

const supervisor = createSupervisor({
  workers,
  maxCleanExits: positiveInteger("WORKER_MAX_CLEAN_EXITS", 3),
  stableMs: STABLE_THRESHOLD_MS,
  backoffMs: exponentialBackoff(MAX_BACKOFF_MS),
  onFailure: () => void exit(1)
});

process.on("SIGTERM", () => void exit(0));
process.on("SIGINT", () => void exit(0));

console.log(
  `[supervisor] Starting ${workers.length} workers: ${workers.map((w) => w.name).join(", ")}`
);
supervisor.start();
