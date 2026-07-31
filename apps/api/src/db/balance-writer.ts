/**
 * The single authoritative writer for account_period_balances.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Balances used to be written from roughly fourteen places with two different
 * sign conventions:
 *
 *   - GL, AP and AR repositories signed by a hardcoded type-code list
 *     ['ASSET', 'EXPENSE', 'CONTRA_REVENUE'].
 *   - FX revaluation, fixed-asset depreciation and every import connector
 *     (Mews, SAF, payroll, Opera Cloud, Simphony, generic interfaces) wrote
 *     `debit - credit` unsigned.
 *
 * Unsigned writes move credit-normal accounts the wrong way. Month-end FX
 * revaluation of foreign payables pushed AP control in the wrong direction and
 * the trial balance stopped tying; depreciation drove accumulated depreciation
 * — a credit-normal contra-asset — negative.
 *
 * ── The convention ──────────────────────────────────────────────────────────
 * Closing balances are stored NORMAL-BALANCE-POSITIVE: a debit-normal account
 * with debits exceeding credits has a positive closing balance, and so does a
 * credit-normal account with credits exceeding debits. The trial balance ties
 * when sum(debit-normal closings) equals sum(credit-normal closings).
 *
 *     closing = opening + sign * (debits - credits)
 *     sign    = +1 for debit-normal, -1 for credit-normal
 *
 * ── Sign comes from accounts.normal_balance, not the type code ──────────────
 * The old type-code list could not classify custom account types, which
 * Account.type explicitly allows (it is a free-form code referencing
 * AccountTypeDefinition). It also disagreed with the schema for STATISTICAL
 * accounts, whose normal_balance is DEBIT but which the list treated as
 * credit-normal. normal_balance is a required, non-null column and is the
 * account's own declaration, so it is authoritative and always available.
 *
 * Callers therefore no longer pass an account type at all — removing the
 * possibility of passing the wrong one.
 */

import { Prisma } from "./client.js";
import { ServiceError } from "../shared/service-error.js";

export class BalanceWriterError extends ServiceError {}

export type BalanceDelta = {
  accountId: string;
  /** Movement in the entity's functional currency. */
  debitFunctional: Prisma.Decimal | string | number;
  creditFunctional: Prisma.Decimal | string | number;
};

/** Accepts the root client or a $transaction client. */
export type BalanceSqlClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

const D = (v: Prisma.Decimal | string | number): Prisma.Decimal =>
  v instanceof Prisma.Decimal ? v : new Prisma.Decimal(String(v ?? 0));

/**
 * Collapse deltas so each account appears once.
 *
 * Required for correctness, not just efficiency: Postgres rejects an
 * INSERT … ON CONFLICT DO UPDATE whose proposed rows contain the same conflict
 * key twice with error 21000, "cannot affect row a second time". A journal that
 * posts two lines to the same GL account — an ordinary dimensional split — used
 * to fail with a 500 for exactly this reason.
 */
function aggregateByAccount(
  deltas: BalanceDelta[]
): Map<string, { d: Prisma.Decimal; c: Prisma.Decimal }> {
  const merged = new Map<string, { d: Prisma.Decimal; c: Prisma.Decimal }>();
  for (const delta of deltas) {
    const existing = merged.get(delta.accountId);
    const debit = D(delta.debitFunctional);
    const credit = D(delta.creditFunctional);
    if (existing) {
      existing.d = existing.d.add(debit);
      existing.c = existing.c.add(credit);
    } else {
      merged.set(delta.accountId, { d: debit, c: credit });
    }
  }
  return merged;
}

/**
 * Apply balance movements for one entity and period.
 *
 * Atomic per statement: the closing balance is computed SQL-side from the
 * account's own normal balance, and concurrent callers accumulate rather than
 * overwrite, so no update is lost under load.
 *
 * Throws if any account is missing or belongs to another entity — dropping a
 * balance movement silently is the failure mode this module exists to end.
 */
export async function applyBalanceDeltas(
  db: BalanceSqlClient,
  entityId: string,
  periodId: string,
  deltas: BalanceDelta[]
): Promise<number> {
  const merged = aggregateByAccount(deltas);
  if (merged.size === 0) return 0;

  // $1 = entityId, $2 = periodId, then (accountId, debit, credit) per row.
  const params: unknown[] = [entityId, periodId];
  const rows: string[] = [];
  for (const [accountId, { d, c }] of merged) {
    const base = params.length + 1;
    rows.push(`($${base}, $${base + 1}::decimal(18,4), $${base + 2}::decimal(18,4))`);
    params.push(accountId, d.toFixed(4), c.toFixed(4));
  }

  const sql = `
    INSERT INTO account_period_balances
      (id, entity_id, account_id, period_id, opening_balance,
       period_debits, period_credits, closing_balance, created_at, updated_at)
    SELECT
      gen_random_uuid()::text,
      $1,
      delta.account_id,
      $2,
      0,
      delta.debits,
      delta.credits,
      -- Normal-balance-positive: debit-normal accounts move up on debits,
      -- credit-normal accounts move up on credits.
      (CASE WHEN a.normal_balance = 'DEBIT' THEN 1 ELSE -1 END)
        * (delta.debits - delta.credits),
      NOW(),
      NOW()
    FROM (VALUES ${rows.join(", ")}) AS delta(account_id, debits, credits)
    JOIN accounts a ON a.id = delta.account_id AND a.entity_id = $1
    ON CONFLICT (entity_id, account_id, period_id) DO UPDATE SET
      period_debits   = account_period_balances.period_debits  + EXCLUDED.period_debits,
      period_credits  = account_period_balances.period_credits + EXCLUDED.period_credits,
      -- EXCLUDED.closing_balance already carries this movement's signed value,
      -- so adding it is equivalent to recomputing opening + sign * (D - C) and
      -- needs no second lookup of the account's normal balance.
      closing_balance = account_period_balances.closing_balance + EXCLUDED.closing_balance,
      updated_at      = NOW()
    RETURNING account_id
  `;

  const written = await db.$queryRawUnsafe<Array<{ account_id: string }>>(sql, ...params);

  if (written.length !== merged.size) {
    const seen = new Set(written.map((r) => r.account_id));
    const missing = [...merged.keys()].filter((id) => !seen.has(id));
    throw new BalanceWriterError(
      "BALANCE_ACCOUNT_NOT_FOUND",
      `Cannot update balances: account(s) ${missing.join(", ")} do not exist for entity ${entityId}. ` +
        `No balance movement was recorded for them.`,
      422
    );
  }

  return written.length;
}

/** Single-account convenience wrapper. */
export async function applyBalanceDelta(
  db: BalanceSqlClient,
  entityId: string,
  periodId: string,
  accountId: string,
  debitFunctional: Prisma.Decimal | string | number,
  creditFunctional: Prisma.Decimal | string | number
): Promise<void> {
  await applyBalanceDeltas(db, entityId, periodId, [
    { accountId, debitFunctional, creditFunctional }
  ]);
}
