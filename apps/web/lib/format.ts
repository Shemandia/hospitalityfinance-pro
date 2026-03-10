/**
 * Shared number formatting utilities for consistent display across the app.
 */

export function fmt(n: string | number, decimals = 0): string {
  const v = Number(n);
  if (isNaN(v)) return "–";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtDecimal(n: string | number): string {
  return fmt(n, 2);
}

export function fmtPct(n: string | number, decimals = 1): string {
  const v = Number(n);
  if (isNaN(v)) return "–";
  return `${fmt(n, decimals)}%`;
}
