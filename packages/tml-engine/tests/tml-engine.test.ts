import { describe, expect, it, afterEach } from "vitest";
import {
  executeTransformation,
  createSandbox,
  BUILTIN_FUNCTIONS_SOURCE,
  type TmlDefinition,
  type TmlRecord,
  type Sandbox
} from "../src/index.js";

// Allow the (insecure) Node vm fallback on dev machines without isolated-vm
process.env.TML_ALLOW_INSECURE_SANDBOX ??= "true";

// ── Helpers ────────────────────────────────────────────────────────────────

let activeSandbox: Sandbox | null = null;

function sandbox(userFns: { name: string; params: string[]; body: string }[] = []): Sandbox {
  activeSandbox = createSandbox(userFns, BUILTIN_FUNCTIONS_SOURCE, { timeoutMs: 2000 });
  return activeSandbox;
}

afterEach(() => {
  activeSandbox?.dispose();
  activeSandbox = null;
});

// ── 1. Simple field mapping (rename fieldA → fieldB) ───────────────────────

describe("map rule", () => {
  it("renames a single field", () => {
    const def: TmlDefinition = {
      rules: [{ type: "map", target: "accountCode", sources: [{ path: "acctCode" }] }]
    };
    const records: TmlRecord[] = [{ acctCode: "4100", amount: 500 }];

    const result = executeTransformation(def, records);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.records[0]!.accountCode).toBe("4100");
  });

  it("concatenates multiple sources", () => {
    const def: TmlDefinition = {
      rules: [
        {
          type: "map",
          target: "fullName",
          sources: [{ path: "firstName", separator: " " }, { path: "lastName" }]
        }
      ]
    };
    const records: TmlRecord[] = [{ firstName: "Alice", lastName: "Smith" }];

    const result = executeTransformation(def, records);

    expect(result.records[0]!.fullName).toBe("Alice Smith");
  });

  it("sets null for missing source field", () => {
    const def: TmlDefinition = {
      rules: [{ type: "map", target: "out", sources: [{ path: "nonExistent" }] }]
    };
    const result = executeTransformation(def, [{ x: 1 }]);
    expect(result.records[0]!.out).toBeNull();
  });
});

// ── 2. Set constant value ──────────────────────────────────────────────────

describe("set rule", () => {
  it("sets a constant string", () => {
    const def: TmlDefinition = {
      rules: [{ type: "set", target: "currency", value: "TZS" }]
    };
    const result = executeTransformation(def, [{ amount: 100 }]);

    expect(result.records[0]!.currency).toBe("TZS");
  });

  it("sets a constant number", () => {
    const def: TmlDefinition = {
      rules: [{ type: "set", target: "version", value: 2 }]
    };
    const result = executeTransformation(def, [{}]);
    expect(result.records[0]!.version).toBe(2);
  });

  it("sets a constant boolean", () => {
    const def: TmlDefinition = {
      rules: [{ type: "set", target: "active", value: true }]
    };
    const result = executeTransformation(def, [{}]);
    expect(result.records[0]!.active).toBe(true);
  });
});

// ── 3. JavaScript transform expression ─────────────────────────────────────

describe("transform rule", () => {
  it("multiplies amount by 1000 via user function", () => {
    const sb = sandbox([{ name: "multiply", params: ["a", "b"], body: "return a * b;" }]);

    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "amount",
          function: {
            name: "multiply",
            params: [{ value: "amount", fromSource: true, type: "number" }, { value: 1000 }]
          }
        }
      ],
      functions: [{ name: "multiply", params: ["a", "b"], body: "return a * b;" }]
    };

    const result = executeTransformation(def, [{ amount: 385 }], sb);

    expect(result.succeeded).toBe(1);
    expect(result.records[0]!.amount).toBe(385000);
  });

  it("errors when no sandbox provided", () => {
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "x",
          function: { name: "identity", params: [{ value: "x", fromSource: true }] }
        }
      ]
    };
    const result = executeTransformation(def, [{ x: 1 }], null);

    expect(result.failed).toBe(1);
    expect(result.errors[0]!.message).toContain("sandbox");
  });
});

// ── 4. Lookup substitution ─────────────────────────────────────────────────

describe("lookup rule", () => {
  it("substitutes a value from a lookup table", () => {
    const def: TmlDefinition = {
      rules: [{ type: "lookup", table: "deptMap", target: "department", source: "deptCode" }]
    };

    const lookupTables = new Map([
      [
        "deptMap",
        new Map([
          ["D001", "Front Office"],
          ["D002", "Housekeeping"],
          ["D003", "F&B"]
        ])
      ]
    ]);

    const records: TmlRecord[] = [{ deptCode: "D001" }, { deptCode: "D003" }, { deptCode: "D002" }];

    const result = executeTransformation(def, records, null, { lookupTables });

    expect(result.succeeded).toBe(3);
    expect(result.records[0]!.department).toBe("Front Office");
    expect(result.records[1]!.department).toBe("F&B");
    expect(result.records[2]!.department).toBe("Housekeeping");
  });

  it("fails on unknown value with unknown=fail (default)", () => {
    const def: TmlDefinition = {
      rules: [{ type: "lookup", table: "map", target: "out", source: "code" }]
    };
    const lookupTables = new Map([["map", new Map([["A", "Alpha"]])]]);

    const result = executeTransformation(def, [{ code: "Z" }], null, { lookupTables });

    expect(result.failed).toBe(1);
    expect(result.errors[0]!.message).toContain("no entry");
  });

  it("copies through on unknown value with unknown=copy", () => {
    const def: TmlDefinition = {
      rules: [{ type: "lookup", table: "map", target: "out", source: "code", unknown: "copy" }]
    };
    const lookupTables = new Map([["map", new Map([["A", "Alpha"]])]]);

    const result = executeTransformation(def, [{ code: "Z" }], null, { lookupTables });

    expect(result.succeeded).toBe(1);
    expect(result.records[0]!.out).toBe("Z");
  });
});

// ── 5. Conditional: if journalType === "PV" then divideBy1000(amount) ──────

describe("conditional rule", () => {
  it("applies then-branch when condition matches", () => {
    const sb = sandbox();

    const def: TmlDefinition = {
      rules: [
        { type: "map", target: "amount", sources: [{ path: "amount" }] },
        { type: "map", target: "journalType", sources: [{ path: "journalType" }] },
        {
          type: "conditional",
          condition: { field: "journalType", operator: "==", value: "PV" },
          then: [
            {
              type: "transform",
              target: "amount",
              function: {
                name: "divideBy1000",
                params: [{ value: "amount", fromSource: true, type: "number" }]
              }
            }
          ],
          else: [{ type: "map", target: "amount", sources: [{ path: "amount" }] }]
        }
      ]
    };

    const pvRecord: TmlRecord = { journalType: "PV", amount: 385000 };
    const imRecord: TmlRecord = { journalType: "IM", amount: 500 };

    const result = executeTransformation(def, [pvRecord, imRecord], sb);

    expect(result.succeeded).toBe(2);
    expect(result.records[0]!.amount).toBe(385);
    expect(result.records[1]!.amount).toBe(500);
  });

  it("skips else-branch when not provided and condition fails", () => {
    const def: TmlDefinition = {
      rules: [
        {
          type: "conditional",
          condition: { field: "type", operator: "==", value: "X" },
          then: [{ type: "set", target: "flag", value: "matched" }]
          // no else
        }
      ]
    };

    const result = executeTransformation(def, [{ type: "Y" }]);

    expect(result.succeeded).toBe(1);
    expect(result.records[0]!.flag).toBeUndefined();
  });
});

// ── 6. Jana ÷1000 rule ────────────────────────────────────────────────────

describe("Jana ÷1000 rule", () => {
  it("purchasing vouchers use whole integers (no transformation needed)", () => {
    // PV amounts are already whole-integer TZS — just map them through
    const def: TmlDefinition = {
      rules: [
        { type: "map", target: "debit", sources: [{ path: "field4" }] },
        { type: "map", target: "credit", sources: [{ path: "field5" }] }
      ]
    };

    const records: TmlRecord[] = [
      { field4: 385000, field5: 0 },
      { field4: 0, field5: 385000 }
    ];

    const result = executeTransformation(def, records);

    expect(result.succeeded).toBe(2);
    expect(result.records[0]!.debit).toBe(385000);
    expect(result.records[0]!.credit).toBe(0);
    expect(result.records[1]!.debit).toBe(0);
    expect(result.records[1]!.credit).toBe(385000);
  });

  it("internal movements apply ÷1000 to convert implied decimals", () => {
    const sb = sandbox();

    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "debit",
          function: {
            name: "divideBy1000",
            params: [{ value: "field4", fromSource: true, type: "number" }]
          }
        },
        {
          type: "transform",
          target: "credit",
          function: {
            name: "divideBy1000",
            params: [{ value: "field5", fromSource: true, type: "number" }]
          }
        }
      ]
    };

    const records: TmlRecord[] = [
      { field4: 385000, field5: 0 },
      { field4: 0, field5: 250000 }
    ];

    const result = executeTransformation(def, records, sb);

    expect(result.succeeded).toBe(2);
    expect(result.records[0]!.debit).toBe(385);
    expect(result.records[0]!.credit).toBe(0);
    expect(result.records[1]!.debit).toBe(0);
    expect(result.records[1]!.credit).toBe(250);
  });

  it("multiplyBy1000 reverses the ÷1000 for export", () => {
    const sb = sandbox();

    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "field4",
          function: {
            name: "multiplyBy1000",
            params: [{ value: "debit", fromSource: true, type: "number" }]
          }
        }
      ]
    };

    const result = executeTransformation(def, [{ debit: 385 }], sb);

    expect(result.records[0]!.field4).toBe(385000);
  });
});

// ── 7. Sandbox timeout ─────────────────────────────────────────────────────

describe("sandbox timeout", () => {
  it("fails gracefully when JavaScript runs longer than timeout", () => {
    // Create a sandbox with a very short timeout
    const sb = createSandbox(
      [{ name: "infinite", params: [], body: "while(true){}" }],
      BUILTIN_FUNCTIONS_SOURCE,
      { timeoutMs: 100 }
    );

    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "result",
          function: { name: "infinite", params: [] }
        }
      ]
    };

    const result = executeTransformation(def, [{ x: 1 }], sb);

    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.ruleType).toBe("transform");
    // The error should indicate a timeout
    expect(result.errors[0]!.message).toMatch(/timed out|timeout|execution time/i);

    sb.dispose();
  });
});

// ── 8. Pre-built function library round-trips ──────────────────────────────

describe("pre-built function library", () => {
  it("formatDate converts YYYY-MM-DD to DD/MM/YYYY", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "displayDate",
          function: {
            name: "formatDate",
            params: [
              { value: "date", fromSource: true },
              { value: "YYYY-MM-DD" },
              { value: "DD/MM/YYYY" }
            ]
          }
        }
      ]
    };

    const result = executeTransformation(def, [{ date: "2026-04-01" }], sb);
    expect(result.records[0]!.displayDate).toBe("01/04/2026");
  });

  it("padLeft pads with zeros", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "code",
          function: {
            name: "padLeft",
            params: [{ value: "code", fromSource: true }, { value: 8 }, { value: "0" }]
          }
        }
      ]
    };

    const result = executeTransformation(def, [{ code: "4100" }], sb);
    expect(result.records[0]!.code).toBe("00004100");
  });

  it("padRight pads with spaces", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "name",
          function: {
            name: "padRight",
            params: [{ value: "name", fromSource: true }, { value: 10 }, { value: " " }]
          }
        }
      ]
    };

    const result = executeTransformation(def, [{ name: "Alice" }], sb);
    expect(result.records[0]!.name).toBe("Alice     ");
  });

  it("toUpperCase and toLowerCase", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "upper",
          function: {
            name: "toUpperCase",
            params: [{ value: "text", fromSource: true }]
          }
        },
        {
          type: "transform",
          target: "lower",
          function: {
            name: "toLowerCase",
            params: [{ value: "text", fromSource: true }]
          }
        }
      ]
    };

    const result = executeTransformation(def, [{ text: "Hello World" }], sb);
    expect(result.records[0]!.upper).toBe("HELLO WORLD");
    expect(result.records[0]!.lower).toBe("hello world");
  });

  it("currencyConvert multiplies and rounds to 2dp", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "usdAmount",
          function: {
            name: "currencyConvert",
            params: [{ value: "tzsAmount", fromSource: true, type: "number" }, { value: 0.00038 }]
          }
        }
      ]
    };

    const result = executeTransformation(def, [{ tzsAmount: 385000 }], sb);
    // 385000 * 0.00038 = 146.30
    expect(result.records[0]!.usdAmount).toBe(146.3);
  });

  it("divideBy1000 and multiplyBy1000 are inverse", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "divided",
          function: {
            name: "divideBy1000",
            params: [{ value: "raw", fromSource: true, type: "number" }]
          }
        },
        {
          type: "transform",
          target: "restored",
          function: {
            name: "multiplyBy1000",
            params: [{ value: "raw", fromSource: true, type: "number" }]
          }
        }
      ]
    };

    const result = executeTransformation(def, [{ raw: 500000 }], sb);
    expect(result.records[0]!.divided).toBe(500);
    expect(result.records[0]!.restored).toBe(500000000);
  });
});

// ── Multi-record batch ─────────────────────────────────────────────────────

describe("batch processing", () => {
  it("processes multiple records independently", () => {
    const def: TmlDefinition = {
      rules: [
        { type: "map", target: "account", sources: [{ path: "code" }] },
        { type: "set", target: "currency", value: "TZS" }
      ]
    };

    const records: TmlRecord[] = [{ code: "4100" }, { code: "4200" }, { code: "4300" }];

    const result = executeTransformation(def, records);

    expect(result.succeeded).toBe(3);
    expect(result.records).toHaveLength(3);
    expect(result.records[0]!.account).toBe("4100");
    expect(result.records[1]!.account).toBe("4200");
    expect(result.records[2]!.account).toBe("4300");
    expect(result.records.every((r) => r.currency === "TZS")).toBe(true);
  });

  it("captures errors per record without aborting the batch", () => {
    const lookupTables = new Map([["tbl", new Map([["A", "Alpha"]])]]);

    const def: TmlDefinition = {
      rules: [
        { type: "map", target: "code", sources: [{ path: "code" }] },
        { type: "lookup", table: "tbl", target: "name", source: "code" }
      ]
    };

    const records: TmlRecord[] = [
      { code: "A" }, // succeeds
      { code: "B" }, // fails lookup
      { code: "A" } // succeeds
    ];

    const result = executeTransformation(def, records, null, { lookupTables });

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.recordIndex).toBe(1);
    expect(result.errors[0]!.ruleType).toBe("lookup");
  });
});

// ── 9. New core built-in functions ────────────────────────────────────────────

describe("new core built-in functions", () => {
  it("trim removes whitespace", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: { name: "trim", params: [{ value: "val", fromSource: true }] }
        }
      ]
    };
    const result = executeTransformation(def, [{ val: "  hello  " }], sb);
    expect(result.records[0]!.out).toBe("hello");
  });

  it("numberFormat formats with decimals and separators", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "numberFormat",
            params: [
              { value: "amount", fromSource: true, type: "number" },
              { value: 2 },
              { value: "," },
              { value: "." }
            ]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ amount: 1234567.8 }], sb);
    expect(result.records[0]!.out).toBe("1,234,567.80");
  });

  it("numberFormat handles negative numbers", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "numberFormat",
            params: [
              { value: "amt", fromSource: true, type: "number" },
              { value: 2 },
              { value: "," },
              { value: "." }
            ]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ amt: -42500.5 }], sb);
    expect(result.records[0]!.out).toBe("-42,500.50");
  });

  it("substring extracts part of a string", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "substring",
            params: [{ value: "code", fromSource: true }, { value: 2 }, { value: 4 }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ code: "AB1234XY" }], sb);
    expect(result.records[0]!.out).toBe("1234");
  });

  it("replace does global string replacement", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "replace",
            params: [
              { value: "txt", fromSource: true },
              { value: "-" },
              { value: "/" },
              { value: 0 }
            ]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ txt: "2026-04-10" }], sb);
    expect(result.records[0]!.out).toBe("2026/04/10");
  });

  it("replace supports regex", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "replace",
            params: [
              { value: "txt", fromSource: true },
              { value: "\\d+" },
              { value: "X" },
              { value: 1 }
            ]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ txt: "abc123def456" }], sb);
    expect(result.records[0]!.out).toBe("abcXdefX");
  });

  it("lookupValue maps via JSON mapping", () => {
    const sb = sandbox();
    const mapping = JSON.stringify({ USD: "US Dollar", EUR: "Euro" });
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "lookupValue",
            params: [{ value: "curr", fromSource: true }, { value: mapping }, { value: "Unknown" }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ curr: "EUR" }, { curr: "GBP" }], sb);
    expect(result.records[0]!.out).toBe("Euro");
    expect(result.records[1]!.out).toBe("Unknown");
  });

  it("divide and multiply with 2dp rounding", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "divided",
          function: {
            name: "divide",
            params: [{ value: "amt", fromSource: true, type: "number" }, { value: 3 }]
          }
        },
        {
          type: "transform",
          target: "multiplied",
          function: {
            name: "multiply",
            params: [{ value: "amt", fromSource: true, type: "number" }, { value: 1.15 }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ amt: 100 }], sb);
    expect(result.records[0]!.divided).toBe(33.33);
    expect(result.records[0]!.multiplied).toBe(115);
  });

  it("defaultValue returns fallback for empty/null", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "a",
          function: {
            name: "defaultValue",
            params: [{ value: "x", fromSource: true }, { value: "N/A" }]
          }
        },
        {
          type: "transform",
          target: "b",
          function: {
            name: "defaultValue",
            params: [{ value: "y", fromSource: true }, { value: "N/A" }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ x: "", y: "hello" }], sb);
    expect(result.records[0]!.a).toBe("N/A");
    expect(result.records[0]!.b).toBe("hello");
  });

  it("concatFields joins values with separator", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "concatFields",
            params: [
              { value: "first", fromSource: true },
              { value: "last", fromSource: true },
              { value: " " }
            ]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ first: "John", last: "Doe" }], sb);
    expect(result.records[0]!.out).toBe("John Doe");
  });

  it("splitField extracts part by delimiter", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "splitField",
            params: [{ value: "code", fromSource: true }, { value: "-" }, { value: 1 }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ code: "4100-001-003" }], sb);
    expect(result.records[0]!.out).toBe("001");
  });

  it("currencyCode maps abbreviation to ISO code", () => {
    const sb = sandbox();
    const mapping = JSON.stringify({ TSH: "TZS", US: "USD" });
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "currencyCode",
            params: [{ value: "curr", fromSource: true }, { value: mapping }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ curr: "TSH" }, { curr: "EUR" }], sb);
    expect(result.records[0]!.out).toBe("TZS");
    expect(result.records[1]!.out).toBe("EUR"); // pass-through
  });

  it("accountSegment extracts segment from composite code", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "dept",
          function: {
            name: "accountSegment",
            params: [{ value: "acct", fromSource: true }, { value: "-" }, { value: 1 }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ acct: "4100-001-003" }], sb);
    expect(result.records[0]!.dept).toBe("001");
  });
});

// ── 10. Hospitality built-in functions ────────────────────────────────────────

describe("hospitality built-in functions", () => {
  it("operaDate parses YYYYMMDD to ISO", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "operaDate",
            params: [{ value: "dt", fromSource: true }, { value: "YYYYMMDD" }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ dt: "20260410" }], sb);
    expect(result.records[0]!.out).toBe("2026-04-10");
  });

  it("operaDate parses YYMMDD to ISO", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "operaDate",
            params: [{ value: "dt", fromSource: true }, { value: "YYMMDD" }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ dt: "260410" }], sb);
    expect(result.records[0]!.out).toBe("2026-04-10");
  });

  it("janaAmount divides by 1000 (user-selected, explicit)", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "out",
          function: {
            name: "janaAmount",
            params: [{ value: "amt", fromSource: true, type: "number" }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ amt: 385000 }], sb);
    expect(result.records[0]!.out).toBe(385);
  });

  it("simphonyRvc maps RVC code to department", () => {
    const sb = sandbox();
    const mapping = JSON.stringify({ "101": "Front Office", "201": "F&B" });
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "dept",
          function: {
            name: "simphonyRvc",
            params: [{ value: "rvc", fromSource: true }, { value: mapping }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ rvc: "201" }, { rvc: "999" }], sb);
    expect(result.records[0]!.dept).toBe("F&B");
    expect(result.records[1]!.dept).toBe("999"); // pass-through
  });

  it("usaliMap maps account prefix to USALI department", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "dept",
          function: {
            name: "usaliMap",
            params: [{ value: "acct", fromSource: true }, { value: "12th" }]
          }
        }
      ]
    };
    const result = executeTransformation(
      def,
      [{ acct: "4100" }, { acct: "6000" }, { acct: "9999" }],
      sb
    );
    expect(result.records[0]!.dept).toBe("Rooms");
    expect(result.records[1]!.dept).toBe("Administrative & General");
    expect(result.records[2]!.dept).toBe("9999"); // no match, pass-through
  });

  it("entityCode maps property code via JSON", () => {
    const sb = sandbox();
    const mapping = JSON.stringify({ PROP01: "ent-001", PROP02: "ent-002" });
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "entity",
          function: {
            name: "entityCode",
            params: [{ value: "prop", fromSource: true }, { value: mapping }]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ prop: "PROP01" }, { prop: "PROP03" }], sb);
    expect(result.records[0]!.entity).toBe("ent-001");
    expect(result.records[1]!.entity).toBe("PROP03"); // pass-through
  });

  it("taxExtract splits tax-inclusive amount into net", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "net",
          function: {
            name: "taxExtract",
            params: [
              { value: "gross", fromSource: true, type: "number" },
              { value: 0.18 },
              { value: 1 },
              { value: "net" }
            ]
          }
        },
        {
          type: "transform",
          target: "tax",
          function: {
            name: "taxExtract",
            params: [
              { value: "gross", fromSource: true, type: "number" },
              { value: 0.18 },
              { value: 1 },
              { value: "tax" }
            ]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ gross: 118 }], sb);
    expect(result.records[0]!.net).toBe(100);
    expect(result.records[0]!.tax).toBe(18);
  });

  it("taxExtract handles tax-exclusive amount", () => {
    const sb = sandbox();
    const def: TmlDefinition = {
      rules: [
        {
          type: "transform",
          target: "net",
          function: {
            name: "taxExtract",
            params: [
              { value: "amount", fromSource: true, type: "number" },
              { value: 0.15 },
              { value: 0 },
              { value: "net" }
            ]
          }
        },
        {
          type: "transform",
          target: "tax",
          function: {
            name: "taxExtract",
            params: [
              { value: "amount", fromSource: true, type: "number" },
              { value: 0.15 },
              { value: 0 },
              { value: "tax" }
            ]
          }
        }
      ]
    };
    const result = executeTransformation(def, [{ amount: 200 }], sb);
    expect(result.records[0]!.net).toBe(200);
    expect(result.records[0]!.tax).toBe(30);
  });
});
