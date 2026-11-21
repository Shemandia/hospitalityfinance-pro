import { describe, expect, it } from "vitest";
import { getSupportedTimezones } from "../lib/timezones";

describe("getSupportedTimezones", () => {
  it("offers UTC, which the forms start on", () => {
    const zones = getSupportedTimezones();
    expect(zones).toContain("UTC");
    expect(zones.filter((z) => z === "UTC")).toHaveLength(1);
    expect(zones).toContain("Africa/Dar_es_Salaam");
  });
});
