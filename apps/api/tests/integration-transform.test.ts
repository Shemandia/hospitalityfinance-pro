import { describe, expect, it, vi } from "vitest";
import type { FsdSchema } from "@hfp/fsd-engine";

// Allow the (insecure) Node vm fallback on dev machines without isolated-vm
process.env.TML_ALLOW_INSECURE_SANDBOX ??= "true";

// ── Mock AP/AR services before importing the pipeline ──────────────────────
// Ledger imports post canonical documents; a fake poster records them.

const postMock = vi.fn(async () => ({
  status: "POSTED",
  journalId: "journal-001",
  entityId: "entity-001"
}));
const poster = { post: postMock, postAll: vi.fn() };

vi.mock("../src/modules/ap/service.js", () => ({
  APService: class {
    createInvoice = vi.fn().mockResolvedValue({ id: "ap-inv-001" });
  }
}));

vi.mock("../src/modules/ar/service.js", () => ({
  ARService: class {
    createInvoice = vi.fn().mockResolvedValue({ id: "ar-inv-001" });
  }
}));

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

// ── Jana voucher FSD schema (semicolon-delimited, 9 fields) ────────────────

const janaSchema: FsdSchema = {
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

const janaFsdJson = JSON.stringify(janaSchema);

// ── Test data: Jana internal movements (÷1000 implied decimals) ─────────────

const JANA_INTERNAL_MOVEMENT_INPUT =
  "EZZ-IM001;INTMV;30010;500000;0;Transfer to Kitchen;2026-04-01;EZZ;TZS\n" +
  "EZZ-IM001;INTMV;30020;0;500000;Transfer from Store;2026-04-01;EZZ;TZS";

// ── Test data: Jana purchasing vouchers (whole integers, no transform) ──────

const JANA_PURCHASING_INPUT =
  "EZZ-PV001;PURCH;50010;385000;0;Rice 50kg;2026-04-01;EZZ;TZS\n" +
  "EZZ-PV001;PURCH;20010;0;385000;Control;2026-04-01;EZZ;TZS";

// ── TML definitions ────────────────────────────────────────────────────────

/** Transformation that applies ÷1000 to debit and credit fields */
const divideBy1000Rules = [
  { type: "map" as const, target: "sourceDocumentRef", sources: [{ path: "sourceDocumentRef" }] },
  { type: "map" as const, target: "journalTypeCode", sources: [{ path: "journalTypeCode" }] },
  { type: "map" as const, target: "accountCode", sources: [{ path: "accountCode" }] },
  {
    type: "transform" as const,
    target: "debit",
    function: {
      name: "divideBy1000",
      params: [{ value: "debit", fromSource: true, type: "number" as const }]
    }
  },
  {
    type: "transform" as const,
    target: "credit",
    function: {
      name: "divideBy1000",
      params: [{ value: "credit", fromSource: true, type: "number" as const }]
    }
  },
  { type: "map" as const, target: "description", sources: [{ path: "description" }] },
  { type: "map" as const, target: "documentDate", sources: [{ path: "documentDate" }] },
  { type: "map" as const, target: "entityCode", sources: [{ path: "entityCode" }] },
  { type: "map" as const, target: "currency", sources: [{ path: "currency" }] }
];

/** Transformation that just maps fields through (identity, for PV) */
const identityRules = [
  { type: "map" as const, target: "sourceDocumentRef", sources: [{ path: "sourceDocumentRef" }] },
  { type: "map" as const, target: "journalTypeCode", sources: [{ path: "journalTypeCode" }] },
  { type: "map" as const, target: "accountCode", sources: [{ path: "accountCode" }] },
  { type: "map" as const, target: "debit", sources: [{ path: "debit" }] },
  { type: "map" as const, target: "credit", sources: [{ path: "credit" }] },
  { type: "map" as const, target: "description", sources: [{ path: "description" }] },
  { type: "map" as const, target: "documentDate", sources: [{ path: "documentDate" }] },
  { type: "map" as const, target: "entityCode", sources: [{ path: "entityCode" }] },
  { type: "map" as const, target: "currency", sources: [{ path: "currency" }] }
];

/** Transformation with a lookup table substitution for department codes */
const lookupRules = [
  { type: "map" as const, target: "accountCode", sources: [{ path: "accountCode" }] },
  {
    type: "lookup" as const,
    table: "deptMap",
    target: "department",
    source: "accountCode",
    unknown: "copy" as const
  }
];

// ── Helpers ────────────────────────────────────────────────────────────────

function createStubDb() {
  const logs: Record<string, unknown>[] = [];
  const execUpdates: Record<string, unknown>[] = [];

  return {
    db: {
      integrationProfile: {
        findUnique: vi.fn().mockResolvedValue(null)
      },
      // The tenant's lookup tables (none here).
      integrationLookupTable: { findMany: vi.fn().mockResolvedValue([]) },
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

function makeProfile(overrides: Partial<ProfileWithRelations> = {}): ProfileWithRelations {
  return {
    id: "prof-001",
    name: "Jana Import",
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

describe("executeImport with TML transformation — Jana ÷1000 rule", () => {
  it("applies ÷1000 to internal movement debit/credit fields", async () => {
    postMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/movements.csv": JANA_INTERNAL_MOVEMENT_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeProfile({
      transformationId: "txf-001",
      transformation: {
        id: "txf-001",
        rulesJson: divideBy1000Rules,
        functionsJson: null
      }
    });

    const result = await executeImport(ctx, "exec-001", profile, {
      filePath: "test-hotel/movements.csv",
      entityId: "entity-001",
      periodId: "period-001"
    });

    expect(result.recordsSucceeded).toBeGreaterThan(0);
    expect(result.recordsFailed).toBe(0);

    // Verify the document posted carries the transformed (÷1000) amounts
    expect(postMock).toHaveBeenCalledTimes(1);
    const journalInput = (postMock.mock.calls[0] as unknown as [any])[0];

    // The transformed records should have debit=500 and credit=500 (not 500000)
    const lines = journalInput.lines ?? journalInput;
    if (Array.isArray(lines)) {
      // Check the debit line (first record: debit=500000 → 500 after ÷1000)
      const debitLine = lines.find((l: any) => Number(l.debit) > 0);
      expect(debitLine).toBeDefined();
      if (debitLine) {
        expect(Number(debitLine.debit)).toBe(500);
      }
    }
  });

  it("passes purchasing vouchers through without transformation", async () => {
    postMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/vouchers.csv": JANA_PURCHASING_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    // No transformation — profile has no transformationId
    const profile = makeProfile();

    const result = await executeImport(ctx, "exec-002", profile, {
      filePath: "test-hotel/vouchers.csv",
      entityId: "entity-001",
      periodId: "period-001"
    });

    expect(result.recordsSucceeded).toBeGreaterThan(0);
    expect(result.recordsFailed).toBe(0);

    // Verify the GL journal was created with original amounts (no ÷1000)
    expect(postMock).toHaveBeenCalledTimes(1);
    const journalInput = (postMock.mock.calls[0] as unknown as [any])[0];
    const lines = journalInput.lines ?? journalInput;
    if (Array.isArray(lines)) {
      const debitLine = lines.find((l: any) => Number(l.debit) > 0);
      expect(debitLine).toBeDefined();
      if (debitLine) {
        expect(Number(debitLine.debit)).toBe(385000);
      }
    }
  });

  it("purchasing vouchers with identity transformation keep whole integers", async () => {
    postMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/vouchers.csv": JANA_PURCHASING_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    // Identity transformation — maps all fields 1:1 without dividing
    const profile = makeProfile({
      transformationId: "txf-002",
      transformation: {
        id: "txf-002",
        rulesJson: identityRules,
        functionsJson: null
      }
    });

    const result = await executeImport(ctx, "exec-003", profile, {
      filePath: "test-hotel/vouchers.csv",
      entityId: "entity-001",
      periodId: "period-001"
    });

    expect(result.recordsSucceeded).toBeGreaterThan(0);

    // Verify amounts are still 385000 (not divided)
    expect(postMock).toHaveBeenCalledTimes(1);
    const journalInput = (postMock.mock.calls[0] as unknown as [any])[0];
    const lines = journalInput.lines ?? journalInput;
    if (Array.isArray(lines)) {
      const debitLine = lines.find((l: any) => Number(l.debit) > 0);
      expect(debitLine).toBeDefined();
      if (debitLine) {
        expect(Number(debitLine.debit)).toBe(385000);
      }
    }
  });
});

describe("executeImport — transformation error logging", () => {
  it("logs TRANSFORM_ERROR for records that fail transformation", async () => {
    postMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/test.csv": JANA_PURCHASING_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    // Use a transformation with a lookup rule that will fail (no lookup tables provided)
    const profile = makeProfile({
      transformationId: "txf-bad",
      transformation: {
        id: "txf-bad",
        rulesJson: [
          {
            type: "lookup",
            table: "nonExistentTable",
            target: "department",
            source: "accountCode"
          }
        ],
        functionsJson: null
      }
    });

    const result = await executeImport(ctx, "exec-004", profile, {
      filePath: "test-hotel/test.csv",
      entityId: "entity-001",
      periodId: "period-001"
    });

    // Both records fail the transformation, so their document is refused
    // whole and nothing posts.
    expect(result.recordsFailed).toBe(2);
    expect(result.recordsSucceeded).toBe(0);
    expect(postMock).not.toHaveBeenCalled();

    // Each record is logged with the transformation's error.
    const transformLogs = dbStub.logs.filter((l) => l.errorCode === "TRANSFORM_ERROR");
    expect(transformLogs.length).toBe(2);
    expect(String(transformLogs[0]!.errorMessage)).toContain(
      'lookup table "nonExistentTable" not found'
    );
  });

  it("skips transformation step when profile has no transformationId", async () => {
    postMock.mockClear();

    const dbStub = createStubDb();
    const storageStub = createStubStorage({
      "test-hotel/vouchers.csv": JANA_PURCHASING_INPUT
    });
    const ctx = createCtx(dbStub, storageStub);

    const profile = makeProfile({ transformation: null, transformationId: null });

    const result = await executeImport(ctx, "exec-005", profile, {
      filePath: "test-hotel/vouchers.csv",
      entityId: "entity-001",
      periodId: "period-001"
    });

    // Should succeed with no transformation errors
    expect(result.recordsSucceeded).toBeGreaterThan(0);

    // No TRANSFORM_ERROR logs
    const transformLogs = dbStub.logs.filter((l) => l.errorCode === "TRANSFORM_ERROR");
    expect(transformLogs).toHaveLength(0);
  });
});
