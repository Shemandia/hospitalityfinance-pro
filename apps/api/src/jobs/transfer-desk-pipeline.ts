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
import {
  executeTransformation,
  createSandbox,
  BUILTIN_FUNCTIONS_SOURCE,
  type TmlDefinition,
  type TmlRecord,
  type Sandbox
} from "@hfp/tml-engine";
import { GLService } from "../modules/gl/service.js";
import { APService } from "../modules/ap/service.js";
import { ARService } from "../modules/ar/service.js";
import { AllocationService } from "../modules/allocation/service.js";
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
  transformation: {
    id: string;
    rulesJson: unknown;
    functionsJson: unknown;
  } | null;
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

  // 4. Apply TML transformation (if profile has a transformation)
  let recordsForMapping: FsdRecordValue[] = parseResult.records;

  if (profile.transformation?.rulesJson) {
    const tmlResult = applyTransformation(profile.transformation, parseResult.records);

    // Log transformation errors
    if (tmlResult.errors.length > 0) {
      const logData = tmlResult.errors.map((e) => ({
        executionId,
        recordIndex: e.recordIndex,
        status: "FAILED" as const,
        sourceData: parseResult.records[e.recordIndex] as any,
        transformedData: null,
        errorCode: "TRANSFORM_ERROR",
        errorMessage: `[${e.ruleType}] ${e.message}`
      }));
      await ctx.db.transferExecutionLog.createMany({ data: logData });
    }

    // If ALL records failed transformation, fail the execution
    if (tmlResult.succeeded === 0 && tmlResult.failed > 0) {
      return {
        recordsTotal: parseResult.records.length,
        recordsSucceeded: 0,
        recordsFailed: tmlResult.failed,
        errorMessage: `All ${tmlResult.failed} records failed transformation: ${tmlResult.errors[0]?.message ?? "unknown error"}`
      };
    }

    // Use transformed records for mapping (cast back to FsdRecordValue)
    recordsForMapping = tmlResult.records as FsdRecordValue[];
  }

  // 5. Map parsed records to target service inputs
  const targetParams: TargetParams = {
    ...(profile.targetParams as TargetParams | null),
    entityId: String(runtimeParams.entityId ?? ""),
    periodId: String(runtimeParams.periodId ?? (profile.targetParams as any)?.periodId ?? "")
  };

  const mapResult = mapRecordsToTarget(profile.targetComponent, recordsForMapping, targetParams);

  if (!mapResult.ok) {
    return failExecution(ctx, executionId, mapResult.code, mapResult.message);
  }

  // 6. Write to target component
  const result = await runWithContext(
    {
      tenantSlug: ctx.tenantSlug,
      tenantDbUrl: ctx.tenantDbUrl,
      entityId: targetParams.entityId || null,
      userId: String(runtimeParams.triggeredBy ?? "system")
    },
    () => writeToTarget(ctx, executionId, profile, mapResult, parseResult.records, targetParams)
  );

  // 7. Save payloads if configured
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

// ── Export pipeline ─────────────────────────────────────────────────────────

export async function executeExport(
  ctx: PipelineContext,
  executionId: string,
  profile: ProfileWithRelations,
  runtimeParams: Record<string, unknown>
): Promise<PipelineResult> {
  // 1. Validate prerequisites
  if (!profile.targetFormat) {
    return failExecution(
      ctx,
      executionId,
      "MISSING_TARGET_FORMAT",
      "Export profile has no target format definition"
    );
  }
  if (!profile.sourceComponent) {
    return failExecution(
      ctx,
      executionId,
      "MISSING_SOURCE_COMPONENT",
      "Export profile has no source component"
    );
  }

  // 2. Parse FSD definition
  let fsdSchema: FsdSchema;
  try {
    fsdSchema = JSON.parse(profile.targetFormat.fsdXml) as FsdSchema;
  } catch {
    return failExecution(ctx, executionId, "INVALID_FSD", "Target format fsdXml is not valid JSON");
  }

  // 3. Read records from source component
  const entityId = String(runtimeParams.entityId ?? "");
  let sourceRecords: FsdRecordValue[];

  try {
    sourceRecords = await runWithContext(
      {
        tenantSlug: ctx.tenantSlug,
        tenantDbUrl: ctx.tenantDbUrl,
        entityId: entityId || null,
        userId: String(runtimeParams.triggeredBy ?? "system")
      },
      () => readFromSource(ctx, profile.sourceComponent!, entityId, runtimeParams)
    );
  } catch (err) {
    return failExecution(
      ctx,
      executionId,
      "SOURCE_READ_ERROR",
      `Failed to read from source "${profile.sourceComponent}": ${(err as Error).message}`
    );
  }

  if (sourceRecords.length === 0) {
    return failExecution(
      ctx,
      executionId,
      "NO_RECORDS",
      `No records found in source "${profile.sourceComponent}" for the given parameters`
    );
  }

  // 4. Write records to FSD format
  const writeResult = write(fsdSchema, sourceRecords);

  if (writeResult.errors.length > 0 && !writeResult.output) {
    const logData = writeResult.errors.map((e, i) => ({
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
      recordsTotal: sourceRecords.length,
      recordsSucceeded: 0,
      recordsFailed: sourceRecords.length,
      errorMessage: `FSD write failed: ${writeResult.errors[0]!.message}`
    };
  }

  // 5. Save output file
  const outputPath = resolveOutputFilePath(profile, runtimeParams, ctx.tenantSlug, executionId);
  try {
    await ctx.storage.write(outputPath, writeResult.output);
  } catch (err) {
    return failExecution(
      ctx,
      executionId,
      "FILE_WRITE_ERROR",
      `Failed to write output file "${outputPath}": ${(err as Error).message}`
    );
  }

  // 6. Log success for all records
  const logData = sourceRecords.map((rec, i) => ({
    executionId,
    recordIndex: i,
    status: "SUCCESS" as const,
    sourceData: rec as any,
    transformedData: null
  }));
  await ctx.db.transferExecutionLog.createMany({ data: logData });

  // 7. Save payloads if configured
  if (profile.savePayload === "INPUT" || profile.savePayload === "BOTH") {
    const inputKey = `${ctx.tenantSlug}/${executionId}/input.json`;
    await ctx.storage.write(inputKey, JSON.stringify(sourceRecords)).catch(() => {});
    await ctx.db.transferExecution.update({
      where: { id: executionId },
      data: { inputPayloadKey: inputKey }
    });
  }
  if (profile.savePayload === "OUTPUT" || profile.savePayload === "BOTH") {
    const outputKey = `${ctx.tenantSlug}/${executionId}/output.txt`;
    await ctx.storage.write(outputKey, writeResult.output).catch(() => {});
    await ctx.db.transferExecution.update({
      where: { id: executionId },
      data: { outputPayloadKey: outputKey }
    });
  }

  await ctx.db.transferExecution.update({
    where: { id: executionId },
    data: { outputPayloadKey: outputPath }
  });

  return {
    recordsTotal: sourceRecords.length,
    recordsSucceeded: sourceRecords.length,
    recordsFailed: writeResult.errors.length
  };
}

// ── Read from source (inside runWithContext) ─────────────────────────────────

const SUPPORTED_READ_COMPONENTS = new Set(["GL_JOURNAL", "AP_INVOICE", "AR_INVOICE"]);

async function readFromSource(
  ctx: PipelineContext,
  sourceComponent: string,
  entityId: string,
  runtimeParams: Record<string, unknown>
): Promise<FsdRecordValue[]> {
  if (!SUPPORTED_READ_COMPONENTS.has(sourceComponent)) {
    throw new Error(
      `Source component "${sourceComponent}" is not supported for data reading. Supported: ${[...SUPPORTED_READ_COMPONENTS].join(", ")}`
    );
  }

  if (sourceComponent === "GL_JOURNAL") {
    const glService = new GLService(ctx.db as any);
    const result = await glService.listJournals(entityId, {
      periodId: runtimeParams.periodId ? String(runtimeParams.periodId) : undefined,
      status: "POSTED",
      limit: 100
    });
    // Flatten journal lines into FSD records
    const records: FsdRecordValue[] = [];
    const journals = Array.isArray(result) ? result : ((result as any).data ?? []);
    for (const journal of journals) {
      const lines = (journal as any).lines ?? [];
      for (const line of lines) {
        records.push({
          journalId: (journal as any).id,
          reference: (journal as any).reference ?? "",
          periodId: (journal as any).periodId ?? "",
          description: (line as any).description ?? "",
          accountId: (line as any).accountId ?? "",
          debit: String((line as any).debit ?? "0"),
          credit: String((line as any).credit ?? "0"),
          currency: (line as any).currency ?? "",
          fxRate: String((line as any).fxRate ?? "1")
        });
      }
    }
    return records;
  }

  if (sourceComponent === "AP_INVOICE") {
    const apService = new APService(ctx.db as any);
    const result = await (apService as any).listInvoices(entityId, {
      limit: 100,
      ...runtimeParams
    });
    const invoices = Array.isArray(result) ? result : ((result as any).data ?? []);
    return invoices.map((inv: any) => ({ ...inv }) as FsdRecordValue);
  }

  if (sourceComponent === "AR_INVOICE") {
    const arService = new ARService(ctx.db as any);
    const result = await (arService as any).listInvoices(entityId, {
      limit: 100,
      ...runtimeParams
    });
    const invoices = Array.isArray(result) ? result : ((result as any).data ?? []);
    return invoices.map((inv: any) => ({ ...inv }) as FsdRecordValue);
  }

  return [];
}

// ── Process pipeline (stub) ──────────────────────────────────────────────────

export async function executeProcess(
  ctx: PipelineContext,
  executionId: string,
  profile: ProfileWithRelations
): Promise<PipelineResult> {
  const targetComponent = profile.targetComponent ?? "";

  if (targetComponent === "ALLOCATION") {
    return executeAllocationProcess(ctx, executionId, profile);
  }

  return failExecution(
    ctx,
    executionId,
    "UNSUPPORTED_PROCESS",
    `Process profile "${profile.name}" (${targetComponent || "unknown"}) is not yet supported.`
  );
}

/**
 * Execute an allocation process profile.
 * targetParams should contain: { definitionId, periodId? }
 */
async function executeAllocationProcess(
  ctx: PipelineContext,
  executionId: string,
  profile: ProfileWithRelations
): Promise<PipelineResult> {
  const params = (profile.targetParams ?? {}) as Record<string, string>;
  const definitionId = params.definitionId;

  if (!definitionId) {
    return failExecution(
      ctx,
      executionId,
      "MISSING_DEFINITION_ID",
      "Allocation process profile requires targetParams.definitionId."
    );
  }

  const entityId = params.entityId;
  if (!entityId) {
    return failExecution(
      ctx,
      executionId,
      "MISSING_ENTITY_ID",
      "Allocation process profile requires targetParams.entityId."
    );
  }

  const userId = params.executedBy ?? "system";
  const periodId = params.periodId ?? undefined;

  try {
    const allocationService = new AllocationService(ctx.db as any);
    const result = await allocationService.executeAllocation(
      entityId,
      definitionId,
      userId,
      periodId
    );

    await ctx.db.transferExecutionLog
      .create({
        data: {
          executionId,
          recordIndex: 0,
          status: "SUCCESS",
          payload: {
            definitionId,
            journalId: result.journalId ?? null,
            sourceAmount: result.sourceAmount,
            lineCount: result.lines.length
          }
        }
      })
      .catch(() => {});

    return { status: "COMPLETED", totalRecords: 1, successCount: 1, failCount: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown allocation error";
    return failExecution(ctx, executionId, "ALLOCATION_FAILED", message);
  }
}

// ── TML transformation ──────────────────────────────────────────────────────

function applyTransformation(
  transformation: { rulesJson: unknown; functionsJson: unknown },
  records: FsdRecordValue[]
): ReturnType<typeof executeTransformation> {
  // Parse TML definition from DB JSONB columns
  const definition: TmlDefinition = {
    rules: Array.isArray(transformation.rulesJson)
      ? (transformation.rulesJson as TmlDefinition["rules"])
      : ((transformation.rulesJson as any)?.rules ?? []),
    functions: Array.isArray(transformation.functionsJson)
      ? (transformation.functionsJson as TmlDefinition["functions"])
      : undefined
  };

  // Create sandbox if there are transform rules or user functions
  const hasTransformRules = definition.rules.some((r) => r.type === "transform");
  const hasUserFunctions = (definition.functions?.length ?? 0) > 0;
  let sandbox: Sandbox | null = null;

  if (hasTransformRules || hasUserFunctions) {
    sandbox = createSandbox(definition.functions ?? [], BUILTIN_FUNCTIONS_SOURCE);
  }

  try {
    return executeTransformation(definition, records as TmlRecord[], sandbox);
  } finally {
    sandbox?.dispose();
  }
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

function resolveOutputFilePath(
  profile: ProfileWithRelations,
  runtimeParams: Record<string, unknown>,
  tenantSlug: string,
  executionId: string
): string {
  if (runtimeParams.outputFilePath) {
    return String(runtimeParams.outputFilePath);
  }
  if (profile.targetParams && (profile.targetParams as any).fileName) {
    return `${tenantSlug}/${(profile.targetParams as any).fileName}`;
  }
  return `${tenantSlug}/exports/${executionId}.txt`;
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
