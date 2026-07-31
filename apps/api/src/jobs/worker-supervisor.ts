/**
 * Worker Process Supervisor
 *
 * Manages all background worker processes with automatic restart on crash.
 * Run as: node dist/jobs/worker-supervisor.js
 *
 * Features:
 * - Automatic restart with exponential backoff (1s → 2s → 4s → max 30s)
 * - Backoff resets after 60s of stable running
 * - Graceful shutdown on SIGTERM/SIGINT
 * - Health logging
 */

import { fork, type ChildProcess } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface WorkerConfig {
  name: string;
  script: string;
  enabled: boolean;
}

const WORKERS: WorkerConfig[] = [
  {
    name: "report-generation",
    script: resolve(__dirname, "report-generation-worker.js"),
    enabled: true
  },
  {
    name: "dunning",
    script: resolve(__dirname, "dunning-worker.js"),
    enabled: true
  },
  {
    name: "scheduled-reports",
    script: resolve(__dirname, "scheduled-reports-worker.js"),
    enabled: true
  },
  {
    name: "transfer-desk",
    script: resolve(__dirname, "transfer-desk-worker.js"),
    enabled: true
  }
];

interface ManagedWorker {
  config: WorkerConfig;
  process: ChildProcess | null;
  restartCount: number;
  lastStartTime: number;
}

const MAX_BACKOFF_MS = 30_000;
const STABLE_THRESHOLD_MS = 60_000;

const managed: ManagedWorker[] = [];
let shuttingDown = false;

function getBackoffMs(restartCount: number): number {
  return Math.min(1000 * Math.pow(2, restartCount), MAX_BACKOFF_MS);
}

function startWorker(worker: ManagedWorker): void {
  if (shuttingDown) return;

  const now = Date.now();
  // Reset backoff if last run was stable (ran for > 60s)
  if (worker.lastStartTime > 0 && now - worker.lastStartTime > STABLE_THRESHOLD_MS) {
    worker.restartCount = 0;
  }

  worker.lastStartTime = now;

  console.log(`[supervisor] Starting worker: ${worker.config.name}`);
  const child = fork(worker.config.script, [], {
    stdio: "inherit",
    env: { ...process.env }
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    worker.restartCount++;
    const delay = getBackoffMs(worker.restartCount);
    console.error(
      `[supervisor] Worker "${worker.config.name}" exited (code=${code}, signal=${signal}). ` +
        `Restarting in ${delay}ms (attempt #${worker.restartCount})...`
    );

    setTimeout(() => startWorker(worker), delay);
  });

  child.on("error", (err) => {
    console.error(`[supervisor] Worker "${worker.config.name}" error:`, err.message);
  });

  worker.process = child;
}

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[supervisor] Shutting down all workers...");

  for (const worker of managed) {
    if (worker.process && !worker.process.killed) {
      worker.process.kill("SIGTERM");
    }
  }

  // Force kill after 10s
  setTimeout(() => {
    for (const worker of managed) {
      if (worker.process && !worker.process.killed) {
        console.log(`[supervisor] Force-killing ${worker.config.name}`);
        worker.process.kill("SIGKILL");
      }
    }
    process.exit(0);
  }, 10_000);
}

// ── Main ────────────────────────────────────────────────────────────────────

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const enabledWorkers = WORKERS.filter((w) => w.enabled);
console.log(
  `[supervisor] Starting ${enabledWorkers.length} workers: ${enabledWorkers.map((w) => w.name).join(", ")}`
);

for (const config of enabledWorkers) {
  const worker: ManagedWorker = {
    config,
    process: null,
    restartCount: 0,
    lastStartTime: 0
  };
  managed.push(worker);
  startWorker(worker);
}
