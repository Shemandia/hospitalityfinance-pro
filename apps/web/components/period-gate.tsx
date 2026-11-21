"use client";

import type { ReactNode } from "react";
import { CalendarX2 } from "lucide-react";
import { useEntity } from "./entity-provider";
import { useSelectedPeriod } from "./period-provider";
import { QueryError } from "./query-error";
import { monthLabel, type EntityPeriod } from "../lib/period";
import { PeriodStatusBadge } from "./period-selector";

/** The message for a month the selected entity has no period for. */
export function PeriodMissing({ month, entityName }: { month: string; entityName: string }) {
  return (
    <div
      role="status"
      className="mx-auto my-8 max-w-lg rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"
    >
      <p className="flex items-center gap-2 font-semibold">
        <CalendarX2 className="h-4 w-4" aria-hidden />
        {entityName} has no period for {month}
      </p>
      <p className="mt-1.5 text-amber-800">
        Nothing is shown for another month instead. Choose a month this entity has in the period
        selector at the top, or ask an administrator to create the period under Periods.
      </p>
    </div>
  );
}

/**
 * Why there is nothing to show for the global period: no period for the
 * month, no periods at all, or the list could not be loaded. Null while the
 * periods load and once a period is resolved.
 */
export function PeriodNotice() {
  const selected = useSelectedPeriod();
  const { currentEntity } = useEntity();
  const entityName = currentEntity?.name ?? "This entity";

  switch (selected.state) {
    case "error":
      return <QueryError message={selected.error.message} onRetry={selected.refetch} />;
    case "no-periods":
      return (
        <div role="status" className="mx-auto my-8 max-w-lg rounded-xl border bg-white p-5 text-sm">
          <p className="font-semibold text-slate-800">{entityName} has no periods yet</p>
          <p className="mt-1.5 text-slate-600">
            Periods are created under Periods; figures appear once the first one exists.
          </p>
        </div>
      );
    case "missing":
      return <PeriodMissing month={monthLabel(selected.month)} entityName={entityName} />;
    default:
      return null;
  }
}

/**
 * Draws `children` with the selected entity's period for the global month,
 * or a clear message when the entity has no such period.
 */
export function PeriodGate({
  children,
  loading = null
}: {
  children: (period: EntityPeriod, periods: EntityPeriod[]) => ReactNode;
  loading?: ReactNode;
}) {
  const selected = useSelectedPeriod();
  if (selected.state === "loading") return <>{loading}</>;
  if (selected.state !== "ready") return <PeriodNotice />;
  return <>{children(selected.period, selected.periods)}</>;
}

/** The period a page shows, as a label: chosen in the top bar, not on the page. */
export function PeriodInUse() {
  const selected = useSelectedPeriod();
  if (selected.state !== "ready") return null;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
      {monthLabel(selected.month)}
      <PeriodStatusBadge status={selected.period.status} />
    </span>
  );
}
