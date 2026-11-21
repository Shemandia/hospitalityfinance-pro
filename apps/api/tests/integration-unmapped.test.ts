/**
 * Unmapped source codes (docs/IMPORT-PLAN.md section 5): the profile's policy
 * decides, and a document never posts with a line missing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.TML_ALLOW_INSECURE_SANDBOX ??= "true";

vi.mock("../src/modules/ap/service.js", () => ({ APService: class {} }));
vi.mock("../src/modules/ar/service.js", () => ({ ARService: class {} }));
vi.mock("../src/modules/allocation/service.js", () => ({ AllocationService: class {} }));
vi.mock("../src/modules/fixed-asset/service.js", () => ({ FixedAssetService: class {} }));
vi.mock("../src/db/requestContext.js", () => ({
  runWithContext: (_c: unknown, fn: () => unknown) => fn()
}));
vi.mock("../src/db/rls-bypass.js", () => ({
  withBypassRLS: async (_db: unknown, fn: (tx: unknown) => unknown) =>
    fn({ entity: { findUnique: async () => ({ id: "e1", code: "EZZ" }) } })
}));
vi.mock("../src/modules/access/system-user.js", () => ({
  systemUserId: async () => "system-user"
}));

import type { TmlResult } from "@hfp/tml-engine";
import { applyUnmappedPolicy } from "../src/jobs/integration-unmapped.js";
import { executeImport, type ProfileWithRelations } from "../src/jobs/integration-pipeline.js";

describe("applyUnmappedPolicy", () => {
  const tml: Pick<TmlResult, "records" | "errors"> = {
    records: [
      { accountCode: "4000", description: "Room" },
      { description: "Spa" },
      { accountCode: "4000" }
    ],
    errors: [
      {
        recordIndex: 1,
        ruleIndex: 1,
        ruleType: "lookup" as const,
        message: "x",
        unmapped: { table: "Revenue codes", key: "SPA", target: "accountCode" }
      },
      {
        recordIndex: 2,
        ruleIndex: 2,
        ruleType: "lookup" as const,
        message: "x",
        unmapped: { table: "Departments", key: "Z", target: "dimensions.Department" }
      },
      { recordIndex: 2, ruleIndex: 0, ruleType: "map" as const, message: "map rule broke" }
    ]
  };

  it("REJECT fails every record with an unmapped value or another error", () => {
    const result = applyUnmappedPolicy(tml, { unmappedPolicy: "REJECT" });
    expect(result.unmapped).toBe(2);
    expect([...result.failures.entries()]).toEqual([
      [1, { code: "UNMAPPED_CODE", message: 'Revenue codes has no entry for "SPA" (accountCode)' }],
      [
        2,
        {
          code: "UNMAPPED_CODE",
          message: 'Departments has no entry for "Z" (dimensions.Department); [map] map rule broke'
        }
      ]
    ]);
  });

  it("SUSPENSE sends an unmapped account to the suspense account, keeping the code; other values still fail", () => {
    const result = applyUnmappedPolicy(tml, {
      unmappedPolicy: "SUSPENSE",
      suspenseAccountCode: "1999"
    });
    expect(result.records[1]).toEqual({
      accountCode: "1999",
      description: "Unmapped Revenue codes SPA: Spa"
    });
    expect(result.suspended).toBe(1);
    expect([...result.failures.keys()]).toEqual([2]);
    expect(tml.records[1]).toEqual({ description: "Spa" }); // the input is not changed
  });
});

describe("unmapped codes in a ledger import", () => {
  const FSD = JSON.stringify({
    classification: "DELIMITED",
    fieldSep: ";",
    recordSep: "\n",
    record: {
      name: "r",
      fields: ["ref", "code", "dr", "cr"].map((name) => ({ name, type: "string" }))
    }
  });
  const RULES = [
    { type: "set", target: "entityCode", value: "EZZ" },
    { type: "map", target: "sourceDocumentRef", sources: [{ path: "ref" }] },
    { type: "set", target: "documentDate", value: "2026-04-14" },
    { type: "set", target: "currency", value: "TZS" },
    { type: "lookup", table: "Revenue codes", source: "code", target: "accountCode" },
    { type: "map", target: "debit", sources: [{ path: "dr" }] },
    { type: "map", target: "credit", sources: [{ path: "cr" }] }
  ];
  // Two documents; A has an unmapped code (SPA), B is fine.
  const FILE = "A;GL;10;0\nA;SPA;0;10\nB;GL;5;0\nB;RM;0;5";
  const lookupTable = {
    name: "Revenue codes",
    columns: [{ id: "c", name: "Account", columnOrder: 1 }],
    rows: [
      {
        businessUnit: null,
        rangeFrom: "GL",
        rangeTo: "GL",
        rowOrder: 1,
        values: [{ columnId: "c", valueType: "MAP_TO", valueParam: "1200", isDefault: false }]
      },
      {
        businessUnit: null,
        rangeFrom: "RM",
        rangeTo: "RM",
        rowOrder: 2,
        values: [{ columnId: "c", valueType: "MAP_TO", valueParam: "4000", isDefault: false }]
      }
    ]
  };

  let db: any;
  let poster: any;
  beforeEach(() => {
    db = {
      integrationProfile: { findUnique: vi.fn() },
      integrationExecution: {
        update: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ automationId: null, triggeredBy: null })
      },
      integrationExecutionLog: { create: vi.fn(), createMany: vi.fn() },
      integrationBatch: {
        create: vi.fn().mockResolvedValue({ id: "b1" }),
        update: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null)
      },
      integrationBatchItem: { createMany: vi.fn() },
      integrationLookupTable: { findMany: vi.fn().mockResolvedValue([lookupTable]) }
    };
    poster = {
      post: vi.fn(
        async (doc: any, o: any): Promise<any> =>
          o.dryRun
            ? { status: "VALID", entityId: "e1" }
            : { status: "POSTED", journalId: `j-${doc.sourceDocumentRef}`, entityId: "e1" }
      ),
      postAll: vi.fn()
    };
  });

  const profile = (over: Partial<ProfileWithRelations>): ProfileWithRelations =>
    ({
      id: "p",
      name: "Night audit",
      profileType: "IMPORT",
      sourceComponent: "FILE",
      targetComponent: "GL_JOURNAL",
      sourceFormatId: "f",
      targetFormatId: null,
      transformationId: "t",
      sourceParams: null,
      targetParams: { journalSource: "PMS" },
      savePayload: "NONE",
      sourceFormat: { id: "f", fsdXml: FSD, classification: "DELIMITED" },
      targetFormat: null,
      transformation: { id: "t", rulesJson: RULES, functionsJson: null },
      reviewMode: "AUTO_COMMIT",
      sourceSystemCode: "OPERA",
      atomicity: "PER_DOCUMENT",
      unmappedPolicy: "REJECT",
      ...over
    }) as ProfileWithRelations;

  const run = (p: ProfileWithRelations) =>
    executeImport(
      {
        db,
        poster,
        storage: { read: async () => FILE, write: vi.fn() } as any,
        tenantSlug: "t",
        tenantDbUrl: "x"
      },
      "x1",
      p,
      {}
    );
  const logs = () =>
    db.integrationExecutionLog.createMany.mock.calls.flatMap((c: any) => c[0].data);

  it("REJECT refuses the document with the unmapped code whole, and posts the other", async () => {
    const result = await run(profile({}));
    expect(poster.post.mock.calls.map((c: any) => c[0].sourceDocumentRef)).toEqual(["B"]);
    expect(poster.post.mock.calls[0][0].lines.map((l: any) => l.accountCode)).toEqual([
      "1200",
      "4000"
    ]);
    expect(result).toMatchObject({ recordsSucceeded: 2, recordsFailed: 2 });
    expect(
      logs()
        .filter((l: any) => l.documentRef === "A")
        .map((l: any) => l.errorCode)
    ).toEqual(["UNMAPPED_CODE", "UNMAPPED_CODE"]);
  });

  it("HOLD stages the run for review even though the profile commits", async () => {
    await run(profile({ unmappedPolicy: "HOLD" }));
    expect(poster.post.mock.calls.every((c: any) => c[1].dryRun)).toBe(true);
    const items = db.integrationBatchItem.createMany.mock.calls[0][0].data;
    expect(items.map((i: any) => [i.payload.document.sourceDocumentRef, i.status])).toEqual([
      ["A", "ERROR"],
      ["B", "HELD"]
    ]);
  });

  it("SUSPENSE posts the unmapped amount to the suspense account", async () => {
    await run(profile({ unmappedPolicy: "SUSPENSE", suspenseAccountCode: "1999" }));
    const docA = poster.post.mock.calls.find((c: any) => c[0].sourceDocumentRef === "A")[0];
    expect(docA.lines).toEqual([
      { accountCode: "1200", debit: "10", credit: "0" },
      { accountCode: "1999", debit: "0", credit: "10", description: "Unmapped Revenue codes SPA" }
    ]);
  });
});
