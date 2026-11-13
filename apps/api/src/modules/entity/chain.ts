import { prisma } from "../../db/prisma.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import type { Prisma } from "../../db/client.js";

/**
 * The top of the entity's tree: the chain the entity belongs to. Callers pass
 * only an entity the user can open (AUT-15).
 */
export async function resolveChainEntityId(entityId: string): Promise<string | null> {
  return withBypassRLS(prisma, async (tx: Prisma.TransactionClient) => {
    const visited = new Set<string>();
    let currentId: string | null = entityId;
    let top: string | null = null;
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const entity: { id: string; parentId: string | null } | null = await tx.entity.findUnique({
        where: { id: currentId },
        select: { id: true, parentId: true }
      });
      if (!entity) break;
      top = entity.id;
      currentId = entity.parentId;
    }
    return top;
  });
}
