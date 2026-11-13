/**
 * The supervisor's entry points each stay running (OPS-10).
 *
 * Each of the four scripts the worker supervisor forks is started here as its
 * own process, the way the supervisor starts it, against a real registry
 * database, tenant database and Redis. Each must still be running after
 * several seconds: an entry point that only exports functions runs to its
 * end and exits 0, which is how the transfer-desk worker restarted every 30s.
 *
 * The transfer-desk process must also run a worker for each active tenant,
 * pick up a tenant added to the registry, and stop the worker of a tenant that
 * was deactivated.
 *
 * Needs TEST_REGISTRY_DATABASE_URL (a database with the registry schema),
 * TEST_DATABASE_URL and REDIS_URL.
 */

import { fork, type ChildProcess } from "node:child_process";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient as RegistryClient } from "../../src/db/registry-client.js";
import { workerEntryPoints } from "../../src/jobs/supervisor.js";
import {
  getTransferDeskQueueName,
  getTransferDeskRedisConnection
} from "../../src/jobs/transfer-desk-queue.js";

const registryUrl = process.env.TEST_REGISTRY_DATABASE_URL;
const tenantDbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const STAY_UP_MS = 8_000;

function until(condition: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((done, fail) => {
    const tick = async () => {
      try {
        if (await condition()) return done();
      } catch {
        // retry
      }
      if (Date.now() - started > timeoutMs) return fail(new Error("timed out"));
      setTimeout(tick, 200);
    };
    void tick();
  });
}

if (!registryUrl || !tenantDbUrl || !redisUrl) {
  describe("worker entry points (OPS-10)", () => {
    it("requires TEST_REGISTRY_DATABASE_URL, TEST_DATABASE_URL and REDIS_URL", () => {
      expect(Boolean(registryUrl && tenantDbUrl && redisUrl)).toBe(true);
    });
  });
} else {
  describe("worker entry points (OPS-10)", () => {
    const registry = new RegistryClient({ datasourceUrl: registryUrl });
    const run = Date.now().toString(36);
    const slugs = { first: `it-wk-a-${run}`, added: `it-wk-b-${run}` };
    const children = new Map<string, { child: ChildProcess; output: string[] }>();
    const queues: Queue[] = [];

    function workerCount(slug: string): Promise<number> {
      let queue = queues.find((q) => q.name === getTransferDeskQueueName(slug));
      if (!queue) {
        queue = new Queue(getTransferDeskQueueName(slug), {
          connection: getTransferDeskRedisConnection()
        });
        queues.push(queue);
      }
      return queue.getWorkers().then((w) => w.length);
    }

    async function addTenant(slug: string, code: string) {
      await registry.tenant.create({
        data: {
          slug,
          tenantCode: code,
          name: slug,
          databaseUrl: tenantDbUrl!,
          adminEmail: "workers@example.test",
          provisionedAt: new Date()
        }
      });
    }

    beforeAll(async () => {
      await addTenant(slugs.first, run.slice(-8).padStart(8, "a"));

      for (const entry of workerEntryPoints()) {
        const output: string[] = [];
        const child = fork(entry.script, [], {
          execArgv: ["--import", "tsx"],
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          env: {
            ...process.env,
            REGISTRY_DATABASE_URL: registryUrl,
            DATABASE_URL: tenantDbUrl,
            TRANSFER_DESK_TENANT_POLL_MS: "500"
          }
        });
        child.stdout?.on("data", (d) => output.push(String(d)));
        child.stderr?.on("data", (d) => output.push(String(d)));
        children.set(entry.name, { child, output });
      }
      await new Promise((r) => setTimeout(r, STAY_UP_MS));
    }, STAY_UP_MS + 20_000);

    afterAll(async () => {
      await Promise.all(
        [...children.values()].map(
          ({ child }) =>
            new Promise<void>((done) => {
              if (child.exitCode !== null || child.signalCode !== null) return done();
              const force = setTimeout(() => child.kill("SIGKILL"), 10_000);
              child.once("exit", () => {
                clearTimeout(force);
                done();
              });
              child.kill("SIGTERM");
            })
        )
      );
      for (const queue of queues) {
        await queue.obliterate({ force: true }).catch(() => undefined);
        await queue.close();
      }
      await registry.tenant.deleteMany({ where: { slug: { in: Object.values(slugs) } } });
      await registry.$disconnect();
    }, 30_000);

    it.each(workerEntryPoints().map((e) => e.name))("%s is still running", (name) => {
      const { child, output } = children.get(name)!;
      expect(
        { exitCode: child.exitCode, signal: child.signalCode },
        `${name} stopped. Its output:\n${output.join("")}`
      ).toEqual({ exitCode: null, signal: null });
    });

    it("transfer-desk runs a worker for an active tenant", async () => {
      await until(async () => (await workerCount(slugs.first)) === 1, 10_000);
    }, 15_000);

    it("transfer-desk picks up a tenant added to the registry", async () => {
      await addTenant(slugs.added, (run.slice(-7) + "b").padStart(8, "b"));
      await until(async () => (await workerCount(slugs.added)) === 1, 10_000);
    }, 15_000);

    it("transfer-desk stops the worker of a deactivated tenant", async () => {
      await registry.tenant.update({ where: { slug: slugs.first }, data: { isActive: false } });
      await until(async () => (await workerCount(slugs.first)) === 0, 10_000);
      expect(await workerCount(slugs.added)).toBe(1);
    }, 15_000);
  });
}
