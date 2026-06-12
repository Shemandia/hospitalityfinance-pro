/**
 * Held-journal batch review service — list/get/reject/restore/discard.
 * Commit lives in commitBatch (a later task).
 */

import type { PrismaClient } from "../../db/client.js";

export class BatchReviewError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = "BatchReviewError";
  }
}

export class BatchReviewService {
  constructor(protected readonly prisma: PrismaClient) {}

  protected get db(): any {
    return this.prisma as any;
  }

  async listBatches(filter: { entityId?: string; status?: string; profileId?: string }) {
    return this.db.transferBatch.findMany({
      where: {
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.profileId ? { profileId: filter.profileId } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  async getBatch(batchId: string) {
    const batch = await this.db.transferBatch.findFirst({
      where: { id: batchId },
      include: { items: { orderBy: { itemIndex: "asc" } } }
    });
    if (!batch) throw new BatchReviewError("BATCH_NOT_FOUND", "Batch not found.", 404);
    return batch;
  }

  private async assertReviewable(batchId: string) {
    const batch = await this.db.transferBatch.findFirst({ where: { id: batchId } });
    if (!batch) throw new BatchReviewError("BATCH_NOT_FOUND", "Batch not found.", 404);
    if (batch.status !== "PENDING_REVIEW") {
      throw new BatchReviewError(
        "BATCH_NOT_REVIEWABLE",
        `Batch is ${batch.status}, not PENDING_REVIEW.`,
        409
      );
    }
    return batch;
  }

  async rejectItem(batchId: string, itemId: string, userId: string, reason?: string) {
    await this.assertReviewable(batchId);
    const item = await this.db.transferBatchItem.findFirst({ where: { id: itemId, batchId } });
    if (!item) throw new BatchReviewError("ITEM_NOT_FOUND", "Batch item not found.", 404);
    if (item.status !== "HELD")
      throw new BatchReviewError("ITEM_NOT_HELD", `Item is ${item.status}, not HELD.`, 409);

    await this.db.transferBatchItem.update({
      where: { id: itemId },
      data: { status: "REJECTED", rejectedReason: reason ?? null }
    });
    await this.db.transferBatch.update({
      where: { id: batchId },
      data: { heldItems: { decrement: 1 }, rejectedItems: { increment: 1 }, reviewedById: userId }
    });
    return { ok: true };
  }

  async restoreItem(batchId: string, itemId: string) {
    await this.assertReviewable(batchId);
    const item = await this.db.transferBatchItem.findFirst({ where: { id: itemId, batchId } });
    if (!item) throw new BatchReviewError("ITEM_NOT_FOUND", "Batch item not found.", 404);
    if (item.status !== "REJECTED")
      throw new BatchReviewError("ITEM_NOT_REJECTED", `Item is ${item.status}, not REJECTED.`, 409);

    await this.db.transferBatchItem.update({
      where: { id: itemId },
      data: { status: "HELD", rejectedReason: null }
    });
    await this.db.transferBatch.update({
      where: { id: batchId },
      data: { heldItems: { increment: 1 }, rejectedItems: { decrement: 1 } }
    });
    return { ok: true };
  }

  async discardBatch(batchId: string, userId: string) {
    await this.assertReviewable(batchId);
    await this.db.transferBatch.update({
      where: { id: batchId },
      data: { status: "DISCARDED", reviewedById: userId }
    });
    return { ok: true };
  }
}
