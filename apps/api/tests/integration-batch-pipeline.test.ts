/**
 * The ledger import stages of the pipeline (import plan section 4): records
 * become canonical documents, HOLD stages them after a dry run, AUTO_COMMIT
 * posts them per document or the whole file at once, and every record is
 * logged with its document and journal. The posting service is a fake here;
 * tests/integration/import-pipeline.test.ts runs the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/ap/service.js", () => ({ APService: class {} }));
vi.mock("../src/modules/ar/service.js", () => ({ ARService: class {} }));
vi.mock("../src/modules/allocation/service.js", () => ({ AllocationService: class {} }));
vi.mock("../src/modules/fixed-asset/service.js", () => ({ FixedAssetService: class {} }));
vi.mock("../src/db/requestContext.js", () => ({
  runWithContext: (_ctx: unknown, fn: () => unknown) => fn()
}));
vi.mock("../src/db/rls-bypass.js", () => ({
  withBypassRLS: async (_db: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      entity: {
        findUnique: async ({ where }: any) => ({
          id: where.id,
          code: where.id === "e1" ? "EZZ" : "DOH"
        })
      }
    })
}));
vi.mock("../src/modules/access/system-user.js", () => ({
  systemUserId: async () => "system-user",
  actingUserId: async () => "system-user"
}));

import {
  executeImport,
  type PipelineContext,
  type ProfileWithRelations
} from "../src/jobs/integration-pipeline.js";

const USER = "00000000-0000-4000-8000-000000000001";

const FSD = JSON.stringify({
  classification: "DELIMITED",
  fieldSep: ",",
  recordSep: "\n",
  record: {
    name: "row",
    fields: [
      { name: "entityCode", type: "string" },
      { name: "sourceDocumentRef", type: "string" },
      { name: "documentDate", type: "string" },
      { name: "currency", type: "string" },
      { name: "accountCode", type: "string" },
      { name: "debit", type: "number" },
      { name: "credit", type: "number" },
      { name: "dimensions.Department", type: "string" }
    ]
  }
});

// Two documents of EZZ, two lines each.
const FILE = [
  "EZZ,EZZ-1,2026-04-14,TZS,1200,100,0,ROOMS",
  "EZZ,EZZ-1,2026-04-14,TZS,4000,0,100,ROOMS",
  "EZZ,EZZ-2,2026-04-15,TZS,1200,50.5,0,",
  "EZZ,EZZ-2,2026-04-15,TZS,4000,0,50.5,"
].join("\n");

function makeProfile(overrides: Partial<ProfileWithRelations> = {}): ProfileWithRelations {
  return {
    id: "prof1",
    name: "Night audit",
    profileType: "IMPORT",
    sourceComponent: "FILE",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: "f1",
    targetFormatId: null,
    transformationId: null,
    sourceParams: { fileName: "in.csv" },
    targetParams: { journalSource: "PMS" },
    savePayload: "NONE",
    sourceFormat: { id: "f1", fsdXml: FSD, classification: "DELIMITED" },
    targetFormat: null,
    transformation: null,
    reviewMode: "AUTO_COMMIT",
    sourceSystemCode: "OPERA",
    atomicity: "PER_DOCUMENT",
    ...overrides
  } as ProfileWithRelations;
}

const posted = (journalId: string) => ({ status: "POSTED" as const, journalId, entityId: "e1" });

function makeCtx(db: any, poster: any, file = FILE): PipelineContext {
  return {
    db,
    poster,
    storage: { read: vi.fn().mockResolvedValue(file), write: vi.fn() } as any,
    tenantSlug: "t1",
    tenantDbUrl: "postgres://x"
  };
}

function makeDb() {
  return {
    integrationProfile: { findUnique: vi.fn() },
    integrationExecution: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ automationId: null, triggeredBy: USER })
    },
    integrationExecutionLog: { create: vi.fn(), createMany: vi.fn().mockResolvedValue({}) },
    integrationBatch: {
      create: vi.fn().mockResolvedValue({ id: "b1" }),
      update: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    integrationBatchItem: { createMany: vi.fn().mockResolvedValue({}) }
  };
}

function makePoster() {
  return {
    post: vi.fn(
      async (doc: any, options: any): Promise<any> =>
        options.dryRun ? { status: "VALID", entityId: "e1" } : posted(`j-${doc.sourceDocumentRef}`)
    ),
    postAll: vi.fn(
      async (docs: any[], _options?: any): Promise<any[]> =>
        docs.map((d) => posted(`j-${d.sourceDocumentRef}`))
    )
  };
}

const logs = (db: ReturnType<typeof makeDb>) =>
  db.integrationExecutionLog.createMany.mock.calls.flatMap((c: any) => c[0].data);

let db: ReturnType<typeof makeDb>;
let poster: ReturnType<typeof makePoster>;
beforeEach(() => {
  db = makeDb();
  poster = makePoster();
});

describe("ledger imports become documents", () => {
  it("groups records by entity and reference, one line each, with dimensions by name", async () => {
    const result = await executeImport(makeCtx(db, poster), "x1", makeProfile(), {
      entityId: "e1"
    });
    expect(poster.post).toHaveBeenCalledTimes(2);
    const [first, options] = poster.post.mock.calls[0]!;
    expect(first).toEqual({
      contractVersion: 1,
      documentType: "GL_JOURNAL",
      sourceSystem: "OPERA",
      sourceDocumentRef: "EZZ-1",
      entityCode: "EZZ",
      documentDate: "2026-04-14",
      currency: "TZS",
      lines: [
        { accountCode: "1200", debit: "100", credit: "0", dimensions: { Department: "ROOMS" } },
        { accountCode: "4000", debit: "0", credit: "100", dimensions: { Department: "ROOMS" } }
      ]
    });
    expect(options).toEqual({ actorUserId: USER, journalSource: "PMS" });
    expect(poster.post.mock.calls[1]![0].lines[0]).toEqual({
      accountCode: "1200",
      debit: "50.5",
      credit: "0"
    });
    expect(result).toMatchObject({ recordsTotal: 4, recordsSucceeded: 4, recordsFailed: 0 });
    expect(logs(db).map((l: any) => [l.recordIndex, l.status, l.documentRef, l.journalId])).toEqual(
      [
        [0, "SUCCESS", "EZZ-1", "j-EZZ-1"],
        [1, "SUCCESS", "EZZ-1", "j-EZZ-1"],
        [2, "SUCCESS", "EZZ-2", "j-EZZ-2"],
        [3, "SUCCESS", "EZZ-2", "j-EZZ-2"]
      ]
    );
  });

  it("refuses without a source system on the profile", async () => {
    const result = await executeImport(
      makeCtx(db, poster),
      "x1",
      makeProfile({ sourceSystemCode: null }),
      {}
    );
    expect(result.errorMessage).toMatch(/names no source system/);
    expect(poster.post).not.toHaveBeenCalled();
  });

  it("logs a record without a reference, and a document whose records disagree", async () => {
    const file = [
      "EZZ,,2026-04-14,TZS,1200,1,0,",
      "EZZ,EZZ-9,2026-04-14,TZS,1200,1,0,",
      "EZZ,EZZ-9,2026-04-15,TZS,4000,0,1,"
    ].join("\n");
    const result = await executeImport(makeCtx(db, poster, file), "x1", makeProfile(), {
      entityId: "e1"
    });
    expect(poster.post).not.toHaveBeenCalled();
    expect(result).toMatchObject({ recordsTotal: 3, recordsSucceeded: 0, recordsFailed: 3 });
    expect(logs(db).map((l: any) => [l.recordIndex, l.errorCode])).toEqual([
      [0, "MISSING_DOCUMENT_KEY"],
      [1, "CONFLICTING_DOCUMENT_FIELD"],
      [2, "CONFLICTING_DOCUMENT_FIELD"]
    ]);
  });

  it("logs refusals and duplicates per record, and reports a file of duplicates", async () => {
    poster.post.mockImplementation(async (doc: any) =>
      doc.sourceDocumentRef === "EZZ-1"
        ? { status: "DUPLICATE", journalId: "j-old", entityId: "e1" }
        : {
            status: "REFUSED",
            errors: [
              { code: "NO_PERIOD", path: "documentDate", message: "EZZ has no period for 2026-04." }
            ]
          }
    );
    const result = await executeImport(makeCtx(db, poster), "x1", makeProfile(), {
      entityId: "e1"
    });
    expect(result).toMatchObject({ recordsSucceeded: 0, recordsFailed: 4 });
    expect(logs(db).map((l: any) => [l.status, l.errorCode, l.journalId])).toEqual([
      ["FAILED", "DUPLICATE", null],
      ["FAILED", "DUPLICATE", null],
      ["FAILED", "NO_PERIOD", null],
      ["FAILED", "NO_PERIOD", null]
    ]);

    poster.post.mockResolvedValue({ status: "DUPLICATE", journalId: "j-old", entityId: "e1" });
    const again = await executeImport(makeCtx(makeDb(), poster), "x2", makeProfile(), {
      entityId: "e1"
    });
    expect(again).toMatchObject({ status: "DUPLICATE" });
  });

  it("refuses, in an interactive run, a document for another entity than the run's", async () => {
    const file = "DOH,DOH-1,2026-04-14,TZS,1200,1,0,\nDOH,DOH-1,2026-04-14,TZS,4000,0,1,";
    await executeImport(makeCtx(db, poster, file), "x1", makeProfile(), { entityId: "e1" });
    expect(poster.post).not.toHaveBeenCalled();
    expect(logs(db).map((l: any) => l.errorCode)).toEqual([
      "ENTITY_OUTSIDE_RUN",
      "ENTITY_OUTSIDE_RUN"
    ]);
  });

  it("lets a scheduled run post to any entity the file names", async () => {
    db.integrationExecution.findUnique.mockResolvedValue({
      automationId: "auto1",
      triggeredBy: "scheduler"
    });
    const file = "DOH,DOH-1,2026-04-14,TZS,1200,1,0,\nDOH,DOH-1,2026-04-14,TZS,4000,0,1,";
    await executeImport(makeCtx(db, poster, file), "x1", makeProfile(), { entityId: "e1" });
    expect(poster.post).toHaveBeenCalledTimes(1);
    expect(poster.post.mock.calls[0]![1]).toMatchObject({ actorUserId: "system-user" });
  });
});

describe("HOLD, AUTO_COMMIT and whole files", () => {
  it("HOLD checks every document without writing and stages them as one batch", async () => {
    await executeImport(makeCtx(db, poster), "x1", makeProfile({ reviewMode: "HOLD" }), {
      entityId: "e1"
    });
    expect(poster.post.mock.calls.every((c: any) => c[1].dryRun === true)).toBe(true);
    expect(db.integrationBatch.create).toHaveBeenCalledTimes(1);
    expect(db.integrationBatch.create.mock.calls[0]![0].data).toMatchObject({
      entityId: "e1",
      totalItems: 2,
      heldItems: 2,
      errorItems: 0
    });
    const items = db.integrationBatchItem.createMany.mock.calls[0]![0].data;
    expect(
      items.map((i: any) => [i.status, i.payload.document.sourceDocumentRef, i.sourceRecordIndices])
    ).toEqual([
      ["HELD", "EZZ-1", [0, 1]],
      ["HELD", "EZZ-2", [2, 3]]
    ]);
  });

  it("HOLD does not stage the same file twice", async () => {
    db.integrationBatch.findFirst.mockResolvedValue({ id: "b0", status: "PENDING_REVIEW" });
    const result = await executeImport(
      makeCtx(db, poster),
      "x1",
      makeProfile({ reviewMode: "HOLD" }),
      { entityId: "e1" }
    );
    expect(result).toMatchObject({ status: "DUPLICATE" });
    expect(db.integrationBatch.create).not.toHaveBeenCalled();
  });

  it("AUTO_COMMIT posts per document and stages nothing", async () => {
    await executeImport(makeCtx(db, poster), "x1", makeProfile(), { entityId: "e1" });
    expect(poster.post.mock.calls.every((c: any) => !c[1].dryRun)).toBe(true);
    expect(db.integrationBatch.create).not.toHaveBeenCalled();
  });

  it("WHOLE_FILE posts all documents in one call", async () => {
    await executeImport(makeCtx(db, poster), "x1", makeProfile({ atomicity: "WHOLE_FILE" }), {
      entityId: "e1"
    });
    expect(poster.postAll).toHaveBeenCalledTimes(1);
    expect(poster.postAll.mock.calls[0]![0].map((d: any) => d.sourceDocumentRef)).toEqual([
      "EZZ-1",
      "EZZ-2"
    ]);
    expect(poster.post).not.toHaveBeenCalled();
  });

  it("WHOLE_FILE posts nothing when a record cannot be placed in a document", async () => {
    const file = `${FILE}\nEZZ,,2026-04-14,TZS,1200,1,0,`;
    const result = await executeImport(
      makeCtx(db, poster, file),
      "x1",
      makeProfile({ atomicity: "WHOLE_FILE" }),
      { entityId: "e1" }
    );
    expect(poster.postAll).not.toHaveBeenCalled();
    expect(result).toMatchObject({ recordsSucceeded: 0, recordsFailed: 5 });
    expect(new Set(logs(db).map((l: any) => l.errorCode))).toEqual(
      new Set(["FILE_NOT_POSTED", "MISSING_DOCUMENT_KEY"])
    );
  });
});
