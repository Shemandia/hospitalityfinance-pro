/**
 * A job whose tenant is under maintenance is postponed, not failed
 * (WP-2 item 3). Transfer Desk jobs have one attempt, so failing them would
 * lose the import; createWorker puts the job back, delayed, instead.
 *
 * Needs REDIS_URL.
 */
import { afterAll, describe, expect, it } from "vitest";
import type { Queue, Worker } from "bullmq";
import { createQueue, createWorker, MAINTENANCE_DELAY_MS } from "../../src/jobs/queues.js";
import { TenantMaintenanceError } from "../../src/db/schema-version.js";

if (!process.env.REDIS_URL) {
  describe("worker and tenant maintenance", () => {
    it("requires REDIS_URL", () => expect(process.env.REDIS_URL).toBeDefined());
  });
} else {
  describe("worker and tenant maintenance", () => {
    const name = `it-maintenance-${Date.now().toString(36)}`;
    let queue: Queue;
    let worker: Worker;

    afterAll(async () => {
      await worker?.close();
      await queue?.obliterate({ force: true }).catch(() => undefined);
      await queue?.close();
    });

    it("puts the job back, delayed, without using its single attempt", async () => {
      queue = createQueue(name);
      worker = createWorker<unknown, unknown>(name, async (): Promise<unknown> => {
        throw new TenantMaintenanceError("acme");
      });
      const job = await queue.add("import", { tenant: "acme" }, { attempts: 1 });
      const started = Date.now();
      let state = "";
      for (let i = 0; i < 50 && state !== "delayed"; i++) {
        await new Promise((r) => setTimeout(r, 100));
        state = await job.getState();
      }
      expect(state).toBe("delayed");
      const fresh = await queue.getJob(job.id!);
      expect(fresh?.attemptsMade).toBe(0);
      expect(fresh?.failedReason ?? "").toBe("");
      expect((fresh?.timestamp ?? 0) + (fresh?.delay ?? 0)).toBeGreaterThanOrEqual(
        started + MAINTENANCE_DELAY_MS - 1_000
      );
    }, 20_000);
  });
}
