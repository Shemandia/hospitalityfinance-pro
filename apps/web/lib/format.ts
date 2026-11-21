/**
 * Shared number / currency / date formatting utilities.
 * Every page should import from here — no local fmt() definitions.
 *
 * Locale defaults to "en-US" for behavior-preserving rendering. Callers can
 * pass an explicit locale (and currency decimals) sourced from tenant/user
 * settings once available.
 */

export const DEFAULT_LOCALE = "en-US";

/** Format a number with locale separators (no currency symbol). */
export function fmt(
  n: string | number | null | undefined,
  decimals = 0,
  locale: string = DEFAULT_LOCALE
): string {
  const v = Number(n);
  if (n == null || isNaN(v)) return "–";
  return v.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/** Format a number with 2 decimal places (no currency symbol). */
export function fmtDecimal(
  n: string | number | null | undefined,
  decimals = 2,
  locale: string = DEFAULT_LOCALE
): string {
  return fmt(n, decimals, locale);
}

/** Resolve decimal places for a currency from API-provided values with a fallback. */
export function getCurrencyDecimals(
  currency: string | undefined,
  registryDecimals?: number | null
): number {
  if (typeof registryDecimals === "number" && Number.isFinite(registryDecimals)) {
    return registryDecimals;
  }
  if (!currency) return 2;
  return isZeroDecimalCurrency(currency) ? 0 : 2;
}

/** Format a monetary amount with its currency symbol (e.g. "$1,234.56" or "TZS 1,234"). */
export function fmtCurrency(
  n: string | number | null | undefined,
  currency: string | undefined,
  decimals?: number | null,
  locale: string = DEFAULT_LOCALE
): string {
  const v = Number(n);
  if (n == null || isNaN(v)) return "–";
  const resolvedDecimals = getCurrencyDecimals(currency, decimals);
  if (!currency) return fmt(n, resolvedDecimals, locale);
  try {
    return v.toLocaleString(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: resolvedDecimals,
      maximumFractionDigits: resolvedDecimals
    });
  } catch {
    // Fallback for unknown currency codes
    return `${currency} ${fmt(n, resolvedDecimals, locale)}`;
  }
}

/** Format a percentage value (e.g. "72.3%"). */
export function fmtPct(
  n: string | number | null | undefined,
  decimals = 1,
  locale: string = DEFAULT_LOCALE
): string {
  const v = Number(n);
  if (n == null || isNaN(v)) return "–";
  return `${fmt(n, decimals, locale)}%`;
}

/** Format an ISO date string as a short date (e.g. "Mar 15, 2026"). */
export function fmtDate(
  d: string | null | undefined,
  locale: string = DEFAULT_LOCALE,
  timeZone?: string
): string {
  if (!d) return "–";
  return new Date(d).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(timeZone ? { timeZone } : {})
  });
}

/** Format an ISO date string as date + time (e.g. "Mar 15, 2026, 2:30 PM"). */
export function fmtDateTime(
  d: string | null | undefined,
  locale: string = DEFAULT_LOCALE,
  timeZone?: string
): string {
  if (!d) return "–";
  return new Date(d).toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {})
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
