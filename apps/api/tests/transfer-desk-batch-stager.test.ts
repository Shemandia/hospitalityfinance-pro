import { describe, expect, it } from "vitest";
import {
  stageJournalItems,
  resolveReviewMode,
  type StageContext
} from "../src/jobs/transfer-desk-batch-stager.js";
import type { MappedJournal } from "../src/jobs/transfer-desk-record-mapper.js";

function journal(
  lines: Array<{ accountId: string; debit: string; credit: string; fxRate?: string }>
): MappedJournal {
  return {
    entityId: "e1",
    sourceIndices: [0],
    input: {
      periodId: "p1",
      source: "IMPORT",
      functionalCurrency: "USD",
      lines: lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit,
        credit: l.credit,
        currency: "USD",
        fxRate: l.fxRate ?? "1"
      }))
    } as any
  };
}

const ctx: StageContext = {
  validAccountKeys: new Set(["1000", "2000"]),
  periodStatusById: new Map([["p1", "OPEN"]])
};

describe("stageJournalItems", () => {
  it("marks a balanced, valid journal OK/HELD", () => {
    const items = stageJournalItems(
      [
        journal([
          { accountId: "1000", debit: "100", credit: "0" },
          { accountId: "2000", debit: "0", credit: "100" }
        ])
      ],
      ctx
    );
    expect(items[0].validationStatus).toBe("OK");
    expect(items[0].status).toBe("HELD");
    expect(items[0].itemIndex).toBe(0);
    expect(items[0].sourceRecordIndices).toEqual([0]);
  });

  it("flags an unbalanced functional journal as ERROR (uses debit*fxRate)", () => {
    const items = stageJournalItems(
      [
        journal([
          { accountId: "1000", debit: "100", credit: "0", fxRate: "1.10" },
          { accountId: "2000", debit: "0", credit: "100", fxRate: "1.05" }
        ])
      ],
      ctx
    );
    expect(items[0].validationStatus).toBe("ERROR");
    expect(items[0].status).toBe("ERROR");
    expect(items[0].validationMessages.some((m) => m.code === "UNBALANCED_FUNCTIONAL")).toBe(true);
  });

  it("flags a missing account as ERROR", () => {
    const items = stageJournalItems(
      [
        journal([
          { accountId: "9999", debit: "100", credit: "0" },
          { accountId: "2000", debit: "0", credit: "100" }
        ])
      ],
      ctx
    );
    expect(items[0].validationStatus).toBe("ERROR");
    expect(items[0].validationMessages.some((m) => m.code === "ACCOUNT_NOT_FOUND")).toBe(true);
  });

  it("flags a closed/unknown period as WARNING but keeps the item HELD", () => {
    const closedCtx: StageContext = {
      validAccountKeys: new Set(["1000", "2000"]),
      periodStatusById: new Map([["p1", "CLOSED"]])
    };
    const items = stageJournalItems(
      [
        journal([
          { accountId: "1000", debit: "100", credit: "0" },
          { accountId: "2000", debit: "0", credit: "100" }
        ])
      ],
      closedCtx
    );
    expect(items[0].validationStatus).toBe("WARNING");
    expect(items[0].status).toBe("HELD");
  });
});

describe("resolveReviewMode", () => {
  it("forces AUTO_COMMIT for automation executions", () => {
    expect(resolveReviewMode("HOLD", { automationId: "a1", triggeredBy: "u1" })).toBe(
      "AUTO_COMMIT"
    );
  });
  it("forces AUTO_COMMIT when triggered by the scheduler", () => {
    expect(resolveReviewMode("HOLD", { automationId: null, triggeredBy: "scheduler" })).toBe(
      "AUTO_COMMIT"
    );
  });
  it("honors HOLD for interactive runs", () => {
    expect(resolveReviewMode("HOLD", { automationId: null, triggeredBy: "u1" })).toBe("HOLD");
  });
  it("honors AUTO_COMMIT profile setting for interactive runs", () => {
    expect(resolveReviewMode("AUTO_COMMIT", { automationId: null, triggeredBy: "u1" })).toBe(
      "AUTO_COMMIT"
    );
  });
  it("defaults missing profile mode to HOLD for interactive runs", () => {
    expect(resolveReviewMode(null, { automationId: null, triggeredBy: "u1" })).toBe("HOLD");
  });
});
