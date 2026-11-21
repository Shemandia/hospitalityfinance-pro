/**
 * Held-batch review: list, get, reject, restore, discard, and commit (which
 * posts the held canonical documents through the posting service).
 */

import type { PrismaClient } from "../../db/client.js";
import { PostingService, type PostingOptions, type PostingOutcome } from "../posting/service.js";

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
  constructor(
    protected readonly prisma: PrismaClient,
    /** Posts the held documents; the posting service unless a test gives one. */
    private readonly poster?: Pick<PostingService, "post" | "postAll">
  ) {}

  protected get db(): any {
    return this.prisma as any;
  }

  async listBatches(filter: { entityId?: string; status?: string; profileId?: string }) {
    return this.db.integrationBatch.findMany({
      where: {
        ...(filter.entityId ? { entityId: filter.entityId } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.profileId ? { profileId: filter.profileId } : {})
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });
  }

  /**
   * Every lookup below is scoped by entityId.
   *
   * These used to query on batch id alone, and the transfer batch tables carry
   * no RLS policy, so a user in one property could fetch, reject, restore,
   * commit or discard another property's staged batch simply by holding its
   * id. Scoping the query makes a cross-entity id behave exactly like a
   * non-existent one.
   */
  async getBatch(entityId: string, batchId: string) {
    const batch = await this.db.integrationBatch.findFirst({
      where: { id: batchId, entityId },
      include: { items: { orderBy: { itemIndex: "asc" } } }
    });
    if (!batch) throw new BatchReviewError("BATCH_NOT_FOUND", "Batch not found.", 404);
    return batch;
  }

  private async assertReviewable(entityId: string, batchId: string) {
    const batch = await this.db.integrationBatch.findFirst({ where: { id: batchId, entityId } });
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

  async rejectItem(
    entityId: string,
    batchId: string,
    itemId: string,
    userId: string,
    reason?: string
  ) {
    await this.assertReviewable(entityId, batchId);
    const item = await this.db.integrationBatchItem.findFirst({ where: { id: itemId, batchId } });
    if (!item) throw new BatchReviewError("ITEM_NOT_FOUND", "Batch item not found.", 404);
    if (item.status !== "HELD")
      throw new BatchReviewError("ITEM_NOT_HELD", `Item is ${item.status}, not HELD.`, 409);

    await this.db.integrationBatchItem.update({
      where: { id: itemId },
      data: { status: "REJECTED", rejectedReason: reason ?? null }
    });
    await this.db.integrationBatch.update({
      where: { id: batchId },
      data: { heldItems: { decrement: 1 }, rejectedItems: { increment: 1 }, reviewedById: userId }
    });
    return { ok: true };
  }

  async restoreItem(entityId: string, batchId: string, itemId: string) {
    await this.assertReviewable(entityId, batchId);
    const item = await this.db.integrationBatchItem.findFirst({ where: { id: itemId, batchId } });
    if (!item) throw new BatchReviewError("ITEM_NOT_FOUND", "Batch item not found.", 404);
    if (item.status !== "REJECTED")
      throw new BatchReviewError("ITEM_NOT_REJECTED", `Item is ${item.status}, not REJECTED.`, 409);

    await this.db.integrationBatchItem.update({
      where: { id: itemId },
      data: { status: "HELD", rejectedReason: null }
    });
    await this.db.integrationBatch.update({
      where: { id: batchId },
      data: { heldItems: { increment: 1 }, rejectedItems: { decrement: 1 } }
    });
    return { ok: true };
  }

  async discardBatch(entityId: string, batchId: string, userId: string) {
    await this.assertReviewable(entityId, batchId);
    await this.db.integrationBatch.update({
      where: { id: batchId },
      data: { status: "DISCARDED", reviewedById: userId }
    });
    return { ok: true };
  }

  /**
   * Commit a held batch: post each HELD, non-ERROR item's canonical document
   * through the posting service (approval rules and authorization apply as
   * for any journal), or all of them in one transaction when the profile
   * posts whole files. Idempotent and resumable.
   */
  async commitBatch(entityId: string, batchId: string, userId: string) {
    const batch = await this.db.integrationBatch.findFirst({ where: { id: batchId, entityId } });
    if (!batch) throw new BatchReviewError("BATCH_NOT_FOUND", "Batch not found.", 404);

    // Claim the batch by moving it to COMMITTING, not straight to COMMITTED.
    //
    // The flip previously went directly to COMMITTED before a single item had
    // been posted. A crash, timeout or restart part-way through the loop below
    // then left a batch marked COMMITTED with items still HELD and unposted —
    // and because a re-run saw a non-PENDING_REVIEW status it returned
    // "already committed" and did nothing, so those items were stranded
    // silently and forever.
    //
    // COMMITTING still wins the race against a concurrent caller, but marks the
    // work as in-flight so it can be picked up again. Only once every item has
    // been processed does the batch become COMMITTED.
    const claimed = await this.db.integrationBatch.updateMany({
      where: { id: batchId, entityId, status: "PENDING_REVIEW" },
      data: { status: "COMMITTING", reviewedById: userId }
    });

    if (claimed.count === 0) {
      // Not ours to claim. Resume only if a previous attempt was interrupted.
      const current = await this.db.integrationBatch.findFirst({
        where: { id: batchId, entityId }
      });
      if (current?.status !== "COMMITTING") {
        return { alreadyCommitted: true, committed: 0, pendingApproval: 0, rejected: 0, errors: 0 };
      }
      const remaining = await this.db.integrationBatchItem.count({
        where: { batchId, status: "HELD", validationStatus: { not: "ERROR" } }
      });
      if (remaining === 0) {
        // Interrupted after the last item but before the final flip.
        await this.finaliseCommit(batchId);
        return { alreadyCommitted: true, committed: 0, pendingApproval: 0, rejected: 0, errors: 0 };
      }
      // Fall through and post the remaining items.
    }

    const items = await this.db.integrationBatchItem.findMany({
      where: { batchId, status: "HELD", validationStatus: { not: "ERROR" } },
      orderBy: { itemIndex: "asc" }
    });

    const profile = await this.db.integrationProfile.findUnique({ where: { id: batch.profileId } });
    const options: PostingOptions = {
      actorUserId: userId,
      journalSource:
        ((profile?.targetParams as Record<string, unknown> | null)
          ?.journalSource as PostingOptions["journalSource"]) ?? "IMPORT",
      ...(profile?.fxRateType && { fxRateType: profile.fxRateType })
    };
    const poster = this.poster ?? new PostingService(this.prisma);
    const documents: unknown[] = items.map(
      (item: { payload: unknown }) => (item.payload as { document?: unknown } | null)?.document
    );
    let outcomes: PostingOutcome[];
    if (documents.some((d) => d === undefined)) {
      // Staged before documents (import plan step 5): its payload is not a document.
      outcomes = documents.map(
        (d): PostingOutcome =>
          d === undefined
            ? {
                status: "REFUSED",
                errors: [
                  {
                    code: "STAGED_BEFORE_RELEASE",
                    path: "",
                    message:
                      "Staged by an earlier release; discard the batch and import the file again."
                  }
                ]
              }
            : {
                status: "REFUSED",
                errors: [
                  {
                    code: "FILE_NOT_POSTED",
                    path: "",
                    message: "Not posted: another item of the batch cannot be."
                  }
                ]
              }
      );
    } else if (profile?.atomicity === "WHOLE_FILE") {
      outcomes = await poster.postAll(documents, options);
    } else {
      outcomes = [];
      for (const document of documents) outcomes.push(await poster.post(document, options));
    }

    let committed = 0;
    let pendingApproval = 0;
    let errors = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const outcome = outcomes[i]!;
      if (
        outcome.status === "POSTED" ||
        outcome.status === "PENDING_APPROVAL" ||
        outcome.status === "AWAITING_AUTHORIZATION"
      ) {
        if (outcome.status === "POSTED") committed++;
        else pendingApproval++;
        await this.db.integrationBatchItem.update({
          where: { id: item.id },
          data: { status: "COMMITTED", resultJournalId: outcome.journalId }
        });
        continue;
      }
      errors++;
      const messages =
        outcome.status === "REFUSED"
          ? outcome.errors.map((e) => ({ code: e.code, severity: "ERROR", message: e.message }))
          : outcome.status === "DUPLICATE"
            ? [
                {
                  code: "DUPLICATE",
                  severity: "ERROR",
                  message: `Already posted (journal ${outcome.journalId}).`
                }
              ]
            : [
                {
                  code: "COMMIT_FAILED",
                  severity: "ERROR",
                  message: `Unexpected outcome ${outcome.status}.`
                }
              ];
      const existing = Array.isArray(item.validationMessages) ? item.validationMessages : [];
      await this.db.integrationBatchItem.update({
        where: { id: item.id },
        data: {
          status: "ERROR",
          validationStatus: "ERROR",
          validationMessages: [...existing, ...messages] as any
        }
      });
    }

    await this.db.integrationBatch.update({
      where: { id: batchId },
      data: {
        committedItems: { increment: committed + pendingApproval },
        heldItems: 0,
        errorItems: { increment: errors }
      }
    });

    // Only now is the batch genuinely committed.
    await this.finaliseCommit(batchId);

    return {
      alreadyCommitted: false,
      committed,
      pendingApproval,
      rejected: batch.rejectedItems ?? 0,
      errors
    };
  }

  /** COMMITTING → COMMITTED, once every item has been processed. */
  private async finaliseCommit(batchId: string) {
    await this.db.integrationBatch.updateMany({
      where: { id: batchId, status: "COMMITTING" },
      data: { status: "COMMITTED", committedAt: new Date() }
    });
  }
}
