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

vi.mock("../src/db/requestContext.js", () => ({
  runWithContext: (_ctx: unknown, fn: () => unknown) => fn()
}));

import {
  executeExport,
  executeProcess,
  type PipelineContext,
  type ProfileWithRelations
} from "../src/jobs/transfer-desk-pipeline.js";
import { mapRecordsToTarget, type TargetParams } from "../src/jobs/transfer-desk-record-mapper.js";

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
      transferProfile: {
        findUnique: vi.fn().mockResolvedValue(null)
      },
      transferExecution: {
        update: vi.fn(async (args: any) => {
          execUpdates.push(args.data);
          return {};
        })
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
      targetFormat: null
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

  it("maps records to GL_JOURNAL with fieldMap applied", () => {
    const records: FsdRecordValue[] = [
      { acctCode: "50010", dr: 100, cr: 0, desc: "Line 1" },
      { acctCode: "20010", dr: 0, cr: 100, desc: "Line 2" }
    ];

    const params: TargetParams = {
      fieldMap: {
        acctCode: "accountId",
        dr: "debit",
        cr: "credit",
        desc: "description"
      },
      periodId: "period-001",
      functionalCurrency: "USD",
      entityId: "entity-001"
    };

    const result = mapRecordsToTarget("GL_JOURNAL", records, params);

    expect(result.ok).toBe(true);
    if (result.ok && result.component === "GL_JOURNAL") {
      expect(result.journals).toHaveLength(1);
      expect(result.journals[0]!.input.lines).toHaveLength(2);
      expect(result.journals[0]!.input.lines[0]!.accountId).toBe("50010");
      expect(result.journals[0]!.input.lines[0]!.debit).toBe("100");
      expect(result.journals[0]!.input.lines[0]!.credit).toBe("0");
      expect(result.journals[0]!.input.source).toBe("IMPORT");
      expect(result.journals[0]!.input.periodId).toBe("period-001");
    }
  });

  it("groups records by groupBy field into separate journals", () => {
    const records: FsdRecordValue[] = [
      { batchNo: "B1", accountId: "50010", debit: 100, credit: 0 },
      { batchNo: "B1", accountId: "20010", debit: 0, credit: 100 },
      { batchNo: "B2", accountId: "60010", debit: 200, credit: 0 },
      { batchNo: "B2", accountId: "20010", debit: 0, credit: 200 }
    ];

    const params: TargetParams = {
      groupBy: "batchNo",
      periodId: "period-001",
      functionalCurrency: "EUR"
    };

    const result = mapRecordsToTarget("GL_JOURNAL", records, params);

    expect(result.ok).toBe(true);
    if (result.ok && result.component === "GL_JOURNAL") {
      expect(result.journals).toHaveLength(2);
      expect(result.journals[0]!.input.lines).toHaveLength(2);
      expect(result.journals[1]!.input.lines).toHaveLength(2);
      expect(result.journals[0]!.sourceIndices).toEqual([0, 1]);
      expect(result.journals[1]!.sourceIndices).toEqual([2, 3]);
    }
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
