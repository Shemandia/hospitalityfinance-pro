/**
 * Import Suspense / Clearing account helpers.
 *
 * Several import paths build a GL journal from *mapped-only* lines: when a source
 * code can't be mapped (or a settlement/tax account is missing) its line is
 * dropped, which would leave the journal out of balance — yet these paths write
 * `status: "POSTED"` directly and bypass the GL service's `validateBalance()`.
 * The result is a posted, unbalanced journal that silently corrupts the ledger
 * (audit findings F2/F3/F6).
 *
 * The fix used across all import paths: after building the lines, compute the
 * residual imbalance and, if any, append a single balancing line to a per-entity
 * **Import Suspense** account. The journal then always balances by construction,
 * the ledger stays valid, and the unresolved amount is parked visibly for finance
 * to clear (reclassify to the correct account) rather than vanishing.
 *
 * This mirrors how mature ERPs (NetSuite/Dynamics/SunSystems) handle an import
 * that doesn't fully resolve: nothing is dropped, the difference lands in a
 * clearing/suspense account.
 */

import { Prisma, type PrismaClient } from "../../../../db/client.js";

/** Well-known code for the per-entity import suspense/clearing account. */
export const SUSPENSE_ACCOUNT_CODE = "SUSPENSE";

/** Amounts within this tolerance are treated as balanced (matches GL 4dp rounding). */
const BALANCE_EPSILON = new Prisma.Decimal("0.0001");

/** Minimal line shape needed to reason about balance. */
export type BalanceLine = { debit: Prisma.Decimal; credit: Prisma.Decimal };

/**
 * Find (or lazily create) the entity's Import Suspense account.
 * Created as a postable balance-sheet (LIABILITY) account so it can carry either
 * a debit or credit residual; finance reclassifies out of it during clearing.
 */
export async function getOrCreateSuspenseAccount(
  prisma: PrismaClient,
  entityId: string
): Promise<{ id: string; code: string }> {
  const existing = await prisma.account.findFirst({
    where: { entityId, code: SUSPENSE_ACCOUNT_CODE },
    select: { id: true, code: true }
  });
  if (existing) return existing;

  return prisma.account.create({
    data: {
      entityId,
      code: SUSPENSE_ACCOUNT_CODE,
      name: "Import Suspense (Clearing)",
      type: "LIABILITY",
      normalBalance: "CREDIT",
      allowPosting: true,
      isControlAccount: false,
      level: 3
    },
    select: { id: true, code: true }
  });
}

/**
 * Signed imbalance of a set of lines: total debit − total credit.
 * `> 0` means debits exceed credits (the journal needs a credit to balance);
 * `< 0` means the opposite. Statistical/memo lines (debit=0, credit=0) do not
 * affect the result, so a stats-only journal is naturally balanced.
 */
export function computeImbalance(lines: BalanceLine[]): Prisma.Decimal {
  let debit = new Prisma.Decimal(0);
  let credit = new Prisma.Decimal(0);
  for (const line of lines) {
    debit = debit.add(line.debit);
    credit = credit.add(line.credit);
  }
  return debit.sub(credit);
}

/**
 * Given a signed imbalance, return the debit/credit a suspense line must carry to
 * square the journal, or `null` if it is already balanced within tolerance.
 */
export function suspensePlugSides(
  imbalance: Prisma.Decimal
): { debit: Prisma.Decimal; credit: Prisma.Decimal } | null {
  if (imbalance.abs().lessThanOrEqualTo(BALANCE_EPSILON)) return null;
  return imbalance.greaterThan(0)
    ? { debit: new Prisma.Decimal(0), credit: imbalance } // debits exceed → add a credit
    : { debit: imbalance.abs(), credit: new Prisma.Decimal(0) }; // credits exceed → add a debit
}

/**
 * Safety net: throw if the lines are still not balanced (should never happen once
 * a suspense plug has been appended). Protects against a future logic error
 * silently posting an unbalanced journal.
 */
export function assertBalanced(lines: BalanceLine[], context = "journal"): void {
  const diff = computeImbalance(lines);
  if (diff.abs().greaterThan(BALANCE_EPSILON)) {
    throw new Error(
      `Refusing to post unbalanced ${context}: debits − credits = ${diff.toFixed(4)}`
    );
  }
}
