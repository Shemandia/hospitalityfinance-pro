import { describe, expect, it, afterEach } from "vitest";
import {
  compileMappings,
  executeTransformation,
  createSandbox,
  BUILTIN_FUNCTIONS_SOURCE,
  type WizardTmlMapping,
  type Sandbox
} from "../src/index.js";

// Allow the (insecure) Node vm fallback on dev machines without isolated-vm
process.env.TML_ALLOW_INSECURE_SANDBOX ??= "true";

// ── Helpers ────────────────────────────────────────────────────────────────

let activeSandbox: Sandbox | null = null;

function makeSandbox(def: ReturnType<typeof compileMappings>): Sandbox {
  activeSandbox = createSandbox(def.functions ?? [], BUILTIN_FUNCTIONS_SOURCE, { timeoutMs: 2000 });
  return activeSandbox;
}

afterEach(() => {
  activeSandbox?.dispose();
  activeSandbox = null;
});

// ── 1. Direct mapping ─────────────────────────────────────────────────────

describe("compileMappings — direct", () => {
  it("compiles a direct mapping (null transform) to a map rule", () => {
    const mappings: WizardTmlMapping[] = [
      { id: "m1", sourceField: "acctCode", targetField: "line.account", transform: null }
    ];
    const def = compileMappings(mappings);

    expect(def.rules).toHaveLength(1);
    expect(def.rules[0]!.type).toBe("map");
    const rule = def.rules[0] as { type: "map"; target: string; sources: { path: string }[] };
    expect(rule.target).toBe("line.account");
    expect(rule.sources[0]!.path).toBe("acctCode");

    // Execute
    const result = executeTransformation(def, [{ acctCode: "4100" }]);
    expect(result.records[0]!["line.account"]).toBe("4100");
  });

  it("compiles explicit direct transform type to a map rule", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "name",
        targetField: "journal.description",
        transform: { type: "direct" }
      }
    ];
    const def = compileMappings(mappings);

    expect(def.rules[0]!.type).toBe("map");
    const result = executeTransformation(def, [{ name: "Test Journal" }]);
    expect(result.records[0]!["journal.description"]).toBe("Test Journal");
  });
});

// ── 2. Static mapping ─────────────────────────────────────────────────────

describe("compileMappings — static", () => {
  it("compiles a static string mapping to a set rule", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "__static__",
        targetField: "journal.currency",
        transform: { type: "static", staticValue: "TZS" }
      }
    ];
    const def = compileMappings(mappings);

    expect(def.rules[0]!.type).toBe("set");
    const result = executeTransformation(def, [{ x: 1 }]);
    expect(result.records[0]!["journal.currency"]).toBe("TZS");
  });

  it("compiles a static numeric value", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "__static__",
        targetField: "line.sequence",
        transform: { type: "static", staticValue: "42" }
      }
    ];
    const def = compileMappings(mappings);
    const rule = def.rules[0] as { type: "set"; value: unknown };
    expect(rule.value).toBe(42); // parsed as number

    const result = executeTransformation(def, [{}]);
    expect(result.records[0]!["line.sequence"]).toBe(42);
  });

  it("compiles static boolean value", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "__static__",
        targetField: "flag",
        transform: { type: "static", staticValue: "true" }
      }
    ];
    const def = compileMappings(mappings);
    const rule = def.rules[0] as { type: "set"; value: unknown };
    expect(rule.value).toBe(true);
  });
});

// ── 3. Lookup mapping ─────────────────────────────────────────────────────

describe("compileMappings — lookup", () => {
  it("compiles a lookup mapping to a lookup rule", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "deptCode",
        targetField: "line.analysisCode1",
        transform: { type: "lookup", lookupTableId: "dept_table" }
      }
    ];
    const def = compileMappings(mappings);

    expect(def.rules[0]!.type).toBe("lookup");
    const rule = def.rules[0] as { type: "lookup"; table: string; source: string; unknown: string };
    expect(rule.table).toBe("dept_table");
    expect(rule.source).toBe("deptCode");
    expect(rule.unknown).toBe("fail");
  });

  it("sets unknown=copy when default value is provided", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "code",
        targetField: "out",
        transform: { type: "lookup", lookupTableId: "tbl", lookupDefaultValue: "UNKNOWN" }
      }
    ];
    const def = compileMappings(mappings);
    const rule = def.rules[0] as { type: "lookup"; unknown: string };
    expect(rule.unknown).toBe("copy");
  });

  it("executes lookup rules with provided tables", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "code",
        targetField: "name",
        transform: { type: "lookup", lookupTableId: "myTable" }
      }
    ];
    const def = compileMappings(mappings);
    const lookupTables = new Map([
      [
        "myTable",
        new Map([
          ["A", "Alpha"],
          ["B", "Beta"]
        ])
      ]
    ]);
    const result = executeTransformation(def, [{ code: "A" }, { code: "B" }], null, {
      lookupTables
    });
    expect(result.records[0]!.name).toBe("Alpha");
    expect(result.records[1]!.name).toBe("Beta");
  });
});

// ── 4. Expression mapping ─────────────────────────────────────────────────

describe("compileMappings — expression", () => {
  it("compiles an expression to a user function + transform rule", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "amount",
        targetField: "line.debit",
        transform: { type: "expression", expression: "Number(value) * 100" }
      }
    ];
    const def = compileMappings(mappings);

    expect(def.rules[0]!.type).toBe("transform");
    expect(def.functions).toHaveLength(1);
    expect(def.functions![0]!.name).toBe("__expr_0");
    expect(def.functions![0]!.body).toContain("Number(value) * 100");

    const sb = makeSandbox(def);
    const result = executeTransformation(def, [{ amount: 385 }], sb);
    expect(result.records[0]!["line.debit"]).toBe(38500);
  });

  it("compiles multiple expressions with unique function names", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "a",
        targetField: "out1",
        transform: { type: "expression", expression: "value + '_x'" }
      },
      {
        id: "m2",
        sourceField: "b",
        targetField: "out2",
        transform: { type: "expression", expression: "value + '_y'" }
      }
    ];
    const def = compileMappings(mappings);

    expect(def.functions).toHaveLength(2);
    expect(def.functions![0]!.name).toBe("__expr_0");
    expect(def.functions![1]!.name).toBe("__expr_1");

    const sb = makeSandbox(def);
    const result = executeTransformation(def, [{ a: "hello", b: "world" }], sb);
    expect(result.records[0]!.out1).toBe("hello_x");
    expect(result.records[0]!.out2).toBe("world_y");
  });
});

// ── 5. Function mapping ───────────────────────────────────────────────────

describe("compileMappings — function", () => {
  it("compiles fn_upper to toUpperCase transform rule", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "name",
        targetField: "line.description",
        transform: { type: "function", functionId: "fn_upper" }
      }
    ];
    const def = compileMappings(mappings);

    expect(def.rules[0]!.type).toBe("transform");
    const rule = def.rules[0] as { function: { name: string } };
    expect(rule.function.name).toBe("toUpperCase");

    const sb = makeSandbox(def);
    const result = executeTransformation(def, [{ name: "hello" }], sb);
    expect(result.records[0]!["line.description"]).toBe("HELLO");
  });

  it("compiles fn_pad_left with params", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "code",
        targetField: "out",
        transform: {
          type: "function",
          functionId: "fn_pad_left",
          functionParams: { char: "0", length: 8 }
        }
      }
    ];
    const def = compileMappings(mappings);

    const sb = makeSandbox(def);
    const result = executeTransformation(def, [{ code: "4100" }], sb);
    expect(result.records[0]!.out).toBe("00004100");
  });

  it("compiles fn_jana_amount (explicit ÷1000)", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "rawAmount",
        targetField: "line.debit",
        transform: { type: "function", functionId: "fn_jana_amount" }
      }
    ];
    const def = compileMappings(mappings);
    const sb = makeSandbox(def);
    const result = executeTransformation(def, [{ rawAmount: 385000 }], sb);
    expect(result.records[0]!["line.debit"]).toBe(385);
  });

  it("compiles fn_date_format with input/output format params", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "date",
        targetField: "journal.date",
        transform: {
          type: "function",
          functionId: "fn_date_format",
          functionParams: { inputFormat: "DD/MM/YYYY", outputFormat: "YYYY-MM-DD" }
        }
      }
    ];
    const def = compileMappings(mappings);
    const sb = makeSandbox(def);
    const result = executeTransformation(def, [{ date: "10/04/2026" }], sb);
    expect(result.records[0]!["journal.date"]).toBe("2026-04-10");
  });
});

// ── 6. Concat mapping ─────────────────────────────────────────────────────

describe("compileMappings — concat", () => {
  it("compiles concat to concatFields transform rule", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "first",
        targetField: "fullName",
        transform: {
          type: "concat",
          additionalSources: ["last"],
          separator: " "
        }
      }
    ];
    const def = compileMappings(mappings);

    expect(def.rules[0]!.type).toBe("transform");
    const rule = def.rules[0] as {
      function: { name: string; params: { value: string; fromSource?: boolean }[] };
    };
    expect(rule.function.name).toBe("concatFields");
    expect(rule.function.params).toHaveLength(3); // first, last, separator

    const sb = makeSandbox(def);
    const result = executeTransformation(def, [{ first: "John", last: "Doe" }], sb);
    expect(result.records[0]!.fullName).toBe("John Doe");
  });

  it("handles concat with multiple additional sources", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "a",
        targetField: "out",
        transform: {
          type: "concat",
          additionalSources: ["b", "c"],
          separator: "-"
        }
      }
    ];
    const def = compileMappings(mappings);
    const sb = makeSandbox(def);
    const result = executeTransformation(def, [{ a: "X", b: "Y", c: "Z" }], sb);
    expect(result.records[0]!.out).toBe("X-Y-Z");
  });
});

// ── 7. Split mapping ──────────────────────────────────────────────────────

describe("compileMappings — split", () => {
  it("compiles split to splitField transform rule", () => {
    const mappings: WizardTmlMapping[] = [
      {
        id: "m1",
        sourceField: "account",
        targetField: "department",
        transform: {
          type: "split",
          splitDelimiter: "-",
          splitIndex: 1
        }
      }
    ];
    const def = compileMappings(mappings);

    expect(def.rules[0]!.type).toBe("transform");
    const rule = def.rules[0] as { function: { name: string } };
    expect(rule.function.name).toBe("splitField");

    const sb = makeSandbox(def);
    const result = executeTransformation(def, [{ account: "4100-001-003" }], sb);
    expect(result.records[0]!.department).toBe("001");
  });
});

// ── 8. Mixed mappings (real-world scenario) ───────────────────────────────

describe("compileMappings — mixed real-world", () => {
  it("compiles a Jana import mapping with multiple transform types", () => {
    const mappings: WizardTmlMapping[] = [
      // Direct: field_1 → journal.date
      { id: "m1", sourceField: "field_1", targetField: "journal.date", transform: null },
      // Function: field_2 → line.account with padding
      {
        id: "m2",
        sourceField: "field_2",
        targetField: "line.account",
        transform: {
          type: "function",
          functionId: "fn_pad_left",
          functionParams: { char: "0", length: 8 }
        }
      },
      // Jana amount: field_4 → line.debit
      {
        id: "m3",
        sourceField: "field_4",
        targetField: "line.debit",
        transform: { type: "function", functionId: "fn_jana_amount" }
      },
      // Static: set currency
      {
        id: "m4",
        sourceField: "__static__",
        targetField: "journal.currency",
        transform: { type: "static", staticValue: "TZS" }
      },
      // Split: composite code → department
      {
        id: "m5",
        sourceField: "field_3",
        targetField: "line.analysisCode1",
        transform: { type: "split", splitDelimiter: "-", splitIndex: 0 }
      }
    ];

    const def = compileMappings(mappings);
    expect(def.rules).toHaveLength(5);

    const sb = makeSandbox(def);
    const result = executeTransformation(
      def,
      [{ field_1: "2026-04-10", field_2: "4100", field_3: "D01-Sales", field_4: 385000 }],
      sb
    );

    const rec = result.records[0]!;
    expect(rec["journal.date"]).toBe("2026-04-10");
    expect(rec["line.account"]).toBe("00004100");
    expect(rec["line.debit"]).toBe(385);
    expect(rec["journal.currency"]).toBe("TZS");
    expect(rec["line.analysisCode1"]).toBe("D01");
    expect(result.succeeded).toBe(1);
  });
});
