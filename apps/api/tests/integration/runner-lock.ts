import { RunnerBusyError } from "../../src/db/tenant-runner.js";

/**
 * Runs `fn` (a migration run, or an adoption, which ends with one), waiting
 * while another test file holds the runner's lock on the shared test
 * registry. CI runs the integration files in parallel, and
 * migration-runner.test.ts holds the lock on purpose to test the refusal.
 * Both operations are safe to repeat.
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
