"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useUserRole } from "../../../../../../components/use-user-role";
import { getPeriods, getRevPAR, getRevPARTrend, getUSALI } from "../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import Link from "next/link";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import { fmt, fmtPct } from "../../../../../../lib/format";

// ── Types ────────────────────────────────────────────────────────────────────

type Period = { id: string; name: string; status: string; year: number; month: number };

type RevPARData = {
  occupancyPct: number;
  adr: string;
  revpar: string;
  trevpar: string;
  roomRevenue: string;
  totalRevenue: string;
  fbRevenue: string;
  gopAmount: string;
  gopPct: string;
  fbCostPct: string;
  periodName: string;
  roomsSold?: number;
  availableRooms?: number;
  complimentaryRooms?: number;
};

type USALIData = {
  departments: Array<{
    name: string;
    revenue: string;
    expenses: string;
    departmentalIncome: string;
    incomePct: string;
  }>;
  totalRevenue: string;
  grossOperatingProfit: string;
  ebitda: string;
};

type TrendPoint = { date: string; revpar: string; adr: string; occupancyPct: string };

// ── Formatting helpers ───────────────────────────────────────────────────────

function occupancyColor(pct: number) {
  if (pct >= 70) return "text-emerald-700";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}

function occupancyBg(pct: number) {
  if (pct >= 70) return "bg-emerald-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-red-500";
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  accent
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="flex-1 min-w-[180px] bg-muted/40 rounded-lg px-4 py-3 border border-border/40">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={`text-2xl font-bold leading-tight mt-0.5 ${accent ?? "text-primary"}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GMDashboardPage() {
  const apiContext = useApiContext();
  const { role } = useUserRole();
  const tenantHref = useTenantHref();
  const [periodId, setPeriodId] = useState("");

  // Periods
  const periodsQ = useQuery({
    queryKey: ["periods", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => (apiContext ? getPeriods(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: any) => (r.data as unknown as Period[]) ?? []
  });
  const periods = periodsQ.data ?? [];
  const activePeriodId =
    periodId || periods.find((p) => p.status === "OPEN")?.id || periods[0]?.id || "";
  const activePeriod = periods.find((p) => p.id === activePeriodId);

  // RevPAR
  const revparQ = useQuery({
    queryKey: ["kpi-revpar", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getRevPAR(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    select: (r: any): RevPARData | null => r.data ?? null
  });

  // USALI
  const usaliQ = useQuery({
    queryKey: ["kpi-usali", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getUSALI(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    select: (r: any): USALIData | null => r.data ?? null
  });

  // Trend
  const trendQ = useQuery({
    queryKey: ["kpi-trend", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getRevPARTrend(apiContext, activePeriodId)
        : Promise.resolve({ data: [] }),
    enabled: Boolean(apiContext && activePeriodId),
    select: (r: any): TrendPoint[] => r.data ?? []
  });

  const revpar = revparQ.data;
  const usali = usaliQ.data;
  const trend = trendQ.data ?? [];

  const occPct = revpar ? revpar.occupancyPct : 0;
  const gopPct = revpar ? parseFloat(revpar.gopPct) : 0;
  const totalRevenue = usali ? parseFloat(usali.totalRevenue) : 0;

  const isLoading = periodsQ.isLoading || revparQ.isLoading;

  return (
    <div className="space-y-4">
      {/* Header + Period Selector */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-3 px-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary">General Manager Dashboard</span>
            <Badge variant="outline" className="text-[10px]">
              {role}
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

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          Loading dashboard data...
        </div>
      )}

      {!isLoading && (
        <>
          {/* ── KPI Cards Row 1 ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="flex-1 min-w-[180px] bg-muted/40 rounded-lg px-4 py-3 border border-border/40">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Occupancy %
              </p>
              <p className={`text-3xl font-bold leading-tight mt-0.5 ${occupancyColor(occPct)}`}>
                {revpar ? fmtPct(occPct) : "--"}
              </p>
              {/* Mini progress bar */}
              <div className="mt-1.5 h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${occupancyBg(occPct)}`}
                  style={{ width: `${Math.min(occPct, 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {occPct >= 70 ? "Strong" : occPct >= 50 ? "Moderate" : "Low"} occupancy
              </p>
            </div>
            <KPICard label="ADR" value={revpar ? fmt(revpar.adr) : "--"} sub="Average Daily Rate" />
            <KPICard
              label="RevPAR"
              value={revpar ? fmt(revpar.revpar) : "--"}
              sub="Rev per Available Room"
            />
            <KPICard
              label="TRevPAR"
              value={revpar ? fmt(revpar.trevpar) : "--"}
              sub="Total Rev per Avail. Room"
            />
          </div>

          {/* ── KPI Cards Row 2 ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard
              label="Room Revenue"
              value={revpar ? fmt(revpar.roomRevenue) : "--"}
              sub="Rooms department"
            />
            <KPICard
              label="F&B Revenue"
              value={revpar ? fmt(revpar.fbRevenue) : "--"}
              sub="Food & Beverage"
            />
            <div className="flex-1 min-w-[180px] bg-muted/40 rounded-lg px-4 py-3 border border-border/40">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                GOP / GOP %
              </p>
              <p className="text-2xl font-bold leading-tight mt-0.5 text-emerald-700">
                {revpar ? fmt(revpar.gopAmount) : "--"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {revpar ? (
                  <span
                    className={
                      gopPct >= 35
                        ? "text-emerald-600"
                        : gopPct >= 20
                          ? "text-amber-600"
                          : "text-red-600"
                    }
                  >
                    {fmtPct(gopPct)} margin
                  </span>
                ) : (
                  "Gross Operating Profit"
                )}
              </p>
            </div>
            <KPICard
              label="F&B Cost %"
              value={revpar ? fmtPct(revpar.fbCostPct) : "--"}
              sub="Food & Bev Cost Ratio"
              accent={
                revpar
                  ? parseFloat(revpar.fbCostPct) <= 30
                    ? "text-emerald-700"
                    : parseFloat(revpar.fbCostPct) <= 40
                      ? "text-amber-600"
                      : "text-red-600"
                  : undefined
              }
            />
          </div>

          {/* ── Departmental Performance ── */}
          <SectionHeader title="Departmental Performance" />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-primary text-base">
                USALI Departmental Summary
                {activePeriod && (
                  <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                    {activePeriod.name}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!usali || usali.departments.length === 0 ? (
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
                          Income
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide w-48">
                          Income %
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {usali.departments.map((dept) => {
                        const incomePct = parseFloat(dept.incomePct);
                        const rev = parseFloat(dept.revenue);
                        const maxRev = Math.max(
                          ...usali.departments.map((d) => parseFloat(d.revenue)),
                          1
                        );
                        const barWidth = (rev / maxRev) * 100;
                        return (
                          <tr key={dept.name} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-4 text-slate-700 font-medium">{dept.name}</td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(dept.revenue)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(dept.expenses)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-medium tabular-nums text-emerald-700">
                              {fmt(dept.departmentalIncome)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      incomePct >= 35
                                        ? "bg-emerald-500"
                                        : incomePct >= 20
                                          ? "bg-amber-500"
                                          : "bg-red-500"
                                    }`}
                                    style={{
                                      width: `${Math.max(0, Math.min(incomePct, 100))}%`
                                    }}
                                  />
                                </div>
                                <span
                                  className={`text-xs font-semibold tabular-nums w-12 text-right ${
                                    incomePct >= 35
                                      ? "text-emerald-700"
                                      : incomePct >= 20
                                        ? "text-amber-600"
                                        : "text-red-600"
                                  }`}
                                >
                                  {fmtPct(incomePct)}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                        <td className="py-2.5 px-4 text-slate-800">Total</td>
                        <td className="py-2.5 px-3 text-right text-slate-800 tabular-nums">
                          {fmt(usali.totalRevenue)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-800 tabular-nums">--</td>
                        <td className="py-2.5 px-3 text-right text-emerald-800 tabular-nums">
                          {fmt(usali.grossOperatingProfit)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-800 tabular-nums">
                          {revpar ? fmtPct(revpar.gopPct) : "--"}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Revenue Trend ── */}
          <SectionHeader title="Revenue Trend (Last 6 Periods)" />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-primary text-base">
                RevPAR / ADR / Occupancy Trend
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {trend.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No trend data available. Post journals to multiple periods to see trends.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Period
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          RevPAR
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          ADR
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Occupancy %
                        </th>
                        <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-32">
                          Occ. Bar
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {trend.slice(-6).map((p, i) => {
                        const occ = parseFloat(p.occupancyPct);
                        return (
                          <tr key={i} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-4 text-slate-700 font-medium font-mono text-xs">
                              {p.date}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(p.revpar)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(p.adr)}
                            </td>
                            <td className="py-2.5 px-3 text-right tabular-nums">
                              <span className={occupancyColor(occ)}>{fmtPct(occ)}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${occupancyBg(occ)}`}
                                  style={{ width: `${Math.min(occ, 100)}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Guest Statistics ── */}
          <SectionHeader title="Guest Statistics" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card>
              <CardContent className="py-4 px-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Rooms Sold
                </p>
                <p className="text-2xl font-bold text-primary mt-1">
                  {revpar?.roomsSold != null ? fmt(revpar.roomsSold) : "--"}
                </p>
                <p className="text-xs text-muted-foreground">Occupied room nights this period</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 px-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Available Rooms
                </p>
                <p className="text-2xl font-bold text-primary mt-1">
                  {revpar?.availableRooms != null ? fmt(revpar.availableRooms) : "--"}
                </p>
                <p className="text-xs text-muted-foreground">Total available room nights</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 px-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Complimentary Rooms
                </p>
                <p className="text-2xl font-bold text-primary mt-1">
                  {revpar?.complimentaryRooms != null ? fmt(revpar.complimentaryRooms) : "--"}
                </p>
                <p className="text-xs text-muted-foreground">Comp room nights issued</p>
              </CardContent>
            </Card>
          </div>

          {/* ── Action Items ── */}
          <SectionHeader title="Action Items" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Link href={tenantHref("/reports/usali-pl")} className="block">
              <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-emerald-500">
                <CardContent className="py-4 px-5">
                  <p className="text-sm font-semibold text-slate-800">USALI P&L Report</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    View full departmental P&L with comparative analysis
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href={tenantHref("/budget")} className="block">
              <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-blue-500">
                <CardContent className="py-4 px-5">
                  <p className="text-sm font-semibold text-slate-800">Budget & Variance</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Review budget definitions and variance analysis
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href={tenantHref("/reports/balance-sheet")} className="block">
              <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-purple-500">
                <CardContent className="py-4 px-5">
                  <p className="text-sm font-semibold text-slate-800">Balance Sheet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Assets, liabilities, and equity position
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
