"use client";

import { useQuery, useQueries } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import { useUserRole } from "../../../../components/use-user-role";
import {
  getBalanceSheet,
  getCashFlow,
  getPeriods,
  getRevPAR,
  getUSALI,
  getUSALIComparative,
  getEntities,
  getEntitySummary,
  getARAgeing,
  getAPInvoicesDue
} from "../../../../lib/gl-api";
import type {
  BalanceSheetResult,
  CashFlowResult,
  USALIReport,
  USALIComparativeReport,
  EntitySummary
} from "../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../components/ui/select";

// ── Types ────────────────────────────────────────────────────────────────────

type Period = {
  id: string;
  name: string;
  status: string;
  year: number;
  month: number;
};

type AgeingRow = {
  customerId: string;
  customerName: string;
  bucket0to30: string;
  bucket31to60: string;
  bucket61to90: string;
  bucket91Plus: string;
  totalOutstanding: string;
  currency: string;
};

type APInvoice = {
  id: string;
  invoiceNumber: string;
  dueDate: string;
  grossAmount: string;
  currency: string;
  status: string;
  supplier?: { name: string };
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

function gopColor(pct: number): string {
  if (pct >= 35) return "text-emerald-600";
  if (pct >= 20) return "text-amber-600";
  return "text-red-600";
}

function gopBg(pct: number): string {
  if (pct >= 35) return "bg-emerald-500";
  if (pct >= 20) return "bg-amber-500";
  return "bg-red-500";
}

// ── Small Components ─────────────────────────────────────────────────────────

function BigKPICard({
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
    <Card className="flex-1 min-w-[200px]">
      <CardContent className="pt-4 pb-3 px-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className={`text-3xl font-bold leading-tight mt-1 ${accent ?? "text-primary"}`}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
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
      Loading dashboard data...
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DirectorsDashboardPage() {
  const apiContext = useApiContext();
  useUserRole();
  const [periodId, setPeriodId] = useState("");

  // ── Periods ──
  const periodsQ = useQuery({
    queryKey: ["periods", apiContext?.entityId],
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revparQ = useQuery({
    queryKey: ["kpi-revpar", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getRevPAR(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => r.data ?? null
  });

  const usaliQ = useQuery({
    queryKey: ["kpi-usali", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getUSALI(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data ?? null) as USALIReport | null
  });

  const usaliCompQ = useQuery({
    queryKey: ["usali-comparative", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getUSALIComparative(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data ?? null) as USALIComparativeReport | null
  });

  const bsQ = useQuery({
    queryKey: ["kpi-bs", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getBalanceSheet(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data ?? null) as BalanceSheetResult | null
  });

  const cfQ = useQuery({
    queryKey: ["kpi-cf", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getCashFlow(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data ?? null) as CashFlowResult | null
  });

  // ── Portfolio entities ──
  const entitiesQ = useQuery({
    queryKey: ["portfolio-entities", apiContext?.entityId],
    queryFn: () => (apiContext ? getEntities(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) =>
      ((r.data ?? []) as Array<{ id: string; name: string; type: string }>).filter(
        (e) => e.type === "PROPERTY"
      )
  });
  const portfolioEntities = entitiesQ.data ?? [];

  const portfolioQueries = useQueries({
    queries: portfolioEntities.map((entity) => ({
      queryKey: ["entity-summary", entity.id, activePeriod?.year, activePeriod?.month],
      queryFn: () =>
        apiContext && activePeriod
          ? getEntitySummary(apiContext, entity.id, activePeriod.year, activePeriod.month)
          : Promise.resolve({ data: null }),
      enabled: Boolean(apiContext && activePeriod && portfolioEntities.length > 0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (r: any) => r.data as EntitySummary | null
    }))
  });

  // ── Alerts: AR Ageing ──
  const arAgeingQ = useQuery({
    queryKey: ["ar-ageing", apiContext?.entityId],
    queryFn: () =>
      apiContext ? getARAgeing(apiContext) : Promise.resolve({ data: { asOfDate: "", data: [] } }),
    enabled: Boolean(apiContext),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data?.data ?? []) as AgeingRow[]
  });

  // ── Alerts: AP Due ──
  const nextWeek = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  }, []);
  const apDueQ = useQuery({
    queryKey: ["ap-due", apiContext?.entityId, nextWeek],
    queryFn: () =>
      apiContext ? getAPInvoicesDue(apiContext, nextWeek) : Promise.resolve({ data: [] }),
    enabled: Boolean(apiContext),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (r: any) => (r.data ?? []) as APInvoice[]
  });

  // ── Derived data ──
  const revpar = revparQ.data as Record<string, string> | null;
  const usali = usaliQ.data;
  const usaliComp = usaliCompQ.data;
  const bs = bsQ.data;
  const cf = cfQ.data;

  const totalRevenue = usali ? parseFloat(usali.totalRevenue) : 0;
  const gop = usali ? parseFloat(usali.grossOperatingProfit) : 0;
  const gopPct = totalRevenue !== 0 ? (gop / totalRevenue) * 100 : 0;
  const ebitda = usali ? parseFloat(usali.ebitda) : 0;
  const ebitdaPct = totalRevenue !== 0 ? (ebitda / totalRevenue) * 100 : 0;

  const cashPosition = cf ? parseFloat(cf.closingCash) : 0;
  const totalAssets = bs ? parseFloat(bs.totalAssets) : 0;
  const totalLiabilities = bs ? parseFloat(bs.totalLiabilities) : 0;
  const totalEquity = bs ? parseFloat(bs.totalEquity) : 0;

  // YoY from comparative
  const priorRevenue = usaliComp ? parseFloat(usaliComp.priorTotalRevenue) : 0;
  const revenueYoY =
    priorRevenue !== 0 ? ((totalRevenue - priorRevenue) / Math.abs(priorRevenue)) * 100 : null;

  // Financial ratios
  const debtEquity = totalEquity !== 0 ? totalLiabilities / Math.abs(totalEquity) : 0;
  const currentAssets = (bs?.assets ?? [])
    .filter((s) =>
      [
        "Cash & Cash Equivalents",
        "Accounts Receivable",
        "Inventories",
        "Prepaid Expenses"
      ].includes(s.name)
    )
    .reduce((sum, section) => sum + parseFloat(section.total), 0);
  const currentLiabilities = (bs?.liabilities ?? [])
    .filter((s) =>
      [
        "Accounts Payable",
        "Accrued Expenses",
        "Current Liabilities",
        "Other Current Liabilities"
      ].includes(s.name)
    )
    .reduce((sum, section) => sum + parseFloat(section.total), 0);
  const currentRatio =
    currentLiabilities !== 0
      ? currentAssets / Math.abs(currentLiabilities)
      : currentAssets > 0
        ? 999
        : 0;
  const roe = totalEquity !== 0 ? (ebitda / Math.abs(totalEquity)) * 100 : 0;

  // Portfolio sorted by GOP%
  const portfolioSummaries = portfolioQueries
    .map((q) => q.data ?? null)
    .filter(Boolean) as EntitySummary[];
  const sortedPortfolio = [...portfolioSummaries].sort(
    (a, b) => parseFloat(b.gopPct) - parseFloat(a.gopPct)
  );

  // Alerts
  const arRows = arAgeingQ.data ?? [];
  const overdueAR = arRows.filter(
    (r) => parseFloat(r.bucket61to90) > 0 || parseFloat(r.bucket91Plus) > 0
  );
  const overdueARTotal = overdueAR.reduce(
    (s, r) => s + parseFloat(r.bucket61to90) + parseFloat(r.bucket91Plus),
    0
  );

  const apInvoices = apDueQ.data ?? [];
  const overdueAP = apInvoices.filter((inv) => {
    const daysUntil = Math.ceil((new Date(inv.dueDate).getTime() - Date.now()) / 86400000);
    return daysUntil <= 0 && !["PAID", "CANCELLED"].includes(inv.status);
  });
  const overdueAPTotal = overdueAP.reduce((s, inv) => s + parseFloat(inv.grossAmount), 0);

  const openPeriods = periods.filter((p) => p.status === "OPEN");

  // YTD data
  const hasYTD = usaliComp?.hasYTD ?? false;
  const ytdRevenue = usaliComp ? parseFloat(usaliComp.ytdTotalRevenue) : 0;
  const ytdGOP = usaliComp ? parseFloat(usaliComp.ytdGOP) : 0;
  const ytdGOPPct = usaliComp ? parseFloat(usaliComp.ytdGOPPct) : 0;
  const ytdEBITDA = usaliComp ? parseFloat(usaliComp.ytdEBITDA) : 0;

  const isLoading =
    periodsQ.isLoading || revparQ.isLoading || usaliQ.isLoading || bsQ.isLoading || cfQ.isLoading;

  if (!apiContext) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Please log in to view the Directors Dashboard.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-3 px-6">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-primary">Directors Dashboard</span>
            <Badge variant="outline" className="text-[10px]">
              Board-Level Executive Summary
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
            <BigKPICard
              label="Total Revenue"
              value={usali ? fmt(totalRevenue) : "--"}
              sub={
                revenueYoY !== null
                  ? `${revenueYoY >= 0 ? "+" : ""}${revenueYoY.toFixed(1)}% vs prior year`
                  : "Current period"
              }
              accent="text-primary"
            />
            <BigKPICard
              label="EBITDA"
              value={usali ? fmt(ebitda) : "--"}
              sub={`Margin: ${ebitdaPct.toFixed(1)}%`}
              accent="text-blue-700"
            />
            <BigKPICard
              label="GOP"
              value={usali ? fmt(gop) : "--"}
              sub={`Margin: ${gopPct.toFixed(1)}%`}
              accent="text-emerald-700"
            />
            <BigKPICard
              label="Cash Position"
              value={cf ? fmt(cashPosition) : "--"}
              sub="Closing cash balance"
              accent={cashPosition >= 0 ? "text-emerald-700" : "text-red-600"}
            />
          </div>

          {/* ── Section 1: Executive Summary ── */}
          <SectionHeader title="Executive Summary" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="border-l-4 border-l-primary">
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Revenue
                </p>
                <p className="text-2xl font-bold text-primary mt-1">
                  {usali ? fmt(totalRevenue) : "--"}
                </p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-emerald-500">
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Profit (EBITDA)
                </p>
                <p className="text-2xl font-bold text-emerald-700 mt-1">
                  {usali ? fmt(ebitda) : "--"}
                </p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Cash
                </p>
                <p className="text-2xl font-bold text-blue-700 mt-1">
                  {cf ? fmt(cashPosition) : "--"}
                </p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-violet-500">
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Equity
                </p>
                <p className="text-2xl font-bold text-violet-700 mt-1">
                  {bs ? fmt(totalEquity) : "--"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* ── Section 2: Property Performance Ranking ── */}
          <SectionHeader title="Property Performance Ranking" />
          <Card>
            <CardContent className="p-0">
              {sortedPortfolio.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No property performance data available for this period.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          #
                        </th>
                        <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Property
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Revenue
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          GOP
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          GOP %
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          EBITDA
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          RevPAR
                        </th>
                        <th className="py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-36">
                          Performance
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sortedPortfolio.map((s, i) => {
                        const pct = parseFloat(s.gopPct);
                        const barWidth = Math.min(pct, 60);
                        return (
                          <tr key={s.entityId} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-4 text-slate-400 font-mono text-xs">
                              {i + 1}
                            </td>
                            <td className="py-2.5 px-4 text-slate-700 font-medium">
                              {s.entityName}
                              <span className="ml-1.5 text-[10px] text-muted-foreground font-mono">
                                {s.currency}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(s.totalRevenue)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-emerald-700 font-medium tabular-nums">
                              {fmt(s.grossOperatingProfit)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-bold tabular-nums ${gopColor(pct)}`}
                            >
                              {fmtPct(pct)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-blue-700 tabular-nums">
                              {fmt(s.ebitda)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(s.revpar)}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${gopBg(pct)}`}
                                    style={{
                                      width: `${Math.max((barWidth / 60) * 100, 3)}%`
                                    }}
                                  />
                                </div>
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

          {/* ── Section 3: Key Financial Ratios ── */}
          <SectionHeader title="Key Financial Ratios" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                label: "Debt / Equity",
                value: `${debtEquity.toFixed(2)}x`,
                ok: debtEquity <= 2.5,
                threshold: "Target: <= 2.5x"
              },
              {
                label: "Current Ratio",
                value: `${currentRatio > 100 ? ">100" : currentRatio.toFixed(2)}x`,
                ok: currentRatio >= 1.0,
                threshold: "Target: >= 1.0x"
              },
              {
                label: "Return on Equity",
                value: `${roe.toFixed(1)}%`,
                ok: roe > 0,
                threshold: "Target: > 0%"
              },
              {
                label: "EBITDA Margin",
                value: `${ebitdaPct.toFixed(1)}%`,
                ok: ebitdaPct >= 15,
                threshold: "Target: >= 15%"
              }
            ].map((ratio) => (
              <Card
                key={ratio.label}
                className={`border-l-4 ${ratio.ok ? "border-l-emerald-400 bg-emerald-50/30" : "border-l-red-400 bg-red-50/30"}`}
              >
                <CardContent className="pt-4 pb-3 px-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {ratio.label}
                  </p>
                  <p
                    className={`text-2xl font-bold mt-1 ${ratio.ok ? "text-emerald-700" : "text-red-600"}`}
                  >
                    {bs || usali ? ratio.value : "--"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">{ratio.threshold}</p>
                  {(bs || usali) && (
                    <Badge
                      variant={ratio.ok ? "outline" : "destructive"}
                      className="mt-1 text-[9px]"
                    >
                      {ratio.ok ? "Within target" : "Below target"}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── Section 4: Year-to-Date Highlights ── */}
          {hasYTD && (
            <>
              <SectionHeader title="Year-to-Date Highlights" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      YTD Revenue
                    </p>
                    <p className="text-2xl font-bold text-primary mt-1">{fmt(ytdRevenue)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      YTD EBITDA
                    </p>
                    <p className="text-2xl font-bold text-blue-700 mt-1">{fmt(ytdEBITDA)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      YTD GOP
                    </p>
                    <p className="text-2xl font-bold text-emerald-700 mt-1">{fmt(ytdGOP)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-3 px-4">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      YTD GOP %
                    </p>
                    <p className={`text-2xl font-bold mt-1 ${gopColor(ytdGOPPct)}`}>
                      {fmtPct(ytdGOPPct)}
                    </p>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {/* ── Section 5: Strategic Alerts ── */}
          <SectionHeader title="Strategic Alerts" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Periods needing close */}
            <Card
              className={`border-l-4 ${openPeriods.length > 1 ? "border-l-amber-400 bg-amber-50/40" : "border-l-emerald-400 bg-emerald-50/30"}`}
            >
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Periods Needing Close
                </p>
                <p
                  className={`text-2xl font-bold mt-1 ${openPeriods.length > 1 ? "text-amber-600" : "text-emerald-700"}`}
                >
                  {openPeriods.length}
                </p>
                {openPeriods.length > 1 ? (
                  <div className="mt-2 space-y-0.5">
                    {openPeriods.slice(0, 3).map((p) => (
                      <p key={p.id} className="text-xs text-amber-700">
                        {p.name}
                      </p>
                    ))}
                    {openPeriods.length > 3 && (
                      <p className="text-xs text-muted-foreground">
                        +{openPeriods.length - 3} more
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-emerald-600 mt-1">All periods up to date</p>
                )}
              </CardContent>
            </Card>

            {/* Overdue AP */}
            <Card
              className={`border-l-4 ${overdueAP.length > 0 ? "border-l-red-400 bg-red-50/40" : "border-l-emerald-400 bg-emerald-50/30"}`}
            >
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Overdue AP
                </p>
                <p
                  className={`text-2xl font-bold mt-1 ${overdueAP.length > 0 ? "text-red-600" : "text-emerald-700"}`}
                >
                  {overdueAP.length > 0 ? fmt(overdueAPTotal) : "0"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {overdueAP.length > 0
                    ? `${overdueAP.length} invoice${overdueAP.length !== 1 ? "s" : ""} overdue`
                    : "No overdue payables"}
                </p>
              </CardContent>
            </Card>

            {/* Overdue AR */}
            <Card
              className={`border-l-4 ${overdueAR.length > 0 ? "border-l-orange-400 bg-orange-50/40" : "border-l-emerald-400 bg-emerald-50/30"}`}
            >
              <CardContent className="pt-4 pb-3 px-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Overdue AR (60+ days)
                </p>
                <p
                  className={`text-2xl font-bold mt-1 ${overdueAR.length > 0 ? "text-orange-600" : "text-emerald-700"}`}
                >
                  {overdueAR.length > 0 ? fmt(overdueARTotal) : "0"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {overdueAR.length > 0
                    ? `${overdueAR.length} customer${overdueAR.length !== 1 ? "s" : ""} with overdue balances`
                    : "No overdue receivables"}
                </p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
