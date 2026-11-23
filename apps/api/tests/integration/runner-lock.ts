import { RunnerBusyError } from "../../src/db/tenant-runner.js";

/**
 * Runs `fn` (a migration run, or an adoption, which ends with one), waiting
 * while another test file holds the runner's lock on the shared test
 * registry. CI runs the integration files in parallel, and
 * migration-runner.test.ts holds the lock on purpose to test the refusal.
 * A migration run is refused before it changes anything; an adoption waits
 * for the lock itself at its last step, so it is refused here only before
 * it has adopted anything.
 */
export async function whenRunnerFree<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof RunnerBusyError) || attempt >= 60) throw error;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
