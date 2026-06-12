/**
 * Held-journal batch review service — list/get/reject/restore/discard.
 * Commit lives in commitBatch (a later task).
 */

import type { PrismaClient } from "../../db/client.js";
import { GLService } from "../gl/service.js";

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

  /**
   * Commit a held batch: materialise each HELD, non-ERROR item through
   * GLService.createJournal (honouring approval rules); DRAFT results are
   * posted, PENDING_APPROVAL results are left for approvers. Idempotent.
   */
  async commitBatch(batchId: string, userId: string) {
    const batch = await this.db.transferBatch.findFirst({ where: { id: batchId } });
    if (!batch) throw new BatchReviewError("BATCH_NOT_FOUND", "Batch not found.", 404);

    // Conditional flip — only one caller wins; prevents double-commit.
    const flipped = await this.db.transferBatch.updateMany({
      where: { id: batchId, status: "PENDING_REVIEW" },
      data: { status: "COMMITTED", reviewedById: userId, committedAt: new Date() }
    });
    if (flipped.count === 0) {
      return { alreadyCommitted: true, committed: 0, pendingApproval: 0, rejected: 0, errors: 0 };
    }

    const items = await this.db.transferBatchItem.findMany({
      where: { batchId, status: "HELD", validationStatus: { not: "ERROR" } },
      orderBy: { itemIndex: "asc" }
    });

    const gl = new GLService(this.prisma);
    let committed = 0;
    let pendingApproval = 0;
    let errors = 0;

    for (const item of items) {
      try {
        const created: any = await gl.createJournal(batch.entityId, userId, item.payload as any);
        if (created?.status === "PENDING_APPROVAL") {
          pendingApproval++;
        } else {
          await gl.postJournal(batch.entityId, created.id, userId);
          committed++;
        }
        await this.db.transferBatchItem.update({
          where: { id: item.id },
          data: { status: "COMMITTED", resultJournalId: created?.id ?? null }
        });
      } catch (err) {
        errors++;
        const message = err instanceof Error ? err.message : "Commit failed";
        const existing = Array.isArray(item.validationMessages) ? item.validationMessages : [];
        await this.db.transferBatchItem.update({
          where: { id: item.id },
          data: {
            status: "ERROR",
            validationStatus: "ERROR",
            validationMessages: [
              ...existing,
              { code: "COMMIT_FAILED", severity: "ERROR", message }
            ] as any
          }
        });
      }
    }

    await this.db.transferBatch.update({
      where: { id: batchId },
      data: {
        committedItems: { increment: committed + pendingApproval },
        heldItems: 0,
        errorItems: { increment: errors }
      }
    });

    return {
      alreadyCommitted: false,
      committed,
      pendingApproval,
      rejected: batch.rejectedItems ?? 0,
      errors
    };
  }
}
