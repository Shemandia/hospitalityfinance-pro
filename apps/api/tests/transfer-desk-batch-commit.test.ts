import { describe, expect, it, vi, beforeEach } from "vitest";
import { BatchReviewService } from "../src/modules/transfer-desk/batch-service.js";
import { GLService } from "../src/modules/gl/service.js";

function item(over: Record<string, any> = {}) {
  return {
    id: "i1",
    batchId: "b1",
    status: "HELD",
    validationStatus: "OK",
    payload: { periodId: "p1", source: "IMPORT", functionalCurrency: "USD", lines: [] },
    ...over
  };
}

function makeDb(items: any[]) {
  return {
    transferBatch: {
      findFirst: vi.fn().mockResolvedValue({ id: "b1", entityId: "e1", status: "PENDING_REVIEW" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({})
    },
    transferBatchItem: {
      findMany: vi.fn().mockResolvedValue(items),
      update: vi.fn().mockResolvedValue({})
    }
  } as any;
}

let createSpy: any;
let postSpy: any;
beforeEach(() => {
  createSpy = vi.spyOn(GLService.prototype, "createJournal");
  postSpy = vi
    .spyOn(GLService.prototype, "postJournal")
    .mockResolvedValue({ id: "j1", status: "POSTED" } as any);
});

describe("commitBatch governance", () => {
  it("posts a journal when createJournal returns DRAFT (no approval rule)", async () => {
    createSpy.mockResolvedValue({ id: "j1", status: "DRAFT" } as any);
    const db = makeDb([item()]);
    const summary = await new BatchReviewService(db).commitBatch("e1", "b1", "u1");
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith("e1", "j1", "u1");
    expect(summary.committed).toBe(1);
    expect(summary.pendingApproval).toBe(0);
  });

  it("leaves a journal for approval when createJournal returns PENDING_APPROVAL", async () => {
    createSpy.mockResolvedValue({ id: "j2", status: "PENDING_APPROVAL" } as any);
    const db = makeDb([item()]);
    const summary = await new BatchReviewService(db).commitBatch("e1", "b1", "u1");
    expect(postSpy).not.toHaveBeenCalled();
    expect(summary.pendingApproval).toBe(1);
    expect(summary.committed).toBe(0);
  });

  it("skips REJECTED and ERROR items", async () => {
    createSpy.mockResolvedValue({ id: "j1", status: "DRAFT" } as any);
    const db = makeDb([item({ id: "ok" })]); // findMany already returns only eligible items
    await new BatchReviewService(db).commitBatch("e1", "b1", "u1");
    expect(createSpy).toHaveBeenCalledTimes(1);
    // verify the eligibility filter is applied in the query
    expect(db.transferBatchItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          batchId: "b1",
          status: "HELD",
          validationStatus: { not: "ERROR" }
        })
      })
    );
  });

  it("is idempotent — a non-PENDING_REVIEW batch creates no journals", async () => {
    const db = makeDb([item()]);
    db.transferBatch.updateMany.mockResolvedValue({ count: 0 });
    const summary = await new BatchReviewService(db).commitBatch("e1", "b1", "u1");
    expect(createSpy).not.toHaveBeenCalled();
    expect(summary.alreadyCommitted).toBe(true);
  });

  it("marks an item ERROR when createJournal throws but still commits the batch", async () => {
    createSpy.mockRejectedValueOnce(new Error("account locked"));
    const db = makeDb([item()]);
    const summary = await new BatchReviewService(db).commitBatch("e1", "b1", "u1");
    expect(db.transferBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({ status: "ERROR" })
      })
    );
    expect(summary.errors).toBe(1);
  });
});
