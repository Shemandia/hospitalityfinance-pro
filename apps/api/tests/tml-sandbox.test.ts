/** The insecure TML sandbox fallback: only with the flag, never in production. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { reloadConfig } from "../src/config.js";
import { insecureTmlSandboxAllowed } from "../src/shared/tml-sandbox.js";

function withEnv(env: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  reloadConfig();
  return insecureTmlSandboxAllowed();
}

afterEach(() => {
  vi.unstubAllEnvs();
  reloadConfig();
});

describe("insecureTmlSandboxAllowed", () => {
  it("is off unless TML_ALLOW_INSECURE_SANDBOX is set", () => {
    expect(withEnv({ TML_ALLOW_INSECURE_SANDBOX: "", NODE_ENV: "test" })).toBe(false);
    expect(withEnv({ TML_ALLOW_INSECURE_SANDBOX: "true", NODE_ENV: "test" })).toBe(true);
  });

  it("is off in production even with the flag set", () => {
    expect(
      withEnv({
        TML_ALLOW_INSECURE_SANDBOX: "true",
        NODE_ENV: "production",
        REGISTRY_DATABASE_URL: "postgresql://x@localhost/r"
      })
    ).toBe(false);
  });
});
