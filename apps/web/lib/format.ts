/**
 * Shared number / currency / date formatting utilities.
 * Every page should import from here — no local fmt() definitions.
 */

/** Format a number with locale separators (no currency symbol). */
export function fmt(n: string | number | null | undefined, decimals = 0): string {
  const v = Number(n);
  if (n == null || isNaN(v)) return "–";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/** Format a number with 2 decimal places (no currency symbol). */
export function fmtDecimal(n: string | number | null | undefined): string {
  return fmt(n, 2);
}

/** Format a monetary amount with its currency symbol (e.g. "$1,234.56" or "TZS 1,234"). */
export function fmtCurrency(
  n: string | number | null | undefined,
  currency: string | undefined,
  decimals?: number
): string {
  const v = Number(n);
  if (n == null || isNaN(v)) return "–";
  if (!currency) return fmt(n, decimals ?? 2);
  try {
    return v.toLocaleString("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals ?? (isZeroDecimalCurrency(currency) ? 0 : 2),
      maximumFractionDigits: decimals ?? (isZeroDecimalCurrency(currency) ? 0 : 2)
    });
  } catch {
    // Fallback for unknown currency codes
    return `${currency} ${fmt(n, decimals ?? 2)}`;
  }
}

/** Format a percentage value (e.g. "72.3%"). */
export function fmtPct(n: string | number | null | undefined, decimals = 1): string {
  const v = Number(n);
  if (n == null || isNaN(v)) return "–";
  return `${fmt(n, decimals)}%`;
}

/** Format an ISO date string as a short date (e.g. "Mar 15, 2026"). */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "–";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

/** Format an ISO date string as date + time (e.g. "Mar 15, 2026, 2:30 PM"). */
export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "–";
  return new Date(d).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** Currencies that use 0 decimal places (e.g. JPY, KRW, TZS, VND). */
/**
 * Currencies rendered without fractional digits.
 *
 * The authoritative source is `currencies.decimal_places` in the tenant
 * database (see apps/api/src/shared/currency-decimals.ts, which the payment
 * file formats read). This list mirrors it for client-side rendering, where a
 * per-render database lookup is not practical. Pass an explicit `decimals`
 * argument to fmtCurrency wherever the registry value is already to hand.
 *
 * TZS is included by local convention rather than by ISO 4217, which still
 * lists it with 2 decimals: the senti subunit is defunct and Tanzanian banks
 * transact in whole shillings. Omitting it rendered phantom cents on every
 * screen for the hotels' own currency.
 */
export const ZERO_DECIMAL_CURRENCIES = new Set([
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

export function isZeroDecimalCurrency(code: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(code.toUpperCase());
}
