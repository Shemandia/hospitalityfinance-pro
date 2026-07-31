/**
 * Simphony POS → GL account mapper
 *
 * Maps Simphony revenue class codes to GL accounts via ConnectorMapping.
 * ConnectorType: "SIMPHONY_POS"
 *
 * Typical GL account mapping for F&B:
 *   FOOD_REV   → 4200 (Food Revenue)
 *   BEV_REV    → 4210 (Beverage Revenue)
 *   TAX_COLL   → 2300 (Tax Payable)
 *   SVC_CHG    → 4220 (Service Charge Revenue)
 *   DISCOUNT   → 4290 (F&B Discounts & Allowances)
 *   TIPS       → 2310 (Tips Payable)
 */

import type { PrismaClient } from "../../../../db/client.js";
import type { SimphonyTransactionLine } from "./simphony-client.js";

export type MappedPOSLine = SimphonyTransactionLine & {
  glAccountId: string;
  glAccountCode: string;
};

export type SimphonyMapperResult = {
  mapped: MappedPOSLine[];
  unmapped: SimphonyTransactionLine[];
};

/**
 * Map Simphony revenue class codes to GL accounts using ConnectorMapping table.
 *
 * Mapping is done by `revenueClassCode`.  If a revenue class code is not
 * mapped, the line is added to the `unmapped` array for user review.
 */
export async function mapSimphonyToGL(
  prisma: PrismaClient,
  entityId: string,
  lines: SimphonyTransactionLine[]
): Promise<SimphonyMapperResult> {
  const mappings = await prisma.connectorMapping.findMany({
    where: { entityId, connectorType: "SIMPHONY_POS" },
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

  const mapped: MappedPOSLine[] = [];
  const unmapped: SimphonyTransactionLine[] = [];

  for (const line of lines) {
    const mapping = index.get(line.revenueClassCode);
    if (mapping) {
      mapped.push({ ...line, ...mapping });
    } else {
      unmapped.push(line);
    }
  }

  return { mapped, unmapped };
}
