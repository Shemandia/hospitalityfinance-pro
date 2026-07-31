/**
 * Test runner service for Transfer Desk dry-run tests.
 *
 * Runs the full pipeline: FSD parse → TML transform → validate →
 * journal preview. Streams progress via an SSE callback and persists
 * results in TransferExecution + TransferExecutionLog.
 */

import type { PrismaClient } from "../../db/client.js";
import { FsdEngine } from "@hfp/fsd-engine";
import type { ProfileFsdSchema } from "@hfp/fsd-engine";
import {
  compileMappings,
  executeTransformation,
  createSandbox,
  BUILTIN_FUNCTIONS_SOURCE,
  type WizardTmlMapping,
  type Sandbox,
  type TmlRecord
} from "@hfp/tml-engine";

// ── Error ────────────────────────────────────────────────────────────────────

export class TestServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export type SseEmitter = (event: string, data: Record<string, unknown>) => void;

export type TestSummary = {
  testId: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  warnings: number;
};

// ── Service ──────────────────────────────────────────────────────────────────

const engine = new FsdEngine();

export class TestRunnerService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Run a dry-run test for a profile.
   *
   * Steps:
   *   1. Load profile + its FSD schema from DB
   *   2. Parse the uploaded file via FsdEngine.parse()
   *   3. Validate parsed rows via FsdEngine.validate()
   *   4. Generate simple journal preview (debit/credit view)
   *   5. Persist results in TransferExecution + TransferExecutionLog
   *   6. Stream progress via SSE callback
   */
  async runTest(
    profileId: string,
    userId: string,
    fileBuffer: Buffer,
    sse: SseEmitter
  ): Promise<TestSummary> {
    const db = this.prisma as any;

    // 1. Load profile with source format
    const profile = await db.transferProfile.findUnique({
      where: { id: profileId },
      include: {
        sourceFormat: true
      }
    });
    if (!profile) {
      throw new TestServiceError("PROFILE_NOT_FOUND", "Profile not found.", 404);
    }

    // Resolve the FSD schema.
    // The profile's FSD schema may be stored as:
    //   a) guiState JSON on the linked TransferFormat (wizard-created)
    //   b) sourceParams.__fsdSchema (wizard draft, before format is saved)
    // Fall back to attempting parse with a minimal auto-detected schema.
    let fsdSchema: ProfileFsdSchema | null = null;

    if (profile.sourceFormat?.guiState) {
      fsdSchema = profile.sourceFormat.guiState as unknown as ProfileFsdSchema;
    }
    const sourceParams = (profile.sourceParams ?? {}) as Record<string, unknown>;
    if (!fsdSchema && sourceParams.__fsdSchema) {
      fsdSchema = sourceParams.__fsdSchema as unknown as ProfileFsdSchema;
    }

    if (!fsdSchema) {
      // Try auto-detection as last resort
      const detection = engine.detectFormat(fileBuffer);
      if (detection.confidence < 0.5) {
        throw new TestServiceError(
          "TEST_NO_FSD_SCHEMA",
          "Profile has no FSD schema configured and auto-detection confidence is too low.",
          400
        );
      }
      fsdSchema = {
        version: "1.0",
        format: detection.detectedFormat,
        fields: detection.detectedFields.map((f, i) => ({
          name: f.name,
          target: "",
          type: f.suggestedType,
          columnName: f.name,
          columnIndex: i
        }))
      } as unknown as ProfileFsdSchema;
    }

    // 2. Create execution record (dry-run)
    const execution = await db.transferExecution.create({
      data: {
        profileId,
        status: "RUNNING",
        triggeredBy: userId,
        runtimeParams: { isDryRun: true } as any,
        startedAt: new Date()
      }
    });
    const testId = execution.id as string;

    try {
      // 3. Parse
      sse("progress", {
        step: "parsing",
        current: 0,
        total: 0,
        message: "Starting file parse..."
      });

      const parseResult = await engine.parse(fileBuffer, fsdSchema);
      const totalRows = parseResult.rowCount;

      sse("progress", {
        step: "parsing",
        current: totalRows,
        total: totalRows,
        message: `Parsed ${totalRows} rows`
      });

      // 4. Validate
      sse("progress", {
        step: "validation",
        current: 0,
        total: totalRows,
        message: "Validating parsed rows..."
      });

      const validation = engine.validate(parseResult.rows, fsdSchema);

      sse("progress", {
        step: "validation",
        current: totalRows,
        total: totalRows,
        message: `Validation complete: ${validation.errors.length} errors`
      });

      // 5. TML Transformation
      // Extract flat records from parsed rows (field name → parsed value)
      const flatRecords: TmlRecord[] = parseResult.rows.map((row) => {
        const rec: TmlRecord = {};
        for (const [name, cell] of Object.entries(row.fields)) {
          const parsed = (cell as { parsedValue: unknown }).parsedValue;
          rec[name] = (
            parsed == null ? null : typeof parsed === "object" ? String(parsed) : parsed
          ) as string | number | boolean | null;
        }
        return rec;
      });

      // Compile and execute TML mappings if available
      const tmlMappings = sourceParams.__tmlMappings as WizardTmlMapping[] | undefined;
      let transformedRecords: TmlRecord[] = flatRecords;
      let tmlErrors: Array<{ rowIndex: number; message: string }> = [];

      if (tmlMappings && tmlMappings.length > 0) {
        sse("progress", {
          step: "mapping",
          current: 0,
          total: totalRows,
          message: "Compiling TML mappings..."
        });

        let sandbox: Sandbox | null = null;
        try {
          const tmlDef = compileMappings(tmlMappings);
          if (tmlDef.functions && tmlDef.functions.length > 0) {
            sandbox = createSandbox(tmlDef.functions, BUILTIN_FUNCTIONS_SOURCE, {
              timeoutMs: 5000
            });
          }

          // Load lookup tables if any rules reference them
          let lookupTables: Map<string, Map<string, string>> | undefined;
          const lookupRules = tmlDef.rules.filter((r) => r.type === "lookup");
          if (lookupRules.length > 0) {
            lookupTables = await this.loadLookupTables(
              lookupRules.map((r) => (r as { table: string }).table)
            );
          }

          const tmlResult = executeTransformation(tmlDef, flatRecords, sandbox, { lookupTables });
          transformedRecords = tmlResult.records;
          tmlErrors = tmlResult.errors.map((e) => ({
            rowIndex: e.recordIndex,
            message: e.message
          }));

          sse("progress", {
            step: "mapping",
            current: totalRows,
            total: totalRows,
            message: `TML transformation complete: ${tmlResult.succeeded} succeeded, ${tmlResult.failed} failed`
          });
        } finally {
          sandbox?.dispose();
        }
      } else {
        sse("progress", {
          step: "mapping",
          current: totalRows,
          total: totalRows,
          message: "No TML mappings configured — using raw parsed data"
        });
      }

      // 6. Build row-level results + journal preview
      const errorRowIndices = new Set(validation.errors.map((e) => e.rowIndex));
      const parseErrorRowIndices = new Set(parseResult.errors.map((e) => e.rowIndex));
      const tmlErrorRowIndices = new Set(tmlErrors.map((e) => e.rowIndex));

      let validRows = 0;
      let errorRows = 0;
      const logInserts: Array<{
        executionId: string;
        recordIndex: number;
        status: string;
        sourceData: unknown;
        transformedData: unknown;
        errorCode: string | null;
        errorMessage: string | null;
      }> = [];

      for (let i = 0; i < parseResult.rows.length; i++) {
        const row = parseResult.rows[i];
        const hasError =
          errorRowIndices.has(i) || parseErrorRowIndices.has(i) || tmlErrorRowIndices.has(i);

        if (hasError) {
          errorRows++;
          // Collect error messages for this row
          const rowErrors = [
            ...parseResult.errors.filter((e) => e.rowIndex === i),
            ...validation.errors.filter((e) => e.rowIndex === i),
            ...tmlErrors
              .filter((e) => e.rowIndex === i)
              .map((e) => ({
                errorCode: "TML_TRANSFORM_ERROR",
                message: e.message
              }))
          ];
          logInserts.push({
            executionId: testId,
            recordIndex: i,
            status: "FAILED",
            sourceData: row.fields,
            transformedData: transformedRecords[i] ?? null,
            errorCode: (rowErrors[0] as { errorCode?: string })?.errorCode ?? "VALIDATION_FAILED",
            errorMessage: rowErrors.map((e) => e.message).join("; ")
          });
        } else {
          validRows++;
          logInserts.push({
            executionId: testId,
            recordIndex: i,
            status: "SUCCESS",
            sourceData: row.fields,
            transformedData: transformedRecords[i] ?? null,
            errorCode: null,
            errorMessage: null
          });
        }

        // Emit progress every 50 rows
        if ((i + 1) % 50 === 0 || i === parseResult.rows.length - 1) {
          sse("progress", {
            step: "results",
            current: i + 1,
            total: totalRows,
            message: `Processing row ${i + 1} of ${totalRows}`
          });
        }
      }

      // 6. Persist execution logs (batch insert)
      if (logInserts.length > 0) {
        // Prisma doesn't support createMany with all fields on all adapters,
        // so we batch in chunks
        const CHUNK = 500;
        for (let c = 0; c < logInserts.length; c += CHUNK) {
          const chunk = logInserts.slice(c, c + CHUNK);
          await db.transferExecutionLog.createMany({
            data: chunk
          });
        }
      }

      // 7. Update execution record
      const warnings = parseResult.errors.filter((e) => e.errorCode === "UNKNOWN_COLUMN").length;

      const summary: TestSummary = {
        testId,
        totalRows,
        validRows,
        errorRows,
        warnings
      };

      await db.transferExecution.update({
        where: { id: testId },
        data: {
          status: "COMPLETED",
          recordsTotal: totalRows,
          recordsSucceeded: validRows,
          recordsFailed: errorRows,
          finishedAt: new Date()
        }
      });

      // 8. Emit completion
      sse("complete", {
        summary
      });

      return summary;
    } catch (error) {
      // Mark execution as failed
      const msg = error instanceof Error ? error.message : "Unknown error";
      await db.transferExecution
        .update({
          where: { id: testId },
          data: {
            status: "FAILED",
            errorMessage: msg,
            finishedAt: new Date()
          }
        })
        .catch(() => {});

      throw error;
    }
  }

  // ── Lookup table loader ────────────────────────────────────────────────

  /**
   * Load lookup tables from DB for TML lookup rules.
   * Returns Map<tableId, Map<sourceValue, targetValue>>.
   */
  private async loadLookupTables(tableIds: string[]): Promise<Map<string, Map<string, string>>> {
    const db = this.prisma as any;
    const result = new Map<string, Map<string, string>>();

    const uniqueIds = [...new Set(tableIds.filter(Boolean))];
    if (uniqueIds.length === 0) return result;

    for (const tableId of uniqueIds) {
      const rows = await db.transferLookupRow
        ?.findMany?.({
          where: { tableId },
          select: { sourceValue: true, targetValue: true }
        })
        .catch(() => []);

      if (rows && rows.length > 0) {
        const map = new Map<string, string>();
        for (const row of rows) {
          map.set(String(row.sourceValue), String(row.targetValue));
        }
        result.set(tableId, map);
      }
    }

    return result;
  }

  // ── Get cached results ──────────────────────────────────────────────────

  async getResults(profileId: string, testId: string) {
    const db = this.prisma as any;

    const execution = await db.transferExecution.findFirst({
      where: { id: testId, profileId }
    });
    if (!execution) {
      throw new TestServiceError("TEST_NOT_FOUND", "Test run not found.", 404);
    }

    const logs = await db.transferExecutionLog.findMany({
      where: { executionId: testId },
      orderBy: { recordIndex: "asc" }
    });

    // Separate into categories
    const parsedRows: Array<Record<string, unknown>> = [];
    const mappedRows: Array<Record<string, unknown>> = [];
    const validationErrors: Array<{
      rowIndex: number;
      errorCode: string;
      message: string;
    }> = [];
    const journalPreview: Array<Record<string, unknown>> = [];

    for (const log of logs) {
      if (log.sourceData) {
        parsedRows.push({
          rowIndex: log.recordIndex,
          fields: log.sourceData
        });
      }
      if (log.transformedData) {
        mappedRows.push({
          rowIndex: log.recordIndex,
          ...log.transformedData
        });
        // Build journal preview from mapped data if it has account/debit/credit
        const mapped = log.transformedData as Record<string, unknown>;
        if (mapped.account || mapped["line.account"]) {
          journalPreview.push({
            lineNumber: log.recordIndex + 1,
            account: (mapped.account as string) ?? (mapped["line.account"] as string) ?? "",
            description:
              (mapped.description as string) ?? (mapped["line.description"] as string) ?? "",
            debit: Number(mapped.debit ?? mapped["line.debit"] ?? 0),
            credit: Number(mapped.credit ?? mapped["line.credit"] ?? 0),
            currency: (mapped.currency as string) ?? (mapped["journal.currency"] as string) ?? ""
          });
        }
      }
      if (log.status === "FAILED" && log.errorCode) {
        validationErrors.push({
          rowIndex: log.recordIndex,
          errorCode: log.errorCode,
          message: log.errorMessage ?? ""
        });
      }
    }

    return {
      testId,
      status: execution.status,
      summary: {
        testId,
        totalRows: execution.recordsTotal,
        validRows: execution.recordsSucceeded,
        errorRows: execution.recordsFailed,
        warnings: 0
      },
      parsedRows,
      mappedRows,
      validationErrors,
      journalPreview,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt
    };
  }
}
