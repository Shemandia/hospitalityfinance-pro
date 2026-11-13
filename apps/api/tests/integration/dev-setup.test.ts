/**
 * WP-A acceptance 7: on an empty server, the setup command followed by sign-in
 * reaches the dashboard with full admin permissions.
 *
 * Two databases that do not exist yet are named, `pnpm dev:setup` is run
 * against them as a separate process, exactly as a developer runs it, and then
 * the admin signs in through the real API with the password from
 * SEED_USER_PASSWORD. The access context the web app draws the dashboard from
 * must show the tenant set up (so no wizard) and every permission held
 * tenant-wide. The databases are dropped afterwards.
 *
 * Needs TEST_DATABASE_URL (its server and credentials are used; the role needs
 * CREATEDB) and REDIS_URL.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient as RegistryClient } from "../../src/db/registry-client.js";
import { SYSTEM_PERMISSIONS } from "../../src/modules/access/system-catalog.js";
import type { AccessContext } from "../../src/modules/access/context.js";

const setup = vi.hoisted(() => {
  const base = process.env.TEST_DATABASE_URL;
  const ready = Boolean(base && process.env.REDIS_URL);
  const run = Date.now().toString(36);
  const at = (name: string) => {
    const url = new URL(base ?? "postgresql://unset/unset");
    url.pathname = `/${name}`;
    return url.toString();
  };
  const env = {
    DATABASE_URL: at(`hfp_it_setup_t_${run}`),
    REGISTRY_DATABASE_URL: at(`hfp_it_setup_r_${run}`),
    SEED_USER_PASSWORD: `Accept7-${run}-Pw`,
    APP_BASE_URL: "http://web.test:3005"
  };
  if (ready) {
    // The app under test reads its registry and its tenant from these.
    process.env.DATABASE_URL = env.DATABASE_URL;
    process.env.REGISTRY_DATABASE_URL = env.REGISTRY_DATABASE_URL;
    process.env.JWT_SECRET ??= "dev-setup-test-secret-dev-setup-test-secret";
    process.env.PLATFORM_API_KEY ??= "dev-setup-test-platform-key";
  }
  return { ready, env, maintenance: at("postgres") };
});

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function runDevSetup(): Promise<{ code: number | null; output: string }> {
  return new Promise((done) => {
    const output: string[] = [];
    const child = spawn("pnpm", ["run", "dev:setup"], {
      cwd: apiRoot,
      env: { ...process.env, ...setup.env, NODE_ENV: "development" }
    });
    child.stdout.on("data", (d) => output.push(String(d)));
    child.stderr.on("data", (d) => output.push(String(d)));
    child.on("close", (code) => done({ code, output: output.join("") }));
  });
}

if (!setup.ready) {
  describe("dev:setup (WP-A acceptance 7)", () => {
    it("requires TEST_DATABASE_URL and REDIS_URL; run pnpm test:integration", () => {
      expect(setup.ready).toBe(true);
    });
  });
} else {
  describe("dev:setup (WP-A acceptance 7)", () => {
    let app: FastifyInstance;
    let result: { code: number | null; output: string };
    let tenantCode: string;
    let cookie = "";

    beforeAll(async () => {
      result = await runDevSetup();
      if (result.code !== 0) return;

      const registry = new RegistryClient({ datasourceUrl: setup.env.REGISTRY_DATABASE_URL });
      const tenant = await registry.tenant.findUniqueOrThrow({ where: { slug: "demo-hotels" } });
      await registry.$disconnect();
      tenantCode = tenant.tenantCode;

      const { createApp } = await import("../../src/app.js");
      app = await createApp();
    }, 300_000);

    afterAll(async () => {
      await app?.close();
      const { disconnectAllTenants } = await import("../../src/db/tenantPool.js");
      const { disconnectRegistry } = await import("../../src/db/tenantRegistry.js");
      await Promise.allSettled([disconnectAllTenants(), disconnectRegistry()]);

      const admin = new RegistryClient({ datasourceUrl: setup.maintenance });
      for (const url of [setup.env.DATABASE_URL, setup.env.REGISTRY_DATABASE_URL]) {
        const name = new URL(url).pathname.slice(1);
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      }
      await admin.$disconnect();
    }, 60_000);

    it("builds both databases from nothing and prints the sign-in address", () => {
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain(
        `Created database ${new URL(setup.env.DATABASE_URL).pathname.slice(1)}`
      );
      expect(result.output).toContain(`Sign in at  http://web.test:3005/t/${tenantCode}/login`);
    });

    it("the admin signs in with SEED_USER_PASSWORD, with no password change pending", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "admin@hfp.local",
          password: setup.env.SEED_USER_PASSWORD,
          tenantCode
        }
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.mustChangePassword).toBe(false);
      cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      expect(cookie).toContain("hfp_access_token=");
    });

    it("reaches the dashboard: setup complete, every permission tenant-wide, every property open", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/context",
        headers: { cookie }
      });
      expect(response.statusCode, response.body).toBe(200);
      const context = response.json().data as AccessContext;

      // The web app's SetupGuard draws the dashboard only when this is true.
      expect(context.setup.isCompleted).toBe(true);
      expect(context.tenantPermissions).toEqual(SYSTEM_PERMISSIONS.map((p) => p.code).sort());
      expect(context.entities.map((e) => e.code).sort()).toEqual(["DOH", "HFP", "JUM"]);
      for (const entity of context.entities) {
        expect(entity.permissions).toEqual(context.tenantPermissions);
      }
    });

    it("a wrong password is refused", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: "admin@hfp.local", password: "Wrong-Password-1", tenantCode }
      });
      expect(response.statusCode).toBe(401);
    });
  });
}
