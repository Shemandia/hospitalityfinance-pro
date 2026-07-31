/**
 * Recurring Journal Generation Job
 *
 * BullMQ repeatable job that runs daily at 06:00 UTC.
 * For each entity with an OPEN period, generates any due recurring journals.
 */

import type { PrismaClient } from "../db/client.js";
import { RecurringJournalService } from "../modules/gl/recurring-service.js";

let queue: any = null;
let worker: any = null;

export async function startRecurringJournalJob(prisma: PrismaClient): Promise<void> {
  try {
    const { Queue, Worker } = await import("bullmq");
    const redisUrl =
      process.env.REDIS_URL ??
      `redis://${process.env.REDIS_HOST ?? "127.0.0.1"}:${process.env.REDIS_PORT ?? 6379}`;

    const connection = { url: redisUrl };

    queue = new Queue("recurring-journals", { connection });
    const service = new RecurringJournalService(prisma);

    // Schedule daily at 06:00 UTC
    await queue.upsertJobScheduler(
      "daily-recurring-check",
      { pattern: "0 6 * * *" },
      { name: "generate-recurring", data: {} }
    );

    worker = new Worker(
      "recurring-journals",
      async () => {
        // Find all entities with an OPEN period
        const openPeriods = await prisma.period.findMany({
          where: { status: "OPEN" },
          select: { id: true, entityId: true, year: true, month: true }
        });

        let totalGenerated = 0;
        for (const period of openPeriods) {
          try {
            const ids = await service.generateDueJournals(
              period.entityId,
              period.id,
              period.year,
              period.month
            );
            totalGenerated += ids.length;
          } catch (err) {
            console.error(
              `[recurring-journal-job] Error generating for entity ${period.entityId}:`,
              err
            );
          }
        }

        return { generated: totalGenerated, entitiesProcessed: openPeriods.length };
      },
      { connection, concurrency: 1 }
    );

    worker.on("failed", (job: any, err: Error) => {
      console.error(`[recurring-journal-job] Job ${job?.id} failed:`, err.message);
    });

    console.log("[recurring-journal-job] Scheduler started (daily 06:00 UTC)");
  } catch {
    console.warn("[recurring-journal-job] Redis not available — recurring jobs disabled");
  }
}

export async function stopRecurringJournalJob(): Promise<void> {
  if (worker) await worker.close();
  if (queue) await queue.close();
}
