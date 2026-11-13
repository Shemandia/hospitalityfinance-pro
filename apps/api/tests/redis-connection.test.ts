/**
 * Every Redis connection comes from REDIS_URL, read in one place (HC-32).
 */

import { afterEach, describe, expect, it } from "vitest";
import { reloadConfig } from "../src/config.js";
import { redisConnectionOptions } from "../src/db/redis.js";

describe("redisConnectionOptions", () => {
  const saved = process.env.REDIS_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved;
    reloadConfig();
  });

  const optionsFor = (url: string) => {
    process.env.REDIS_URL = url;
    reloadConfig();
    return redisConnectionOptions();
  };

  it("reads host, port, user, password and database from the URL", () => {
    expect(optionsFor("redis://app:p%40ss@cache.internal:6380/3")).toMatchObject({
      host: "cache.internal",
      port: 6380,
      username: "app",
      password: "p@ss",
      db: 3
    });
  });

  it("uses TLS for rediss:// and the default port when none is given", () => {
    const options = optionsFor("rediss://:secret@cache.internal");
    expect(options).toMatchObject({ port: 6379, password: "secret", db: 0, tls: {} });
    expect(options.username).toBeUndefined();
  });

  it("refuses a missing REDIS_URL instead of falling back to a local Redis", () => {
    process.env.REDIS_URL = "";
    reloadConfig();
    expect(() => redisConnectionOptions()).toThrow(/REDIS_URL is required by Redis/);
  });
});
