/**
 * Transfer Desk — Automation scheduler.
 *
 * Syncs active TransferAutomationSchedule rows to BullMQ repeatable jobs.
 * Each schedule becomes a repeatable job on the tenant's transfer-desk queue
 * with pattern `automation:{automationId}`.
 *
 * Call `syncAutomationSchedules()` on API startup and after schedule CRUD.
 */

import { getTransferDeskQueue } from "./transfer-desk-queue.js";

export type ScheduleRow = {
  id: string;
  automationId: string;
  cronExpression: string;
  timezone: string;
  isActive: boolean;
  runAsUser: string | null;
  bullmqRepeatKey: string | null;
  automation: {
    id: string;
    name: string;
    isEnabled: boolean;
    steps: Array<{
      profileId: string;
      stepOrder: number;
    }>;
  };
};

/**
 * Sync all active automation schedules for a tenant to BullMQ repeatables.
 *
 * Strategy:
 *   1. Remove all existing repeatable jobs for automations (clean slate)
 *   2. Add new repeatable jobs for each active schedule whose automation is enabled
 *   3. Update the schedule row with the BullMQ repeat key for later removal
 *   4. Update nextRunAt based on the cron expression
 */
export async function syncAutomationSchedules(
  db: any,
  tenantSlug: string
): Promise<{ synced: number; removed: number }> {
  const queue = getTransferDeskQueue(tenantSlug);
  let removed = 0;
  let synced = 0;

  // Load all schedules with their automation
  const schedules: ScheduleRow[] = await db.transferAutomationSchedule.findMany({
    include: {
      automation: {
        select: {
          id: true,
          name: true,
          isEnabled: true,
          steps: {
            select: { profileId: true, stepOrder: true },
            orderBy: { stepOrder: "asc" }
          }
        }
      }
    }
  });

  // Remove existing repeatable jobs that have a stored bullmqRepeatKey
  for (const schedule of schedules) {
    if (schedule.bullmqRepeatKey) {
      try {
        await queue.removeRepeatableByKey(schedule.bullmqRepeatKey);
        removed++;
      } catch {
        // Key may already be gone
      }
      await db.transferAutomationSchedule.update({
        where: { id: schedule.id },
        data: { bullmqRepeatKey: null, nextRunAt: null }
      });
    }
  }

  // Add new repeatables for active schedules with enabled automations
  for (const schedule of schedules) {
    if (!schedule.isActive || !schedule.automation.isEnabled) continue;
    if (schedule.automation.steps.length === 0) continue;

    try {
      const job = await queue.add(
        `automation:${schedule.automationId}`,
        {
          tenantSlug,
          executionId: "", // Will be created by the automation handler
          profileId: "", // Multi-step — handled by automation engine
          automationId: schedule.automationId
        },
        {
          repeat: {
            pattern: schedule.cronExpression,
            tz: schedule.timezone
          },
          jobId: `auto-schedule-${schedule.id}`
        }
      );

      // Store the repeat key for later removal
      const repeatKey = job.repeatJobKey;
      if (repeatKey) {
        await db.transferAutomationSchedule.update({
          where: { id: schedule.id },
          data: {
            bullmqRepeatKey: repeatKey,
            nextRunAt: computeNextRun(schedule.cronExpression, schedule.timezone)
          }
        });
      }
      synced++;
    } catch (err) {
      console.error(
        `[AutomationScheduler] Failed to add repeatable for schedule ${schedule.id}:`,
        (err as Error).message
      );
    }
  }

  return { synced, removed };
}

/**
 * Compute the next run time from a cron expression. Simple approximation —
 * the authoritative next-run is determined by BullMQ's internal scheduler.
 */
function computeNextRun(cronExpression: string, _timezone: string): Date | null {
  try {
    // For now return null — the BullMQ scheduler handles actual timing.
    // A future enhancement could use cron-parser for display purposes.
    void cronExpression;
    return null;
  } catch {
    return null;
  }
}
