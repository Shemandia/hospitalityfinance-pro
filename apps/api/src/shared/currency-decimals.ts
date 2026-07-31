/**
 * Currency decimal places — one source of truth for how many fractional digits
 * an amount carries, used by on-screen formatting and every payment-file format.
 *
 * ── The defect this addresses ───────────────────────────────────────────────
 * The `currencies` table has always had a `decimal_places` column, and the ECB
 * import seeds TZS with 0. Nothing read it. Every payment format hardcoded two
 * decimals, so a 402,500 TZS supplier payment was written as "402500.00" in CSV
 * and pain.001 and "402500,00" in MT103 — phantom cents a Tanzanian bank may
 * reject or misread.
 *
 * ── On TZS specifically ─────────────────────────────────────────────────────
 * ISO 4217 lists TZS with 2 decimals; the senti subunit is long defunct and
 * Tanzanian banks transact in whole shillings. This is therefore a local
 * convention, not a standards correction — which is exactly why the number
 * lives in the database per tenant rather than being hardcoded here. The set
 * below is only a fallback for currencies absent from the table.
 */

import type { Prisma, PrismaClient } from "../db/client.js";

/**
 * Fallback for currencies not present in the `currencies` table: the ISO 4217
 * zero-decimal list, plus TZS by local convention.
 */
export const FALLBACK_ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "TZS",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF"
]);

const DEFAULT_DECIMALS = 2;

type CurrencyReader = {
  currency: {
    findMany(args: unknown): Promise<Array<{ code: string; decimalPlaces: number }>>;
  };
};

/**
 * Resolve decimal places for a set of currency codes.
 *
 * The `currencies` table wins; anything missing falls back to the zero-decimal
 * list above, then to 2. Batched so building a payment file costs one query
 * regardless of how many currencies it spans.
 */
export async function resolveCurrencyDecimals(
  db: CurrencyReader,
  codes: Iterable<string>
): Promise<Map<string, number>> {
  const wanted = [...new Set([...codes].map((c) => c.toUpperCase()))];
  const resolved = new Map<string, number>();
  if (wanted.length === 0) return resolved;

  const rows = await db.currency.findMany({
    where: { code: { in: wanted } },
    select: { code: true, decimalPlaces: true }
  });
  for (const row of rows) {
    resolved.set(row.code.toUpperCase(), row.decimalPlaces);
  }

  for (const code of wanted) {
    if (!resolved.has(code)) {
      resolved.set(code, FALLBACK_ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : DEFAULT_DECIMALS);
    }
  }
  return resolved;
}

/** Decimal places for one currency, applying the same precedence. */
export function decimalsFor(map: Map<string, number>, code: string): number {
  const upper = code.toUpperCase();
  const fromMap = map.get(upper);
  if (fromMap !== undefined) return fromMap;
  return FALLBACK_ZERO_DECIMAL_CURRENCIES.has(upper) ? 0 : DEFAULT_DECIMALS;
}

/**
 * Plain amount for CSV and ISO 20022 pain.001, which both use a period as the
 * decimal separator: 402500 for TZS, 1234.56 for USD.
 */
export function formatAmountPlain(amount: Prisma.Decimal, decimals: number): string {
  return amount.toDecimalPlaces(decimals).toFixed(decimals);
}

/**
 * Amount for SWIFT MT field 32A.
 *
 * The decimal separator is a COMMA and is MANDATORY — field 32A is 6!n3!a15d
 * and the comma must be present even when the currency has no fractional
 * digits. A zero-decimal amount is therefore "402500," and not "402500".
 * Do not "normalise" this to a period: that produces a malformed MT103.
 */
export function formatAmountSwift(amount: Prisma.Decimal, decimals: number): string {
  return (
    amount.toDecimalPlaces(decimals).toFixed(decimals).replace(".", ",") +
    (decimals === 0 ? "," : "")
  );
}
