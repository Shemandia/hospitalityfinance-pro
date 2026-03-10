import type { PrismaClient } from "@prisma/client";
import type { OhipRevenueTransaction } from "./opera-cloud-client.js";

export type MappedTransaction = OhipRevenueTransaction & {
  glAccountId: string;
  glAccountCode: string;
};

export type MapperResult = {
  mapped: MappedTransaction[];
  unmapped: OhipRevenueTransaction[];
};

export async function mapTransactionsToGL(
  prisma: PrismaClient,
  entityId: string,
  transactions: OhipRevenueTransaction[]
): Promise<MapperResult> {
  const mappings = await prisma.connectorMapping.findMany({
    where: { entityId, connectorType: "OPERA_CLOUD" },
    include: { glAccount: true }
  });

  const mappingIndex = new Map<string, { glAccountId: string; glAccountCode: string }>();
  for (const m of mappings) {
    if (m.glAccount) {
      mappingIndex.set(m.sourceCode, {
        glAccountId: m.glAccount.id,
        glAccountCode: m.glAccount.code
      });
    }
  }

  const mapped: MappedTransaction[] = [];
  const unmapped: OhipRevenueTransaction[] = [];

  for (const tx of transactions) {
    const mapping = mappingIndex.get(tx.transactionCode);
    if (mapping) {
      mapped.push({ ...tx, ...mapping });
    } else {
      unmapped.push(tx);
    }
  }

  return { mapped, unmapped };
}
