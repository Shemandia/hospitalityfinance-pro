/**
 * Transfer Desk import idempotency, entity scoping and resumable commit (P0).
 *
 * The reported failure: re-upload last night's PMS file after a timeout and
 * the revenue posts twice. Alongside it, a user in one property could commit
 * or discard another property's staged batch, and an interrupted commit
 * stranded items in a batch that claimed to be finished.
 */

import { describe, it, expect, vi } from "vitest";
import { hashSourceRecords } from "../src/jobs/transfer-desk-pipeline.js";
import {
  BatchReviewService,
  BatchReviewError
} from "../src/modules/transfer-desk/batch-service.js";

describe("hashSourceRecords", () => {
  it("gives the same fingerprint for the same content", () => {
    const a = [{ account: "4000", amount: "100" }];
    const b = [{ account: "4000", amount: "100" }];
    expect(hashSourceRecords(a as any)).toBe(hashSourceRecords(b as any));
  });

  it("is stable regardless of key order", () => {
    // Two parses of the same file can build objects in different orders;
    // JSON.stringify alone would hash them differently.
    const a = [{ account: "4000", amount: "100" }];
    const b = [{ amount: "100", account: "4000" }];
    expect(hashSourceRecords(a as any)).toBe(hashSourceRecords(b as any));
  });

  it("changes when any value changes", () => {
    const a = [{ account: "4000", amount: "100" }];
    const b = [{ account: "4000", amount: "100.01" }];
    expect(hashSourceRecords(a as any)).not.toBe(hashSourceRecords(b as any));
  });

  it("changes when a record is added", () => {
    const a = [{ account: "4000", amount: "100" }];
    const b = [
      { account: "4000", amount: "100" },
      { account: "4100", amount: "50" }
    ];
    expect(hashSourceRecords(a as any)).not.toBe(hashSourceRecords(b as any));
  });

  it("distinguishes record order, which is a genuine content difference", () => {
    const a = [{ n: "1" }, { n: "2" }];
    const b = [{ n: "2" }, { n: "1" }];
    expect(hashSourceRecords(a as any)).not.toBe(hashSourceRecords(b as any));
  });
});

describe("batch operations are entity-scoped", () => {
  /** Only ever returns the batch when the query also matches on entityId. */
  function dbWithBatchOwnedBy(ownerEntityId: string) {
    return {
      transferBatch: {
        findFirst: vi
          .fn()
          .mockImplementation(({ where }: any) =>
            where.entityId === ownerEntityId && where.id === "b1"
              ? { id: "b1", entityId: ownerEntityId, status: "PENDING_REVIEW", rejectedItems: 0 }
              : null
          ),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      transferBatchItem: {
        findFirst: vi.fn().mockResolvedValue({ id: "i1", batchId: "b1", status: "HELD" }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockResolvedValue({})
      }
    } as any;
  }

  it("hides another property's batch from getBatch", async () => {
    const service = new BatchReviewService(dbWithBatchOwnedBy("hotel-a"));
    await expect(service.getBatch("hotel-b", "b1")).rejects.toBeInstanceOf(BatchReviewError);
  });

  it("refuses to discard another property's batch", async () => {
    const service = new BatchReviewService(dbWithBatchOwnedBy("hotel-a"));
    await expect(service.discardBatch("hotel-b", "b1", "u1")).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND"
    });
  });

  it("refuses to commit another property's batch", async () => {
    const service = new BatchReviewService(dbWithBatchOwnedBy("hotel-a"));
    await expect(service.commitBatch("hotel-b", "b1", "u1")).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND"
    });
  });

  it("refuses to reject an item on another property's batch", async () => {
    const service = new BatchReviewService(dbWithBatchOwnedBy("hotel-a"));
    await expect(service.rejectItem("hotel-b", "b1", "i1", "u1")).rejects.toMatchObject({
      code: "BATCH_NOT_FOUND"
    });
  });

  it("still allows the owning property", async () => {
    const service = new BatchReviewService(dbWithBatchOwnedBy("hotel-a"));
    await expect(service.discardBatch("hotel-a", "b1", "u1")).resolves.toEqual({ ok: true });
  });
});

describe("commitBatch is resumable", () => {
  /**
   * A batch left in COMMITTING by an interrupted run: the status flip claims
   * it, so a fresh claim fails, but items are still HELD and must be posted.
   */
  function interruptedDb(remainingHeld: number) {
    const items = Array.from({ length: remainingHeld }, (_, i) => ({
      id: `i${i}`,
      batchId: "b1",
      status: "HELD",
      validationStatus: "OK",
      payload: {}
    }));
    return {
      transferBatch: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "b1", entityId: "e1", status: "COMMITTING", rejectedItems: 0 }),
        // Claim fails: the batch is no longer PENDING_REVIEW.
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({})
      },
      transferBatchItem: {
        findMany: vi.fn().mockResolvedValue(items),
        count: vi.fn().mockResolvedValue(remainingHeld),
        update: vi.fn().mockResolvedValue({})
      }
    } as any;
  }

  it("picks up items stranded by an interrupted commit", async () => {
    const db = interruptedDb(2);
    const service = new BatchReviewService(db);
    const result = await service.commitBatch("e1", "b1", "u1");

    // Previously this returned alreadyCommitted and left both items HELD.
    expect(result.alreadyCommitted).toBe(false);
    expect(db.transferBatchItem.findMany).toHaveBeenCalled();
  });

  it("finalises a commit interrupted after the last item", async () => {
    const db = interruptedDb(0);
    const service = new BatchReviewService(db);
    const result = await service.commitBatch("e1", "b1", "u1");

    expect(result.alreadyCommitted).toBe(true);
    // COMMITTING → COMMITTED rather than being left in limbo.
    expect(db.transferBatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "COMMITTING" }),
        data: expect.objectContaining({ status: "COMMITTED" })
      })
    );
  });

  it("does not reprocess a genuinely committed batch", async () => {
    const db = {
      transferBatch: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "b1", entityId: "e1", status: "COMMITTED", rejectedItems: 0 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn().mockResolvedValue({})
      },
      transferBatchItem: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        update: vi.fn().mockResolvedValue({})
      }
    } as any;

    const service = new BatchReviewService(db);
    const result = await service.commitBatch("e1", "b1", "u1");

    expect(result.alreadyCommitted).toBe(true);
    expect(db.transferBatchItem.findMany).not.toHaveBeenCalled();
  });
});
