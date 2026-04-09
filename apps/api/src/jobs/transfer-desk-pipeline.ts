/**
 * Transfer Desk — execution pipeline.
 *
 * Core business logic for import/export/process profile execution.
 * Called by the BullMQ worker after it marks the execution as RUNNING.
 *
 * The pipeline:
 *   1. Loads the profile + format definition from DB
 *   2. Reads/writes files via StorageBackend
 *   3. Calls @hfp/fsd-engine parse() / write()
 *   4. Maps records to target service inputs
 *   5. Writes to GL/AP/AR services
 *   6. Logs per-record results to transfer_execution_logs
 *   7. Optionally saves payloads to storage
 */

import { parse, write, type FsdSchema, type FsdRecordValue } from "@hfp/fsd-engine";
import { GLService } from "../modules/gl/service.js";
import { APService } from "../modules/ap/service.js";
import { ARService } from "../modules/ar/service.js";
import { runWithContext } from "../db/requestContext.js";
import { mapRecordsToTarget, type TargetParams } from "./transfer-desk-record-mapper.js";
import type { StorageBackend } from "./transfer-desk-storage.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type PipelineContext = {
  /** Prisma client for the tenant DB (already tenant-scoped) */
  db: PipelineDb;
  /** File storage backend (local or S3) */
  storage: StorageBackend;
  /** Tenant slug for context */
  tenantSlug: string;
  /** Tenant DB URL for context */
  tenantDbUrl: string;
};

/** Minimal DB interface for the pipeline (avoids importing full PrismaClient) */
export type PipelineDb = {
  transferProfile: {
    findUnique: (args: {
      where: { id: string };
      include?: Record<string, unknown>;
    }) => Promise<ProfileWithRelations | null>;
  };
  transferExecution: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  transferExecutionLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>;
  };
};

export type ProfileWithRelations = {
  id: string;
  name: string;
  profileType: "IMPORT" | "EXPORT" | "PROCESS" | "INTERNAL_TRANSFER" | "EXTERNAL_TRANSFER";
  sourceComponent: string | null;
  targetComponent: string | null;
  sourceFormatId: string | null;
  targetFormatId: string | null;
  transformationId: string | null;
  sourceParams: Record<string, unknown> | null;
  targetParams: Record<string, unknown> | null;
  savePayload: "NONE" | "INPUT" | "OUTPUT" | "BOTH";
  sourceFormat: { id: string; fsdXml: string; classification: string } | null;
  targetFormat: { id: string; fsdXml: string; classification: string } | null;
};

export type PipelineResult = {
  recordsTotal: number;
  recordsSucceeded: number;
  recordsFailed: number;
  errorMessage?: string;
};

// ── Import pipeline ──────────────────────────────────────────────────────────

export async function executeImport(
  ctx: PipelineContext,
  executionId: string,
  profile: ProfileWithRelations,
  runtimeParams: Record<string, unknown>
): Promise<PipelineResult> {
  // 1. Validate prerequisites
  if (!profile.sourceFormat) {
    return failExecution(
      ctx,
      executionId,
      "MISSING_SOURCE_FORMAT",
      "Import profile has no source format definition"
    );
  }
  if (!profile.targetComponent) {
    return failExecution(
      ctx,
      executionId,
      "MISSING_TARGET_COMPONENT",
      "Import profile has no target component"
    );
  }

  // 2. Resolve and read input file
  const filePath = resolveInputFilePath(profile, runtimeParams, ctx.tenantSlug);
  let fileContent: string;
  try {
    fileContent = await ctx.storage.read(filePath);
  } catch (err) {
    return failExecution(
      ctx,
      executionId,
      "FILE_READ_ERROR",
      `Failed to read input file "${filePath}": ${(err as Error).message}`
    );
  }

  // 3. Parse FSD definition and input file
  let fsdSchema: FsdSchema;
  try {
    fsdSchema = JSON.parse(profile.sourceFormat.fsdXml) as FsdSchema;
  } catch {
    return failExecution(ctx, executionId, "INVALID_FSD", "Source format fsdXml is not valid JSON");
  }

  const parseResult = parse(fsdSchema, fileContent);

  // If the parser returned only errors and no records, fail early
  if (parseResult.records.length === 0 && parseResult.errors.length > 0) {
    // Log parse errors
    const logData = parseResult.errors.map((e, i) => ({
      executionId,
      recordIndex: e.recordIndex ?? i,
      status: "FAILED" as const,
      sourceData: null,
      transformedData: null,
      errorCode: e.code,
      errorMessage: e.message
    }));
    await ctx.db.transferExecutionLog.createMany({ data: logData });

    return {
      recordsTotal: parseResult.errors.length,
      recordsSucceeded: 0,
      recordsFailed: parseResult.errors.length,
      errorMessage: `FSD parse failed: ${parseResult.errors[0]!.message}`
    };
  }

  // 4. Map parsed records to target service inputs
  const targetParams: TargetParams = {
    ...(profile.targetParams as TargetParams | null),
    entityId: String(runtimeParams.entityId ?? ""),
    periodId: String(runtimeParams.periodId ?? (profile.targetParams as any)?.periodId ?? "")
  };

  const mapResult = mapRecordsToTarget(profile.targetComponent, parseResult.records, targetParams);

  if (!mapResult.ok) {
    return failExecution(ctx, executionId, mapResult.code, mapResult.message);
  }

  // 5. Write to target component
  const result = await runWithContext(
    {
      tenantSlug: ctx.tenantSlug,
      tenantDbUrl: ctx.tenantDbUrl,
      entityId: targetParams.entityId || null,
      userId: String(runtimeParams.triggeredBy ?? "system")
    },
    () => writeToTarget(ctx, executionId, profile, mapResult, parseResult.records, targetParams)
  );

  // 6. Save payloads if configured
  if (profile.savePayload === "INPUT" || profile.savePayload === "BOTH") {
    const inputKey = `${ctx.tenantSlug}/${executionId}/input.txt`;
    await ctx.storage.write(inputKey, fileContent).catch(() => {});
    await ctx.db.transferExecution.update({
      where: { id: executionId },
      data: { inputPayloadKey: inputKey }
    });
  }
  if (profile.savePayload === "OUTPUT" || profile.savePayload === "BOTH") {
    const outputKey = `${ctx.tenantSlug}/${executionId}/output.json`;
    await ctx.storage.write(outputKey, JSON.stringify(parseResult.records)).catch(() => {});
    await ctx.db.transferExecution.update({
      where: { id: executionId },
      data: { outputPayloadKey: outputKey }
    });
  }

  return result;
}

// ── Write to target (inside runWithContext) ───────────────────────────────────

async function writeToTarget(
  ctx: PipelineContext,
  executionId: string,
  profile: ProfileWithRelations,
  mapResult: Extract<ReturnType<typeof mapRecordsToTarget>, { ok: true }>,
  sourceRecords: FsdRecordValue[],
  targetParams: TargetParams
): Promise<PipelineResult> {
  let succeeded = 0;
  let failed = 0;
  const totalRecords = sourceRecords.length;

  if (mapResult.component === "GL_JOURNAL") {
    const glService = new GLService(ctx.db as any);

    for (const journal of mapResult.journals) {
      try {
        await glService.createJournal(
          journal.entityId,
          String(targetParams.entityId ?? "system"),
          journal.input
        );
        // Log success for all source records in this journal
        for (const idx of journal.sourceIndices) {
          await ctx.db.transferExecutionLog.create({
            data: {
              executionId,
              recordIndex: idx,
              status: "SUCCESS",
              sourceData: sourceRecords[idx] as any,
              transformedData: journal.input as any
            }
          });
          succeeded++;
        }
      } catch (err) {
        // Log failure for all source records in this journal
        for (const idx of journal.sourceIndices) {
          await ctx.db.transferExecutionLog.create({
            data: {
              executionId,
              recordIndex: idx,
              status: "FAILED",
              sourceData: sourceRecords[idx] as any,
              errorCode: "GL_WRITE_ERROR",
              errorMessage: (err as Error).message
            }
          });
          failed++;
        }
      }
    }
  } else if (mapResult.component === "AP_INVOICE") {
    const apService = new APService(ctx.db as any);

    for (const rec of mapResult.records) {
      try {
        await apService.createInvoice(
          targetParams.entityId ?? "",
          String(targetParams.entityId ?? "system"),
          rec.data as any
        );
        await ctx.db.transferExecutionLog.create({
          data: {
            executionId,
            recordIndex: rec.index,
            status: "SUCCESS",
            sourceData: sourceRecords[rec.index] as any,
            transformedData: rec.data as any
          }
        });
        succeeded++;
      } catch (err) {
        await ctx.db.transferExecutionLog.create({
          data: {
            executionId,
            recordIndex: rec.index,
            status: "FAILED",
            sourceData: sourceRecords[rec.index] as any,
            errorCode: "AP_WRITE_ERROR",
            errorMessage: (err as Error).message
          }
        });
        failed++;
      }
    }
  } else if (mapResult.component === "AR_INVOICE") {
    const arService = new ARService(ctx.db as any);

    for (const rec of mapResult.records) {
      try {
        await arService.createInvoice(targetParams.entityId ?? "", rec.data as any);
        await ctx.db.transferExecutionLog.create({
          data: {
            executionId,
            recordIndex: rec.index,
            status: "SUCCESS",
            sourceData: sourceRecords[rec.index] as any,
            transformedData: rec.data as any
          }
        });
        succeeded++;
      } catch (err) {
        await ctx.db.transferExecutionLog.create({
          data: {
            executionId,
            recordIndex: rec.index,
            status: "FAILED",
            sourceData: sourceRecords[rec.index] as any,
            errorCode: "AR_WRITE_ERROR",
            errorMessage: (err as Error).message
          }
        });
        failed++;
      }
    }
  }

  return {
    recordsTotal: totalRecords,
    recordsSucceeded: succeeded,
    recordsFailed: failed
  };
}

// ── Process pipeline (stub) ──────────────────────────────────────────────────

export async function executeProcess(
  ctx: PipelineContext,
  executionId: string,
  profile: ProfileWithRelations
): Promise<PipelineResult> {
  return failExecution(
    ctx,
    executionId,
    "UNSUPPORTED_PROCESS",
    `Process profile "${profile.name}" (${profile.targetComponent ?? "unknown"}) is not yet supported. Process execution will be available in a future sprint.`
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveInputFilePath(
  profile: ProfileWithRelations,
  runtimeParams: Record<string, unknown>,
  tenantSlug: string
): string {
  // Priority: explicit runtime param → profile sourceParams → fallback
  if (runtimeParams.filePath) {
    return String(runtimeParams.filePath);
  }
  if (profile.sourceParams && (profile.sourceParams as any).fileName) {
    return `${tenantSlug}/${(profile.sourceParams as any).fileName}`;
  }
  return `${tenantSlug}/input.csv`;
}

async function failExecution(
  ctx: PipelineContext,
  executionId: string,
  code: string,
  message: string
): Promise<PipelineResult> {
  await ctx.db.transferExecutionLog
    .create({
      data: {
        executionId,
        recordIndex: 0,
        status: "FAILED",
        errorCode: code,
        errorMessage: message
      }
    })
    .catch(() => {});

  return {
    recordsTotal: 0,
    recordsSucceeded: 0,
    recordsFailed: 0,
    errorMessage: `[${code}] ${message}`
  };
}
