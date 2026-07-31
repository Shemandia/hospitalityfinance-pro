import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { hashPassword, verifyPlatformCredentials } from "../lib/platform-auth";

const ENV_USER = "PLATFORM_ADMIN_USERNAME";
const ENV_HASH = "PLATFORM_ADMIN_PASSWORD_HASH";

// Synthetic fixtures only — never real credentials.
const USERNAME = "test-admin";
const PASSWORD = "correct horse battery staple";

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv[ENV_USER] = process.env[ENV_USER];
  savedEnv[ENV_HASH] = process.env[ENV_HASH];
  process.env[ENV_USER] = USERNAME;
  process.env[ENV_HASH] = hashPassword(PASSWORD);
});

afterEach(() => {
  for (const key of [ENV_USER, ENV_HASH]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("hashPassword", () => {
  it("produces a scrypt:<salt>:<hash> string that verifies", () => {
    const hash = hashPassword(PASSWORD);
    expect(hash).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
  });

  it("uses a random salt (two hashes of the same password differ)", () => {
    expect(hashPassword(PASSWORD)).not.toBe(hashPassword(PASSWORD));
  });
});

describe("verifyPlatformCredentials", () => {
  it("accepts the configured username and password", () => {
    expect(verifyPlatformCredentials(USERNAME, PASSWORD)).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(verifyPlatformCredentials(USERNAME, "wrong-password")).toBe(false);
  });

  it("rejects a wrong username even with the right password", () => {
    expect(verifyPlatformCredentials("someone-else", PASSWORD)).toBe(false);
  });

  it("fails closed when the username env var is missing", () => {
    delete process.env[ENV_USER];
    expect(verifyPlatformCredentials(USERNAME, PASSWORD)).toBe(false);
  });

  it("fails closed when the hash env var is missing", () => {
    delete process.env[ENV_HASH];
    expect(verifyPlatformCredentials(USERNAME, PASSWORD)).toBe(false);
  });

  it("fails closed on a malformed hash", () => {
    process.env[ENV_HASH] = "not-a-valid-hash";
    expect(verifyPlatformCredentials(USERNAME, PASSWORD)).toBe(false);
  });

  it("rejects empty credentials", () => {
    expect(verifyPlatformCredentials("", "")).toBe(false);
  });
});
