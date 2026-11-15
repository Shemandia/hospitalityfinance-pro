/** One page-size default and maximum for every list (HC-39). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { reloadConfig } from "../src/config.js";
import { pageFields, pageLimit, pageOffset } from "../src/shared/pagination.js";

afterEach(() => {
  vi.unstubAllEnvs();
  reloadConfig();
});

describe("pagination", () => {
  it("uses PAGE_SIZE_DEFAULT when no page size is asked for, and caps at PAGE_SIZE_MAX", () => {
    vi.stubEnv("PAGE_SIZE_DEFAULT", "25");
    vi.stubEnv("PAGE_SIZE_MAX", "40");
    reloadConfig();
    expect(pageLimit()).toBe(25);
    expect(pageLimit("")).toBe(25);
    expect(pageLimit("abc")).toBe(25);
    expect(pageLimit(0)).toBe(25);
    expect(pageLimit("10")).toBe(10);
    expect(pageLimit(41)).toBe(40);
  });

  it("never returns more than the maximum, even when the default is larger", () => {
    vi.stubEnv("PAGE_SIZE_DEFAULT", "100");
    vi.stubEnv("PAGE_SIZE_MAX", "50");
    reloadConfig();
    expect(pageLimit()).toBe(50);
  });

  it("reads offsets as whole numbers of at least 0", () => {
    expect(pageOffset()).toBe(0);
    expect(pageOffset("30")).toBe(30);
    expect(pageOffset(-1)).toBe(0);
    expect(pageOffset("1.5")).toBe(0);
  });

  it("query fields reject a malformed page size and clamp a large one", () => {
    reloadConfig();
    const query = z.object(pageFields);
    expect(query.parse({})).toEqual({ limit: 100, offset: 0 });
    expect(query.parse({ limit: "9999", offset: "5" })).toEqual({ limit: 500, offset: 5 });
    expect(query.safeParse({ limit: "-3" }).success).toBe(false);
    expect(query.safeParse({ offset: "x" }).success).toBe(false);
  });
});
