/**
 * Worker supervision (OPS-10).
 *
 * The supervisor runs each background worker as its own child process and
 * restarts it when it stops. A worker is a long-running process: it never has
 * a reason to exit on its own. So:
 *
 *   - A crash (non-zero exit or a signal) is restarted with exponential
 *     backoff, which resets once a run has lasted `stableMs`.
 *   - A clean exit (code 0) is a fault too: the script ran to its end without
 *     starting anything that keeps it alive. After `maxCleanExits` clean exits
 *     in a row the supervisor stops restarting that worker and reports the
 *     failure, instead of restarting it forever.
 *
 * worker-supervisor.ts is the process entry point; this module holds the
 * logic and the list of entry points so tests can use both.
 */

import { fork, type ChildProcess } from "node:child_process";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);

export type WorkerEntryPoint = { name: string; script: string };

/**
 * The supervisor's workers. Each script is a process entry point: it starts
 * its BullMQ worker(s) when run and stays running until it is signalled.
 *
 * The extension follows this file's own, so the list names the compiled .js
 * files under dist and the .ts sources when run with tsx.
 */
export function workerEntryPoints(): WorkerEntryPoint[] {
  const dir = dirname(here);
  const ext = extname(here);
  return [
    { name: "report-generation", script: resolve(dir, `report-generation-worker${ext}`) },
    { name: "dunning", script: resolve(dir, `dunning-worker${ext}`) },
    { name: "scheduled-reports", script: resolve(dir, `scheduled-reports-worker${ext}`) },
    { name: "transfer-desk", script: resolve(dir, `transfer-desk-runner${ext}`) }
  ];
}

export type SupervisorOptions = {
  workers: WorkerEntryPoint[];
  /** Clean exits in a row after which a worker is given up on. */
  maxCleanExits: number;
  /** A run at least this long resets the backoff and the clean-exit count. */
  stableMs: number;
  /** Delay before restart attempt n (1-based). */
  backoffMs: (attempt: number) => number;
  /** Called once when a worker has been given up on. */
  onFailure: (worker: WorkerEntryPoint, reason: string) => void;
  start?: (script: string) => ChildProcess;
  log?: Pick<Console, "log" | "error">;
};

export type WorkerState = {
  entry: WorkerEntryPoint;
  process: ChildProcess | null;
  starts: number;
  restartAttempt: number;
  cleanExitsInARow: number;
  failed: boolean;
  lastStartTime: number;
};

export function exponentialBackoff(maxMs: number): (attempt: number) => number {
  return (attempt) => Math.min(1000 * 2 ** attempt, maxMs);
}

export function createSupervisor(options: SupervisorOptions) {
  const log = options.log ?? console;
  const start =
    options.start ??
    ((script: string) => fork(script, [], { stdio: "inherit", env: { ...process.env } }));
  const states: WorkerState[] = options.workers.map((entry) => ({
    entry,
    process: null,
    starts: 0,
    restartAttempt: 0,
    cleanExitsInARow: 0,
    failed: false,
    lastStartTime: 0
  }));
  const timers = new Set<NodeJS.Timeout>();
  let stopping = false;

  function launch(state: WorkerState): void {
    if (stopping || state.failed) return;
    state.lastStartTime = Date.now();
    state.starts++;
    log.log(`[supervisor] Starting worker: ${state.entry.name}`);
    const child = start(state.entry.script);
    state.process = child;

    child.on("error", (err) => {
      log.error(`[supervisor] Worker "${state.entry.name}" error: ${err.message}`);
    });

    child.on("exit", (code, signal) => {
      state.process = null;
      if (stopping) return;

      if (Date.now() - state.lastStartTime >= options.stableMs) {
        state.restartAttempt = 0;
        state.cleanExitsInARow = 0;
      }

      if (code === 0 && signal === null) {
        state.cleanExitsInARow++;
        if (state.cleanExitsInARow >= options.maxCleanExits) {
          state.failed = true;
          const reason =
            `exited cleanly ${state.cleanExitsInARow} times in a row. A worker must keep ` +
            `running; its entry point starts nothing that does. Not restarting it.`;
          log.error(`[supervisor] FAILED: worker "${state.entry.name}" ${reason}`);
          options.onFailure(state.entry, reason);
          return;
        }
      } else {
        state.cleanExitsInARow = 0;
      }

      state.restartAttempt++;
      const delay = options.backoffMs(state.restartAttempt);
      log.error(
        `[supervisor] Worker "${state.entry.name}" exited (code=${code}, signal=${signal}). ` +
          `Restarting in ${delay}ms (attempt #${state.restartAttempt})...`
      );
      const timer = setTimeout(() => {
        timers.delete(timer);
        launch(state);
      }, delay);
      timers.add(timer);
    });
  }

  return {
    states,
    start(): void {
      for (const state of states) launch(state);
    },
    /** Signals every running worker and resolves when all have exited or `graceMs` passed. */
    async stop(graceMs: number): Promise<void> {
      stopping = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      const running = states
        .map((s) => s.process)
        .filter((p): p is ChildProcess => p !== null && p.exitCode === null);
      const exited = running.map(
        (p) => new Promise<void>((resolveExit) => p.once("exit", () => resolveExit()))
      );
      for (const p of running) p.kill("SIGTERM");
      let graceTimer: NodeJS.Timeout | undefined;
      const grace = new Promise<"timeout">((resolveGrace) => {
        graceTimer = setTimeout(() => resolveGrace("timeout"), graceMs);
      });
      const outcome = await Promise.race([Promise.all(exited), grace]);
      clearTimeout(graceTimer);
      if (outcome === "timeout") {
        for (const p of running) {
          if (p.exitCode === null) {
            log.log(`[supervisor] Force-killing pid ${p.pid}`);
            p.kill("SIGKILL");
          }
        }
      }
    }
  };
}
