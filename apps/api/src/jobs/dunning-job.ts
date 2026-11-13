import { prisma } from "../db/prisma.js";
import { ARService } from "../modules/ar/service.js";
import type { PrismaClient } from "../db/client.js";

const arService = new ARService(prisma as unknown as PrismaClient);

/**
 * A dunning job names its tenant: either one entity of one tenant, or the
 * daily sweep over every entity of every active tenant.
 */
export type DunningJobData =
  | { scope: "entity"; tenantId: string; entityId: string }
  | { scope: "all" };

export async function processDunningJob(data: { entityId: string }): Promise<{
  entityId: string;
  dunningEmailsSent: number;
  invoiceIds: string[];
}> {
  console.log(`[DunningJob] Running dunning for entity ${data.entityId}`);
  const result = await arService.runDunning(data.entityId);
  console.log(
    `[DunningJob] Entity ${data.entityId}: sent ${result.dunningEmailsSent} dunning emails`
  );
  return { entityId: data.entityId, ...result };
}

/**
 * Run dunning for ALL active entities. Used by the scheduled repeatable job.
 */
export async function processDunningForAllEntities(): Promise<{
  totalSent: number;
  entityResults: Array<{ entityId: string; sent: number }>;
}> {
  const entities = await prisma.entity.findMany({
    where: { isActive: true },
    select: { id: true, name: true }
  });

  const entityResults: Array<{ entityId: string; sent: number }> = [];
  let totalSent = 0;

  for (const entity of entities) {
    try {
      const result = await arService.runDunning(entity.id);
      entityResults.push({ entityId: entity.id, sent: result.dunningEmailsSent });
      totalSent += result.dunningEmailsSent;
    } catch (error) {
      console.error(
        `[DunningJob] Failed for entity ${entity.id} (${entity.name}):`,
        error instanceof Error ? error.message : error
      );
      entityResults.push({ entityId: entity.id, sent: 0 });
    }
  }

  console.log(`[DunningJob] Complete: ${totalSent} emails across ${entities.length} entities`);
  return { totalSent, entityResults };
}
