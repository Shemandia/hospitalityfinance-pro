"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useApiContext } from "../../../../components/use-api-context";
import { useUserRole } from "../../../../components/use-user-role";
import {
  getRevPAR,
  getBalanceSheet,
  getUSALIComparative,
  getPeriods,
  getGLJournals,
  getARAgeing,
  getCurrencyExposure
} from "../../../../lib/gl-api";
import type {
  BalanceSheetResult,
  USALIComparativeReport,
  USALIDepartmentComparative,
  CurrencyExposureRow,
  JournalSummary
} from "../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import { fmt, fmtPct } from "../../../../lib/format";

// ── Types ────────────────────────────────────────────────────────────────────

type Period = {
  id: string;
  name: string;
  status: string;
  year: number;
  month: number;
};

type RevPARData = {
  occupancyPct: number;
  adr: string;
  revpar: string;
  roomRevenue: string;
  totalRevenue: string;
  fbRevenue: string;
  gopAmount: string;
  gopPct: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, string> = {
    OPEN: "bg-emerald-100 text-emerald-800",
    CLOSED: "bg-slate-100 text-slate-700",
    LOCKED: "bg-red-100 text-red-700"
  };
  return map[status] ?? "bg-slate-100 text-slate-700";
}

function varianceColor(variance: number): string {
  if (variance > 0) return "text-emerald-700";
  if (variance < 0) return "text-red-600";
  return "text-muted-foreground";
}

function fmtVariance(v: number | string): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "--";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtVariancePct(v: number): string {
  if (isNaN(v)) return "--";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
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
    <div className="flex-1 min-w-36 bg-muted/40 rounded-lg px-4 py-3">
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

// ── Main Page ────────────────────────────────────────────────────────────────

export default function ControllerDashboard() {
  const router = useRouter();
  const apiContext = useApiContext();
  const { role } = useUserRole();

  // Periods
  const periodsQ = useQuery({
    queryKey: ["periods"],
    queryFn: () => getPeriods(apiContext!),
    enabled: !!apiContext
  });

  const periods = (periodsQ.data?.data ?? []) as Period[];
  const currentPeriod = useMemo(
    () =>
      periods.find((p) => p.status === "OPEN") ??
      periods.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      })[0],
    [periods]
  );

  const periodId = currentPeriod?.id ?? "";

  // RevPAR / KPIs
  const revparQ = useQuery({
    queryKey: ["revpar", periodId],
    queryFn: () => getRevPAR(apiContext!, periodId),
    enabled: !!apiContext && !!periodId
  });
  const revpar = revparQ.data?.data as RevPARData | undefined;

  // USALI Comparative (with budget)
  const usaliQ = useQuery({
    queryKey: ["usali-comparative", periodId],
    queryFn: () => getUSALIComparative(apiContext!, periodId),
    enabled: !!apiContext && !!periodId
  });
  const usali = usaliQ.data?.data as USALIComparativeReport | undefined;

  // Balance Sheet
  const bsQ = useQuery({
    queryKey: ["balance-sheet", periodId],
    queryFn: () => getBalanceSheet(apiContext!, periodId),
    enabled: !!apiContext && !!periodId
  });
  const bs = bsQ.data?.data as BalanceSheetResult | undefined;

  // Pending Approval Journals
  const pendingQ = useQuery({
    queryKey: ["journals", "PENDING_APPROVAL"],
    queryFn: () => getGLJournals(apiContext!, { status: "PENDING_APPROVAL", limit: 50 }),
    enabled: !!apiContext
  });
  const pendingJournals = (pendingQ.data?.data ?? []) as JournalSummary[];

  // Currency Exposure (for AP/AR totals)
  const exposureQ = useQuery({
    queryKey: ["currency-exposure"],
    queryFn: () => getCurrencyExposure(apiContext!),
    enabled: !!apiContext
  });
  const exposure = (exposureQ.data?.data ?? []) as CurrencyExposureRow[];

  // AR Ageing
  const ageingQ = useQuery({
    queryKey: ["ar-ageing"],
    queryFn: () => getARAgeing(apiContext!),
    enabled: !!apiContext
  });
  const ageingData = ageingQ.data?.data;

  // Compute AP/AR totals from exposure
  const apTotal = useMemo(
    () => exposure.reduce((s, r) => s + parseFloat(r.apOutstanding || "0"), 0),
    [exposure]
  );
  const arTotal = useMemo(() => {
    if (ageingData?.data) {
      return ageingData.data.reduce((s, r) => s + parseFloat(r.totalOutstanding || "0"), 0);
    }
    return exposure.reduce((s, r) => s + parseFloat(r.arOutstanding || "0"), 0);
  }, [ageingData, exposure]);

  // Cash position from Balance Sheet — find cash accounts
  const cashPosition = useMemo(() => {
    if (!bs?.assets) return 0;
    for (const section of bs.assets) {
      const nameLower = section.name.toLowerCase();
      if (nameLower.includes("cash") || nameLower.includes("bank")) {
        return parseFloat(section.total || "0");
      }
    }
    // Fallback: first asset section often is cash & equivalents
    if (bs.assets.length > 0) {
      return parseFloat(bs.assets[0].total || "0");
    }
    return 0;
  }, [bs]);

  // Balance check
  const balanceCheck = useMemo(() => {
    if (!bs) return null;
    const assets = parseFloat(bs.totalAssets || "0");
    const liabEquity = parseFloat(bs.totalLiabilitiesAndEquity || "0");
    const diff = Math.abs(assets - liabEquity);
    return { assets, liabEquity, balanced: diff < 0.01 };
  }, [bs]);

  const isLoading = periodsQ.isLoading || revparQ.isLoading || usaliQ.isLoading || bsQ.isLoading;

  if (!apiContext) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Please sign in to view the Controller dashboard.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Financial Controller Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Financial oversight and control
          {currentPeriod && (
            <span>
              {" "}
              &mdash; Period: <strong>{currentPeriod.name}</strong>
            </span>
          )}
        </p>
      </div>

      {/* KPI Cards — 6 across */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard
          label="Total Revenue"
          value={usali ? fmt(usali.totalRevenue) : "--"}
          sub="Current Period"
        />
        <KPICard
          label="GOP"
          value={usali ? fmt(usali.grossOperatingProfit) : "--"}
          sub={usali ? `${fmtPct(usali.gopPct)}` : undefined}
          accent={
            usali
              ? parseFloat(usali.gopPct) >= 35
                ? "text-emerald-600"
                : parseFloat(usali.gopPct) >= 20
                  ? "text-amber-600"
                  : "text-red-600"
              : undefined
          }
        />
        <KPICard label="Total Assets" value={bs ? fmt(bs.totalAssets) : "--"} />
        <KPICard label="Total Equity" value={bs ? fmt(bs.totalEquity) : "--"} />
        <KPICard
          label="EBITDA"
          value={usali ? fmt(usali.ebitda) : "--"}
          sub={usali ? `${fmtPct(usali.ebitdaPct)}` : undefined}
        />
        <KPICard
          label="Cash Position"
          value={fmt(cashPosition)}
          accent={cashPosition >= 0 ? "text-emerald-600" : "text-red-600"}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — spans 2 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Revenue vs Budget */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Revenue vs Budget</CardTitle>
                {usali?.hasBudget && (
                  <Badge variant="outline" className="text-[10px]">
                    Budget Available
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {usaliQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : !usali?.departments || usali.departments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No USALI data available.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 pr-4">Department</th>
                        <th className="py-2 pr-4 text-right">Actual</th>
                        <th className="py-2 pr-4 text-right">Budget</th>
                        <th className="py-2 pr-4 text-right">Variance</th>
                        <th className="py-2 pr-4 text-right">Var %</th>
                        <th className="py-2">Performance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usali.departments.map((dept: USALIDepartmentComparative) => {
                        const actual = parseFloat(dept.revenue);
                        const budget = parseFloat(dept.budgetRevenue || "0");
                        const variance = parseFloat(dept.varianceAmount || "0");
                        const variancePctVal = parseFloat(dept.variancePct || "0");
                        const performancePct =
                          budget > 0 ? Math.min(150, (actual / budget) * 100) : 0;

                        return (
                          <tr key={dept.name} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{dept.name}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">{fmt(actual)}</td>
                            <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                              {budget > 0 ? fmt(budget) : "--"}
                            </td>
                            <td
                              className={`py-2 pr-4 text-right tabular-nums font-medium ${varianceColor(
                                variance
                              )}`}
                            >
                              {budget > 0 ? fmtVariance(variance) : "--"}
                            </td>
                            <td
                              className={`py-2 pr-4 text-right tabular-nums ${varianceColor(
                                variancePctVal
                              )}`}
                            >
                              {budget > 0 ? fmtVariancePct(variancePctVal) : "--"}
                            </td>
                            <td className="py-2 w-28">
                              {budget > 0 ? (
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden relative">
                                    {/* Budget target line at 100% */}
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        performancePct >= 100 ? "bg-emerald-500" : "bg-amber-500"
                                      }`}
                                      style={{
                                        width: `${Math.min(100, (performancePct / 150) * 100)}%`
                                      }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">--</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-semibold">
                        <td className="py-2 pr-4">Total Revenue</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {fmt(usali.totalRevenue)}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                          {usali.budgetTotalRevenue !== "0" ? fmt(usali.budgetTotalRevenue) : "--"}
                        </td>
                        <td
                          className={`py-2 pr-4 text-right tabular-nums ${varianceColor(
                            parseFloat(usali.revenueVariance || "0")
                          )}`}
                        >
                          {usali.budgetTotalRevenue !== "0"
                            ? fmtVariance(usali.revenueVariance)
                            : "--"}
                        </td>
                        <td className="py-2 pr-4 text-right" />
                        <td />
                      </tr>
                      <tr className="font-semibold">
                        <td className="py-1 pr-4">GOP</td>
                        <td className="py-1 pr-4 text-right tabular-nums">
                          {fmt(usali.grossOperatingProfit)}
                        </td>
                        <td className="py-1 pr-4 text-right tabular-nums text-muted-foreground">
                          {usali.budgetGOP !== "0" ? fmt(usali.budgetGOP) : "--"}
                        </td>
                        <td />
                        <td />
                        <td />
                      </tr>
                      <tr className="font-semibold">
                        <td className="py-1 pr-4">EBITDA</td>
                        <td className="py-1 pr-4 text-right tabular-nums">{fmt(usali.ebitda)}</td>
                        <td className="py-1 pr-4 text-right tabular-nums text-muted-foreground">
                          {usali.budgetEBITDA !== "0" ? fmt(usali.budgetEBITDA) : "--"}
                        </td>
                        <td />
                        <td />
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Balance Sheet Summary */}
          <SectionHeader title="Balance Sheet Summary" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Total Assets
                </p>
                <p className="text-2xl font-bold text-primary tabular-nums">
                  {bs ? fmt(bs.totalAssets) : "--"}
                </p>
                {bs?.assets && (
                  <div className="mt-2 space-y-1">
                    {bs.assets.map((section) => (
                      <div
                        key={section.name}
                        className="flex justify-between text-xs text-muted-foreground"
                      >
                        <span className="truncate mr-2">{section.name}</span>
                        <span className="tabular-nums font-medium text-foreground">
                          {fmt(section.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Total Liabilities
                </p>
                <p className="text-2xl font-bold text-amber-600 tabular-nums">
                  {bs ? fmt(bs.totalLiabilities) : "--"}
                </p>
                {bs?.liabilities && (
                  <div className="mt-2 space-y-1">
                    {bs.liabilities.map((section) => (
                      <div
                        key={section.name}
                        className="flex justify-between text-xs text-muted-foreground"
                      >
                        <span className="truncate mr-2">{section.name}</span>
                        <span className="tabular-nums font-medium text-foreground">
                          {fmt(section.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Total Equity
                </p>
                <p className="text-2xl font-bold text-emerald-600 tabular-nums">
                  {bs ? fmt(bs.totalEquity) : "--"}
                </p>
                {bs?.equity && (
                  <div className="mt-2 space-y-1">
                    {bs.equity.map((section) => (
                      <div
                        key={section.name}
                        className="flex justify-between text-xs text-muted-foreground"
                      >
                        <span className="truncate mr-2">{section.name}</span>
                        <span className="tabular-nums font-medium text-foreground">
                          {fmt(section.total)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Balance check indicator */}
                {balanceCheck && (
                  <div
                    className={`mt-3 p-2 rounded text-xs font-medium ${
                      balanceCheck.balanced
                        ? "bg-emerald-50 text-emerald-800"
                        : "bg-red-50 text-red-800"
                    }`}
                  >
                    {balanceCheck.balanced
                      ? "Assets = Liabilities + Equity (Balanced)"
                      : `Imbalance: Assets (${fmt(balanceCheck.assets)}) != L+E (${fmt(
                          balanceCheck.liabEquity
                        )})`}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* AP & AR Overview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">AP & AR Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* AP */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Accounts Payable</span>
                  <span className="text-lg font-bold text-red-600 tabular-nums">
                    {fmt(apTotal)}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full"
                    style={{
                      width: `${
                        apTotal + arTotal > 0
                          ? Math.min(100, (apTotal / (apTotal + arTotal)) * 100)
                          : 50
                      }%`
                    }}
                  />
                </div>
              </div>

              {/* AR */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Accounts Receivable</span>
                  <span className="text-lg font-bold text-emerald-600 tabular-nums">
                    {fmt(arTotal)}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{
                      width: `${
                        apTotal + arTotal > 0
                          ? Math.min(100, (arTotal / (apTotal + arTotal)) * 100)
                          : 50
                      }%`
                    }}
                  />
                </div>
              </div>

              {/* Net position */}
              <div className="border-t pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">
                    Net Position
                  </span>
                  <span
                    className={`text-sm font-bold tabular-nums ${
                      arTotal - apTotal >= 0 ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {fmtVariance(arTotal - apTotal)}
                  </span>
                </div>
              </div>

              {/* Breakdown by currency */}
              {exposure.length > 0 && (
                <div className="border-t pt-2 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    By Currency
                  </p>
                  {exposure.map((row) => (
                    <div key={row.currency} className="flex items-center justify-between text-xs">
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {row.currency}
                      </Badge>
                      <div className="flex gap-3">
                        <span className="text-red-600">AP: {fmt(row.apOutstanding)}</span>
                        <span className="text-emerald-600">AR: {fmt(row.arOutstanding)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Approvals */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Pending Approvals</CardTitle>
                <Badge
                  className={`text-xs ${
                    pendingJournals.length > 0
                      ? "bg-amber-100 text-amber-800"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {pendingJournals.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {pendingQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : pendingJournals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No journals awaiting approval.</p>
              ) : (
                <div className="space-y-2">
                  {pendingJournals.slice(0, 5).map((j) => (
                    <div
                      key={j.id}
                      className="flex items-center justify-between py-1.5 border-b last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-mono truncate">{j.reference}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {j.description}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0 ml-2">
                        {j._count.lines} lines
                      </Badge>
                    </div>
                  ))}
                  {pendingJournals.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center">
                      +{pendingJournals.length - 5} more
                    </p>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 text-xs"
                    onClick={() => {
                      router.push("/gl/journals?status=PENDING_APPROVAL");
                    }}
                  >
                    View All Pending Journals
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Period Status */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Period Status</CardTitle>
            </CardHeader>
            <CardContent>
              {periodsQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : periods.length === 0 ? (
                <p className="text-sm text-muted-foreground">No periods found.</p>
              ) : (
                <div className="space-y-2">
                  {periods
                    .sort((a, b) => {
                      if (a.year !== b.year) return b.year - a.year;
                      return b.month - a.month;
                    })
                    .slice(0, 12)
                    .map((p) => (
                      <div
                        key={p.id}
                        className={`flex items-center justify-between py-1.5 border-b last:border-0 ${
                          p.id === currentPeriod?.id ? "bg-primary/5 -mx-2 px-2 rounded" : ""
                        }`}
                      >
                        <span
                          className={`text-sm ${p.id === currentPeriod?.id ? "font-semibold" : ""}`}
                        >
                          {p.name}
                        </span>
                        <Badge className={`text-[10px] ${statusBadge(p.status)}`}>{p.status}</Badge>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
