/**
 * Mews PMS -> GL account mapper
 *
 * Maps Mews accountingCategoryId to GL accounts via ConnectorMapping.
 * ConnectorType: "MEWS_PMS"
 *
 * Typical GL account mapping for hotel revenue:
 *   room-revenue-cat-id   -> 4100 (Room Revenue)
 *   fb-food-cat-id        -> 4200 (Food Revenue)
 *   fb-bev-cat-id         -> 4210 (Beverage Revenue)
 *   spa-cat-id            -> 4300 (Spa Revenue)
 *   minibar-cat-id        -> 4220 (Minibar Revenue)
 *   laundry-cat-id        -> 4400 (Laundry Revenue)
 *   parking-cat-id        -> 4500 (Parking Revenue)
 *   tax-cat-id            -> 2300 (Tax Payable)
 */

import type { PrismaClient } from "@prisma/client";

export type MewsCategoryLine = {
  accountingCategoryId: string;
  categoryName: string;
  amount: number;
  type: string;
};

export type MappedMewsLine = MewsCategoryLine & {
  glAccountId: string;
  glAccountCode: string;
};

export type MewsMapperResult = {
  mapped: MappedMewsLine[];
  unmapped: MewsCategoryLine[];
};

/**
 * Map Mews accounting category IDs to GL accounts using ConnectorMapping table.
 *
 * Mapping is done by `accountingCategoryId` (stored as `sourceCode` in
 * ConnectorMapping).  If a category is not mapped, the line is added to the
 * `unmapped` array for user review.
 */
export async function mapMewsToGL(
  prisma: PrismaClient,
  entityId: string,
  lines: MewsCategoryLine[]
): Promise<MewsMapperResult> {
  const mappings = await prisma.connectorMapping.findMany({
    where: { entityId, connectorType: "MEWS_PMS" },
    include: { glAccount: true }
  });

  const index = new Map<string, { glAccountId: string; glAccountCode: string }>();
  for (const m of mappings) {
    if (m.glAccount) {
      index.set(m.sourceCode, {
        glAccountId: m.glAccount.id,
        glAccountCode: m.glAccount.code
      });
    }
  }

  const mapped: MappedMewsLine[] = [];
  const unmapped: MewsCategoryLine[] = [];

  for (const line of lines) {
    const mapping = index.get(line.accountingCategoryId);
    if (mapping) {
      mapped.push({ ...line, ...mapping });
    } else {
      unmapped.push(line);
    }
  }

  return { mapped, unmapped };
}
