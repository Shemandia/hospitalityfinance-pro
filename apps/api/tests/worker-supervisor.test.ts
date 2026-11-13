/**
 * The worker supervisor gives up on a worker that keeps exiting cleanly
 * (OPS-10), and keeps restarting one that crashes. Real child processes.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSupervisor,
  workerEntryPoints,
  type WorkerEntryPoint
} from "../src/jobs/supervisor.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/workers");
const entry = (name: string): WorkerEntryPoint => ({
  name,
  script: resolve(fixtures, `${name}.mjs`)
});
const quiet = { log: () => {}, error: () => {} };

function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  return new Promise((done, fail) => {
    const tick = () => {
      if (condition()) return done();
      if (Date.now() - started > timeoutMs) return fail(new Error("timed out"));
      setTimeout(tick, 20);
    };
    tick();
  });
}

describe("worker supervisor (OPS-10)", () => {
  let stop: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  function supervise(workers: WorkerEntryPoint[], onFailure = vi.fn()) {
    const supervisor = createSupervisor({
      workers,
      maxCleanExits: 3,
      stableMs: 60_000,
      backoffMs: () => 10,
      onFailure,
      log: quiet
    });
    stop = () => supervisor.stop(2_000);
    supervisor.start();
    return { supervisor, onFailure };
  }

  it("lists four entry points, each a file that exists", () => {
    const entries = workerEntryPoints();
    expect(entries.map((e) => e.name)).toEqual([
      "report-generation",
      "dunning",
      "scheduled-reports",
      "transfer-desk"
    ]);
    for (const e of entries) expect(existsSync(e.script), e.script).toBe(true);
  });

  it("stops restarting a worker that exits cleanly three times in a row, and reports it", async () => {
    const { supervisor, onFailure } = supervise([entry("exits-cleanly"), entry("stays-up")]);
    const [clean, up] = supervisor.states;

    await until(() => onFailure.mock.calls.length > 0);
    // Give a wrongly scheduled restart time to happen.
    await new Promise((r) => setTimeout(r, 200));

    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0].name).toBe("exits-cleanly");
    expect(onFailure.mock.calls[0][1]).toMatch(/exited cleanly 3 times in a row/);
    expect(clean.starts).toBe(3);
    expect(clean.failed).toBe(true);
    // The healthy worker is untouched.
    expect(up.starts).toBe(1);
    expect(up.process?.exitCode).toBeNull();
  });

  it("keeps restarting a worker that crashes, without reporting a clean-exit failure", async () => {
    const { supervisor, onFailure } = supervise([entry("crashes")]);
    const [crashing] = supervisor.states;

    await until(() => crashing.starts >= 5);

    expect(onFailure).not.toHaveBeenCalled();
    expect(crashing.failed).toBe(false);
  });

  it("stops every worker on shutdown and restarts none", async () => {
    const { supervisor } = supervise([entry("stays-up"), entry("stays-up")]);
    await until(() => supervisor.states.every((s) => s.process?.pid !== undefined));
    const children = supervisor.states.map((s) => s.process!);

    await supervisor.stop(2_000);
    await new Promise((r) => setTimeout(r, 100));

    for (const child of children) expect(child.exitCode ?? child.signalCode).not.toBeNull();
    expect(supervisor.states.map((s) => s.starts)).toEqual([1, 1]);
  });
});
