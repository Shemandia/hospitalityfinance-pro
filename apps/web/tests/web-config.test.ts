/** The web server's configuration (HC-30). */
import { describe, expect, it } from "vitest";
import { startupProblems, webConfig, WebConfigError } from "../lib/server/config";

const base = { NODE_ENV: "production", API_INTERNAL_URL: "http://127.0.0.1:4500" } as const;

describe("web config", () => {
  it("starts with only API_INTERNAL_URL set", () => {
    expect(startupProblems({ ...base })).toEqual([]);
  });

  it("names API_INTERNAL_URL when it is missing or empty", () => {
    expect(startupProblems({ NODE_ENV: "production" })).toEqual(["API_INTERNAL_URL is required"]);
    expect(startupProblems({ ...base, API_INTERNAL_URL: " " })).toEqual([
      "API_INTERNAL_URL is required"
    ]);
  });

  it("rejects an API_INTERNAL_URL that is not a URL", () => {
    expect(startupProblems({ ...base, API_INTERNAL_URL: "127.0.0.1:4500" })).toEqual([
      "API_INTERNAL_URL: Invalid url"
    ]);
    expect(() => webConfig({ ...base, API_INTERNAL_URL: "nope" })).toThrow(WebConfigError);
  });

  it("requires both halves of the platform operator account, or neither", () => {
    expect(startupProblems({ ...base, PLATFORM_ADMIN_USERNAME: "admin" })).toEqual([
      "PLATFORM_ADMIN_USERNAME and PLATFORM_ADMIN_PASSWORD_HASH are set together"
    ]);
    expect(
      startupProblems({
        ...base,
        PLATFORM_ADMIN_USERNAME: "admin",
        PLATFORM_ADMIN_PASSWORD_HASH: "scrypt:aa:bb"
      })
    ).toEqual([]);
  });

  it("defaults NODE_ENV to development and ignores settings it does not know", () => {
    const cfg = webConfig({
      API_INTERNAL_URL: base.API_INTERNAL_URL,
      NEXT_PUBLIC_API_BASE_URL: "x"
    });
    expect(cfg.NODE_ENV).toBe("development");
    expect(cfg).not.toHaveProperty("NEXT_PUBLIC_API_BASE_URL");
  });
});
