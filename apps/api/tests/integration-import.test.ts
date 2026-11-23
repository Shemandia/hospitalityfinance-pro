import { describe, expect, it, vi } from "vitest";
import type { FsdSchema } from "@hfp/fsd-engine";

// ── Mock AP/AR services before importing the pipeline ──────────────────────
// Ledger imports post canonical documents through the posting service; the
// tests give the pipeline a fake poster that records what it receives.

const postMock = vi.fn(async () => ({
  status: "POSTED",
  journalId: "journal-001",
  entityId: "entity-001"
}));
const poster = { post: postMock, postAll: vi.fn() };
const createApInvoiceMock = vi.fn().mockResolvedValue({ id: "ap-inv-001" });
const createArInvoiceMock = vi.fn().mockResolvedValue({ id: "ar-inv-001" });

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

// The pipeline sets the acting user in the context it opens; the mocked
// system-user module reads it back, as the real one does.
const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("../src/db/requestContext.js", () => ({
  runWithContext: (ctx: { userId?: string | null }, fn: () => unknown) => {
    acting.userId = ctx?.userId ?? null;
    return fn();
  }
}));
vi.mock("../src/db/rls-bypass.js", () => ({
  withBypassRLS: async (_db: unknown, fn: (tx: unknown) => unknown) =>
    fn({ entity: { findUnique: async () => ({ id: "entity-001", code: "EZZ" }) } })
}));
vi.mock("../src/modules/access/system-user.js", () => ({
  systemUserId: async () => "system-user",
  actingUserId: async () => acting.userId ?? "system-user"
}));

import {
  executeImport,
  type PipelineContext,
  type ProfileWithRelations
} from "../src/jobs/integration-pipeline.js";

// ── Jana voucher FSD schema (semicolon-delimited) ──────────────────────────
// The fields carry the contract's names, so no transformation is needed:
// records with the same entity and sourceDocumentRef form one document.

const janaVoucherSchema: FsdSchema = {
  classification: "DELIMITED",
  fieldSep: ";",
  recordSep: "\n",
  record: {
    name: "voucher",
    fields: [
      { name: "sourceDocumentRef", type: "string", required: true, maxLength: 20 },
      { name: "journalTypeCode", type: "string", required: true, maxLength: 10 },
      { name: "accountCode", type: "string", required: true, maxLength: 20 },
      { name: "debit", type: "integer", required: true, maxLength: 15 },
      { name: "credit", type: "integer", required: true, maxLength: 15 },
      { name: "description", type: "string", maxLength: 200 },
      { name: "documentDate", type: "date", required: true, maxLength: 10 },
      { name: "entityCode", type: "string", maxLength: 20 },
      { name: "currency", type: "string", maxLength: 3 }
    ]
  }
};

const janaFsdJson = JSON.stringify(janaVoucherSchema);

// ── Test data ──────────────────────────────────────────────────────────────

const VALID_JANA_INPUT =
  "EZZ-PV001;PURCH;50010;385000;0;Rice 50kg;2026-04-01;EZZ;TZS\n" +
  "EZZ-PV001;PURCH;20010;0;385000;Control;2026-04-01;EZZ;TZS";

// ── Helpers ────────────────────────────────────────────────────────────────

function createStubDb() {
  const logs: Record<string, unknown>[] = [];
  const execUpdates: Record<string, unknown>[] = [];

  return {
    db: {
      integrationProfile: {
        findUnique: vi.fn().mockResolvedValue(null)
      },
      integrationExecution: {
        update: vi.fn(async (args: any) => {
          execUpdates.push(args.data);
          return {};
        }),
        findUnique: vi.fn().mockResolvedValue(null)
      },
      integrationExecutionLog: {
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
    poster: poster as any,
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
    targetParams: { journalSource: "IMPORT" },
    sourceSystemCode: "JANA",
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
  it("parses a 2-line Jana file into one document of 2 lines and posts it", async () => {
    postMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/vouchers.csv": VALID_JANA_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeImportProfile();
    const runtimeParams = {
      filePath: "test-hotel/vouchers.csv",
      entityId: "entity-001",
      triggeredBy: "00000000-0000-4000-8000-000000000001"
    };

    const result = await executeImport(ctx, "exec-001", profile, runtimeParams);

    // Should have processed 2 records
    expect(result.recordsTotal).toBe(2);
    expect(result.recordsSucceeded).toBe(2);
    expect(result.recordsFailed).toBe(0);
    expect(result.errorMessage).toBeUndefined();

    // One document: both records share entity and reference.
    expect(postMock).toHaveBeenCalledTimes(1);
    const [document, options] = postMock.mock.calls[0] as unknown as [any, any];
    expect(document).toMatchObject({
      contractVersion: 1,
      documentType: "GL_JOURNAL",
      sourceSystem: "JANA",
      sourceDocumentRef: "EZZ-PV001",
      entityCode: "EZZ",
      documentDate: "2026-04-01",
      journalTypeCode: "PURCH",
      currency: "TZS",
      lines: [
        { accountCode: "50010", debit: "385000", credit: "0", description: "Rice 50kg" },
        { accountCode: "20010", debit: "0", credit: "385000", description: "Control" }
      ]
    });
    // Recorded as the user who ran the import, never the entity id (IMP-01).
    expect(options).toMatchObject({
      actorUserId: "00000000-0000-4000-8000-000000000001",
      journalSource: "IMPORT"
    });

    // Should have logged 2 SUCCESS records
    const successLogs = dbStub.logs.filter((l) => l.status === "SUCCESS");
    expect(successLogs).toHaveLength(2);
  });

  it("saves input payload when savePayload is INPUT", async () => {
    postMock.mockClear();

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
    postMock.mockClear();

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
    postMock.mockClear();

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
