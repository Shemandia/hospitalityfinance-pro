import { describe, expect, it } from "vitest";
import { executeTransformation } from "../src/index.js";

const rules = [
  { type: "map" as const, target: "entityCode", sources: [{ path: "prop" }] },
  {
    type: "lookup" as const,
    table: "Revenue codes",
    column: "Account",
    source: "code",
    target: "accountCode"
  }
];

describe("lookup through a resolver", () => {
  it("writes the resolved value, with the record so far and the column asked for", () => {
    const seen: unknown[] = [];
    const result = executeTransformation({ rules }, [{ prop: "EZZ", code: "RM" }], null, {
      lookup: (request) => {
        seen.push(request);
        return "4000";
      }
    });
    expect(result.records[0]).toEqual({ entityCode: "EZZ", accountCode: "4000" });
    expect(seen).toEqual([
      {
        table: "Revenue codes",
        column: "Account",
        key: "RM",
        record: { prop: "EZZ", code: "RM", entityCode: "EZZ" }
      }
    ]);
  });

  it("leaves the target empty for null (an omitted value)", () => {
    const result = executeTransformation({ rules }, [{ prop: "EZZ", code: "X" }], null, {
      lookup: () => null
    });
    expect(result.records[0]).toEqual({ entityCode: "EZZ", accountCode: null });
    expect(result.errors).toEqual([]);
  });

  it("reports a value the table has no entry for as unmapped, keeping the rest of the record", () => {
    const result = executeTransformation({ rules }, [{ prop: "EZZ", code: "ZZ" }], null, {
      lookup: () => undefined
    });
    expect(result.failed).toBe(1);
    expect(result.records[0]).toEqual({ entityCode: "EZZ" });
    expect(result.errors[0]).toMatchObject({
      recordIndex: 0,
      ruleType: "lookup",
      unmapped: { table: "Revenue codes", key: "ZZ", target: "accountCode" }
    });
  });
});
