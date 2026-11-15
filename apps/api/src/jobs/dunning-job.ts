import { prisma } from "../db/prisma.js";
import { ARService } from "../modules/ar/service.js";
import type { PrismaClient } from "../db/client.js";
import { moduleLogger } from "../shared/logger.js";

const log = moduleLogger("dunning-job");

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
  log.info(`Running dunning for entity ${data.entityId}`);
  const result = await arService.runDunning(data.entityId);
  log.info(`Entity ${data.entityId}: sent ${result.dunningEmailsSent} dunning emails`);
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
      log.error({ err: error, entityId: entity.id }, `Dunning failed for entity ${entity.name}`);
      entityResults.push({ entityId: entity.id, sent: 0 });
    }
  }

  log.info(`Complete: ${totalSent} emails across ${entities.length} entities`);
  return { totalSent, entityResults };
}
