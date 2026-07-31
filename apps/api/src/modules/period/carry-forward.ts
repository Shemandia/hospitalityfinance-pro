/**
 * Balance Carry-Forward Engine — P0 blocker: opening balances never rolled over.
 *
 * Before this existed, `closePeriod` only advanced LedgerSetup.currentPeriodId
 * and GLRepository inserted every account_period_balances row with
 * opening_balance = 0. A period's closing balance was therefore only *that
 * period's movement*, so the trial balance and balance sheet were structurally
 * wrong: post rent in January, none in February, and February's balance sheet
 * showed Cash back at zero.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *   opening_balance(period N+1, account A) = closing_balance(period N, account A)
 *
 * applied uniformly to every account type, where "period N" is the period with
 * the greatest (year, month) strictly less than N+1's for the same entity.
 *
 * ── Why P&L accounts are NOT special-cased at the year boundary ──────────────
 * It is tempting to reset REVENUE/EXPENSE openings to zero each January. That
 * would be wrong here, for two reasons:
 *
 *   1. Year-end cleardown (period-close/year-end-cleardown.ts) already zeroes
 *      P&L accounts by *posting a journal* into the final period of the year.
 *      December therefore closes at zero for P&L, and January opens at zero on
 *      its own. No special case is needed.
 *   2. Closing balances are stored normal-balance-positive, so the trial
 *      balance ties only when sum(debit-normal) == sum(credit-normal). Carrying
 *      every account forward preserves that invariant because the prior period
 *      tied. Zeroing P&L openings *without* the corresponding cleardown journal
 *      would break it — and would silently mask a cleardown that never ran.
 *
 * A January P&L opening that is not zero is a true signal that year-end
 * cleardown was skipped, and should be surfaced rather than hidden.
 *
 * ── Sign convention ─────────────────────────────────────────────────────────
 * Sign comes from accounts.normal_balance, matching the canonical balance
 * writer in db/balance-writer.ts. Both must agree: carry-forward recomputes a
 * closing balance that postings then accumulate onto, so a disagreement would
 * silently corrupt the period it restates.
 */

import type { PrismaClient } from "../../db/client.js";

/** Accepts either the root client or a $transaction client. */
export type BalanceSqlClient = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

export type CarryForwardResult = {
  targetPeriodId: string;
  /** Period the balances came from; null when the target is the first period. */
  sourcePeriodId: string | null;
  /** Rows created for accounts that carry a balance but have no activity yet. */
  rowsSeeded: number;
  /** Rows whose opening_balance / closing_balance were (re)computed. */
  rowsRecomputed: number;
};

/**
 * The period immediately preceding `periodId` for this entity, by (year, month).
 * Status is irrelevant — an unposted or skipped period must not break the chain.
 */
export async function findPrecedingPeriodId(
  db: BalanceSqlClient,
  entityId: string,
  periodId: string
): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT prev.id
    FROM periods prev
    JOIN periods target ON target.id = ${periodId}
    WHERE prev.entity_id = ${entityId}
      AND target.entity_id = ${entityId}
      AND (prev.year, prev.month) < (target.year, target.month)
    ORDER BY prev.year DESC, prev.month DESC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/** The period immediately following `periodId` for this entity, by (year, month). */
export async function findFollowingPeriodId(
  db: BalanceSqlClient,
  entityId: string,
  periodId: string
): Promise<string | null> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT next.id
    FROM periods next
    JOIN periods target ON target.id = ${periodId}
    WHERE next.entity_id = ${entityId}
      AND target.entity_id = ${entityId}
      AND (next.year, next.month) > (target.year, target.month)
    ORDER BY next.year ASC, next.month ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/**
 * Set `targetPeriodId`'s opening balances from the preceding period's closing
 * balances, then recompute its closing balances from those openings.
 *
 * Idempotent: running it repeatedly produces the same result, because opening
 * is *assigned* from the source rather than accumulated. Safe to re-run after a
 * period is reopened, amended and re-closed.
 *
 * Does not create the journal entries — it only restates the balance rows that
 * postings maintain.
 */
export async function carryForwardOpeningBalances(
  db: BalanceSqlClient,
  entityId: string,
  targetPeriodId: string
): Promise<CarryForwardResult> {
  const sourcePeriodId = await findPrecedingPeriodId(db, entityId, targetPeriodId);

  if (sourcePeriodId === null) {
    // First period on record: every opening is zero by definition. Still
    // recompute closing so a previously mis-seeded opening cannot survive.
    const rowsRecomputed = await db.$executeRaw`
      UPDATE account_period_balances tgt
      SET opening_balance = 0,
          closing_balance =
            (CASE WHEN a.normal_balance = 'DEBIT' THEN 1 ELSE -1 END)
            * (tgt.period_debits - tgt.period_credits),
          updated_at = NOW()
      FROM accounts a
      WHERE a.id = tgt.account_id
        AND tgt.entity_id = ${entityId}
        AND tgt.period_id = ${targetPeriodId}
    `;
    return { targetPeriodId, sourcePeriodId: null, rowsSeeded: 0, rowsRecomputed };
  }

  // Step 1 — materialise rows for accounts that carry a balance forward but
  // have no activity yet in the target period. Without this, a dormant account
  // simply vanishes from the target period's balance sheet.
  const rowsSeeded = await db.$executeRaw`
    INSERT INTO account_period_balances
      (id, entity_id, account_id, period_id, opening_balance,
       period_debits, period_credits, closing_balance, created_at, updated_at)
    SELECT
      gen_random_uuid()::text,
      prev.entity_id,
      prev.account_id,
      ${targetPeriodId},
      prev.closing_balance,
      0,
      0,
      prev.closing_balance,
      NOW(),
      NOW()
    FROM account_period_balances prev
    WHERE prev.entity_id = ${entityId}
      AND prev.period_id = ${sourcePeriodId}
      AND prev.closing_balance <> 0
    ON CONFLICT (entity_id, account_id, period_id) DO NOTHING
  `;

  // Step 2 — assign opening from the source period and recompute closing for
  // every row in the target period, including ones that already had postings.
  // Accounts with no row in the source period correctly resolve to zero.
  const rowsRecomputed = await db.$executeRaw`
    UPDATE account_period_balances tgt
    SET opening_balance = COALESCE(prev.closing_balance, 0),
        closing_balance = COALESCE(prev.closing_balance, 0)
          + (CASE WHEN a.normal_balance = 'DEBIT' THEN 1 ELSE -1 END)
            * (tgt.period_debits - tgt.period_credits),
        updated_at = NOW()
    FROM accounts a
    LEFT JOIN account_period_balances prev
      ON prev.account_id = a.id
     AND prev.entity_id = ${entityId}
     AND prev.period_id = ${sourcePeriodId}
    WHERE a.id = tgt.account_id
      AND tgt.entity_id = ${entityId}
      AND tgt.period_id = ${targetPeriodId}
  `;

  return { targetPeriodId, sourcePeriodId, rowsSeeded, rowsRecomputed };
}

/**
 * Rebuild the whole opening-balance chain for an entity, oldest period first.
 *
 * Required for repair: existing tenant databases were written with
 * opening_balance = 0 on every row, so their closing balances hold only
 * per-period movement. Carrying forward one period at a time in chronological
 * order restores the true cumulative position.
 *
 * Runs period-by-period because each step depends on the corrected closing
 * balance produced by the previous one.
 */
export async function rebuildOpeningBalances(
  db: BalanceSqlClient,
  entityId: string
): Promise<CarryForwardResult[]> {
  const periods = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM periods
    WHERE entity_id = ${entityId}
    ORDER BY year ASC, month ASC
  `;

  const results: CarryForwardResult[] = [];
  for (const period of periods) {
    results.push(await carryForwardOpeningBalances(db, entityId, period.id));
  }
  return results;
}
