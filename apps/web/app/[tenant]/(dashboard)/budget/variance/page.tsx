"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../components/use-api-context";
import { useTenantHref } from "../../../../../hooks/use-tenant-router";
import {
  BarChart2,
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/card";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import {
  getBudgetDefinitions,
  getBudgetVariance,
  getPeriodList,
  type VarianceLine,
  type ApiContext
} from "../../../../../lib/gl-api";
import { fmtDecimal as fmt } from "../../../../../lib/format";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: string | null | undefined) {
  if (v == null) return null;
  const n = parseFloat(v);
  if (isNaN(n)) return null;
  return n;
}

function sum(rows: VarianceLine[], field: keyof VarianceLine) {
  return rows.reduce((s, r) => s + parseFloat(String(r[field] ?? "0")), 0);
}

function exportToCsv(rows: VarianceLine[], budgetName: string, periodName: string) {
  const headers = [
    "Account Code",
    "Account Name",
    "USALI Category",
    "USALI Department",
    "Budget",
    "Actual",
    "Variance",
    "Variance %"
  ];
  const body = rows.map((r) =>
    [
      r.accountCode,
      r.accountName,
      r.usaliCategory ?? "",
      r.usaliDepartment ?? "",
      r.budgetAmount,
      r.actualAmount,
      r.variance,
      r.variancePct ?? ""
    ]
      .map((f) => `"${String(f).replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = [headers.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `variance-${budgetName}-${periodName}.csv`.replace(/\s+/g, "-")
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Variance bar ──────────────────────────────────────────────────────────────

function VarianceBar({ variancePct }: { variancePct: string | null }) {
  const p = pct(variancePct);
  if (p === null) return <span className="text-muted-foreground text-xs">—</span>;

  const capped = Math.max(-100, Math.min(100, p));
  const isPositive = p >= 0;
  const width = Math.abs(capped);

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden relative">
        <div
          className={`absolute top-0 h-full rounded-full transition-all ${
            isPositive ? "bg-emerald-500" : "bg-red-500"
          }`}
          style={{ width: `${width}%`, left: isPositive ? "50%" : `${50 - width}%` }}
        />
        <div className="absolute left-1/2 top-0 w-px h-full bg-border" />
      </div>
      <span
        className={`text-xs tabular-nums font-medium w-14 text-right ${
          isPositive ? "text-emerald-700" : "text-red-700"
        }`}
      >
        {isPositive ? "+" : ""}
        {p.toFixed(1)}%
      </span>
    </div>
  );
}

// ── USALI group ───────────────────────────────────────────────────────────────

function UsaliGroup({ label, rows }: { label: string; rows: VarianceLine[] }) {
  const [expanded, setExpanded] = useState(true);

  const totalBudget = sum(rows, "budgetAmount");
  const totalActual = sum(rows, "actualAmount");
  const totalVariance = sum(rows, "variance");
  const groupVariancePct =
    totalBudget !== 0 ? ((totalActual - totalBudget) / Math.abs(totalBudget)) * 100 : null;

  const isPositive = totalVariance >= 0;

  return (
    <>
      <tr
        className="bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <td colSpan={8} className="py-2.5 px-4">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="font-semibold text-sm">{label}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {rows.length} account{rows.length !== 1 ? "s" : ""}
            </Badge>
            <span className="ml-auto flex items-center gap-6 text-sm">
              <span className="text-muted-foreground w-32 text-right tabular-nums">
                {fmt(totalBudget)}
              </span>
              <span className="w-32 text-right tabular-nums">{fmt(totalActual)}</span>
              <span
                className={`w-32 text-right tabular-nums font-semibold ${isPositive ? "text-emerald-700" : "text-red-700"}`}
              >
                {isPositive ? "+" : ""}
                {fmt(totalVariance)}
              </span>
              <span className="w-36">
                <VarianceBar
                  variancePct={groupVariancePct !== null ? String(groupVariancePct) : null}
                />
              </span>
            </span>
          </div>
        </td>
      </tr>
      {expanded &&
        rows.map((row) => {
          const v = parseFloat(row.variance);
          const isRowPos = v >= 0;
          return (
            <tr
              key={row.accountId}
              className="border-b border-border/40 hover:bg-muted/20 transition-colors group"
            >
              <td className="py-2 px-4 text-xs font-mono text-muted-foreground w-28">
                {row.accountCode}
              </td>
              <td className="py-2 px-4 text-sm">{row.accountName}</td>
              <td className="py-2 px-4 text-xs text-muted-foreground">
                {row.usaliDepartment ?? "—"}
              </td>
              <td className="py-2 px-4 text-right tabular-nums text-sm text-muted-foreground">
                {fmt(row.budgetAmount)}
              </td>
              <td className="py-2 px-4 text-right tabular-nums text-sm">{fmt(row.actualAmount)}</td>
              <td
                className={`py-2 px-4 text-right tabular-nums text-sm font-medium ${isRowPos ? "text-emerald-700" : "text-red-700"}`}
              >
                <span className="flex items-center justify-end gap-1">
                  {isRowPos ? (
                    <TrendingUp className="h-3 w-3 opacity-70" />
                  ) : (
                    <TrendingDown className="h-3 w-3 opacity-70" />
                  )}
                  {isRowPos ? "+" : ""}
                  {fmt(row.variance)}
                </span>
              </td>
              <td className="py-2 px-4">
                <VarianceBar variancePct={row.variancePct} />
              </td>
            </tr>
          );
        })}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BudgetVariancePage() {
  const ctx = useApiContext();
  const tenantHref = useTenantHref();

  // ── Selectors ─────────────────────────────────────────────────────────────

  const [selectedDefId, setSelectedDefId] = useState<string>("NONE");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("NONE");
  const [activeDefId, setActiveDefId] = useState<string | null>(null);
  const [activePeriodId, setActivePeriodId] = useState<string | null>(null);

  // ── Data queries ──────────────────────────────────────────────────────────

  const defsQ = useQuery({
    queryKey: ["budget-defs", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => getBudgetDefinitions(ctx!),
    enabled: !!ctx
  });

  const periodsQ = useQuery({
    queryKey: ["periods", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => getPeriodList(ctx!),
    enabled: !!ctx
  });

  const varianceQ = useQuery({
    queryKey: ["budget-variance", ctx?.tenantSlug, ctx?.entityId, activeDefId, activePeriodId],
    queryFn: () => getBudgetVariance(ctx!, activeDefId!, activePeriodId!),
    enabled: !!ctx && !!activeDefId && !!activePeriodId
  });

  const defs = defsQ.data?.data ?? [];
  const periods = periodsQ.data?.data ?? [];
  const report = varianceQ.data?.data;
  const rows: VarianceLine[] = report?.data ?? [];

  // ── Apply / run ───────────────────────────────────────────────────────────

  function runReport() {
    if (selectedDefId !== "NONE" && selectedPeriodId !== "NONE") {
      setActiveDefId(selectedDefId);
      setActivePeriodId(selectedPeriodId);
    }
  }

  // ── Grouping by USALI category ────────────────────────────────────────────

  const groups = useMemo(() => {
    const map = new Map<string, VarianceLine[]>();
    for (const row of rows) {
      const key = row.usaliCategory ?? "Uncategorised";
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  // ── Summary totals ────────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const budget = sum(rows, "budgetAmount");
    const actual = sum(rows, "actualAmount");
    const variance = sum(rows, "variance");
    const variancePct = budget !== 0 ? ((actual - budget) / Math.abs(budget)) * 100 : null;
    const overBudget = rows.filter((r) => parseFloat(r.variance) > 0).length;
    const underBudget = rows.filter((r) => parseFloat(r.variance) < 0).length;
    return { budget, actual, variance, variancePct, overBudget, underBudget };
  }, [rows]);

  const canRun = selectedDefId !== "NONE" && selectedPeriodId !== "NONE";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-muted-foreground" />
            Budget vs Actual Variance
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Compare budgeted amounts against actual account balances for a period
          </p>
        </div>
        {report && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportToCsv(rows, report.budgetName, report.periodName)}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        )}
      </div>

      {/* Selectors */}
      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1.5 min-w-[240px]">
              <label className="text-sm font-medium">Budget Definition</label>
              <Select value={selectedDefId} onValueChange={setSelectedDefId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select budget…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— Select a budget —</SelectItem>
                  {defs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} ({d.year})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 min-w-[200px]">
              <label className="text-sm font-medium">Period</label>
              <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— Select a period —</SelectItem>
                  {periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.status !== "OPEN" && (
                        <span className="ml-1.5 text-muted-foreground text-xs">({p.status})</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={runReport} disabled={!canRun} className="h-10">
              Run Report
            </Button>

            {varianceQ.isLoading && <span className="text-sm text-muted-foreground">Loading…</span>}
            {varianceQ.isError && (
              <span className="text-sm text-destructive">{(varianceQ.error as Error).message}</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Report */}
      {report && (
        <>
          {/* Report header */}
          <div className="flex items-center gap-3 flex-wrap">
            <div>
              <p className="font-semibold text-lg">{report.budgetName}</p>
              <p className="text-sm text-muted-foreground">
                Period: <strong>{report.periodName}</strong> · FY {report.year} · {rows.length}{" "}
                accounts
              </p>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                Total Budget
              </p>
              <p className="text-xl font-bold mt-1 tabular-nums">{fmt(totals.budget)}</p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                Total Actual
              </p>
              <p className="text-xl font-bold mt-1 tabular-nums">{fmt(totals.actual)}</p>
            </div>
            <div
              className={`rounded-lg border p-4 ${totals.variance >= 0 ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"}`}
            >
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                Net Variance
              </p>
              <p
                className={`text-xl font-bold mt-1 tabular-nums flex items-center gap-1.5 ${totals.variance >= 0 ? "text-emerald-700" : "text-red-700"}`}
              >
                {totals.variance >= 0 ? (
                  <TrendingUp className="h-5 w-5" />
                ) : (
                  <TrendingDown className="h-5 w-5" />
                )}
                {totals.variance >= 0 ? "+" : ""}
                {fmt(totals.variance)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                Variance %
              </p>
              <p
                className={`text-xl font-bold mt-1 ${totals.variancePct !== null && totals.variancePct >= 0 ? "text-emerald-700" : "text-red-700"}`}
              >
                {totals.variancePct !== null
                  ? `${totals.variancePct >= 0 ? "+" : ""}${totals.variancePct.toFixed(1)}%`
                  : "—"}
              </p>
              <div className="flex gap-2 mt-1">
                <span className="text-xs text-emerald-600">{totals.overBudget} over</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-red-600">{totals.underBudget} under</span>
              </div>
            </div>
          </div>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              {rows.length === 0 ? (
                <div className="py-16 text-center text-sm text-muted-foreground">
                  No budget or actual data for this selection.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide">
                        <th className="py-2.5 px-4 text-left font-medium text-muted-foreground w-28">
                          Code
                        </th>
                        <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">
                          Account
                        </th>
                        <th className="py-2.5 px-4 text-left font-medium text-muted-foreground w-36">
                          Department
                        </th>
                        <th className="py-2.5 px-4 text-right font-medium text-muted-foreground w-32">
                          Budget
                        </th>
                        <th className="py-2.5 px-4 text-right font-medium text-muted-foreground w-32">
                          Actual
                        </th>
                        <th className="py-2.5 px-4 text-right font-medium text-muted-foreground w-32">
                          Variance
                        </th>
                        <th className="py-2.5 px-4 text-left font-medium text-muted-foreground w-44">
                          Variance %
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(([label, groupRows]) => (
                        <UsaliGroup key={label} label={label} rows={groupRows} />
                      ))}

                      {/* Grand total */}
                      <tr className="border-t-2 border-border bg-muted/60 font-bold text-sm">
                        <td colSpan={3} className="py-3 px-4">
                          Grand Total
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                          {fmt(totals.budget)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums">{fmt(totals.actual)}</td>
                        <td
                          className={`py-3 px-4 text-right tabular-nums ${totals.variance >= 0 ? "text-emerald-700" : "text-red-700"}`}
                        >
                          {totals.variance >= 0 ? "+" : ""}
                          {fmt(totals.variance)}
                        </td>
                        <td className="py-3 px-4">
                          <VarianceBar
                            variancePct={
                              totals.variancePct !== null ? String(totals.variancePct) : null
                            }
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty prompt */}
      {!report && !varianceQ.isLoading && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <BarChart2 className="h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Select a budget definition and period, then click <strong>Run Report</strong>
          </p>
          {defs.length === 0 && !defsQ.isLoading && (
            <p className="text-xs text-muted-foreground">
              No budget definitions found. Create one on the{" "}
              <a href={tenantHref("/budget")} className="underline hover:text-foreground">
                Budget page
              </a>
              .
            </p>
          )}
        </div>
      )}
    </div>
  );
}
