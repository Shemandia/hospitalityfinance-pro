/**
 * Transfer Desk — Automation execution engine.
 *
 * Runs an automation's steps sequentially. Each step enqueues a Transfer Desk
 * profile execution and waits for it to complete before moving to the next.
 *
 * Behaviour when a step fails depends on the step's `failOnError` flag:
 *   - failOnError=true  → stop, mark automation FAILED
 *   - failOnError=false → log error, continue to next step
 *
 * Final derived status:
 *   - COMPLETED — all steps succeeded
 *   - PARTIAL   — some steps failed but execution continued
 *   - FAILED    — stopped early because a fail-on-error step failed
 */

import { enqueueTransferDeskExecution, type TransferDeskJobData } from "./transfer-desk-queue.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type AutomationStep = {
  id: string;
  profileId: string;
  stepOrder: number;
  failOnError: boolean;
  sourceParamOverrides: Record<string, unknown> | null;
  targetParamOverrides: Record<string, unknown> | null;
};

export type AutomationContext = {
  db: any; // PrismaClient (tenant-scoped)
  tenantSlug: string;
  tenantDbUrl: string;
  triggeredBy: string;
};

export type AutomationResult = {
  automationId: string;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  stepsTotal: number;
  stepsSucceeded: number;
  stepsFailed: number;
  stepResults: StepResult[];
};

export type StepResult = {
  stepOrder: number;
  profileId: string;
  executionId: string;
  status: "COMPLETED" | "FAILED";
  errorMessage?: string;
};

// ── Engine ───────────────────────────────────────────────────────────────────

/**
 * Execute all steps in an automation sequentially.
 */
export async function executeAutomation(
  ctx: AutomationContext,
  automationId: string,
  steps: AutomationStep[],
  runtimeParams: Record<string, unknown> = {}
): Promise<AutomationResult> {
  const stepResults: StepResult[] = [];
  let stepsSucceeded = 0;
  let stepsFailed = 0;
  let aborted = false;

  for (const step of steps) {
    if (aborted) break;

    // Merge runtime params with step-level overrides
    const mergedParams = {
      ...runtimeParams,
      ...(step.sourceParamOverrides ?? {}),
      ...(step.targetParamOverrides ?? {})
    };

    // Create execution row
    const execution = await ctx.db.transferExecution.create({
      data: {
        profileId: step.profileId,
        automationId,
        automationStepOrder: step.stepOrder,
        status: "QUEUED",
        triggeredBy: ctx.triggeredBy,
        runtimeParams: Object.keys(mergedParams).length > 0 ? mergedParams : undefined
      }
    });

    // Enqueue the job
    const jobData: TransferDeskJobData = {
      tenantSlug: ctx.tenantSlug,
      executionId: execution.id,
      profileId: step.profileId,
      automationId,
      automationStepOrder: step.stepOrder
    };

    try {
      await enqueueTransferDeskExecution(jobData);
    } catch (err) {
      // If enqueue fails, mark execution as failed immediately
      await ctx.db.transferExecution.update({
        where: { id: execution.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: `Failed to enqueue: ${(err as Error).message}`
        }
      });

      stepsFailed++;
      stepResults.push({
        stepOrder: step.stepOrder,
        profileId: step.profileId,
        executionId: execution.id,
        status: "FAILED",
        errorMessage: `Failed to enqueue: ${(err as Error).message}`
      });

      if (step.failOnError) {
        aborted = true;
        continue;
      }
      continue;
    }

    // Poll for completion
    const finalExecution = await waitForExecution(ctx.db, execution.id);

    if (finalExecution.status === "COMPLETED") {
      stepsSucceeded++;
      stepResults.push({
        stepOrder: step.stepOrder,
        profileId: step.profileId,
        executionId: execution.id,
        status: "COMPLETED"
      });
    } else {
      stepsFailed++;
      stepResults.push({
        stepOrder: step.stepOrder,
        profileId: step.profileId,
        executionId: execution.id,
        status: "FAILED",
        errorMessage: finalExecution.errorMessage ?? undefined
      });

      if (step.failOnError) {
        aborted = true;
      }
    }
  }

  // Derive final status
  let status: AutomationResult["status"];
  if (aborted) {
    status = "FAILED";
  } else if (stepsFailed > 0) {
    status = "PARTIAL";
  } else {
    status = "COMPLETED";
  }

  return {
    automationId,
    status,
    stepsTotal: steps.length,
    stepsSucceeded,
    stepsFailed,
    stepResults
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 500;
const MAX_POLL_ATTEMPTS = 600; // 5 minutes max wait per step

/**
 * Poll the execution row until it reaches a terminal status.
 */
async function waitForExecution(
  db: any,
  executionId: string
): Promise<{ status: string; errorMessage: string | null }> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const row = await db.transferExecution.findUnique({
      where: { id: executionId },
      select: { status: true, errorMessage: true }
    });

    if (!row) {
      return { status: "FAILED", errorMessage: "Execution row not found" };
    }

    if (row.status === "COMPLETED" || row.status === "FAILED" || row.status === "CANCELLED") {
      return row;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return { status: "FAILED", errorMessage: "Execution timed out waiting for completion" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
