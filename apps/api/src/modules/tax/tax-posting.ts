/**
 * Tax posting support — resolving the GL account that an invoice's tax posts to.
 *
 * AP invoices previously posted net of tax: the journal summed the invoice
 * lines (which equal netAmount) and credited AP control with that same total,
 * silently discarding invoice.taxAmount. A 118,000 TZS invoice of 100,000 net
 * plus 18,000 VAT recorded a 100,000 liability, and the payment run then paid
 * the supplier 100,000. AR had no tax fields at all and credited the whole
 * invoice to revenue.
 *
 * ── Why there is no fallback account ────────────────────────────────────────
 * Other control accounts in this codebase resolve by code convention (AP
 * control "2000", AR control "1200", revenue "4100"). Tax cannot: the seeded
 * USALI chart of accounts contains no VAT accounts at all, so any code we
 * guessed would not exist in a real tenant and posting would either fail with
 * a confusing error or, worse, land tax in an unrelated account.
 *
 * The mapping is therefore explicit on the tax code, and posting an invoice
 * that carries tax without one fails loudly. That is a deliberate behaviour
 * change from silently dropping the tax — but it only affects invoices where
 * taxAmount is non-zero, which are exactly the invoices that were being posted
 * incorrectly before.
 */

import { ServiceError } from "../../shared/service-error.js";

export class TaxPostingError extends ServiceError {}

export type TaxDirection = "INPUT" | "OUTPUT";

type TaxCodeRow = {
  id: string;
  code: string;
  inputTaxAccountId: string | null;
  outputTaxAccountId: string | null;
};

type TaxCodeReader = {
  taxCode: {
    findMany(args: unknown): Promise<TaxCodeRow[]>;
  };
};

const DIRECTION_LABEL: Record<TaxDirection, string> = {
  INPUT: "input (recoverable) tax",
  OUTPUT: "output tax"
};

/**
 * Resolve the single GL account an invoice's tax amount posts to.
 *
 * `taxCodeIds` is the set of tax codes referenced by the invoice — one for an
 * AR invoice, potentially one per line for AP. Tax is held as a single
 * invoice-level figure on both models, so it can only post to one account:
 * if the referenced codes disagree, there is no correct way to apportion it
 * and this refuses rather than guessing.
 */
export async function resolveTaxAccountId(
  db: TaxCodeReader,
  entityId: string,
  taxCodeIds: Array<string | null | undefined>,
  direction: TaxDirection
): Promise<string> {
  const distinctIds = [...new Set(taxCodeIds.filter((id): id is string => Boolean(id)))];

  if (distinctIds.length === 0) {
    throw new TaxPostingError(
      "TAX_CODE_REQUIRED",
      `This invoice carries tax but references no tax code, so there is no account to post ` +
        `${DIRECTION_LABEL[direction]} to. Assign a tax code to the invoice.`,
      422
    );
  }

  const taxCodes = await db.taxCode.findMany({
    where: { entityId, id: { in: distinctIds } },
    select: { id: true, code: true, inputTaxAccountId: true, outputTaxAccountId: true }
  });

  const missing = distinctIds.filter((id) => !taxCodes.some((t) => t.id === id));
  if (missing.length > 0) {
    throw new TaxPostingError(
      "TAX_CODE_NOT_FOUND",
      `Tax code(s) not found for this entity: ${missing.join(", ")}.`,
      422
    );
  }

  const pick = (t: TaxCodeRow) =>
    direction === "INPUT" ? t.inputTaxAccountId : t.outputTaxAccountId;

  const unmapped = taxCodes.filter((t) => !pick(t));
  if (unmapped.length > 0) {
    throw new TaxPostingError(
      "TAX_ACCOUNT_NOT_CONFIGURED",
      `Tax code(s) ${unmapped.map((t) => t.code).join(", ")} have no ${DIRECTION_LABEL[direction]} ` +
        `GL account configured. Set one before posting invoices that carry tax under them.`,
      422
    );
  }

  const distinctAccounts = [...new Set(taxCodes.map((t) => pick(t)!))];
  if (distinctAccounts.length > 1) {
    throw new TaxPostingError(
      "TAX_ACCOUNT_AMBIGUOUS",
      `This invoice references tax codes (${taxCodes.map((t) => t.code).join(", ")}) that post ` +
        `${DIRECTION_LABEL[direction]} to different GL accounts. Tax is held as a single ` +
        `invoice-level amount and cannot be split across them — use one tax code per invoice, ` +
        `or raise separate invoices.`,
      422
    );
  }

  return distinctAccounts[0]!;
}
