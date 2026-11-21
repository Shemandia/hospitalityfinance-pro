import { describe, expect, it, vi, beforeEach } from "vitest";
import { BatchReviewService, BatchReviewError } from "../src/modules/integrations/batch-service.js";

function makeDb() {
  return {
    integrationBatch: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 })
    },
    integrationBatchItem: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({})
    }
  } as any;
}

let db: ReturnType<typeof makeDb>;
let service: BatchReviewService;
beforeEach(() => {
  db = makeDb();
  service = new BatchReviewService(db);
});

describe("rejectItem", () => {
  it("rejects a HELD item and decrements held / increments rejected", async () => {
    db.integrationBatch.findFirst.mockResolvedValue({ id: "b1", status: "PENDING_REVIEW" });
    db.integrationBatchItem.findFirst.mockResolvedValue({
      id: "i1",
      batchId: "b1",
      status: "HELD"
    });

    await service.rejectItem("e1", "b1", "i1", "u1", "wrong account");

    expect(db.integrationBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "i1" },
        data: expect.objectContaining({ status: "REJECTED", rejectedReason: "wrong account" })
      })
    );
    expect(db.integrationBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          heldItems: { decrement: 1 },
          rejectedItems: { increment: 1 }
        })
      })
    );
  });

  it("refuses to reject when the batch is already COMMITTED", async () => {
    db.integrationBatch.findFirst.mockResolvedValue({ id: "b1", status: "COMMITTED" });
    await expect(service.rejectItem("e1", "b1", "i1", "u1")).rejects.toMatchObject({
      code: "BATCH_NOT_REVIEWABLE",
      statusCode: 409
    });
  });

  it("refuses to reject an item that is not HELD", async () => {
    db.integrationBatch.findFirst.mockResolvedValue({ id: "b1", status: "PENDING_REVIEW" });
    db.integrationBatchItem.findFirst.mockResolvedValue({
      id: "i1",
      batchId: "b1",
      status: "ERROR"
    });
    await expect(service.rejectItem("e1", "b1", "i1", "u1")).rejects.toMatchObject({
      code: "ITEM_NOT_HELD",
      statusCode: 409
    });
  });
});

describe("restoreItem", () => {
  it("moves a REJECTED item back to HELD and adjusts counts", async () => {
    db.integrationBatch.findFirst.mockResolvedValue({ id: "b1", status: "PENDING_REVIEW" });
    db.integrationBatchItem.findFirst.mockResolvedValue({
      id: "i1",
      batchId: "b1",
      status: "REJECTED"
    });
    await service.restoreItem("e1", "b1", "i1");
    expect(db.integrationBatchItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "HELD", rejectedReason: null })
      })
    );
    expect(db.integrationBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          heldItems: { increment: 1 },
          rejectedItems: { decrement: 1 }
        })
      })
    );
  });
});

describe("discardBatch", () => {
  it("sets a reviewable batch to DISCARDED", async () => {
    db.integrationBatch.findFirst.mockResolvedValue({ id: "b1", status: "PENDING_REVIEW" });
    await service.discardBatch("e1", "b1", "u1");
    expect(db.integrationBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1" },
        data: expect.objectContaining({ status: "DISCARDED" })
      })
    );
  });

  it("refuses to discard a committed batch", async () => {
    db.integrationBatch.findFirst.mockResolvedValue({ id: "b1", status: "COMMITTED" });
    await expect(service.discardBatch("e1", "b1", "u1")).rejects.toMatchObject({
      code: "BATCH_NOT_REVIEWABLE"
    });
  });
});

describe("getBatch", () => {
  it("throws when not found", async () => {
    db.integrationBatch.findFirst.mockResolvedValue(null);
    await expect(service.getBatch("e1", "nope")).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND",
      statusCode: 404
    });
  });
});
