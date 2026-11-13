/**
 * The configuration module (WP-1, HC-33).
 *
 * WP-1 acceptance: starting the API with a required variable missing exits
 * with a message naming it.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, config, reloadConfig, requireConfig } from "../src/config.js";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Starts src/index.ts with these variables; empty means unset (and blocks apps/api/.env). */
function startApi(env: Record<string, string>): Promise<{ code: number | null; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: apiRoot,
      env: { ...process.env, ...env }
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d)));
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ code, stderr });
    });
  });
}

describe("config", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    reloadConfig();
  });

  it("applies defaults and types", () => {
    process.env.TENANT_POOL_MAX = "";
    process.env.COOKIE_SECURE = "true";
    process.env.JWT_ACCESS_EXPIRY = "60";
    const cfg = reloadConfig();
    expect(cfg.TENANT_POOL_MAX).toBe(50);
    expect(cfg.COOKIE_SECURE).toBe(true);
    expect(cfg.JWT_ACCESS_EXPIRY).toBe(60);
  });

  it("treats an empty value as unset", () => {
    process.env.SEED_USER_PASSWORD = "";
    expect(reloadConfig().SEED_USER_PASSWORD).toBeUndefined();
  });

  it("names every invalid setting", () => {
    process.env.PORT = "eighty";
    process.env.COOKIE_SECURE = "yes";
    expect(() => reloadConfig()).toThrow(ConfigError);
    try {
      reloadConfig();
    } catch (error) {
      const problems = (error as ConfigError).problems.join("\n");
      expect(problems).toMatch(/^PORT:/m);
      expect(problems).toMatch(/^COOKIE_SECURE:/m);
    }
  });

  it("requireConfig names what is missing and who needs it", () => {
    process.env.TD_S3_BUCKET = "";
    reloadConfig();
    expect(() => requireConfig(["TD_S3_BUCKET"], "S3 storage")).toThrow(
      /TD_S3_BUCKET is required by S3 storage/
    );
  });

  it("requireConfig picks up a value set after the first read", () => {
    process.env.TD_S3_BUCKET = "";
    reloadConfig();
    process.env.TD_S3_BUCKET = "late-bucket";
    expect(requireConfig(["TD_S3_BUCKET"], "S3 storage").TD_S3_BUCKET).toBe("late-bucket");
    expect(config().TD_S3_BUCKET).toBe("late-bucket");
  });

  it("starting the API without JWT_SECRET exits with a message naming it (WP-1 acceptance)", async () => {
    const result = await startApi({ JWT_SECRET: "" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("JWT_SECRET is required");
  }, 30_000);

  it("starting the API with an invalid setting exits naming it", async () => {
    const result = await startApi({ PORT: "eighty" });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/PORT: /);
  }, 30_000);

  it("in production, also requires the registry", async () => {
    const result = await startApi({
      NODE_ENV: "production",
      REGISTRY_DATABASE_URL: "",
      JWT_SECRET: "a-production-secret-of-at-least-thirty-two-chars",
      PLATFORM_API_KEY: "k",
      REDIS_URL: "redis://redis.invalid:6379",
      APP_BASE_URL: "https://app.example.test"
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("REGISTRY_DATABASE_URL is required in production");
  }, 30_000);
});
