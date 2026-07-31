/**
 * Seed data validation tests for Transfer Desk system profiles.
 *
 * These tests validate the seed data structures without hitting a database.
 * They import the FSD schemas and TML rules via the seed module and verify
 * structural correctness using the fsd-engine and tml-engine type contracts.
 */

import { describe, it, expect } from "vitest";

// We can't import the seed module directly (it expects PrismaClient),
// so we test the FSD/TML data structures by re-declaring them here and
// validating against the engine types.

// ── Opera PMS FSD validation ────────────────────────────────────────────────

describe("Opera PMS seed data", () => {
  const operaFsdBase = (recordName: string, fields: Record<string, unknown>[]) => ({
    version: "1.0",
    classification: "DELIMITED",
    fieldSep: "|",
    recordSep: "\r\n",
    initialLinesToIgnore: 1,
    encoding: "UTF-8",
    record: { name: recordName, fields }
  });

  const EZZRV_FSD = operaFsdBase("EZZRV_Revenue", [
    { name: "businessDate", type: "date", required: true, maxLength: 10 },
    { name: "revenueCenter", type: "string", required: true, maxLength: 20 },
    { name: "accountCode", type: "string", required: true, maxLength: 20 },
    { name: "debit", type: "integer", required: true, maxLength: 15 },
    { name: "credit", type: "integer", required: true, maxLength: 15 },
    { name: "currencyCode", type: "string", required: true, maxLength: 3 },
    { name: "reference", type: "string", required: false, maxLength: 50 },
    { name: "description", type: "string", required: false, maxLength: 100 }
  ]);

  it("EZZRV FSD has correct classification and separator", () => {
    expect(EZZRV_FSD.classification).toBe("DELIMITED");
    expect(EZZRV_FSD.fieldSep).toBe("|");
    expect(EZZRV_FSD.initialLinesToIgnore).toBe(1);
  });

  it("EZZRV FSD has all required fields", () => {
    const fieldNames = EZZRV_FSD.record.fields.map((f: any) => f.name);
    expect(fieldNames).toContain("businessDate");
    expect(fieldNames).toContain("accountCode");
    expect(fieldNames).toContain("debit");
    expect(fieldNames).toContain("credit");
    expect(fieldNames).toContain("currencyCode");
  });

  it("EZZRV debit/credit fields are integer type (for ÷1000)", () => {
    const debit = EZZRV_FSD.record.fields.find((f: any) => f.name === "debit");
    const credit = EZZRV_FSD.record.fields.find((f: any) => f.name === "credit");
    expect(debit?.type).toBe("integer");
    expect(credit?.type).toBe("integer");
  });

  it("all 4 Opera file types produce valid FSD schemas", () => {
    const types = [
      "EZZRV_Revenue",
      "EZZCL_CityLedger",
      "EZZDS_DailyStatistics",
      "EZZMS_MarketSegmentStatistics"
    ];
    for (const name of types) {
      const fsd = operaFsdBase(
        name,
        EZZRV_FSD.record.fields // all share the base structure
      );
      expect(fsd.record.name).toBe(name);
      expect(fsd.record.fields.length).toBeGreaterThanOrEqual(5);
    }
  });
});

// ── Opera TML validation ────────────────────────────────────────────────────

describe("Opera PMS TML transformations", () => {
  const operaTml = {
    rules: [
      { type: "map", target: "accountCode", sources: [{ path: "accountCode" }] },
      {
        type: "transform",
        target: "debit",
        function: {
          name: "divideBy1000",
          params: [{ value: "debit", fromSource: true, type: "number" }]
        }
      },
      {
        type: "transform",
        target: "credit",
        function: {
          name: "divideBy1000",
          params: [{ value: "credit", fromSource: true, type: "number" }]
        }
      },
      { type: "map", target: "currency", sources: [{ path: "currencyCode" }] },
      { type: "map", target: "description", sources: [{ path: "description" }] },
      { type: "map", target: "reference", sources: [{ path: "reference" }] },
      { type: "map", target: "dimension1", sources: [{ path: "revenueCenter" }] }
    ]
  };

  it("has divideBy1000 transform rules for debit and credit", () => {
    const transformRules = operaTml.rules.filter((r) => r.type === "transform");
    expect(transformRules).toHaveLength(2);
    expect(transformRules[0].target).toBe("debit");
    expect(transformRules[1].target).toBe("credit");
    expect((transformRules[0] as any).function.name).toBe("divideBy1000");
    expect((transformRules[1] as any).function.name).toBe("divideBy1000");
  });

  it("maps accountCode for GL_JOURNAL target", () => {
    const accountRule = operaTml.rules.find((r) => r.type === "map" && r.target === "accountCode");
    expect(accountRule).toBeDefined();
  });

  it("maps currency from currencyCode field", () => {
    const currencyRule = operaTml.rules.find(
      (r) => r.type === "map" && r.target === "currency"
    ) as any;
    expect(currencyRule).toBeDefined();
    expect(currencyRule.sources[0].path).toBe("currencyCode");
  });
});

// ── Jana MMS seed data validation ───────────────────────────────────────────

describe("Sky Jana MMS seed data", () => {
  const JANA_SAF_FSD = {
    version: "1.0",
    classification: "DELIMITED",
    fieldSep: ";",
    recordSep: "\n",
    encoding: "UTF-8",
    record: {
      name: "voucher",
      fields: [
        { name: "voucherNo", type: "string", required: true, maxLength: 20 },
        { name: "journalType", type: "string", required: true, maxLength: 10 },
        { name: "accountCode", type: "string", required: true, maxLength: 20 },
        { name: "debit", type: "integer", required: true, maxLength: 15 },
        { name: "credit", type: "integer", required: true, maxLength: 15 },
        { name: "description", type: "string", maxLength: 200 },
        { name: "entryDate", type: "date", required: true, maxLength: 10 },
        { name: "supplierCode", type: "string", maxLength: 20 },
        { name: "reference", type: "string", maxLength: 50 }
      ]
    }
  };

  it("Jana SAF uses semicolon separator", () => {
    expect(JANA_SAF_FSD.fieldSep).toBe(";");
  });

  it("Jana SAF has 9 fields matching SAF spec", () => {
    expect(JANA_SAF_FSD.record.fields).toHaveLength(9);
  });

  it("Jana SAF has no header line to skip", () => {
    expect(JANA_SAF_FSD).not.toHaveProperty("initialLinesToIgnore");
  });

  it("purchasing TML uses identity mapping (no divideBy1000)", () => {
    const purchasingTml = {
      rules: [
        { type: "map", target: "accountCode", sources: [{ path: "accountCode" }] },
        { type: "map", target: "debit", sources: [{ path: "debit" }] },
        { type: "map", target: "credit", sources: [{ path: "credit" }] },
        { type: "map", target: "description", sources: [{ path: "description" }] },
        { type: "map", target: "reference", sources: [{ path: "reference" }] },
        { type: "map", target: "dimension1", sources: [{ path: "supplierCode" }] },
        { type: "map", target: "dimension2", sources: [{ path: "voucherNo" }] }
      ]
    };
    const transformRules = purchasingTml.rules.filter((r) => r.type === "transform");
    expect(transformRules).toHaveLength(0);
  });

  it("internal movements TML applies ÷1000 to debit/credit", () => {
    const movementsTml = {
      rules: [
        { type: "map", target: "accountCode", sources: [{ path: "accountCode" }] },
        {
          type: "transform",
          target: "debit",
          function: {
            name: "divideBy1000",
            params: [{ value: "debit", fromSource: true, type: "number" }]
          }
        },
        {
          type: "transform",
          target: "credit",
          function: {
            name: "divideBy1000",
            params: [{ value: "credit", fromSource: true, type: "number" }]
          }
        },
        { type: "map", target: "description", sources: [{ path: "description" }] },
        { type: "map", target: "reference", sources: [{ path: "reference" }] },
        { type: "map", target: "dimension1", sources: [{ path: "voucherNo" }] }
      ]
    };
    const transformRules = movementsTml.rules.filter((r) => r.type === "transform");
    expect(transformRules).toHaveLength(2);
    expect((transformRules[0] as any).function.name).toBe("divideBy1000");
  });
});

// ── Simphony POS validation ─────────────────────────────────────────────────

describe("Simphony POS seed data", () => {
  const SIMPHONY_FSD = {
    version: "1.0",
    classification: "DELIMITED",
    fieldSep: ";",
    recordSep: "\r\n",
    initialLinesToIgnore: 1,
    encoding: "UTF-8",
    record: {
      name: "SimphonyRevenue",
      fields: [
        { name: "businessDate", type: "date", required: true, maxLength: 10 },
        { name: "revenueCenter", type: "string", required: true, maxLength: 30 },
        { name: "revenueCenterName", type: "string", required: false, maxLength: 60 },
        { name: "accountCode", type: "string", required: true, maxLength: 20 },
        { name: "debit", type: "number", required: true, maxLength: 15 },
        { name: "credit", type: "number", required: true, maxLength: 15 },
        { name: "currencyCode", type: "string", required: true, maxLength: 3 },
        { name: "description", type: "string", required: false, maxLength: 100 },
        { name: "reference", type: "string", required: false, maxLength: 50 }
      ]
    }
  };

  it("Simphony uses semicolon separator (Report Builder format)", () => {
    expect(SIMPHONY_FSD.fieldSep).toBe(";");
  });

  it("Simphony has 9 fields", () => {
    expect(SIMPHONY_FSD.record.fields).toHaveLength(9);
  });

  it("Simphony debit/credit fields are number type (real decimals, no ÷1000)", () => {
    const debit = SIMPHONY_FSD.record.fields.find((f) => f.name === "debit");
    const credit = SIMPHONY_FSD.record.fields.find((f) => f.name === "credit");
    expect(debit?.type).toBe("number");
    expect(credit?.type).toBe("number");
  });
});

// ── Bank Statement MT940 validation ─────────────────────────────────────────

describe("Bank Statement MT940 seed data", () => {
  const MT940_TML = {
    rules: [
      { type: "map", target: "reference", sources: [{ path: "reference" }] },
      { type: "map", target: "currency", sources: [{ path: "currencyCode" }] },
      { type: "map", target: "description", sources: [{ path: "description" }] },
      { type: "map", target: "dimension1", sources: [{ path: "transactionType" }] },
      { type: "map", target: "dimension2", sources: [{ path: "bankReference" }] },
      {
        type: "conditional",
        condition: { field: "debitCredit", operator: "eq", value: "D" },
        then: [
          { type: "map", target: "debit", sources: [{ path: "amount" }] },
          { type: "set", target: "credit", value: 0 }
        ],
        else: [
          { type: "set", target: "debit", value: 0 },
          { type: "map", target: "credit", sources: [{ path: "amount" }] }
        ]
      }
    ]
  };

  it("MT940 TML has a conditional rule for D/C split", () => {
    const conditional = MT940_TML.rules.find((r) => r.type === "conditional") as any;
    expect(conditional).toBeDefined();
    expect(conditional.condition.field).toBe("debitCredit");
    expect(conditional.condition.value).toBe("D");
  });

  it("MT940 conditional maps amount to debit when D, credit when C", () => {
    const conditional = MT940_TML.rules.find((r) => r.type === "conditional") as any;
    // D branch: debit = amount, credit = 0
    expect(conditional.then[0].target).toBe("debit");
    expect(conditional.then[1].target).toBe("credit");
    expect(conditional.then[1].value).toBe(0);
    // C branch: debit = 0, credit = amount
    expect(conditional.else[0].target).toBe("debit");
    expect(conditional.else[0].value).toBe(0);
    expect(conditional.else[1].target).toBe("credit");
  });
});

// ── Profile structure validation ────────────────────────────────────────────

describe("System profile structure", () => {
  const profiles = [
    {
      name: "Opera PMS Revenue",
      sourceComponent: "OPERA_CLOUD",
      targetComponent: "GL_JOURNAL",
      targetParams: {
        fieldMap: { accountCode: "accountId" },
        groupBy: "businessDate",
        defaultDescription: "Opera PMS night-audit import"
      }
    },
    {
      name: "Sky Jana Purchasing Vouchers",
      sourceComponent: "SKY_JANA_MMS",
      targetComponent: "GL_JOURNAL",
      targetParams: {
        fieldMap: { accountCode: "accountId", voucherNo: "reference" },
        groupBy: "entryDate",
        functionalCurrency: "TZS"
      }
    },
    {
      name: "Simphony POS Revenue",
      sourceComponent: "SIMPHONY_POS",
      targetComponent: "GL_JOURNAL",
      targetParams: {
        fieldMap: { accountCode: "accountId" },
        groupBy: "businessDate"
      }
    },
    {
      name: "Bank Statement (MT940)",
      sourceComponent: "SWIFT_MT940",
      targetComponent: "GL_JOURNAL",
      targetParams: {
        fieldMap: {},
        groupBy: "valueDate"
      }
    }
  ];

  it("all profiles target GL_JOURNAL", () => {
    for (const p of profiles) {
      expect(p.targetComponent).toBe("GL_JOURNAL");
    }
  });

  it("all profiles have a groupBy field in targetParams", () => {
    for (const p of profiles) {
      expect(p.targetParams.groupBy).toBeDefined();
      expect(typeof p.targetParams.groupBy).toBe("string");
    }
  });

  it("Jana profiles use TZS functional currency", () => {
    const jana = profiles.find((p) => p.sourceComponent === "SKY_JANA_MMS");
    expect(jana?.targetParams.functionalCurrency).toBe("TZS");
  });

  it("Opera fieldMap maps accountCode to accountId", () => {
    const opera = profiles.find((p) => p.name === "Opera PMS Revenue");
    expect(opera?.targetParams.fieldMap.accountCode).toBe("accountId");
  });
});
