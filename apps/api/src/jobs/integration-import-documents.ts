/**
 * Stages 4 to 8 of an import into the ledger (import plan section 4): build
 * canonical documents from the transformed records, check each one through
 * the posting service, then stage them for review (HOLD) or post them
 * (AUTO_COMMIT: per document, or the whole file in one transaction), and
 * record per record what became of it.
 *
 * Nothing here knows a source system: the profile names its source system,
 * and the transformation writes the contract's fields.
 */
import type { PostingOptions, PostingOutcome } from "../modules/posting/service.js";
import {
  type BuiltDocument,
  type TransformedRecord,
  buildGlDocuments
} from "./integration-documents.js";
import {
  hashSourceRecords,
  type PipelineContext,
  type PipelineResult,
  type ProfileWithRelations
} from "./integration-pipeline.js";
import type { FsdRecordValue } from "@hfp/fsd-engine";

/** The part of the posting service the pipeline uses (a fake in unit tests). */
export type DocumentPoster = {
  post(input: unknown, options: PostingOptions): Promise<PostingOutcome>;
  postAll(inputs: ReadonlyArray<unknown>, options: PostingOptions): Promise<PostingOutcome[]>;
};

export type DocumentImportInput = {
  ctx: PipelineContext;
  poster: DocumentPoster;
  executionId: string;
  profile: ProfileWithRelations;
  /** The parsed source records, for the logs and the file fingerprint. */
  sourceRecords: FsdRecordValue[];
  /** The same records after the transformation. */
  records: TransformedRecord[];
  mode: "HOLD" | "AUTO_COMMIT";
  actorUserId: string;
  /**
   * The entity an interactive run was started at: its documents must all be
   * for that entity. Null for scheduled runs, which may post to any entity
   * the file names (the profile is tenant configuration).
   */
  runEntity: { id: string; code: string } | null;
};

const SUCCESS = new Set(["POSTED", "PENDING_APPROVAL", "AWAITING_AUTHORIZATION"]);

type DocResult = { built: BuiltDocument; outcome: PostingOutcome };

function firstError(outcome: PostingOutcome): { code: string; message: string } | null {
  if (outcome.status === "REFUSED") {
    return {
      code: outcome.errors[0]?.code ?? "REFUSED",
      message: outcome.errors
        .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
        .join("; ")
    };
  }
  if (outcome.status === "DUPLICATE") {
    return { code: "DUPLICATE", message: `Already posted (journal ${outcome.journalId}).` };
  }
  return null;
}

export async function importDocuments(input: DocumentImportInput): Promise<PipelineResult> {
  const { ctx, profile, executionId, sourceRecords } = input;
  const sourceSystem = profile.sourceSystemCode;
  if (!sourceSystem) {
    return {
      recordsTotal: sourceRecords.length,
      recordsSucceeded: 0,
      recordsFailed: sourceRecords.length,
      errorMessage: "The profile names no source system; set it before importing into the ledger."
    };
  }

  const { documents, errors: buildErrors } = buildGlDocuments(input.records, { sourceSystem });
  const options: PostingOptions = {
    actorUserId: input.actorUserId,
    journalSource:
      (profile.targetParams?.journalSource as PostingOptions["journalSource"]) ?? "IMPORT",
    ...(profile.fxRateType && { fxRateType: profile.fxRateType })
  };

  // An interactive run posts only to the entity it was started at.
  const outside = (built: BuiltDocument): PostingOutcome | null =>
    input.runEntity && built.document.entityCode !== input.runEntity.code
      ? {
          status: "REFUSED",
          errors: [
            {
              code: "ENTITY_OUTSIDE_RUN",
              path: "entityCode",
              message: `This run was started at ${input.runEntity.code}; the document is for ${built.document.entityCode}.`
            }
          ]
        }
      : null;

  let results: DocResult[];
  if (input.mode === "HOLD") {
    results = [];
    for (const built of documents) {
      const outcome =
        outside(built) ?? (await input.poster.post(built.document, { ...options, dryRun: true }));
      results.push({ built, outcome });
    }
    const staged = await stage(input, results);
    if (staged) return staged;
  } else if (profile.atomicity === "WHOLE_FILE") {
    const refusedOutside = documents.map(outside);
    const outcomes =
      refusedOutside.some(Boolean) || buildErrors.length > 0
        ? documents.map(
            (built, i): PostingOutcome =>
              refusedOutside[i] ?? {
                status: "REFUSED",
                errors: [
                  {
                    code: "FILE_NOT_POSTED",
                    path: "",
                    message:
                      "Not posted: another record or document of the file was refused, and the profile posts whole files only."
                  }
                ]
              }
          )
        : await input.poster.postAll(
            documents.map((d) => d.document),
            options
          );
    results = documents.map((built, i) => ({ built, outcome: outcomes[i]! }));
  } else {
    results = [];
    for (const built of documents) {
      results.push({
        built,
        outcome: outside(built) ?? (await input.poster.post(built.document, options))
      });
    }
  }

  await record(input, results, buildErrors);
  const succeeded = results.filter(
    (r) => SUCCESS.has(r.outcome.status) || (input.mode === "HOLD" && r.outcome.status === "VALID")
  );
  const recordsSucceeded = succeeded.reduce((n, r) => n + r.built.recordIndices.length, 0);
  const allDuplicates =
    results.length > 0 && results.every((r) => r.outcome.status === "DUPLICATE");
  return {
    recordsTotal: sourceRecords.length,
    recordsSucceeded,
    recordsFailed: sourceRecords.length - recordsSucceeded,
    ...(allDuplicates && {
      status: "DUPLICATE" as const,
      errorMessage: "Every document of the file was already posted; nothing was posted again."
    })
  };
}

/** One log row per source record: what its document became. */
async function record(
  input: DocumentImportInput,
  results: DocResult[],
  buildErrors: Array<{ recordIndex: number; code: string; message: string }>
) {
  const rows: Record<string, unknown>[] = [];
  for (const { built, outcome } of results) {
    const error = firstError(outcome);
    const journalId =
      "journalId" in outcome && SUCCESS.has(outcome.status) ? outcome.journalId : null;
    built.recordIndices.forEach((recordIndex, line) => {
      rows.push({
        executionId: input.executionId,
        recordIndex,
        status: error ? "FAILED" : "SUCCESS",
        sourceData: (input.sourceRecords[recordIndex] ?? null) as unknown,
        transformedData: { document: built.document.sourceDocumentRef, line: line + 1 },
        documentRef: built.document.sourceDocumentRef,
        journalId,
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? null
      });
    });
  }
  for (const e of buildErrors) {
    rows.push({
      executionId: input.executionId,
      recordIndex: e.recordIndex,
      status: "FAILED",
      sourceData: (input.sourceRecords[e.recordIndex] ?? null) as unknown,
      transformedData: (input.records[e.recordIndex] ?? null) as unknown,
      errorCode: e.code,
      errorMessage: e.message
    });
  }
  if (rows.length > 0) await input.ctx.db.integrationExecutionLog.createMany({ data: rows });
}

/**
 * HOLD: stage the documents as one batch for review. The batch belongs to
 * the run's entity, or the first document's. A file already staged for the
 * profile (same content) is not staged twice. Returns a result only when it
 * stops the import (duplicate file, nothing to stage).
 */
async function stage(
  input: DocumentImportInput,
  results: DocResult[]
): Promise<PipelineResult | null> {
  const { ctx, profile, executionId, sourceRecords } = input;
  const entityId =
    input.runEntity?.id ??
    results.map((r) => ("entityId" in r.outcome ? r.outcome.entityId : null)).find(Boolean) ??
    null;
  if (!entityId) {
    await record(input, results, []);
    return {
      recordsTotal: sourceRecords.length,
      recordsSucceeded: 0,
      recordsFailed: sourceRecords.length,
      errorMessage: "No document of the file names an entity this tenant has; nothing was staged."
    };
  }
  const sourceHash = hashSourceRecords(sourceRecords);
  const already = await ctx.db.integrationBatch.findFirst({
    where: { entityId, profileId: profile.id, sourceHash }
  });
  const duplicateFile = (id: string, status: string): PipelineResult => ({
    recordsTotal: sourceRecords.length,
    recordsSucceeded: 0,
    recordsFailed: 0,
    status: "DUPLICATE",
    errorMessage: `This file has already been staged for this profile (batch ${id}, status ${status}). No new batch was staged and nothing was posted.`
  });
  if (already) return duplicateFile(already.id, already.status);

  const ok = results.filter((r) => r.outcome.status === "VALID").length;
  let batch: { id: string };
  try {
    batch = await ctx.db.integrationBatch.create({
      data: {
        entityId,
        profileId: profile.id,
        executionId,
        targetComponent: "GL_JOURNAL",
        status: "PENDING_REVIEW",
        totalItems: results.length,
        heldItems: ok,
        errorItems: results.length - ok,
        sourceHash,
        createdById: input.actorUserId
      }
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      const raced = await ctx.db.integrationBatch.findFirst({
        where: { entityId, profileId: profile.id, sourceHash }
      });
      if (raced) return duplicateFile(raced.id, raced.status);
    }
    throw err;
  }
  await ctx.db.integrationBatchItem.createMany({
    data: results.map(({ built, outcome }, itemIndex) => {
      const error = firstError(outcome);
      return {
        batchId: batch.id,
        itemIndex,
        status: error ? "ERROR" : "HELD",
        targetComponent: "GL_JOURNAL",
        payload: { document: built.document } as unknown,
        sourceRecordIndices: built.recordIndices,
        validationStatus: error ? "ERROR" : "OK",
        validationMessages: error
          ? [{ code: error.code, severity: "ERROR", message: error.message }]
          : []
      };
    })
  });
  return null;
}
