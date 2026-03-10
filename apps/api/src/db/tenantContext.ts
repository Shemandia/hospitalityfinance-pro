import { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function setEntityDbContext(db: DbClient, entityId: string): Promise<void> {
  if (!("$executeRaw" in db) || typeof db.$executeRaw !== "function") {
    return;
  }
  await db.$executeRaw`SELECT set_config('app.current_entity_id', ${entityId}, true)`;
}
