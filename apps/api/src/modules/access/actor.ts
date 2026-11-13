/**
 * The user an import records as the creator of what it writes (AUT-03).
 *
 * Imports and system jobs have no signed-in user. They used to take any row
 * of entity_users for the property. They now take the active user whose role
 * assignment reaches the property most directly (see defaultActorForEntity).
 *
 * Interim: WP-4 replaces this with a named system user per import, posting
 * under the normal approval rules.
 */

import type { Prisma, PrismaClient } from "../../db/client.js";
import { withBypassRLS } from "../../db/rls-bypass.js";
import { defaultActorForEntity } from "./grants.js";

export async function entityActor(
  db: Pick<PrismaClient, "$transaction">,
  entityId: string
): Promise<{ userId: string } | null> {
  const userId = await withBypassRLS(db, (tx: Prisma.TransactionClient) =>
    defaultActorForEntity(tx, entityId)
  );
  return userId ? { userId } : null;
}
