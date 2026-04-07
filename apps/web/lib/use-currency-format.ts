"use client";

import { useCallback } from "react";
import { useEntity } from "../components/entity-provider";
import { fmtCurrency, fmt, fmtPct } from "./format";

/**
 * Hook that returns currency-aware formatting functions
 * bound to the current entity's functional currency.
 *
 * Usage:
 *   const { money, number, pct } = useCurrencyFormat();
 *   <span>{money(revpar.adr)}</span>     // → "$1,234.56"
 *   <span>{number(count)}</span>          // → "1,234"
 *   <span>{pct(ratio)}</span>             // → "72.3%"
 */
export function useCurrencyFormat() {
  const { currentEntity } = useEntity();
  const currency = currentEntity?.functionalCurrency;

  const money = useCallback(
    (n: string | number | null | undefined, decimals?: number) =>
      fmtCurrency(n, currency, decimals),
    [currency]
  );

  return {
    /** Format as currency with symbol (e.g. "$1,234.56") */
    money,
    /** The ISO currency code (e.g. "USD") */
    currency,
    /** Format as plain number */
    number: fmt,
    /** Format as percentage */
    pct: fmtPct
  };
}
