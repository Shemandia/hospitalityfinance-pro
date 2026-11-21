"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, Lock } from "lucide-react";
import { usePeriodChoice, useSelectedPeriod } from "./period-provider";
import { useEntity } from "./entity-provider";
import {
  monthLabel,
  monthOf,
  PERIOD_STATUS_LABEL,
  type EntityPeriod,
  type PeriodStatus
} from "../lib/period";

/** "Jul 26", for the narrowest screens. */
function shortMonth(month: string): string {
  return `${monthLabel(month as Parameters<typeof monthLabel>[0], "short").slice(0, 3)} ${month.slice(2, 4)}`;
}

const STATUS_STYLE: Record<PeriodStatus, string> = {
  OPEN: "bg-emerald-50 text-emerald-700 border-emerald-200",
  SOFT_CLOSE: "bg-amber-50 text-amber-800 border-amber-200",
  CLOSED: "bg-slate-100 text-slate-600 border-slate-200",
  LOCKED: "bg-slate-800 text-white border-slate-800"
};

/** A period's status as a word (never colour alone); Locked also carries a lock. */
export function PeriodStatusBadge({ status }: { status: PeriodStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[status]}`}
    >
      {status === "LOCKED" && <Lock className="h-2.5 w-2.5" aria-hidden />}
      {PERIOD_STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The period selector in the top bar: the month in use with its status, and
 * the selected entity's own periods to choose from, newest first.
 */
export function PeriodSelector() {
  const selected = useSelectedPeriod();
  const { setMonth } = usePeriodChoice();
  const { currentEntity } = useEntity();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byYear = useMemo(() => {
    const groups = new Map<number, EntityPeriod[]>();
    const sorted = [...selected.periods].sort((a, b) => b.year - a.year || b.month - a.month);
    for (const p of sorted) groups.set(p.year, [...(groups.get(p.year) ?? []), p]);
    return [...groups.entries()];
  }, [selected.periods]);

  if (!currentEntity) return null;
  if (selected.state === "loading" && !selected.month) {
    return <div className="h-9 w-20 sm:w-36 rounded-xl bg-slate-100 animate-pulse" aria-hidden />;
  }

  const month = selected.month;
  const label = month ? monthLabel(month, "short") : "No periods";
  const status = selected.state === "ready" ? selected.period.status : null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Period: ${month ? monthLabel(month) : "none"}${
          status
            ? `, ${PERIOD_STATUS_LABEL[status]}`
            : selected.state === "missing"
              ? ", no period"
              : ""
        }. Change period`}
        className={`flex items-center gap-2 px-2.5 py-1.5 lg:py-2 rounded-xl border text-left transition-colors ${
          open ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200 hover:bg-slate-50"
        }`}
      >
        <CalendarDays className="hidden sm:block h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
        <span className="text-sm font-semibold text-slate-800 whitespace-nowrap">
          <span className="sm:hidden">{month ? shortMonth(month) : label}</span>
          <span className="hidden sm:inline">{label}</span>
        </span>
        {status && (
          <span className="hidden sm:inline-flex">
            <PeriodStatusBadge status={status} />
          </span>
        )}
        {selected.state === "missing" && (
          <span className="hidden sm:inline text-[10px] font-semibold text-amber-700">
            No period
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="absolute left-0 sm:left-auto sm:right-0 lg:left-0 lg:right-auto top-full mt-1.5 z-50 w-[min(18rem,calc(100vw-2rem))] rounded-xl bg-white border border-slate-200 shadow-xl shadow-slate-200/50">
          <p className="px-3 pt-2.5 pb-1 text-[11px] text-slate-500 truncate">
            Periods of {currentEntity.name}
          </p>
          {selected.state === "error" ? (
            <p className="px-3 py-4 text-xs text-red-600">
              The periods could not be loaded.{" "}
              <button type="button" className="underline" onClick={selected.refetch}>
                Try again
              </button>
            </p>
          ) : byYear.length === 0 ? (
            <p className="px-3 py-4 text-xs text-slate-500">This entity has no periods yet.</p>
          ) : (
            <ul role="listbox" aria-label="Periods" className="max-h-80 overflow-y-auto p-1.5">
              {byYear.map(([year, periods]) => (
                <li key={year} role="presentation">
                  <p className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {year}
                  </p>
                  <ul role="presentation">
                    {periods.map((p) => {
                      const key = monthOf(p);
                      const isSelected = key === month;
                      return (
                        <li
                          key={p.id}
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            setMonth(key);
                            setOpen(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setMonth(key);
                              setOpen(false);
                            }
                          }}
                          tabIndex={0}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm outline-none hover:bg-slate-50 focus:bg-slate-100 ${
                            isSelected ? "font-semibold text-emerald-700" : "text-slate-700"
                          }`}
                        >
                          <span className="flex-1">{monthLabel(key)}</span>
                          <PeriodStatusBadge status={p.status} />
                          <Check
                            className={`h-3.5 w-3.5 ${isSelected ? "text-emerald-600" : "invisible"}`}
                            aria-hidden
                          />
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
