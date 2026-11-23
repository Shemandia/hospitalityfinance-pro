/**
 * Integrations — execution pipeline.
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
 *   6. Logs per-record results to integration_execution_logs
 *   7. Optionally saves payloads to storage
 */

import { createHash } from "node:crypto";
import { parse, write, type FsdSchema, type FsdRecordValue } from "@hfp/fsd-engine";
import {
  executeTransformation,
  createSandbox,
  BUILTIN_FUNCTIONS_SOURCE,
  type TmlDefinition,
  type TmlRecord,
  type Sandbox
} from "@hfp/tml-engine";
import { GLService } from "../modules/gl/service.js"; // exports read journals
import { APService } from "../modules/ap/service.js";
import { ARService } from "../modules/ar/service.js";
import { AllocationService } from "../modules/allocation/service.js";
import { FixedAssetService } from "../modules/fixed-asset/service.js";
import { runWithContext } from "../db/requestContext.js";
import { mapRecordsToTarget, type TargetParams } from "./integration-record-mapper.js";
import { type DocumentPoster, importDocuments } from "./integration-import-documents.js";
import { applyUnmappedPolicy, type RecordFailure } from "./integration-unmapped.js";
import { loadLookupResolver, lookupTablesOf } from "../modules/integrations/lookup-resolver.js";
import { PostingService } from "../modules/posting/service.js";
import { withBypassRLS } from "../db/rls-bypass.js";
import type { PrismaClient } from "../db/client.js";
import type { StorageBackend } from "./integration-storage.js";
import { resolveReviewMode } from "./integration-batch-stager.js";
import { moduleLogger } from "../shared/logger.js";
import { insecureTmlSandboxAllowed } from "../shared/tml-sandbox.js";
import { actingUserId, systemUserId } from "../modules/access/system-user.js";

const log = moduleLogger("integration-pipeline");

// ── Types ────────────────────────────────────────────────────────────────────

export type PipelineContext = {
  /** Prisma client for the tenant DB (already tenant-scoped) */
  db: PipelineDb;
  /** Posts canonical documents; the posting service over `db` unless a test gives one. */
  poster?: DocumentPoster;
  /** File storage backend (local or S3) */
  storage: StorageBackend;
  /** Tenant slug for context */
  tenantSlug: string;
  /** Tenant DB URL for context */
  tenantDbUrl: string;
};

/** Minimal DB interface for the pipeline (avoids importing full PrismaClient) */
export type PipelineDb = {
  integrationProfile: {
    findUnique: (args: {
      where: { id: string };
      include?: Record<string, unknown>;
    }) => Promise<ProfileWithRelations | null>;
  };
  integrationExecution: {
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    findUnique: (args: {
      where: { id: string };
      select?: Record<string, unknown>;
    }) => Promise<{ automationId: string | null; triggeredBy: string | null } | null>;
  };
  integrationExecutionLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    createMany: (args: { data: Record<string, unknown>[] }) => Promise<unknown>;
  };
  account: {
    findMany: (args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => Promise<Array<{ id: string; code: string }>>;
  };
  period: {
    findMany: (args: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => Promise<Array<{ id: string; status: string }>>;
  };
  integrationBatch: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
    /** Used to detect a source file that has already been staged. */
    findFirst: (args: {
      where: Record<string, unknown>;
    }) => Promise<{ id: string; status: string } | null>;
  };
  integrationBatchItem: {
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
  reviewMode?: "HOLD" | "AUTO_COMMIT" | null;
  /** The tenant's source system this profile imports from (ledger imports). */
  sourceSystemCode?: string | null;
  atomicity?: "PER_DOCUMENT" | "WHOLE_FILE";
  unmappedPolicy?: "REJECT" | "HOLD" | "SUSPENSE";
  suspenseAccountCode?: string | null;
  fxRateType?: "SPOT" | "AVERAGE" | "BUDGET" | "CLOSING" | null;
  sourceFormat: { id: string; fsdXml: string; classification: string } | null;
  targetFormat: { id: string; fsdXml: string; classification: string } | null;
  transformation: {
    id: string;
    rulesJson: unknown;
    functionsJson: unknown;
  } | null;
};

/**
 * Deterministic fingerprint of the parsed source records, used to detect a
 * file that has already been imported.
 *
 * Keys are sorted so that two parses of the same file hash identically
 * regardless of property order, which JSON.stringify does not otherwise
 * guarantee across engine versions or object construction paths.
 */
export function hashSourceRecords(records: FsdRecordValue[]): string {
  const canonical = JSON.stringify(records, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      );
    }
    return value;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export type PipelineResult = {
  recordsTotal: number;
  recordsSucceeded: number;
  recordsFailed: number;
  errorMessage?: string;
  status?: string;
  totalRecords?: number;
  successCount?: number;
  failCount?: number;
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
    await ctx.db.integrationExecutionLog.createMany({ data: logData });

    return {
      recordsTotal: parseResult.errors.length,
      recordsSucceeded: 0,
      recordsFailed: parseResult.errors.length,
      errorMessage: `FSD parse failed: ${parseResult.errors[0]!.message}`
    };
  }

  // 4. Apply TML transformation (if profile has a transformation), with the
  // tenant's lookup tables.
  let recordsForMapping: FsdRecordValue[] = parseResult.records;
  let recordFailures = new Map<number, RecordFailure>();
  let unmappedValues = 0;

  if (profile.transformation?.rulesJson) {
    let tmlResult: Awaited<ReturnType<typeof applyTransformation>>;
    try {
      tmlResult = await applyTransformation(ctx, profile.transformation, parseResult.records);
    } catch (err) {
      return failExecution(
        ctx,
        executionId,
        "TRANSFORMATION_SETUP_ERROR",
        `The transformation could not start: ${(err as Error).message}`
      );
    }

    if (profile.targetComponent === "GL_JOURNAL") {
      // Ledger imports: the profile's unmapped policy decides, and a record
      // that failed takes its whole document with it (logged per record by
      // the document stage).
      const applied = applyUnmappedPolicy(tmlResult, profile);
      recordsForMapping = applied.records as FsdRecordValue[];
      recordFailures = applied.failures;
      unmappedValues = applied.unmapped;
    } else {
      // AP and AR targets (WP-U replaces them): failed records are logged and left out.
      if (tmlResult.errors.length > 0) {
        await ctx.db.integrationExecutionLog.createMany({
          data: tmlResult.errors.map((e) => ({
            executionId,
            recordIndex: e.recordIndex,
            status: "FAILED" as const,
            sourceData: parseResult.records[e.recordIndex] as any,
            transformedData: null,
            errorCode: "TRANSFORM_ERROR",
            errorMessage: `[${e.ruleType}] ${e.message}`
          }))
        });
      }
      if (tmlResult.succeeded === 0 && tmlResult.failed > 0) {
        return {
          recordsTotal: parseResult.records.length,
          recordsSucceeded: 0,
          recordsFailed: tmlResult.failed,
          errorMessage: `All ${tmlResult.failed} records failed transformation: ${tmlResult.errors[0]?.message ?? "unknown error"}`
        };
      }
      // Unchanged from before: every record goes on, failed ones as far as
      // they got (the writer logs by index). WP-U replaces these targets.
      recordsForMapping = tmlResult.records as FsdRecordValue[];
    }
  }

  // 5. Ledger imports: build canonical documents and post them through the
  // posting service (import plan section 4). Nothing else writes journals.
  if (profile.targetComponent === "GL_JOURNAL") {
    const execMeta = await ctx.db.integrationExecution.findUnique({
      where: { id: executionId },
      select: { automationId: true, triggeredBy: true }
    });
    const scheduled = Boolean(execMeta?.automationId) || execMeta?.triggeredBy === "scheduler";
    const reviewMode = resolveReviewMode(profile.reviewMode ?? null, {
      automationId: execMeta?.automationId ?? null,
      triggeredBy: execMeta?.triggeredBy ?? null
    });
    // HOLD policy: a run with unmapped values waits for review.
    const mode = profile.unmappedPolicy === "HOLD" && unmappedValues > 0 ? "HOLD" : reviewMode;
    const triggeredBy = String(runtimeParams.triggeredBy ?? execMeta?.triggeredBy ?? "");
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const result = await runWithContext(
      { tenantSlug: ctx.tenantSlug, tenantDbUrl: ctx.tenantDbUrl, entityId: null },
      async () => {
        const actorUserId = UUID.test(triggeredBy) ? triggeredBy : await systemUserId();
        const runEntityId = scheduled
          ? null
          : (runtimeParams.entityId as string | undefined) || null;
        const runEntity = runEntityId
          ? ((await withBypassRLS(ctx.db, (tx: any) =>
              tx.entity.findUnique({ where: { id: runEntityId }, select: { id: true, code: true } })
            )) as { id: string; code: string } | null)
          : null;
        return runWithContext(
          {
            tenantSlug: ctx.tenantSlug,
            tenantDbUrl: ctx.tenantDbUrl,
            entityId: null,
            userId: actorUserId
          },
          () =>
            importDocuments({
              ctx,
              poster: ctx.poster ?? new PostingService(ctx.db as unknown as PrismaClient),
              executionId,
              profile,
              sourceRecords: parseResult.records,
              records: recordsForMapping as Record<string, unknown>[],
              mode,
              actorUserId,
              runEntity,
              recordFailures
            })
        );
      }
    );
    await savePayloads(ctx, executionId, profile, fileContent, parseResult.records);
    return result;
  }

  // 6. AP and AR targets map records to their services' inputs (WP-U replaces them).
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
      // The person who ran the import, or the tenant's system user for a
      // scheduled one. writeToTarget records this user as the creator.
      userId: String(runtimeParams.triggeredBy ?? (await systemUserId()))
    },
    () => writeToTarget(ctx, executionId, profile, mapResult, parseResult.records, targetParams)
  );

  await savePayloads(ctx, executionId, profile, fileContent, parseResult.records);

  return result;
}

/** Keeps the input file and/or the parsed records, when the profile asks for it. */
async function savePayloads(
  ctx: PipelineContext,
  executionId: string,
  profile: ProfileWithRelations,
  fileContent: string,
  records: FsdRecordValue[]
): Promise<void> {
  // 7. Save payloads if configured
  if (profile.savePayload === "INPUT" || profile.savePayload === "BOTH") {
    const inputKey = `${ctx.tenantSlug}/${executionId}/input.txt`;
    await ctx.storage.write(inputKey, fileContent).catch(() => {});
    await ctx.db.integrationExecution.update({
      where: { id: executionId },
      data: { inputPayloadKey: inputKey }
    });
  }
  if (profile.savePayload === "OUTPUT" || profile.savePayload === "BOTH") {
    const outputKey = `${ctx.tenantSlug}/${executionId}/output.json`;
    await ctx.storage.write(outputKey, JSON.stringify(records)).catch(() => {});
    await ctx.db.integrationExecution.update({
      where: { id: executionId },
      data: { outputPayloadKey: outputKey }
    });
  }
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

  if (mapResult.component === "AP_INVOICE") {
    const apService = new APService(ctx.db as any);

    for (const rec of mapResult.records) {
      try {
        await apService.createInvoice(
          targetParams.entityId ?? "",
          await actingUserId(),
          rec.data as any
        );
        await ctx.db.integrationExecutionLog.create({
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
        await ctx.db.integrationExecutionLog.create({
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
        await ctx.db.integrationExecutionLog.create({
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
        await ctx.db.integrationExecutionLog.create({
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
        userId: String(runtimeParams.triggeredBy ?? (await systemUserId()))
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
    await ctx.db.integrationExecutionLog.createMany({ data: logData });

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
  await ctx.db.integrationExecutionLog.createMany({ data: logData });

  // 7. Save payloads if configured
  if (profile.savePayload === "INPUT" || profile.savePayload === "BOTH") {
    const inputKey = `${ctx.tenantSlug}/${executionId}/input.json`;
    await ctx.storage.write(inputKey, JSON.stringify(sourceRecords)).catch(() => {});
    await ctx.db.integrationExecution.update({
      where: { id: executionId },
      data: { inputPayloadKey: inputKey }
    });
  }
  if (profile.savePayload === "OUTPUT" || profile.savePayload === "BOTH") {
    const outputKey = `${ctx.tenantSlug}/${executionId}/output.txt`;
    await ctx.storage.write(outputKey, writeResult.output).catch(() => {});
    await ctx.db.integrationExecution.update({
      where: { id: executionId },
      data: { outputPayloadKey: outputKey }
    });
  }

  await ctx.db.integrationExecution.update({
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
      limit: 100,
      offset: 0
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

  if (targetComponent === "DEPRECIATION") {
    return executeDepreciationProcess(ctx, executionId, profile);
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

  const userId = params.executedBy ?? (await systemUserId());
  const periodId = params.periodId ?? undefined;

  try {
    const allocationService = new AllocationService(ctx.db as any);
    const result = await allocationService.executeAllocation(
      entityId,
      definitionId,
      userId,
      periodId
    );

    await ctx.db.integrationExecutionLog
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

    return {
      recordsTotal: 1,
      recordsSucceeded: 1,
      recordsFailed: 0,
      status: "COMPLETED",
      totalRecords: 1,
      successCount: 1,
      failCount: 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown allocation error";
    return failExecution(ctx, executionId, "ALLOCATION_FAILED", message);
  }
}

/**
 * Execute a depreciation process profile.
 * targetParams should contain: { entityId, periodId, executedBy? }
 */
async function executeDepreciationProcess(
  ctx: PipelineContext,
  executionId: string,
  profile: ProfileWithRelations
): Promise<PipelineResult> {
  const params = (profile.targetParams ?? {}) as Record<string, string>;

  const entityId = params.entityId;
  if (!entityId) {
    return failExecution(
      ctx,
      executionId,
      "MISSING_ENTITY_ID",
      "Depreciation process profile requires targetParams.entityId."
    );
  }

  const periodId = params.periodId;
  if (!periodId) {
    return failExecution(
      ctx,
      executionId,
      "MISSING_PERIOD_ID",
      "Depreciation process profile requires targetParams.periodId."
    );
  }

  const userId = params.executedBy ?? (await systemUserId());

  try {
    const fixedAssetService = new FixedAssetService(ctx.db as any);
    const result = await fixedAssetService.runDepreciation(entityId, periodId, userId);

    await ctx.db.integrationExecutionLog
      .create({
        data: {
          executionId,
          recordIndex: 0,
          status: "SUCCESS",
          payload: {
            periodId,
            journalId: result.journalId ?? null,
            assetsProcessed: result.lines?.length ?? 0
          }
        }
      })
      .catch(() => {});

    return {
      recordsTotal: 1,
      recordsSucceeded: 1,
      recordsFailed: 0,
      status: "COMPLETED",
      totalRecords: 1,
      successCount: 1,
      failCount: 0
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown depreciation error";
    return failExecution(ctx, executionId, "DEPRECIATION_FAILED", message);
  }
}

// ── TML transformation ──────────────────────────────────────────────────────

async function applyTransformation(
  ctx: PipelineContext,
  transformation: { rulesJson: unknown; functionsJson: unknown },
  records: FsdRecordValue[]
): Promise<ReturnType<typeof executeTransformation>> {
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
    sandbox = createSandbox(definition.functions ?? [], BUILTIN_FUNCTIONS_SOURCE, {
      allowInsecureFallback: insecureTmlSandboxAllowed()
    });
  }

  // The tenant's lookup tables the rules name (source codes to ledger codes).
  const lookup = await loadLookupResolver(ctx.db, lookupTablesOf(definition.rules));

  try {
    return executeTransformation(definition, records as TmlRecord[], sandbox, { lookup });
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
  await ctx.db.integrationExecutionLog
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
