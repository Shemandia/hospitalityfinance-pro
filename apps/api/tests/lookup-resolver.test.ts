import { describe, expect, it } from "vitest";
import {
  lookupTablesOf,
  resolveLookup,
  type LookupTableData
} from "../src/modules/integrations/lookup-resolver.js";

const v = (
  columnId: string,
  valueType: LookupTableData["rows"][number]["values"][number]["valueType"],
  valueParam: string | null = null,
  isDefault = false
) => ({
  columnId,
  valueType,
  valueParam,
  isDefault
});

const table: LookupTableData = {
  name: "Revenue codes",
  columns: [
    { id: "dept", name: "Department", columnOrder: 2 },
    { id: "acct", name: "Account", columnOrder: 1 }
  ],
  rows: [
    {
      businessUnit: "DOH",
      rangeFrom: "RM",
      rangeTo: "RM",
      rowOrder: 1,
      values: [v("acct", "MAP_TO", "4100")]
    },
    {
      businessUnit: null,
      rangeFrom: "RM",
      rangeTo: "RM",
      rowOrder: 2,
      values: [v("acct", "MAP_TO", "4000"), v("dept", "CONSTANT", "ROOMS")]
    },
    {
      businessUnit: null,
      rangeFrom: "100",
      rangeTo: "199",
      rowOrder: 3,
      values: [v("acct", "CONSTANT", "4200"), v("dept", "OMIT")]
    },
    {
      businessUnit: null,
      rangeFrom: "TAX",
      rangeTo: "TAX",
      rowOrder: 4,
      values: [v("acct", "COPY")]
    },
    {
      businessUnit: null,
      rangeFrom: "ADJ",
      rangeTo: "ADJ",
      rowOrder: 5,
      values: [v("acct", "REVERSE_SIGN")]
    },
    {
      businessUnit: null,
      rangeFrom: "~",
      rangeTo: "~",
      rowOrder: 6,
      values: [v("dept", "CONSTANT", "OTHER", true)]
    }
  ]
};

describe("resolveLookup", () => {
  it("takes the first row in order that covers the key and applies to the business unit", () => {
    expect(resolveLookup(table, { key: "RM", businessUnit: "DOH" })).toBe("4100");
    expect(resolveLookup(table, { key: "RM", businessUnit: "EZZ" })).toBe("4000");
    expect(resolveLookup(table, { key: "RM" })).toBe("4000");
  });

  it("reads the column asked for, the first column by default", () => {
    expect(resolveLookup(table, { key: "RM", column: "Department" })).toBe("ROOMS");
    expect(() => resolveLookup(table, { key: "RM", column: "Nope" })).toThrow(/no column "Nope"/);
  });

  it("covers numeric ranges numerically", () => {
    expect(resolveLookup(table, { key: "150" })).toBe("4200");
    expect(resolveLookup(table, { key: "99" })).toBeUndefined();
    expect(resolveLookup(table, { key: "1000" })).toBeUndefined();
  });

  it("applies the value types", () => {
    expect(resolveLookup(table, { key: "150", column: "Department" })).toBeNull();
    expect(resolveLookup(table, { key: "TAX" })).toBe("TAX");
    expect(resolveLookup(table, { key: "ADJ" })).toBe("-ADJ");
  });

  it("falls back to a default value of the column, else reports the key unmapped", () => {
    expect(resolveLookup(table, { key: "SPA", column: "Department" })).toBe("OTHER");
    expect(resolveLookup(table, { key: "SPA" })).toBeUndefined();
  });

  it("finds the tables a transformation uses, in conditional branches too", () => {
    expect(
      lookupTablesOf([
        { type: "lookup", table: "A", target: "x" },
        {
          type: "conditional",
          condition: { field: "f", operator: "==", value: 1 },
          then: [{ type: "lookup", table: "B", target: "y" }],
          else: [{ type: "lookup", table: "A", target: "z" }]
        }
      ])
    ).toEqual(["A", "B"]);
  });
});
