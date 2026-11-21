/**
 * The global period: a calendar month, kept in the address (?period=2026-10)
 * and per tenant and user, and resolved on each page to the selected
 * entity's own period for that month. A group resolves against its own
 * calendar like any entity. A month the entity has no period for is
 * reported as missing; another month is never substituted.
 *
 * The address is read through parsePeriodSelection so that ranges
 * (?from=2026-07&to=2026-09) can be added as a second kind later without
 * changing the pages that ask for a month.
 */

export type PeriodStatus = "OPEN" | "SOFT_CLOSE" | "CLOSED" | "LOCKED";

export type EntityPeriod = {
  id: string;
  year: number;
  month: number;
  name: string;
  status: PeriodStatus;
};

/** A month as written in the address and in storage: "2026-10". */
export type MonthKey = `${number}-${string}`;

/** What the address selects. Only months for now; ranges come later. */
export type PeriodSelection = { kind: "month"; month: MonthKey };

export const PERIOD_PARAM = "period";

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "2026-10" for a valid month, otherwise null. */
export function parseMonth(value: string | null | undefined): MonthKey | null {
  if (!value) return null;
  const trimmed = value.trim();
  return MONTH_PATTERN.test(trimmed) ? (trimmed as MonthKey) : null;
}

export function monthKey(year: number, month: number): MonthKey {
  return `${year}-${String(month).padStart(2, "0")}` as MonthKey;
}

export function monthOf(period: Pick<EntityPeriod, "year" | "month">): MonthKey {
  return monthKey(period.year, period.month);
}

/** The selection in the address, or null when it names none (or an invalid one). */
export function parsePeriodSelection(params: {
  get(name: string): string | null;
}): PeriodSelection | null {
  const month = parseMonth(params.get(PERIOD_PARAM));
  return month ? { kind: "month", month } : null;
}

/** The address with `month` selected, other parameters kept. */
export function withPeriodParam(search: string, month: MonthKey): string {
  const params = new URLSearchParams(search);
  params.set(PERIOD_PARAM, month);
  return params.toString();
}

/** "October 2026" (or "Oct 2026" short). */
export function monthLabel(month: MonthKey, style: "long" | "short" = "long"): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const name = new Date(Date.UTC(year, m - 1, 1)).toLocaleString("en-US", {
    month: style,
    timeZone: "UTC"
  });
  return `${name} ${year}`;
}

export const PERIOD_STATUS_LABEL: Record<PeriodStatus, string> = {
  OPEN: "Open",
  SOFT_CLOSE: "Soft close",
  CLOSED: "Closed",
  LOCKED: "Locked"
};

/** The entity's period for `month`, or null when it has none. */
export function resolvePeriod<P extends EntityPeriod>(
  periods: readonly P[],
  month: MonthKey
): P | null {
  return periods.find((p) => monthOf(p) === month) ?? null;
}

/**
 * The month to start on when nothing is chosen: this month if the entity has
 * it open, else its latest open period, else its latest period; null when it
 * has no periods at all.
 */
export function defaultMonth(periods: readonly EntityPeriod[], today: Date): MonthKey | null {
  if (periods.length === 0) return null;
  const current = monthKey(today.getFullYear(), today.getMonth() + 1);
  const latestFirst = [...periods].sort((a, b) => b.year - a.year || b.month - a.month);
  const open = latestFirst.filter((p) => p.status === "OPEN");
  if (open.some((p) => monthOf(p) === current)) return current;
  return monthOf(open[0] ?? latestFirst[0]!);
}

/** Where the chosen month is remembered: per tenant and user, like the entity. */
export function selectedPeriodStorageKey(tenantId: string, userId: string): string {
  return `hfp:selected-period:${tenantId}:${userId}`;
}
