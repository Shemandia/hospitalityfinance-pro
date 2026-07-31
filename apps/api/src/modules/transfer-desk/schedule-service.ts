/**
 * Schedule service for Transfer Desk profile automation.
 *
 * Stores schedule configuration in TransferAutomation +
 * TransferAutomationSchedule tables. After each CRUD mutation,
 * calls syncAutomationSchedules() to keep BullMQ repeatables
 * in sync with the database.
 *
 * Each profile can have at most one schedule (1:1 via a dedicated
 * automation that wraps the single profile).
 */

import type { PrismaClient } from "../../db/client.js";
import type { ScheduleCreateInput } from "./schedule-types.js";
import { syncAutomationSchedules } from "../../jobs/automation-scheduler.js";

// ── Error ────────────────────────────────────────────────────────────────────

export class ScheduleServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

export class ScheduleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly tenantSlug: string = ""
  ) {}

  // ── Get schedule for a profile ────────────────────────────────────────────

  async get(profileId: string) {
    const db = this.prisma as any;

    // A profile's schedule is stored as an automation with a single step
    // pointing to this profile. Find it via the automation step.
    const step = await db.transferAutomationStep.findFirst({
      where: { profileId },
      include: {
        automation: {
          include: {
            schedules: {
              where: { isActive: true },
              orderBy: { createdAt: "desc" },
              take: 1
            }
          }
        }
      }
    });

    if (!step || !step.automation || step.automation.schedules.length === 0) {
      return null;
    }

    const automation = step.automation;
    const schedule = automation.schedules[0];

    // Also read extended config from automation description (JSON-encoded)
    let extendedConfig: Record<string, unknown> = {};
    try {
      if (automation.description) {
        extendedConfig = JSON.parse(automation.description);
      }
    } catch {
      // not JSON — ignore
    }

    return {
      id: schedule.id,
      profileId,
      automationId: automation.id,
      scheduleType: (extendedConfig.scheduleType as string) ?? "CRON",
      cronExpression: schedule.cronExpression,
      timezone: schedule.timezone,
      isActive: schedule.isActive,
      fileWatchPath: extendedConfig.fileWatchPath ?? null,
      fileWatchPattern: extendedConfig.fileWatchPattern ?? null,
      pollingIntervalMs: extendedConfig.pollingIntervalMs ?? null,
      eventType: extendedConfig.eventType ?? null,
      notifyOnSuccess: extendedConfig.notifyOnSuccess ?? false,
      notifyOnFailure: extendedConfig.notifyOnFailure ?? true,
      notifyOnWarning: extendedConfig.notifyOnWarning ?? false,
      notifyEmails: extendedConfig.notifyEmails ?? [],
      maxRetries: extendedConfig.maxRetries ?? 0,
      nextRunAt: schedule.nextRunAt,
      createdAt: schedule.createdAt
    };
  }

  // ── Create / replace schedule ─────────────────────────────────────────────

  async create(profileId: string, userId: string, input: ScheduleCreateInput) {
    const db = this.prisma as any;

    // Verify profile exists and is active
    const profile = await db.transferProfile.findUnique({
      where: { id: profileId },
      select: { id: true, name: true, isActive: true, isValid: true }
    });
    if (!profile) {
      throw new ScheduleServiceError("PROFILE_NOT_FOUND", "Profile not found.", 404);
    }

    const sourceParams = {} as Record<string, unknown>;
    const derived = this._deriveStatus(profile, sourceParams);
    if (derived !== "ACTIVE") {
      throw new ScheduleServiceError(
        "SCHEDULE_REQUIRES_ACTIVE_PROFILE",
        "Only ACTIVE profiles can have schedules. Activate the profile first.",
        409
      );
    }

    // Extended config stored as JSON in automation.description
    const extendedConfig = JSON.stringify({
      scheduleType: input.scheduleType,
      fileWatchPath: input.fileWatchPath,
      fileWatchPattern: input.fileWatchPattern,
      pollingIntervalMs: input.pollingIntervalMs,
      eventType: input.eventType,
      notifyOnSuccess: input.notifyOnSuccess,
      notifyOnFailure: input.notifyOnFailure,
      notifyOnWarning: input.notifyOnWarning,
      notifyEmails: input.notifyEmails,
      maxRetries: input.maxRetries
    });

    // Delete any existing schedule for this profile first
    await this._deleteExisting(profileId);

    // Create automation + step + schedule in a transaction
    const result = await this.prisma.$transaction(async (tx: any) => {
      const automation = await tx.transferAutomation.create({
        data: {
          name: `__schedule_${profileId}`,
          description: extendedConfig,
          isEnabled: true,
          createdById: userId
        }
      });

      await tx.transferAutomationStep.create({
        data: {
          automationId: automation.id,
          profileId,
          stepOrder: 0,
          failOnError: true
        }
      });

      // For MANUAL type, we still create the schedule record but inactive
      const isActive = input.scheduleType !== "MANUAL";

      const schedule = await tx.transferAutomationSchedule.create({
        data: {
          automationId: automation.id,
          cronExpression: input.cronExpression ?? "0 0 * * *",
          timezone: input.timezone,
          isActive,
          runAsUser: userId
        }
      });

      return { automation, schedule };
    });

    // Sync BullMQ repeatable jobs with updated schedule state
    if (this.tenantSlug) {
      await syncAutomationSchedules(this.prisma as any, this.tenantSlug).catch((err) => {
        console.warn(`[ScheduleService] Post-create sync failed: ${(err as Error).message}`);
      });
    }

    return {
      id: result.schedule.id,
      profileId,
      automationId: result.automation.id,
      scheduleType: input.scheduleType,
      cronExpression: result.schedule.cronExpression,
      timezone: result.schedule.timezone,
      isActive: result.schedule.isActive,
      fileWatchPath: input.fileWatchPath ?? null,
      fileWatchPattern: input.fileWatchPattern ?? null,
      pollingIntervalMs: input.pollingIntervalMs ?? null,
      eventType: input.eventType ?? null,
      notifyOnSuccess: input.notifyOnSuccess,
      notifyOnFailure: input.notifyOnFailure,
      notifyOnWarning: input.notifyOnWarning,
      notifyEmails: input.notifyEmails,
      maxRetries: input.maxRetries,
      createdAt: result.schedule.createdAt
    };
  }

  // ── Delete schedule ───────────────────────────────────────────────────────

  async delete(profileId: string) {
    const deleted = await this._deleteExisting(profileId);
    if (!deleted) {
      throw new ScheduleServiceError(
        "SCHEDULE_NOT_FOUND",
        "No schedule found for this profile.",
        404
      );
    }

    // Sync BullMQ repeatable jobs after removing schedule
    if (this.tenantSlug) {
      await syncAutomationSchedules(this.prisma as any, this.tenantSlug).catch((err) => {
        console.warn(`[ScheduleService] Post-delete sync failed: ${(err as Error).message}`);
      });
    }

    return { profileId, deleted: true };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Delete existing automation + schedule for a profile.
   * Returns true if something was deleted.
   */
  private async _deleteExisting(profileId: string): Promise<boolean> {
    const db = this.prisma as any;

    // Find automation steps that point to this profile with
    // the __schedule_ naming convention
    const steps = await db.transferAutomationStep.findMany({
      where: { profileId },
      include: {
        automation: { select: { id: true, name: true } }
      }
    });

    const scheduleAutomations = steps.filter((s: any) =>
      s.automation?.name?.startsWith("__schedule_")
    );

    if (scheduleAutomations.length === 0) return false;

    for (const step of scheduleAutomations) {
      // Cascade delete: automation → steps + schedules
      await db.transferAutomation.delete({
        where: { id: step.automation.id }
      });
    }

    return true;
  }

  /**
   * Derive spec-level status from DB fields.
   * Same logic as ProfileService._deriveStatus.
   */
  private _deriveStatus(
    profile: { isActive: boolean; isValid: boolean },
    sourceParams: Record<string, unknown>
  ): string {
    const explicit = sourceParams.__status;
    if (typeof explicit === "string") return explicit;
    if (profile.isActive) {
      return profile.isValid ? "ACTIVE" : "DRAFT";
    }
    return "INACTIVE";
  }
}
