import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mock the queue module ────────────────────────────────────────────────────

const enqueueMock = vi.fn().mockResolvedValue("job-id");

vi.mock("../src/jobs/transfer-desk-queue.js", () => ({
  enqueueTransferDeskExecution: (...args: unknown[]) => enqueueMock(...args)
}));

import {
  executeAutomation,
  type AutomationStep,
  type AutomationContext
} from "../src/jobs/automation-engine.js";

// ── Mock DB ──────────────────────────────────────────────────────────────────

let executionCounter = 0;
/** Tracks status per executionId — tests set this to control poll results */
const executionStatusMap = new Map<string, { status: string; errorMessage: string | null }>();

function makeMockDb() {
  executionCounter = 0;
  executionStatusMap.clear();

  return {
    transferExecution: {
      create: vi.fn().mockImplementation(({ data }) => {
        executionCounter++;
        const id = `exec-${executionCounter}`;
        // Default: COMPLETED on first poll
        executionStatusMap.set(id, { status: "COMPLETED", errorMessage: null });
        return Promise.resolve({ id, ...data });
      }),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const entry = executionStatusMap.get(where.id);
        return Promise.resolve(entry ?? null);
      })
    }
  };
}

function makeCtx(db: ReturnType<typeof makeMockDb>): AutomationContext {
  return {
    db,
    tenantSlug: "test-hotel",
    tenantDbUrl: "postgres://test",
    triggeredBy: "test-user"
  };
}

function makeStep(overrides: Partial<AutomationStep> = {}): AutomationStep {
  return {
    id: `step-${overrides.stepOrder ?? 1}`,
    profileId: `profile-${overrides.stepOrder ?? 1}`,
    stepOrder: 1,
    failOnError: true,
    sourceParamOverrides: null,
    targetParamOverrides: null,
    ...overrides
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("automation-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes all steps sequentially → COMPLETED", async () => {
    const db = makeMockDb();
    const ctx = makeCtx(db);
    const steps = [
      makeStep({ stepOrder: 1, profileId: "p1" }),
      makeStep({ stepOrder: 2, profileId: "p2" }),
      makeStep({ stepOrder: 3, profileId: "p3" })
    ];

    const result = await executeAutomation(ctx, "auto-1", steps);

    expect(result.status).toBe("COMPLETED");
    expect(result.stepsTotal).toBe(3);
    expect(result.stepsSucceeded).toBe(3);
    expect(result.stepsFailed).toBe(0);
    expect(result.stepResults).toHaveLength(3);
    expect(enqueueMock).toHaveBeenCalledTimes(3);

    // Verify execution rows were created in order
    expect(db.transferExecution.create).toHaveBeenCalledTimes(3);
    const firstCall = (db.transferExecution.create as any).mock.calls[0][0];
    expect(firstCall.data.profileId).toBe("p1");
    expect(firstCall.data.automationStepOrder).toBe(1);
  });

  it("stops on fail-on-error step → FAILED", async () => {
    const db = makeMockDb();
    const ctx = makeCtx(db);
    const steps = [
      makeStep({ stepOrder: 1, profileId: "p1", failOnError: true }),
      makeStep({ stepOrder: 2, profileId: "p2", failOnError: true }),
      makeStep({ stepOrder: 3, profileId: "p3", failOnError: true })
    ];

    // Make step 2 fail: override findUnique to return FAILED for exec-2
    const origCreate = db.transferExecution.create;
    db.transferExecution.create = vi.fn().mockImplementation(({ data }) => {
      executionCounter++;
      const id = `exec-${executionCounter}`;
      if (executionCounter === 2) {
        executionStatusMap.set(id, { status: "FAILED", errorMessage: "Step 2 broke" });
      } else {
        executionStatusMap.set(id, { status: "COMPLETED", errorMessage: null });
      }
      return Promise.resolve({ id, ...data });
    });

    const result = await executeAutomation(ctx, "auto-2", steps);

    expect(result.status).toBe("FAILED");
    expect(result.stepsSucceeded).toBe(1);
    expect(result.stepsFailed).toBe(1);
    // Step 3 should never have run
    expect(result.stepResults).toHaveLength(2);
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("continues past failed step when failOnError=false → PARTIAL", async () => {
    const db = makeMockDb();
    const ctx = makeCtx(db);
    const steps = [
      makeStep({ stepOrder: 1, profileId: "p1", failOnError: true }),
      makeStep({ stepOrder: 2, profileId: "p2", failOnError: false }),
      makeStep({ stepOrder: 3, profileId: "p3", failOnError: true })
    ];

    // Make step 2 fail
    db.transferExecution.create = vi.fn().mockImplementation(({ data }) => {
      executionCounter++;
      const id = `exec-${executionCounter}`;
      if (executionCounter === 2) {
        executionStatusMap.set(id, { status: "FAILED", errorMessage: "Soft fail" });
      } else {
        executionStatusMap.set(id, { status: "COMPLETED", errorMessage: null });
      }
      return Promise.resolve({ id, ...data });
    });

    const result = await executeAutomation(ctx, "auto-3", steps);

    expect(result.status).toBe("PARTIAL");
    expect(result.stepsSucceeded).toBe(2);
    expect(result.stepsFailed).toBe(1);
    expect(result.stepResults).toHaveLength(3);
    // All 3 steps should have been enqueued
    expect(enqueueMock).toHaveBeenCalledTimes(3);
  });

  it("empty automation (0 steps) → COMPLETED", async () => {
    const db = makeMockDb();
    const ctx = makeCtx(db);

    const result = await executeAutomation(ctx, "auto-empty", []);

    expect(result.status).toBe("COMPLETED");
    expect(result.stepsTotal).toBe(0);
    expect(result.stepsSucceeded).toBe(0);
    expect(result.stepsFailed).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("merges runtime params with step-level overrides", async () => {
    const db = makeMockDb();
    const ctx = makeCtx(db);
    const steps = [
      makeStep({
        stepOrder: 1,
        profileId: "p1",
        sourceParamOverrides: { filePath: "/override/input.csv" },
        targetParamOverrides: { entityId: "ent-999" }
      })
    ];

    await executeAutomation(ctx, "auto-params", steps, {
      periodId: "period-2026-01",
      entityId: "ent-default"
    });

    const createCall = (db.transferExecution.create as any).mock.calls[0][0];
    // Step overrides should merge on top of runtime params
    expect(createCall.data.runtimeParams).toEqual({
      periodId: "period-2026-01",
      entityId: "ent-999", // overridden by step
      filePath: "/override/input.csv" // from step source overrides
    });
  });
});
