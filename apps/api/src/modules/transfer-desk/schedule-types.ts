import { z } from "zod";

// ── Cron expression basic validation ─────────────────────────────────────────
// 5-field cron: minute hour day-of-month month day-of-week
const cronRegex = /^(\S+\s+){4}\S+$/;

// ── Schedule create/update schema ────────────────────────────────────────────

export const scheduleCreateSchema = z
  .object({
    scheduleType: z.enum(["CRON", "FILE_WATCH", "EVENT_DRIVEN", "MANUAL"]),
    /** Standard 5-field cron expression (required for CRON type) */
    cronExpression: z.string().regex(cronRegex, "Must be a 5-field cron expression").optional(),
    /** IANA timezone (e.g. "Europe/London"). Defaults to UTC. */
    timezone: z.string().max(50).default("UTC"),
    /** S3 path to watch (required for FILE_WATCH type) */
    fileWatchPath: z.string().max(500).optional(),
    /** File name pattern (glob) for FILE_WATCH */
    fileWatchPattern: z.string().max(200).optional(),
    /** Polling interval in milliseconds for FILE_WATCH (min 5s) */
    pollingIntervalMs: z.coerce.number().int().min(5000).optional(),
    /** HFP event type to listen for (required for EVENT_DRIVEN type) */
    eventType: z.string().max(100).optional(),
    /** Notify on success */
    notifyOnSuccess: z.boolean().default(false),
    /** Notify on failure */
    notifyOnFailure: z.boolean().default(true),
    /** Notify on warnings */
    notifyOnWarning: z.boolean().default(false),
    /** Notification email addresses */
    notifyEmails: z.array(z.string().email()).max(10).default([]),
    /** Max retry attempts on failure */
    maxRetries: z.coerce.number().int().min(0).max(10).default(0)
  })
  .refine(
    (data) => {
      if (data.scheduleType === "CRON" && !data.cronExpression) return false;
      return true;
    },
    { message: "cronExpression is required for CRON schedule type", path: ["cronExpression"] }
  )
  .refine(
    (data) => {
      if (data.scheduleType === "FILE_WATCH" && !data.fileWatchPath) return false;
      return true;
    },
    { message: "fileWatchPath is required for FILE_WATCH schedule type", path: ["fileWatchPath"] }
  )
  .refine(
    (data) => {
      if (data.scheduleType === "EVENT_DRIVEN" && !data.eventType) return false;
      return true;
    },
    { message: "eventType is required for EVENT_DRIVEN schedule type", path: ["eventType"] }
  );

export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>;
