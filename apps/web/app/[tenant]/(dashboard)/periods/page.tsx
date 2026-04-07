"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar,
  Plus,
  Lock,
  LockOpen,
  XCircle,
  ChevronDown,
  ChevronRight,
  AlertTriangle
} from "lucide-react";
import { Card, CardContent, CardHeader } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "../../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../components/ui/select";
import {
  getPeriodList,
  createPeriod,
  closePeriod,
  lockPeriod,
  reopenPeriod,
  type Period,
  type PeriodStatus
} from "../../../../lib/gl-api";
import { useApiContext } from "../../../../components/use-api-context";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

const SHORT_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

const STATUS_CONFIG: Record<
  PeriodStatus,
  {
    label: string;
    variant: "success" | "warning" | "destructive";
    description: string;
  }
> = {
  OPEN: { label: "Open", variant: "success", description: "Journals can be posted" },
  CLOSED: { label: "Closed", variant: "warning", description: "No new postings allowed" },
  LOCKED: { label: "Locked", variant: "destructive", description: "Permanently locked" }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function defaultPeriodName(year: number, month: number) {
  return `${SHORT_MONTH[month - 1]} ${year}`;
}

// ── Confirm action dialog ─────────────────────────────────────────────────────

type ConfirmAction = {
  period: Period;
  action: "close" | "lock" | "reopen";
};

const ACTION_CONFIG = {
  close: {
    title: "Close Period",
    icon: XCircle,
    iconClass: "text-amber-500",
    description: (p: Period) =>
      `Close ${p.name}? No new journal entries can be posted once a period is closed.`,
    buttonLabel: "Close Period",
    buttonVariant: "outline" as const
  },
  lock: {
    title: "Lock Period",
    icon: Lock,
    iconClass: "text-red-500",
    description: (p: Period) =>
      `Lock ${p.name}? This permanently prevents any changes. Only a SUPERADMIN can reopen a locked period.`,
    buttonLabel: "Lock Period",
    buttonVariant: "destructive" as const
  },
  reopen: {
    title: "Reopen Period",
    icon: LockOpen,
    iconClass: "text-emerald-600",
    description: (p: Period) =>
      `Reopen ${p.name}? This requires SUPERADMIN privileges and will set the period back to OPEN.`,
    buttonLabel: "Reopen Period",
    buttonVariant: "outline" as const
  }
};

function ConfirmDialog({
  confirm,
  onClose,
  onConfirm,
  isPending,
  error
}: {
  confirm: ConfirmAction | null;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  error: string | null;
}) {
  if (!confirm) return null;
  const cfg = ACTION_CONFIG[confirm.action];
  const Icon = cfg.icon;

  return (
    <Dialog
      open={!!confirm}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${cfg.iconClass}`} />
            {cfg.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-sm text-muted-foreground">{cfg.description(confirm.period)}</p>
          {confirm.action === "lock" && (
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>This action is irreversible without SUPERADMIN access.</span>
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant={cfg.buttonVariant} onClick={onConfirm} disabled={isPending}>
            {isPending ? "Processing…" : cfg.buttonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── New period dialog ─────────────────────────────────────────────────────────

function NewPeriodDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  error
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (year: number, month: number, name: string) => void;
  isPending: boolean;
  error: string | null;
}) {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [name, setName] = useState(defaultPeriodName(now.getFullYear(), now.getMonth() + 1));

  function handleMonthChange(v: string) {
    setMonth(v);
    const y = parseInt(year) || now.getFullYear();
    setName(defaultPeriodName(y, parseInt(v)));
  }

  function handleYearChange(v: string) {
    setYear(v);
    const y = parseInt(v) || now.getFullYear();
    setName(defaultPeriodName(y, parseInt(month)));
  }

  function handleSubmit() {
    const y = parseInt(year);
    const m = parseInt(month);
    if (isNaN(y) || isNaN(m) || !name.trim()) return;
    onSubmit(y, m, name.trim());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Accounting Period</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                Year <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                value={year}
                onChange={(e) => handleYearChange(e.target.value)}
                min={2000}
                max={2099}
                placeholder="2025"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Month <span className="text-destructive">*</span>
              </Label>
              <Select value={month} onValueChange={handleMonthChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_NAMES.map((mn, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      {mn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              Period Name <span className="text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jan 2025"
              maxLength={100}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Creating…" : "Create Period"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Period row ─────────────────────────────────────────────────────────────────

function PeriodRow({
  period,
  onAction
}: {
  period: Period;
  onAction: (confirm: ConfirmAction) => void;
}) {
  const cfg = STATUS_CONFIG[period.status];

  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
      <td className="py-3 px-4 text-sm font-medium">{period.name}</td>
      <td className="py-3 px-4 text-sm text-muted-foreground">
        {MONTH_NAMES[period.month - 1]} {period.year}
      </td>
      <td className="py-3 px-4">
        <Badge variant={cfg.variant} className="text-xs">
          {cfg.label}
        </Badge>
      </td>
      <td className="py-3 px-4 text-sm text-muted-foreground">{fmtDate(period.openedAt)}</td>
      <td className="py-3 px-4 text-sm text-muted-foreground">{fmtDate(period.closedAt)}</td>
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {period.status === "OPEN" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => onAction({ period, action: "close" })}
            >
              <XCircle className="h-3.5 w-3.5" />
              Close
            </Button>
          )}
          {period.status === "CLOSED" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => onAction({ period, action: "lock" })}
            >
              <Lock className="h-3.5 w-3.5" />
              Lock
            </Button>
          )}
          {period.status === "LOCKED" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 text-muted-foreground"
              onClick={() => onAction({ period, action: "reopen" })}
            >
              <LockOpen className="h-3.5 w-3.5" />
              Reopen
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Year group ────────────────────────────────────────────────────────────────

function YearGroup({
  year,
  periods,
  onAction
}: {
  year: number;
  periods: Period[];
  onAction: (confirm: ConfirmAction) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const counts = {
    open: periods.filter((p) => p.status === "OPEN").length,
    closed: periods.filter((p) => p.status === "CLOSED").length,
    locked: periods.filter((p) => p.status === "LOCKED").length
  };

  return (
    <>
      <tr
        className="bg-muted/50 cursor-pointer select-none hover:bg-muted/70 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td colSpan={6} className="py-2.5 px-4">
          <div className="flex items-center gap-3">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="font-semibold text-sm">{year}</span>
            <div className="flex items-center gap-1.5">
              {counts.open > 0 && (
                <Badge variant="success" className="text-[10px] px-1.5 py-0">
                  {counts.open} Open
                </Badge>
              )}
              {counts.closed > 0 && (
                <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                  {counts.closed} Closed
                </Badge>
              )}
              {counts.locked > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  {counts.locked} Locked
                </Badge>
              )}
            </div>
          </div>
        </td>
      </tr>
      {expanded && periods.map((p) => <PeriodRow key={p.id} period={p} onAction={onAction} />)}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PeriodsPage() {
  const ctx = useApiContext();
  const queryClient = useQueryClient();

  // ── Data ──────────────────────────────────────────────────────────────────

  const {
    data: periodsRes,
    isLoading,
    error: loadError
  } = useQuery({
    queryKey: ["periods", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => getPeriodList(ctx!),
    enabled: !!ctx
  });

  const periods = periodsRes?.data ?? [];

  // ── UI state ──────────────────────────────────────────────────────────────

  const [filterStatus, setFilterStatus] = useState<"ALL" | PeriodStatus>("ALL");
  const [newOpen, setNewOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (filterStatus === "ALL") return periods;
    return periods.filter((p) => p.status === filterStatus);
  }, [periods, filterStatus]);

  const byYear = useMemo(() => {
    const map = new Map<number, Period[]>();
    for (const p of filtered) {
      const list = map.get(p.year) ?? [];
      list.push(p);
      map.set(p.year, list);
    }
    // Sort within each year by month desc
    for (const [, list] of map) {
      list.sort((a, b) => b.month - a.month);
    }
    // Return years sorted descending
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
  }, [filtered]);

  const stats = useMemo(
    () => ({
      open: periods.filter((p) => p.status === "OPEN").length,
      closed: periods.filter((p) => p.status === "CLOSED").length,
      locked: periods.filter((p) => p.status === "LOCKED").length,
      total: periods.length
    }),
    [periods]
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (payload: { year: number; month: number; name: string }) =>
      createPeriod(ctx!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["periods"] });
      setNewOpen(false);
      setCreateError(null);
    },
    onError: (err: Error) => setCreateError(err.message)
  });

  const actionMutation = useMutation({
    mutationFn: ({ period, action }: ConfirmAction) => {
      if (action === "close") return closePeriod(ctx!, period.id);
      if (action === "lock") return lockPeriod(ctx!, period.id);
      return reopenPeriod(ctx!, period.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["periods"] });
      setConfirmAction(null);
      setActionError(null);
    },
    onError: (err: Error) => setActionError(err.message)
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="h-6 w-6 text-muted-foreground" />
            Accounting Periods
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {stats.total} period{stats.total !== 1 ? "s" : ""}
            {stats.open > 0 && ` · ${stats.open} open`}
            {stats.closed > 0 && ` · ${stats.closed} closed`}
            {stats.locked > 0 && ` · ${stats.locked} locked`}
          </p>
        </div>
        <Button
          onClick={() => {
            setCreateError(null);
            setNewOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          New Period
        </Button>
      </div>

      {/* Status overview cards */}
      <div className="grid grid-cols-3 gap-3">
        {(["OPEN", "CLOSED", "LOCKED"] as PeriodStatus[]).map((s) => {
          const cfg = STATUS_CONFIG[s];
          const count = periods.filter((p) => p.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? "ALL" : s)}
              className={`rounded-lg border p-4 text-left transition-all hover:shadow-sm ${
                filterStatus === s
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <div className="text-2xl font-bold">{count}</div>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={cfg.variant} className="text-[10px]">
                  {cfg.label}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1">{cfg.description}</div>
            </button>
          );
        })}
      </div>

      {/* Active filter pill */}
      {filterStatus !== "ALL" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Showing:</span>
          <Badge variant={STATUS_CONFIG[filterStatus].variant}>
            {STATUS_CONFIG[filterStatus].label}
          </Badge>
          <button
            onClick={() => setFilterStatus("ALL")}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Periods table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}

          {loadError && (
            <div className="py-16 text-center text-sm text-destructive">
              Failed to load: {(loadError as Error).message}
            </div>
          )}

          {!isLoading && !loadError && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-4 text-left font-medium">Period</th>
                    <th className="py-2.5 px-4 text-left font-medium">Calendar Month</th>
                    <th className="py-2.5 px-4 text-left font-medium w-28">Status</th>
                    <th className="py-2.5 px-4 text-left font-medium w-36">Opened</th>
                    <th className="py-2.5 px-4 text-left font-medium w-36">Closed</th>
                    <th className="py-2.5 px-4 text-right font-medium w-32">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {byYear.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-sm text-muted-foreground">
                        {filterStatus !== "ALL"
                          ? `No ${STATUS_CONFIG[filterStatus].label.toLowerCase()} periods.`
                          : "No periods yet. Click New Period to get started."}
                      </td>
                    </tr>
                  ) : (
                    byYear.map(([year, yearPeriods]) => (
                      <YearGroup
                        key={year}
                        year={year}
                        periods={yearPeriods}
                        onAction={(c) => {
                          setActionError(null);
                          setConfirmAction(c);
                        }}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lifecycle note */}
      <p className="text-xs text-muted-foreground">
        Period lifecycle: <strong>Open</strong> → <strong>Closed</strong> → <strong>Locked</strong>.
        Only a SUPERADMIN can reopen a locked period.
      </p>

      {/* New period dialog */}
      <NewPeriodDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSubmit={(year, month, name) => createMutation.mutate({ year, month, name })}
        isPending={createMutation.isPending}
        error={createError}
      />

      {/* Confirm action dialog */}
      <ConfirmDialog
        confirm={confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction) actionMutation.mutate(confirmAction);
        }}
        isPending={actionMutation.isPending}
        error={actionError}
      />
    </div>
  );
}
