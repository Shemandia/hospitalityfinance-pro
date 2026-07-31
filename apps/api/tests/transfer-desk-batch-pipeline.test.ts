import { describe, expect, it, vi, beforeEach } from "vitest";

const createJournalMock = vi.fn().mockResolvedValue({ id: "j1", status: "DRAFT" });
vi.mock("../src/modules/gl/service.js", () => ({
  GLService: class {
    createJournal = createJournalMock;
    postJournal = vi.fn().mockResolvedValue({ id: "j1", status: "POSTED" });
  }
}));
vi.mock("../src/modules/ap/service.js", () => ({
  APService: class {
    createInvoice = vi.fn();
  }
}));
vi.mock("../src/modules/ar/service.js", () => ({
  ARService: class {
    createInvoice = vi.fn();
  }
}));
vi.mock("../src/modules/allocation/service.js", () => ({ AllocationService: class {} }));
vi.mock("../src/modules/fixed-asset/service.js", () => ({ FixedAssetService: class {} }));
vi.mock("../src/db/requestContext.js", () => ({
  runWithContext: (_ctx: unknown, fn: () => unknown) => fn()
}));

import {
  executeImport,
  type ProfileWithRelations,
  type PipelineContext
} from "../src/jobs/transfer-desk-pipeline.js";

const FSD = JSON.stringify({
  classification: "DELIMITED",
  fieldSep: ",",
  recordSep: "\n",
  record: {
    name: "row",
    fields: [
      { name: "accountId", type: "string" },
      { name: "debit", type: "number" },
      { name: "credit", type: "number" }
    ]
  }
});

const FILE = "1000,100,0\n2000,0,100\n";

function makeProfile(reviewMode: string): ProfileWithRelations {
  return {
    id: "prof1",
    name: "GL Import",
    profileType: "IMPORT",
    sourceComponent: "BANK",
    targetComponent: "GL_JOURNAL",
    sourceFormatId: "f1",
    targetFormatId: null,
    transformationId: null,
    sourceParams: { fileName: "in.csv" },
    targetParams: { entityId: "e1", periodId: "p1" },
    savePayload: "NONE",
    sourceFormat: { id: "f1", fsdXml: FSD, classification: "DELIMITED" },
    targetFormat: null,
    transformation: null,
    reviewMode
  } as any;
}

function makeCtx(db: any): PipelineContext {
  return {
    db,
    storage: {
      read: vi.fn().mockResolvedValue(FILE),
      write: vi.fn().mockResolvedValue(undefined)
    } as any,
    tenantSlug: "t1",
    tenantDbUrl: "postgres://x"
  };
}

function makeDb(overrides: Record<string, any> = {}) {
  return {
    transferProfile: { findUnique: vi.fn() },
    transferExecution: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue({ automationId: null, triggeredBy: "u1" })
    },
    transferExecutionLog: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({})
    },
    account: {
      findMany: vi.fn().mockResolvedValue([
        { id: "1000", code: "1000" },
        { id: "2000", code: "2000" }
      ])
    },
    period: { findMany: vi.fn().mockResolvedValue([{ id: "p1", status: "OPEN" }]) },
    transferBatch: {
      create: vi.fn().mockResolvedValue({ id: "b1" }),
      update: vi.fn().mockResolvedValue({}),
      // Import idempotency looks for a batch already staged from the same
      // source content; null means this file has not been seen before.
      findFirst: vi.fn().mockResolvedValue(null)
    },
    transferBatchItem: { createMany: vi.fn().mockResolvedValue({}) },
    ...overrides
  };
}

beforeEach(() => {
  createJournalMock.mockClear();
});

describe("executeImport HOLD vs AUTO_COMMIT", () => {
  it("HOLD mode stages a batch and does NOT create journals", async () => {
    const db = makeDb();
    const result = await executeImport(makeCtx(db), "exec1", makeProfile("HOLD"), {
      entityId: "e1",
      periodId: "p1"
    });
    expect(db.transferBatch.create).toHaveBeenCalledTimes(1);
    expect(db.transferBatchItem.createMany).toHaveBeenCalledTimes(1);
    expect(createJournalMock).not.toHaveBeenCalled();
    expect(result.recordsTotal).toBeGreaterThan(0);
  });

  it("AUTO_COMMIT mode writes journals directly and stages no batch", async () => {
    const db = makeDb();
    await executeImport(makeCtx(db), "exec1", makeProfile("AUTO_COMMIT"), {
      entityId: "e1",
      periodId: "p1"
    });
    expect(createJournalMock).toHaveBeenCalled();
    expect(db.transferBatch.create).not.toHaveBeenCalled();
  });
});
