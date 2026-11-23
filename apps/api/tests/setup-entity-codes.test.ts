import { describe, expect, it } from "vitest";
import { stepSchemas } from "../src/modules/setup/types.js";

const property = (code: string) => ({
  name: `Hotel ${code}`,
  code,
  countryCode: "TZ",
  currency: "TZS",
  timezone: "Africa/Dar_es_Salaam"
});
const step1 = (corporate: string, ...properties: string[]) => ({
  corporate: {
    name: "Group",
    code: corporate,
    countryCode: "TZ",
    functionalCurrency: "TZS",
    reportingCurrency: "USD",
    timezone: "Africa/Dar_es_Salaam"
  },
  properties: properties.map(property)
});

describe("setup step 1: entity codes are unique in the tenant", () => {
  it("accepts distinct codes", () => {
    expect(stepSchemas[1]!.safeParse(step1("GRP", "EZZ", "DOH")).success).toBe(true);
  });

  it("refuses a property with the company's code", () => {
    const result = stepSchemas[1]!.safeParse(step1("EZZ", "EZZ"));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["properties", 0, "code"],
      message: expect.stringContaining("the company")
    });
  });

  it("refuses two properties with one code, ignoring surrounding spaces", () => {
    const result = stepSchemas[1]!.safeParse(step1("GRP", "EZZ", " EZZ "));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["properties", 1, "code"] });
  });
});
