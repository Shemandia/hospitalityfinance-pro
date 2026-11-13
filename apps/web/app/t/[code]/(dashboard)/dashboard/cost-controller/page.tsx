"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getPeriods,
  getRevPAR,
  getUSALI,
  getUSALIComparative,
  getBudgetDefinitions,
  getBudgetVariance
} from "../../../../../../lib/gl-api";
import type {
  USALIReport,
  USALIComparativeReport,
  USALIDepartmentComparative,
  BudgetDefinition,
  VarianceReport,
  VarianceLine
} from "../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";

// ── Types ────────────────────────────────────────────────────────────────────

type Period = {
  id: string;
  name: string;
  status: string;
  year: number;
  month: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: string | number, d = 0) {
  return parseFloat(String(n)).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
}

function fmtPct(n: string | number) {
  return `${parseFloat(String(n)).toFixed(1)}%`;
}

function costColor(pct: number): string {
  if (pct <= 30) return "text-emerald-600";
  if (pct <= 40) return "text-amber-600";
  return "text-red-600";
}

function costBg(pct: number): string {
  if (pct <= 30) return "bg-emerald-500";
  if (pct <= 40) return "bg-amber-500";
  return "bg-red-500";
}

function costBgLight(pct: number): string {
  if (pct <= 30) return "bg-emerald-50";
  if (pct <= 40) return "bg-amber-50";
  return "bg-red-50";
}

function varianceColor(variance: number): string {
  // Positive variance = under budget = good for expenses
  if (variance > 0) return "text-emerald-600";
  if (variance < 0) return "text-red-600";
  return "text-slate-600";
}

// ── Small Components ─────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  accent,
  target
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  target?: string;
}) {
  return (
    <Card className="flex-1 min-w-[180px]">
      <CardContent className="pt-4 pb-3 px-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className={`text-2xl font-bold leading-tight mt-1 ${accent ?? "text-primary"}`}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        {target && <p className="text-[10px] text-muted-foreground mt-0.5">{target}</p>}
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 pt-3">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
      Loading cost controller data...
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CostControllerDashboardPage() {
  const apiContext = useApiContext();
  const [periodId, setPeriodId] = useState("");

  // ── Periods ──
  const periodsQ = useQuery({
    queryKey: ["periods", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => (apiContext ? getPeriods(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data as unknown as Period[]) ?? []
  });
  const periods = periodsQ.data ?? [];
  const activePeriodId =
    periodId || periods.find((p) => p.status === "OPEN")?.id || periods[0]?.id || "";
  const activePeriod = periods.find((p) => p.id === activePeriodId);

  // ── KPI Queries ──
  const revparQ = useQuery({
    queryKey: ["kpi-revpar", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getRevPAR(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data ?? null
  });

  const usaliQ = useQuery({
    queryKey: ["kpi-usali", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getUSALI(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data ?? null) as USALIReport | null
  });

  const usaliCompQ = useQuery({
    queryKey: ["usali-comparative", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getUSALIComparative(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data ?? null) as USALIComparativeReport | null
  });

  // ── Budget definitions ──
  const budgetDefsQ = useQuery({
    queryKey: ["budget-defs", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => (apiContext ? getBudgetDefinitions(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data ?? []) as BudgetDefinition[]
  });
  const budgetDefs = budgetDefsQ.data ?? [];
  const activeBudget = activePeriod
    ? budgetDefs.find((b) => b.year === activePeriod.year)
    : budgetDefs[0];

  // ── Budget variance ──
  const varianceQ = useQuery({
    queryKey: [
      "budget-variance",
      apiContext?.tenantSlug,
      apiContext?.entityId,
      activeBudget?.id,
      activePeriodId
    ],
    queryFn: () =>
      apiContext && activeBudget && activePeriodId
        ? getBudgetVariance(apiContext, activeBudget.id, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activeBudget && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data ?? null) as VarianceReport | null
  });

  // ── Historical periods for trend ──
  const sortedPeriods = [...periods].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });
  const currentIdx = sortedPeriods.findIndex((p) => p.id === activePeriodId);
  const trendPeriods = sortedPeriods.slice(currentIdx, currentIdx + 6).reverse();

  const trendQueries = trendPeriods.map((p) => ({
    queryKey: ["kpi-usali-trend", apiContext?.tenantSlug, apiContext?.entityId, p.id],
    queryFn: () => (apiContext ? getUSALI(apiContext, p.id) : Promise.resolve({ data: null })),
    enabled: Boolean(apiContext && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => ({
      periodName: p.name,
      data: (r.data ?? null) as USALIReport | null
    })
  }));

  // Use individual useQuery calls for trend - can't use useQueries with dynamic count
  // so we'll fetch the comparative data which has YTD built in
  // Instead, use the USALI comparative which already includes prior year data

  // ── Derived data ──
  const revpar = revparQ.data as Record<string, string> | null;
  const usali = usaliQ.data;
  const usaliComp = usaliCompQ.data;
  const variance = varianceQ.data;

  const totalRevenue = usali ? parseFloat(usali.totalRevenue) : 0;
  const totalExpenses = usali
    ? parseFloat(usali.totalDepartmentalExpenses) +
      parseFloat(usali.undistributedExpenses) +
      parseFloat(usali.managementFees)
    : 0;
  const undistributed = usali ? parseFloat(usali.undistributedExpenses) : 0;

  // F&B cost % from revpar data
  const fbCostPct = revpar ? parseFloat(revpar.fbCostPct ?? "0") : 0;

  // Estimate payroll from undistributed (typically largest component)
  // In hospitality, payroll is typically 25-35% of revenue
  const payrollEstimate = totalRevenue > 0 ? Math.min(undistributed * 0.6, totalRevenue * 0.35) : 0;
  const payrollPct = totalRevenue > 0 ? (payrollEstimate / totalRevenue) * 100 : 0;

  // Department cost breakdown
  const departments = usali?.departments ?? [];
  const compDepartments = usaliComp?.departments ?? [];

  // Variance lines filtered to expense accounts
  const expenseVarianceLines = (variance?.data ?? []).filter(
    (line) => parseFloat(line.budgetAmount) !== 0 || parseFloat(line.actualAmount) !== 0
  );

  // Cost alerts: departments exceeding budget by >10%
  const costAlerts: Array<{
    name: string;
    actual: number;
    budget: number;
    overPct: number;
  }> = [];
  if (usaliComp?.hasBudget) {
    for (const dept of compDepartments) {
      const actual = parseFloat(dept.expenses);
      const budget = parseFloat(dept.budgetExpenses);
      if (budget > 0 && actual > budget * 1.1) {
        const overPct = ((actual - budget) / budget) * 100;
        costAlerts.push({
          name: dept.name,
          actual,
          budget,
          overPct
        });
      }
    }
    costAlerts.sort((a, b) => b.overPct - a.overPct);
  }

  // Top expense categories sorted by amount
  const topExpenses = [...departments]
    .filter((d) => parseFloat(d.expenses) > 0)
    .sort((a, b) => parseFloat(b.expenses) - parseFloat(a.expenses));

  const isLoading = periodsQ.isLoading || revparQ.isLoading || usaliQ.isLoading;

  if (!apiContext) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Please log in to view the Cost Controller Dashboard.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-3 px-6">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-primary">Cost Controller Dashboard</span>
            <Badge variant="outline" className="text-[10px]">
              Expense Analysis &amp; Cost Control
            </Badge>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Period:</span>
            <Select value={activePeriodId} onValueChange={setPeriodId}>
              <SelectTrigger className="h-8 w-52">
                <SelectValue placeholder="Select period" />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.status === "OPEN" ? " (Open)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <LoadingState />
      ) : (
        <>
          {/* ── Top KPI Cards ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard
              label="Total Expenses"
              value={usali ? fmt(totalExpenses) : "--"}
              sub="Current period"
              accent="text-red-600"
            />
            <KPICard
              label="F&B Cost %"
              value={revpar ? fmtPct(fbCostPct) : "--"}
              accent={
                fbCostPct <= 30
                  ? "text-emerald-700"
                  : fbCostPct <= 35
                    ? "text-amber-600"
                    : "text-red-600"
              }
              target="Target: < 30%"
              sub={
                fbCostPct <= 30
                  ? "Within target"
                  : fbCostPct <= 35
                    ? "Slightly above target"
                    : "Above target"
              }
            />
            <KPICard
              label="Undistributed Expenses"
              value={usali ? fmt(undistributed) : "--"}
              sub={
                totalRevenue > 0
                  ? `${((undistributed / totalRevenue) * 100).toFixed(1)}% of revenue`
                  : "Current period"
              }
              accent="text-orange-600"
            />
            <KPICard
              label="Payroll Cost % (est.)"
              value={totalRevenue > 0 ? fmtPct(payrollPct) : "--"}
              sub="Estimated from undistributed"
              accent={
                payrollPct <= 25
                  ? "text-emerald-700"
                  : payrollPct <= 33
                    ? "text-amber-600"
                    : "text-red-600"
              }
              target="Target: 25-33%"
            />
          </div>

          {/* ── Section 1: Cost Breakdown by Department ── */}
          <SectionHeader title="Cost Breakdown by Department" />
          <Card>
            <CardContent className="p-0">
              {departments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No departmental data available for this period.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Department
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Revenue
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Expenses
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Cost %
                        </th>
                        <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-40">
                          Cost Ratio
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Dept. Income
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {departments.map((dept) => {
                        const rev = parseFloat(dept.revenue);
                        const exp = parseFloat(dept.expenses);
                        const costPct = rev > 0 ? (exp / rev) * 100 : exp > 0 ? 100 : 0;
                        const income = parseFloat(dept.departmentalIncome);

                        return (
                          <tr
                            key={dept.name}
                            className={`hover:bg-slate-50/60 ${costPct > 40 ? costBgLight(costPct) : ""}`}
                          >
                            <td className="py-2.5 px-4 text-slate-700 font-medium">{dept.name}</td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(rev)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(exp)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-bold tabular-nums ${costColor(costPct)}`}
                            >
                              {rev > 0 || exp > 0 ? fmtPct(costPct) : "--"}
                            </td>
                            <td className="py-2.5 px-3">
                              {rev > 0 || exp > 0 ? (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${costBg(costPct)}`}
                                      style={{
                                        width: `${Math.min(costPct, 100)}%`
                                      }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-muted-foreground w-8 text-right">
                                    {costPct.toFixed(0)}%
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">--</span>
                              )}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-medium tabular-nums ${income >= 0 ? "text-emerald-700" : "text-red-600"}`}
                            >
                              {fmt(income)}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Totals row */}
                      <tr className="bg-slate-50 border-t-2 border-slate-300 font-semibold">
                        <td className="py-2.5 px-4 text-slate-800">Total</td>
                        <td className="py-2.5 px-3 text-right text-slate-800 tabular-nums">
                          {fmt(totalRevenue)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-800 tabular-nums">
                          {usali ? fmt(parseFloat(usali.totalDepartmentalExpenses)) : "--"}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-bold tabular-nums ${totalRevenue > 0 ? costColor((parseFloat(usali?.totalDepartmentalExpenses ?? "0") / totalRevenue) * 100) : ""}`}
                        >
                          {totalRevenue > 0
                            ? fmtPct(
                                (parseFloat(usali?.totalDepartmentalExpenses ?? "0") /
                                  totalRevenue) *
                                  100
                              )
                            : "--"}
                        </td>
                        <td className="py-2.5 px-3" />
                        <td className="py-2.5 px-3 text-right text-emerald-700 tabular-nums">
                          {usali ? fmt(parseFloat(usali.totalDepartmentalIncome)) : "--"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Section 2: Budget vs Actual Expenses ── */}
          <SectionHeader title="Budget vs Actual Expenses" />
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base text-primary">Expense Variance</CardTitle>
                {!activeBudget && (
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                    No budget defined for this year
                  </Badge>
                )}
                {activeBudget && !usaliComp?.hasBudget && (
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                    No budget data loaded
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {usaliComp?.hasBudget && compDepartments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Department
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Budget Exp.
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Actual Exp.
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Variance
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Var %
                        </th>
                        <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {compDepartments.map((dept) => {
                        const budgetExp = parseFloat(dept.budgetExpenses);
                        const actualExp = parseFloat(dept.expenses);
                        const variance = budgetExp - actualExp;
                        const variancePctVal =
                          budgetExp !== 0 ? (variance / Math.abs(budgetExp)) * 100 : 0;
                        const isOver = variance < 0;

                        return (
                          <tr
                            key={dept.name}
                            className={`hover:bg-slate-50/60 ${isOver && Math.abs(variancePctVal) > 10 ? "bg-red-50/40" : ""}`}
                          >
                            <td className="py-2.5 px-4 text-slate-700 font-medium">{dept.name}</td>
                            <td className="py-2.5 px-3 text-right text-slate-500 tabular-nums">
                              {fmt(budgetExp)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(actualExp)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-medium tabular-nums ${varianceColor(variance)}`}
                            >
                              {variance >= 0 ? "+" : ""}
                              {fmt(variance)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right tabular-nums ${varianceColor(variance)}`}
                            >
                              {budgetExp !== 0
                                ? `${variancePctVal >= 0 ? "+" : ""}${variancePctVal.toFixed(1)}%`
                                : "--"}
                            </td>
                            <td className="py-2.5 px-3">
                              <Badge
                                variant={
                                  isOver && Math.abs(variancePctVal) > 10
                                    ? "destructive"
                                    : isOver
                                      ? "secondary"
                                      : "outline"
                                }
                                className="text-[10px]"
                              >
                                {isOver && Math.abs(variancePctVal) > 10
                                  ? "Over Budget"
                                  : isOver
                                    ? "Slightly Over"
                                    : "Under Budget"}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : expenseVarianceLines.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Account
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Budget
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Actual
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Variance
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Var %
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {expenseVarianceLines.slice(0, 20).map((line) => {
                        const v = parseFloat(line.variance);
                        const vPct = line.variancePct ? parseFloat(line.variancePct) : null;
                        return (
                          <tr key={line.accountId} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-4 text-slate-700">
                              <span className="font-mono text-xs text-slate-400 mr-2">
                                {line.accountCode}
                              </span>
                              {line.accountName}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-500 tabular-nums">
                              {fmt(line.budgetAmount)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(line.actualAmount)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-medium tabular-nums ${varianceColor(v)}`}
                            >
                              {v >= 0 ? "+" : ""}
                              {fmt(v)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right tabular-nums ${vPct !== null ? varianceColor(vPct) : ""}`}
                            >
                              {vPct !== null ? `${vPct >= 0 ? "+" : ""}${vPct.toFixed(1)}%` : "--"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {expenseVarianceLines.length > 20 && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Showing top 20 of {expenseVarianceLines.length} lines
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No budget variance data available. Define a budget to see comparisons.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Section 3: Expense Trend ── */}
          <SectionHeader title="Expense Trend (Current vs Prior Year)" />
          <Card>
            <CardContent className="p-0">
              {compDepartments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Department
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Current Period
                        </th>
                        {usaliComp?.hasPriorYear && (
                          <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                            Prior Year
                          </th>
                        )}
                        {usaliComp?.hasYTD && (
                          <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                            YTD Expenses
                          </th>
                        )}
                        {usaliComp?.hasPriorYear && (
                          <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                            Change
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {compDepartments.map((dept) => {
                        const current = parseFloat(dept.expenses);
                        const prior = parseFloat(dept.priorExpenses);
                        const ytdExp = parseFloat(dept.ytdExpenses);
                        const change = prior > 0 ? ((current - prior) / prior) * 100 : 0;

                        return (
                          <tr key={dept.name} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-4 text-slate-700 font-medium">{dept.name}</td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(current)}
                            </td>
                            {usaliComp?.hasPriorYear && (
                              <td className="py-2.5 px-3 text-right text-slate-500 tabular-nums">
                                {fmt(prior)}
                              </td>
                            )}
                            {usaliComp?.hasYTD && (
                              <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                                {fmt(ytdExp)}
                              </td>
                            )}
                            {usaliComp?.hasPriorYear && (
                              <td
                                className={`py-2.5 px-3 text-right font-medium tabular-nums ${change > 0 ? "text-red-600" : change < 0 ? "text-emerald-600" : "text-slate-500"}`}
                              >
                                {prior > 0 ? `${change > 0 ? "+" : ""}${change.toFixed(1)}%` : "--"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {/* Summary row */}
                      <tr className="bg-slate-50 border-t-2 border-slate-300 font-semibold">
                        <td className="py-2.5 px-4 text-slate-800">Total</td>
                        <td className="py-2.5 px-3 text-right text-slate-800 tabular-nums">
                          {fmt(totalExpenses)}
                        </td>
                        {usaliComp?.hasPriorYear && (
                          <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                            {fmt(
                              compDepartments.reduce((s, d) => s + parseFloat(d.priorExpenses), 0)
                            )}
                          </td>
                        )}
                        {usaliComp?.hasYTD && (
                          <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                            {fmt(
                              compDepartments.reduce((s, d) => s + parseFloat(d.ytdExpenses), 0)
                            )}
                          </td>
                        )}
                        {usaliComp?.hasPriorYear && <td />}
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No comparative expense data available.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Section 4: Cost Alerts ── */}
          <SectionHeader title="Cost Alerts" />
          {costAlerts.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {costAlerts.map((alert) => (
                <Card key={alert.name} className="border-l-4 border-l-red-400 bg-red-50/40">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-red-800">{alert.name}</p>
                        <p className="text-[10px] text-red-600 mt-0.5">
                          Exceeding budget by {alert.overPct.toFixed(1)}%
                        </p>
                      </div>
                      <Badge variant="destructive" className="text-[10px]">
                        Over Budget
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Budget</p>
                        <p className="font-semibold text-slate-700">{fmt(alert.budget)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Actual</p>
                        <p className="font-semibold text-red-700">{fmt(alert.actual)}</p>
                      </div>
                    </div>
                    <div className="mt-2 h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-red-500 rounded-full"
                        style={{
                          width: `${Math.min((alert.actual / alert.budget) * 100, 100)}%`
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                      <span>0</span>
                      <span>Budget: {fmt(alert.budget)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-l-4 border-l-emerald-400 bg-emerald-50/30">
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-sm font-medium text-emerald-700">
                  {usaliComp?.hasBudget
                    ? "All departments are within 10% of budget."
                    : "No budget defined -- cost alerts will appear when a budget is loaded and departments exceed it by more than 10%."}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Section 5: Top Expense Categories ── */}
          <SectionHeader title="Top Expense Categories (USALI)" />
          <Card>
            <CardContent className="p-0">
              {topExpenses.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No expense data available for this period.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {topExpenses.map((dept, i) => {
                    const exp = parseFloat(dept.expenses);
                    const maxExp = parseFloat(topExpenses[0].expenses);
                    const barPct = maxExp > 0 ? (exp / maxExp) * 100 : 0;
                    const rev = parseFloat(dept.revenue);
                    const costPct = rev > 0 ? (exp / rev) * 100 : exp > 0 ? 100 : 0;

                    return (
                      <div
                        key={dept.name}
                        className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50/60"
                      >
                        <span className="text-xs text-slate-400 font-mono w-5 text-right">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-slate-700 truncate">
                              {dept.name}
                            </span>
                            <div className="flex items-center gap-3">
                              <span className={`text-xs font-semibold ${costColor(costPct)}`}>
                                {rev > 0 ? fmtPct(costPct) : "--"}
                              </span>
                              <span className="text-sm font-bold text-slate-800 tabular-nums">
                                {fmt(exp)}
                              </span>
                            </div>
                          </div>
                          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${costBg(costPct)}`}
                              style={{ width: `${barPct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
