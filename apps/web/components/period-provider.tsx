"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./auth-provider";
import { useApiContext } from "./use-api-context";
import { getPeriods } from "../lib/gl-api";
import {
  defaultMonth,
  parsePeriodSelection,
  resolvePeriod,
  selectedPeriodStorageKey,
  withPeriodParam,
  type EntityPeriod,
  type MonthKey
} from "../lib/period";

/**
 * The global period (see lib/period.ts). The provider holds the chosen
 * month; useSelectedPeriod resolves it against the selected entity.
 */

type PeriodContextValue = {
  /** The month chosen in the address or remembered for this user; null if none yet. */
  chosenMonth: MonthKey | null;
  /** Choose a month: written to the address and remembered per tenant and user. */
  setMonth: (month: MonthKey) => void;
};

const PeriodContext = createContext<PeriodContextValue>({
  chosenMonth: null,
  setMonth: () => {}
});

function readStored(key: string): MonthKey | null {
  try {
    return parsePeriodSelection({ get: () => localStorage.getItem(key) })?.month ?? null;
  } catch {
    return null;
  }
}

function writeStored(key: string, month: MonthKey): void {
  try {
    localStorage.setItem(key, month);
  } catch {
    // Storage unavailable: the address still carries the month.
  }
}

/** Put the month in the address without a navigation (Next keeps useSearchParams in step). */
function writeAddress(month: MonthKey): void {
  const query = withPeriodParam(window.location.search, month);
  const url = `${window.location.pathname}?${query}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const { context } = useAuth();
  const searchParams = useSearchParams();
  const storageKey = context ? selectedPeriodStorageKey(context.tenant.id, context.user.id) : null;
  const [stored, setStored] = useState<MonthKey | null>(null);

  useEffect(() => {
    setStored(storageKey ? readStored(storageKey) : null);
  }, [storageKey]);

  const fromAddress = parsePeriodSelection(searchParams)?.month ?? null;

  // A month in the address (a shared link) becomes this user's choice too.
  useEffect(() => {
    if (fromAddress && storageKey && fromAddress !== stored) {
      writeStored(storageKey, fromAddress);
      setStored(fromAddress);
    }
  }, [fromAddress, storageKey, stored]);

  const setMonth = useCallback(
    (month: MonthKey) => {
      if (storageKey) writeStored(storageKey, month);
      setStored(month);
      writeAddress(month);
    },
    [storageKey]
  );

  const value = useMemo<PeriodContextValue>(
    () => ({ chosenMonth: fromAddress ?? stored, setMonth }),
    [fromAddress, stored, setMonth]
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriodChoice() {
  return useContext(PeriodContext);
}

export type SelectedPeriod =
  | { state: "loading"; month: MonthKey | null; period: null; periods: EntityPeriod[] }
  | { state: "error"; month: MonthKey | null; period: null; periods: EntityPeriod[]; error: Error }
  /** The entity has no periods at all. */
  | { state: "no-periods"; month: null; period: null; periods: EntityPeriod[] }
  /** The entity has no period for the chosen month. */
  | { state: "missing"; month: MonthKey; period: null; periods: EntityPeriod[] }
  | { state: "ready"; month: MonthKey; period: EntityPeriod; periods: EntityPeriod[] };

/**
 * The chosen month resolved to the selected entity's own period. With no
 * choice yet, the entity's default month is used and written to the address.
 */
export function useSelectedPeriod(): SelectedPeriod & { refetch: () => void } {
  const apiContext = useApiContext();
  const { chosenMonth, setMonth } = usePeriodChoice();

  const periodsQ = useQuery({
    queryKey: ["global-period", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () =>
      apiContext ? (((await getPeriods(apiContext)).data as unknown as EntityPeriod[]) ?? []) : [],
    enabled: Boolean(apiContext)
  });
  const periods = useMemo(() => periodsQ.data ?? [], [periodsQ.data]);
  const fallback = useMemo(() => defaultMonth(periods, new Date()), [periods]);
  const month = chosenMonth ?? (periodsQ.isSuccess ? fallback : null);

  // Show the month in use in the address, so the page can be shared as it is.
  useEffect(() => {
    if (!chosenMonth && periodsQ.isSuccess && fallback) setMonth(fallback);
  }, [chosenMonth, periodsQ.isSuccess, fallback, setMonth]);

  const refetch = () => void periodsQ.refetch();

  if (periodsQ.isError) {
    return {
      state: "error",
      month,
      period: null,
      periods,
      error: periodsQ.error as Error,
      refetch
    };
  }
  if (!periodsQ.isSuccess) return { state: "loading", month, period: null, periods, refetch };
  if (!month) return { state: "no-periods", month: null, period: null, periods, refetch };
  const period = resolvePeriod(periods, month);
  return period
    ? { state: "ready", month, period, periods, refetch }
    : { state: "missing", month, period: null, periods, refetch };
}
