/**
 * Committing a held batch posts its canonical documents through the posting
 * service (a fake here): POSTED and awaiting approval count as committed,
 * refusals and duplicates mark the item ERROR, WHOLE_FILE profiles post all
 * items at once, and a batch staged before documents is refused clearly.
 */
import { describe, expect, it, vi } from "vitest";
import { BatchReviewService } from "../src/modules/integrations/batch-service.js";

const doc = (ref: string) => ({
  contractVersion: 1,
  documentType: "GL_JOURNAL",
  sourceDocumentRef: ref
});

function item(id: string, payload: unknown = { document: doc(id) }) {
  return {
    id,
    batchId: "b1",
    status: "HELD",
    validationStatus: "OK",
    payload,
    validationMessages: []
  };
}

function makeDb(items: any[], profile: Record<string, unknown> = {}) {
  return {
    integrationBatch: {
      findFirst: vi.fn().mockResolvedValue({
        id: "b1",
        entityId: "e1",
        profileId: "p1",
        status: "PENDING_REVIEW",
        rejectedItems: 0
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({})
    },
    integrationBatchItem: {
      findMany: vi.fn().mockResolvedValue(items),
      update: vi.fn().mockResolvedValue({})
    },
    integrationProfile: {
      findUnique: vi.fn().mockResolvedValue({
        id: "p1",
        targetParams: { journalSource: "PMS" },
        fxRateType: "AVERAGE",
        atomicity: "PER_DOCUMENT",
        ...profile
      })
    }
  } as any;
}

function makePoster(outcomes: Record<string, any> = {}) {
  const outcome = (d: any) =>
    outcomes[d.sourceDocumentRef] ?? {
      status: "POSTED",
      journalId: `j-${d.sourceDocumentRef}`,
      entityId: "e1"
    };
  return {
    post: vi.fn(async (d: any, _options?: any): Promise<any> => outcome(d)),
    postAll: vi.fn(async (docs: any[], _options?: any): Promise<any[]> => docs.map(outcome))
  };
}

const updates = (db: any) =>
  db.integrationBatchItem.update.mock.calls.map((c: any) => [c[0].where.id, c[0].data.status]);

describe("commitBatch through the posting service", () => {
  it("posts each held document as the reviewer, with the profile's options", async () => {
    const db = makeDb([item("a"), item("b")]);
    const poster = makePoster();
    const summary = await new BatchReviewService(db, poster).commitBatch("e1", "b1", "u1");
    expect(poster.post.mock.calls.map((c: any) => c[0].sourceDocumentRef)).toEqual(["a", "b"]);
    expect(poster.post.mock.calls[0]![1]).toEqual({
      actorUserId: "u1",
      journalSource: "PMS",
      fxRateType: "AVERAGE"
    });
    expect(summary).toMatchObject({ committed: 2, pendingApproval: 0, errors: 0 });
    expect(db.integrationBatchItem.update.mock.calls[0]![0].data).toEqual({
      status: "COMMITTED",
      resultJournalId: "j-a"
    });
  });

  it("counts a journal awaiting approval or authorization as committed, for approvers", async () => {
    const db = makeDb([item("a"), item("b")]);
    const poster = makePoster({
      a: { status: "PENDING_APPROVAL", journalId: "j-a", entityId: "e1" },
      b: { status: "AWAITING_AUTHORIZATION", journalId: "j-b", entityId: "e1" }
    });
    const summary = await new BatchReviewService(db, poster).commitBatch("e1", "b1", "u1");
    expect(summary).toMatchObject({ committed: 0, pendingApproval: 2, errors: 0 });
    expect(updates(db)).toEqual([
      ["a", "COMMITTED"],
      ["b", "COMMITTED"]
    ]);
  });

  it("marks refused and duplicate documents ERROR with the reasons, and still finishes the batch", async () => {
    const db = makeDb([item("a"), item("b"), item("c")]);
    const poster = makePoster({
      a: {
        status: "REFUSED",
        errors: [
          { code: "PERIOD_NOT_OPEN", path: "documentDate", message: "Period 2026-04 is CLOSED." }
        ]
      },
      b: { status: "DUPLICATE", journalId: "j-old", entityId: "e1" }
    });
    const summary = await new BatchReviewService(db, poster).commitBatch("e1", "b1", "u1");
    expect(summary).toMatchObject({ committed: 1, errors: 2 });
    expect(updates(db)).toEqual([
      ["a", "ERROR"],
      ["b", "ERROR"],
      ["c", "COMMITTED"]
    ]);
    expect(db.integrationBatchItem.update.mock.calls[0]![0].data.validationMessages).toEqual([
      { code: "PERIOD_NOT_OPEN", severity: "ERROR", message: "Period 2026-04 is CLOSED." }
    ]);
    expect(db.integrationBatch.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMMITTED" }) })
    );
  });

  it("posts a WHOLE_FILE profile's items in one call", async () => {
    const db = makeDb([item("a"), item("b")], { atomicity: "WHOLE_FILE" });
    const poster = makePoster();
    await new BatchReviewService(db, poster).commitBatch("e1", "b1", "u1");
    expect(poster.postAll).toHaveBeenCalledTimes(1);
    expect(poster.post).not.toHaveBeenCalled();
  });

  it("refuses a batch staged before documents, posting none of it", async () => {
    const db = makeDb([item("a"), item("old", { periodId: "p1", lines: [] })]);
    const poster = makePoster();
    const summary = await new BatchReviewService(db, poster).commitBatch("e1", "b1", "u1");
    expect(poster.post).not.toHaveBeenCalled();
    expect(summary.errors).toBe(2);
    expect(db.integrationBatchItem.update.mock.calls[1]![0].data.validationMessages[0].code).toBe(
      "STAGED_BEFORE_RELEASE"
    );
  });

  it("reads only eligible items, and does nothing for a batch already committed", async () => {
    const db = makeDb([item("a")]);
    const poster = makePoster();
    await new BatchReviewService(db, poster).commitBatch("e1", "b1", "u1");
    expect(db.integrationBatchItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          batchId: "b1",
          status: "HELD",
          validationStatus: { not: "ERROR" }
        })
      })
    );

    const done = makeDb([item("a")]);
    done.integrationBatch.updateMany.mockResolvedValue({ count: 0 });
    done.integrationBatch.findFirst.mockResolvedValue({
      id: "b1",
      entityId: "e1",
      status: "COMMITTED"
    });
    const summary = await new BatchReviewService(done, poster).commitBatch("e1", "b1", "u1");
    expect(summary.alreadyCommitted).toBe(true);
  });
});
