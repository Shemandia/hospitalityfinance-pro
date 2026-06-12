import { describe, expect, it, vi } from "vitest";
import type { FsdSchema } from "@hfp/fsd-engine";

// ── Mock GL/AP/AR services before importing the pipeline ───────────────────

const createJournalMock = vi.fn().mockResolvedValue({ id: "journal-001" });
const createApInvoiceMock = vi.fn().mockResolvedValue({ id: "ap-inv-001" });
const createArInvoiceMock = vi.fn().mockResolvedValue({ id: "ar-inv-001" });

vi.mock("../src/modules/gl/service.js", () => ({
  GLService: class {
    createJournal = createJournalMock;
  }
}));

vi.mock("../src/modules/ap/service.js", () => ({
  APService: class {
    createInvoice = createApInvoiceMock;
  }
}));

vi.mock("../src/modules/ar/service.js", () => ({
  ARService: class {
    createInvoice = createArInvoiceMock;
  }
}));

vi.mock("../src/db/requestContext.js", () => ({
  runWithContext: (_ctx: unknown, fn: () => unknown) => fn()
}));

import {
  executeImport,
  type PipelineContext,
  type ProfileWithRelations
} from "../src/jobs/transfer-desk-pipeline.js";

// ── Jana voucher FSD schema (semicolon-delimited, 9 fields) ────────────────

const janaVoucherSchema: FsdSchema = {
  classification: "DELIMITED",
  fieldSep: ";",
  recordSep: "\n",
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

const janaFsdJson = JSON.stringify(janaVoucherSchema);

// ── Test data ──────────────────────────────────────────────────────────────

const VALID_JANA_INPUT =
  "PV001;PURCH;50010;385000;0;Rice 50kg;2026-04-01;SUP001;INV-1\n" +
  "PV002;PURCH;20010;0;385000;Control;2026-04-01;SUP001;INV-1";

// ── Helpers ────────────────────────────────────────────────────────────────

function createStubDb() {
  const logs: Record<string, unknown>[] = [];
  const execUpdates: Record<string, unknown>[] = [];

  return {
    db: {
      transferProfile: {
        findUnique: vi.fn().mockResolvedValue(null)
      },
      transferExecution: {
        update: vi.fn(async (args: any) => {
          execUpdates.push(args.data);
          return {};
        }),
        findUnique: vi.fn().mockResolvedValue(null)
      },
      transferExecutionLog: {
        create: vi.fn(async (args: any) => {
          logs.push(args.data);
          return {};
        }),
        createMany: vi.fn(async (args: any) => {
          logs.push(...args.data);
          return { count: args.data.length };
        })
      }
    },
    logs,
    execUpdates
  };
}

function createStubStorage(files: Record<string, string> = {}) {
  const written: Record<string, string> = {};
  return {
    storage: {
      read: vi.fn(async (key: string) => {
        if (files[key]) return files[key];
        throw new Error(`File not found: ${key}`);
      }),
      write: vi.fn(async (key: string, content: string) => {
        written[key] = content;
      })
    },
    written
  };
}

function createCtx(
  dbStub: ReturnType<typeof createStubDb>,
  storageStub: ReturnType<typeof createStubStorage>
): PipelineContext {
  return {
    db: dbStub.db as any,
    storage: storageStub.storage,
    tenantSlug: "test-hotel",
    tenantDbUrl: "postgresql://localhost/test"
  };
}

function makeImportProfile(overrides: Partial<ProfileWithRelations> = {}): ProfileWithRelations {
  return {
    id: "prof-001",
    name: "Jana Voucher Import",
    profileType: "IMPORT",
    // These tests assert the direct-write path; run them in AUTO_COMMIT mode
    // (HOLD is the new default and would stage a batch instead).
    reviewMode: "AUTO_COMMIT",
    sourceComponent: null,
    targetComponent: "GL_JOURNAL",
    sourceFormatId: "fmt-001",
    targetFormatId: null,
    transformationId: null,
    sourceParams: null,
    targetParams: {
      fieldMap: {
        accountCode: "accountId",
        voucherNo: "reference"
      }
    },
    savePayload: "NONE",
    sourceFormat: {
      id: "fmt-001",
      fsdXml: janaFsdJson,
      classification: "DELIMITED"
    },
    targetFormat: null,
    transformation: null,
    ...overrides
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("executeImport — happy path (Jana voucher → GL_JOURNAL)", () => {
  it("parses 2-line Jana file and creates one GL journal with 2 lines", async () => {
    createJournalMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/vouchers.csv": VALID_JANA_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile();
    const runtimeParams = {
      filePath: "test-hotel/vouchers.csv",
      entityId: "entity-001",
      periodId: "period-001",
      triggeredBy: "user-001"
    };

    const result = await executeImport(ctx, "exec-001", profile, runtimeParams);

    // Should have processed 2 records
    expect(result.recordsTotal).toBe(2);
    expect(result.recordsSucceeded).toBe(2);
    expect(result.recordsFailed).toBe(0);
    expect(result.errorMessage).toBeUndefined();

    // GLService.createJournal should have been called once (all records → one journal)
    expect(createJournalMock).toHaveBeenCalledTimes(1);

    // Should have logged 2 SUCCESS records
    const successLogs = dbStub.logs.filter((l) => l.status === "SUCCESS");
    expect(successLogs).toHaveLength(2);
  });

  it("saves input payload when savePayload is INPUT", async () => {
    createJournalMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/vouchers.csv": VALID_JANA_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile({ savePayload: "INPUT" });
    const runtimeParams = {
      filePath: "test-hotel/vouchers.csv",
      entityId: "entity-001",
      periodId: "period-001"
    };

    await executeImport(ctx, "exec-002", profile, runtimeParams);

    // Should have written the input payload
    expect(storageStub.written["test-hotel/exec-002/input.txt"]).toBe(VALID_JANA_INPUT);

    // Should have updated execution with payload key
    const payloadUpdate = dbStub.execUpdates.find((u: any) => u.inputPayloadKey);
    expect(payloadUpdate).toBeDefined();
  });

  it("saves both payloads when savePayload is BOTH", async () => {
    createJournalMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/vouchers.csv": VALID_JANA_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile({ savePayload: "BOTH" });
    const runtimeParams = {
      filePath: "test-hotel/vouchers.csv",
      entityId: "entity-001",
      periodId: "period-001"
    };

    await executeImport(ctx, "exec-003", profile, runtimeParams);

    expect(storageStub.written["test-hotel/exec-003/input.txt"]).toBeDefined();
    expect(storageStub.written["test-hotel/exec-003/output.json"]).toBeDefined();
  });
});

describe("executeImport — error cases", () => {
  it("fails with MISSING_SOURCE_FORMAT when no source format", async () => {
    const dbStub = createStubDb();
    const storageStub = createStubStorage();
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile({ sourceFormat: null });

    const result = await executeImport(ctx, "exec-err-01", profile, {});

    expect(result.errorMessage).toContain("MISSING_SOURCE_FORMAT");
    expect(result.recordsFailed).toBe(0);
    expect(result.recordsTotal).toBe(0);
  });

  it("fails with MISSING_TARGET_COMPONENT when no target component", async () => {
    const dbStub = createStubDb();
    const storageStub = createStubStorage();
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile({ targetComponent: null });

    const result = await executeImport(ctx, "exec-err-02", profile, {});

    expect(result.errorMessage).toContain("MISSING_TARGET_COMPONENT");
  });

  it("fails with FILE_READ_ERROR when file does not exist", async () => {
    const dbStub = createStubDb();
    const storageStub = createStubStorage({}); // no files
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile();
    const runtimeParams = { filePath: "test-hotel/missing.csv" };

    const result = await executeImport(ctx, "exec-err-03", profile, runtimeParams);

    expect(result.errorMessage).toContain("FILE_READ_ERROR");
    expect(result.errorMessage).toContain("missing.csv");
  });

  it("fails with INVALID_FSD when fsdXml is not valid JSON", async () => {
    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/input.csv": VALID_JANA_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile({
      sourceFormat: {
        id: "fmt-bad",
        fsdXml: "not-json",
        classification: "DELIMITED"
      }
    });
    const runtimeParams = { filePath: "test-hotel/input.csv" };

    const result = await executeImport(ctx, "exec-err-04", profile, runtimeParams);

    expect(result.errorMessage).toContain("INVALID_FSD");
  });

  it("fails with UNSUPPORTED_COMPONENT for unknown target", async () => {
    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/input.csv": VALID_JANA_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile({ targetComponent: "INVENTORY" });
    const runtimeParams = {
      filePath: "test-hotel/input.csv",
      entityId: "entity-001",
      periodId: "period-001"
    };

    const result = await executeImport(ctx, "exec-err-05", profile, runtimeParams);

    expect(result.errorMessage).toContain("UNSUPPORTED_COMPONENT");
  });

  it("resolves file path from profile sourceParams when no runtimeParams.filePath", async () => {
    createJournalMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/daily-vouchers.csv": VALID_JANA_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile({
      sourceParams: { fileName: "daily-vouchers.csv" }
    });
    const runtimeParams = { entityId: "entity-001", periodId: "period-001" };

    const result = await executeImport(ctx, "exec-path-01", profile, runtimeParams);

    expect(storageStub.storage.read).toHaveBeenCalledWith("test-hotel/daily-vouchers.csv");
    expect(result.recordsTotal).toBe(2);
  });
});
