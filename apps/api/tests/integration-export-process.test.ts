import { describe, expect, it, vi } from "vitest";
import type { FsdSchema, FsdRecordValue } from "@hfp/fsd-engine";

// ── Mock GL/AP/AR services ─────────────────────────────────────────────────

const listJournalsMock = vi.fn().mockResolvedValue([]);
const listApInvoicesMock = vi.fn().mockResolvedValue([]);
const listArInvoicesMock = vi.fn().mockResolvedValue([]);

vi.mock("../src/modules/gl/service.js", () => ({
  GLService: class {
    listJournals = listJournalsMock;
  }
}));

vi.mock("../src/modules/ap/service.js", () => ({
  APService: class {
    listInvoices = listApInvoicesMock;
  }
}));

vi.mock("../src/modules/ar/service.js", () => ({
  ARService: class {
    listInvoices = listArInvoicesMock;
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
vi.mock("../src/modules/access/system-user.js", () => ({
  systemUserId: async () => "system-user",
  actingUserId: async () => acting.userId ?? "system-user"
}));

import {
  executeExport,
  executeProcess,
  type PipelineContext,
  type ProfileWithRelations
} from "../src/jobs/integration-pipeline.js";
import { mapRecordsToTarget, type TargetParams } from "../src/jobs/integration-record-mapper.js";

// ── FSD schema for export ──────────────────────────────────────────────────

const exportSchema: FsdSchema = {
  classification: "DELIMITED",
  fieldSep: ";",
  recordSep: "\n",
  record: {
    name: "line",
    fields: [
      { name: "journalId", type: "string", required: true, maxLength: 50 },
      { name: "accountId", type: "string", required: true, maxLength: 50 },
      { name: "debit", type: "string", required: true, maxLength: 20 },
      { name: "credit", type: "string", required: true, maxLength: 20 },
      { name: "description", type: "string", maxLength: 200 }
    ]
  }
};

const exportFsdJson = JSON.stringify(exportSchema);

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
        })
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
    storage: storageStub.storage,
    tenantSlug: "test-hotel",
    tenantDbUrl: "postgresql://localhost/test"
  };
}

function makeExportProfile(overrides: Partial<ProfileWithRelations> = {}): ProfileWithRelations {
  return {
    id: "prof-export-001",
    name: "GL Export",
    profileType: "EXPORT",
    sourceComponent: "GL_JOURNAL",
    targetComponent: null,
    sourceFormatId: null,
    targetFormatId: "fmt-export-001",
    transformationId: null,
    sourceParams: null,
    targetParams: null,
    savePayload: "NONE",
    sourceFormat: null,
    targetFormat: {
      id: "fmt-export-001",
      fsdXml: exportFsdJson,
      classification: "DELIMITED"
    },
    transformation: null,
    ...overrides
  };
}

// ── Export tests ────────────────────────────────────────────────────────────

describe("executeExport — happy path (GL_JOURNAL → file)", () => {
  it("reads GL journal lines and writes a delimited file", async () => {
    listJournalsMock.mockClear();
    listJournalsMock.mockResolvedValueOnce([
      {
        id: "j-001",
        reference: "REF-001",
        periodId: "per-001",
        lines: [
          { accountId: "acc-001", debit: "500", credit: "0", description: "Debit line" },
          { accountId: "acc-002", debit: "0", credit: "500", description: "Credit line" }
        ]
      }
    ]);

    const dbStub = createStubDb();
    const storageStub = createStubStorage();
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeExportProfile();
    const runtimeParams = {
      entityId: "entity-001",
      periodId: "period-001",
      triggeredBy: "user-001"
    };

    const result = await executeExport(ctx, "exec-exp-01", profile, runtimeParams);

    expect(result.recordsTotal).toBe(2);
    expect(result.recordsSucceeded).toBe(2);
    expect(result.errorMessage).toBeUndefined();

    // Should have written output file
    expect(storageStub.storage.write).toHaveBeenCalled();
    const writtenKeys = Object.keys(storageStub.written);
    expect(writtenKeys.length).toBeGreaterThanOrEqual(1);

    // Should have logged 2 SUCCESS records
    const successLogs = dbStub.logs.filter((l) => l.status === "SUCCESS");
    expect(successLogs).toHaveLength(2);
  });
});

describe("executeExport — error cases", () => {
  it("fails with MISSING_TARGET_FORMAT when no target format", async () => {
    const dbStub = createStubDb();
    const storageStub = createStubStorage();
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeExportProfile({ targetFormat: null });

    const result = await executeExport(ctx, "exec-exp-err-01", profile, {});

    expect(result.errorMessage).toContain("MISSING_TARGET_FORMAT");
  });

  it("fails with MISSING_SOURCE_COMPONENT when no source component", async () => {
    const dbStub = createStubDb();
    const storageStub = createStubStorage();
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeExportProfile({ sourceComponent: null });

    const result = await executeExport(ctx, "exec-exp-err-02", profile, {});

    expect(result.errorMessage).toContain("MISSING_SOURCE_COMPONENT");
  });

  it("fails with NO_RECORDS when source returns empty data", async () => {
    listJournalsMock.mockClear();
    listJournalsMock.mockResolvedValueOnce([]);

    const dbStub = createStubDb();
    const storageStub = createStubStorage();
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeExportProfile();
    const runtimeParams = { entityId: "entity-001" };

    const result = await executeExport(ctx, "exec-exp-err-03", profile, runtimeParams);

    expect(result.errorMessage).toContain("NO_RECORDS");
  });

  it("fails with INVALID_FSD when target fsdXml is not valid JSON", async () => {
    const dbStub = createStubDb();
    const storageStub = createStubStorage();
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeExportProfile({
      targetFormat: {
        id: "fmt-bad",
        fsdXml: "not-json!!!",
        classification: "DELIMITED"
      }
    });

    const result = await executeExport(ctx, "exec-exp-err-04", profile, {});

    expect(result.errorMessage).toContain("INVALID_FSD");
  });
});

// ── Process pipeline tests ─────────────────────────────────────────────────

describe("executeProcess — stub returns UNSUPPORTED_PROCESS", () => {
  it("returns error for PROCESS profile type", async () => {
    const dbStub = createStubDb();
    const storageStub = createStubStorage();
    const ctx = createCtx(dbStub, storageStub);

    const profile: ProfileWithRelations = {
      id: "prof-proc-001",
      name: "Daily Rate Load",
      profileType: "PROCESS",
      sourceComponent: null,
      targetComponent: "RATE_ENGINE",
      sourceFormatId: null,
      targetFormatId: null,
      transformationId: null,
      sourceParams: null,
      targetParams: null,
      savePayload: "NONE",
      sourceFormat: null,
      targetFormat: null,
      transformation: null
    };

    const result = await executeProcess(ctx, "exec-proc-01", profile);

    expect(result.errorMessage).toContain("UNSUPPORTED_PROCESS");
    expect(result.recordsTotal).toBe(0);
  });
});

// ── Record mapper tests ────────────────────────────────────────────────────

describe("mapRecordsToTarget", () => {
  it("returns UNSUPPORTED_COMPONENT for unknown target", () => {
    const records: FsdRecordValue[] = [{ foo: "bar" }];
    const result = mapRecordsToTarget("INVENTORY_SYSTEM", records, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNSUPPORTED_COMPONENT");
    }
  });

  it("does not map ledger imports: they become documents and go through the posting service", () => {
    const records: FsdRecordValue[] = [{ accountCode: "50010", debit: 100, credit: 0 }];
    const result = mapRecordsToTarget("GL_JOURNAL", records, {});
    expect(result).toMatchObject({ ok: false, code: "UNSUPPORTED_COMPONENT" });
  });

  it("maps AP_INVOICE records 1:1", () => {
    const records: FsdRecordValue[] = [
      { vendorId: "v-001", amount: 500, invoiceNo: "INV-001" },
      { vendorId: "v-002", amount: 300, invoiceNo: "INV-002" }
    ];

    const result = mapRecordsToTarget("AP_INVOICE", records, {});

    expect(result.ok).toBe(true);
    if (result.ok && result.component === "AP_INVOICE") {
      expect(result.records).toHaveLength(2);
      expect(result.records[0]!.data.vendorId).toBe("v-001");
      expect(result.records[1]!.index).toBe(1);
    }
  });

  it("maps AR_INVOICE records 1:1", () => {
    const records: FsdRecordValue[] = [{ customerId: "c-001", amount: 1000, invoiceNo: "AR-001" }];

    const result = mapRecordsToTarget("AR_INVOICE", records, {});

    expect(result.ok).toBe(true);
    if (result.ok && result.component === "AR_INVOICE") {
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.data.customerId).toBe("c-001");
    }
  });
});
