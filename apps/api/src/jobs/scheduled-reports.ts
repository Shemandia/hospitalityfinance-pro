/**
 * Scheduled Report Generation
 *
 * Reads report definitions that have a `template.schedule` config,
 * determines which are due to run, creates ReportRun records, and
 * enqueues them via the existing report-generation queue.
 *
 * Schedule config format (stored in ReportDefinition.template.schedule):
 * {
 *   "enabled": true,
 *   "cron": "0 6 1 * *",           // minute hour dayOfMonth month dayOfWeek
 *   "notifyEmail": "ctrl@hotel.com",
 *   "periodSelection": "PREVIOUS"  // AUTO = current open period, PREVIOUS = last closed
 * }
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getReportQueue } from "../modules/reporting/queue.js";

// ── Cron Matching ─────────────────────────────────────────────────────────────

interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

/**
 * Parse a standard 5-field cron expression into arrays of matching values.
 * Supports: *, specific numbers, comma-separated lists, and ranges (e.g., 1-5).
 * Step values (e.g., *​/15) are also supported.
 */
function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${expression}" — expected 5 fields.`);
  }

  const ranges: [number, number][] = [
    [0, 59], // minute
    [0, 23], // hour
    [1, 31], // day of month
    [1, 12], // month
    [0, 6] // day of week (0 = Sunday)
  ];

  function parseField(field: string, min: number, max: number): number[] {
    const values: Set<number> = new Set();

    for (const segment of field.split(",")) {
      // Handle step values: */5, 1-10/2
      const [rangePart, stepStr] = segment.split("/");
      const step = stepStr ? parseInt(stepStr, 10) : 1;

      if (rangePart === "*") {
        for (let i = min; i <= max; i += step) {
          values.add(i);
        }
      } else if (rangePart.includes("-")) {
        const [startStr, endStr] = rangePart.split("-");
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        for (let i = start; i <= end; i += step) {
          values.add(i);
        }
      } else {
        values.add(parseInt(rangePart, 10));
      }
    }

    return Array.from(values);
  }

  return {
    minute: parseField(parts[0], ranges[0][0], ranges[0][1]),
    hour: parseField(parts[1], ranges[1][0], ranges[1][1]),
    dayOfMonth: parseField(parts[2], ranges[2][0], ranges[2][1]),
    month: parseField(parts[3], ranges[3][0], ranges[3][1]),
    dayOfWeek: parseField(parts[4], ranges[4][0], ranges[4][1])
  };
}

/**
 * Check whether a cron expression matches a given Date.
 * Compares hour and minute (and day/month/weekday) — does NOT compare seconds.
 */
function cronMatchesDate(expression: string, date: Date): boolean {
  const fields = parseCron(expression);
  const minute = date.getMinutes();
  const hour = date.getHours();
  const dayOfMonth = date.getDate();
  const month = date.getMonth() + 1; // JS months are 0-based
  const dayOfWeek = date.getDay(); // 0 = Sunday

  return (
    fields.minute.includes(minute) &&
    fields.hour.includes(hour) &&
    fields.dayOfMonth.includes(dayOfMonth) &&
    fields.month.includes(month) &&
    fields.dayOfWeek.includes(dayOfWeek)
  );
}

/**
 * Check if a cron expression matched at any point during the last N minutes.
 * Used because the worker runs hourly, so we check all minutes in the past hour.
 */
function cronMatchedInWindow(expression: string, windowMinutes: number): Date | null {
  const now = new Date();

  for (let i = 0; i < windowMinutes; i++) {
    const checkTime = new Date(now.getTime() - i * 60_000);
    // Zero out seconds/ms for clean comparison
    checkTime.setSeconds(0, 0);

    if (cronMatchesDate(expression, checkTime)) {
      return checkTime;
    }
  }

  return null;
}

// ── Schedule Types ────────────────────────────────────────────────────────────

interface ScheduleConfig {
  enabled: boolean;
  cron: string;
  notifyEmail?: string;
  periodSelection?: "AUTO" | "PREVIOUS";
  lastScheduledRunAt?: string; // ISO timestamp of last scheduled execution
}

function extractSchedule(template: unknown): ScheduleConfig | null {
  if (!template || typeof template !== "object") return null;
  const t = template as Record<string, unknown>;
  if (!t.schedule || typeof t.schedule !== "object") return null;

  const s = t.schedule as Record<string, unknown>;
  if (!s.enabled || typeof s.cron !== "string") return null;

  return {
    enabled: !!s.enabled,
    cron: s.cron,
    notifyEmail: typeof s.notifyEmail === "string" ? s.notifyEmail : undefined,
    periodSelection: s.periodSelection === "PREVIOUS" ? "PREVIOUS" : "AUTO",
    lastScheduledRunAt: typeof s.lastScheduledRunAt === "string" ? s.lastScheduledRunAt : undefined
  };
}

// ── Period Resolution ─────────────────────────────────────────────────────────

async function resolvePeriodId(
  entityId: string,
  selection: "AUTO" | "PREVIOUS"
): Promise<string | null> {
  if (selection === "PREVIOUS") {
    // Find the most recently closed period for this entity
    const closedPeriod = await prisma.period.findFirst({
      where: { entityId, status: "CLOSED" },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { id: true }
    });
    return closedPeriod?.id ?? null;
  }

  // AUTO — find the current open period
  const openPeriod = await prisma.period.findFirst({
    where: { entityId, status: "OPEN" },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { id: true }
  });
  return openPeriod?.id ?? null;
}

// ── Main Scheduler Function ───────────────────────────────────────────────────

/**
 * Check all report definitions across all entities for due scheduled reports.
 * Called by the scheduled-reports worker on an hourly cron.
 *
 * For each definition with an enabled schedule:
 * 1. Parse the cron expression
 * 2. Check if the cron matched any minute in the last 65 minutes (with overlap buffer)
 * 3. Skip if we already ran for this window (via lastScheduledRunAt)
 * 4. Resolve the target period
 * 5. Create a ReportRun and enqueue it
 */
export async function checkAndRunScheduledReports(): Promise<number> {
  console.log("[ScheduledReports] Checking for due scheduled reports...");

  // Fetch all report definitions that have a template (potential schedule inside)
  const definitions = await prisma.reportDefinition.findMany({
    where: {
      template: { not: Prisma.DbNull }
    },
    select: {
      id: true,
      entityId: true,
      name: true,
      type: true,
      template: true
    }
  });

  const queue = getReportQueue();
  let enqueued = 0;
  const now = new Date();
  const windowMinutes = 65; // slightly over 1 hour to avoid missing edge cases

  for (const def of definitions) {
    const schedule = extractSchedule(def.template);
    if (!schedule) continue;

    // Check if cron matched in the window
    const matchTime = cronMatchedInWindow(schedule.cron, windowMinutes);
    if (!matchTime) continue;

    // Deduplicate: skip if we already ran for this match time
    if (schedule.lastScheduledRunAt) {
      const lastRun = new Date(schedule.lastScheduledRunAt);
      const timeSinceLastRun = now.getTime() - lastRun.getTime();
      // If last run was less than 55 minutes ago, skip (prevents double-runs)
      if (timeSinceLastRun < 55 * 60_000) {
        continue;
      }
    }

    // Resolve the period
    const periodId = await resolvePeriodId(def.entityId, schedule.periodSelection ?? "AUTO");

    if (!periodId) {
      console.warn(
        `[ScheduledReports] No ${schedule.periodSelection ?? "AUTO"} period found for ` +
          `entity ${def.entityId}, skipping report "${def.name}" (${def.id}).`
      );
      continue;
    }

    // Create the ReportRun
    const parameters: Record<string, unknown> = { periodId };
    if (schedule.notifyEmail) {
      parameters.notifyEmail = schedule.notifyEmail;
    }
    parameters._scheduledAt = now.toISOString();

    const run = await prisma.reportRun.create({
      data: {
        definitionId: def.id,
        parameters: parameters as Prisma.InputJsonValue,
        status: "QUEUED"
      }
    });

    // Enqueue for processing via existing report generation worker
    await queue.add(
      "generate-report",
      { reportRunId: run.id },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 100
      }
    );

    // Update lastScheduledRunAt in the template to prevent re-runs
    const existingTemplate =
      def.template && typeof def.template === "object"
        ? (def.template as Record<string, unknown>)
        : {};

    const updatedSchedule = {
      ...(existingTemplate.schedule as Record<string, unknown>),
      lastScheduledRunAt: now.toISOString()
    };

    await prisma.reportDefinition.update({
      where: { id: def.id },
      data: {
        template: {
          ...existingTemplate,
          schedule: updatedSchedule
        } as Prisma.InputJsonValue
      }
    });

    console.log(
      `[ScheduledReports] Enqueued report "${def.name}" (${def.type}) ` +
        `for entity ${def.entityId}, period ${periodId}, run ${run.id}.`
    );
    enqueued++;
  }

  console.log(`[ScheduledReports] Check complete. Enqueued ${enqueued} report(s).`);
  return enqueued;
}
