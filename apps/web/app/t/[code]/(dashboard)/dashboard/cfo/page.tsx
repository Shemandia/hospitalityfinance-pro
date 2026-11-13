"use client";

import { useQuery, useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getPeriods,
  getRevPAR,
  getBalanceSheet,
  getCashFlow,
  getUSALI,
  getCurrencyExposure,
  getEntities,
  getEntitySummary
} from "../../../../../../lib/gl-api";
import type { CurrencyExposureRow, EntitySummary } from "../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { fmt, fmtPct } from "../../../../../../lib/format";

// ── Types ────────────────────────────────────────────────────────────────────

type Period = { id: string; name: string; status: string; year: number; month: number };

type BalanceSheetData = {
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  assets: Array<{
    name: string;
    accounts: Array<{ code: string; name: string; balance: string }>;
    total: string;
  }>;
};

type CashFlowData = {
  operating: { total: string };
  investing: { total: string };
  financing: { total: string };
  netChange: string;
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

type PortfolioEntity = { id: string; name: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

function pctColor(n: number) {
  if (n >= 35) return "text-emerald-600";
  if (n >= 20) return "text-amber-600";
  return "text-red-600";
}

// ── Components ───────────────────────────────────────────────────────────────

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
    <div className="flex-1 min-w-[160px] bg-muted/40 rounded-lg px-4 py-3 border border-border/40">
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

export default function CFODashboardPage() {
  const apiContext = useApiContext();
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

  // Balance Sheet
  const bsQ = useQuery({
    queryKey: ["kpi-bs", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getBalanceSheet(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    select: (r: any): BalanceSheetData | null => r.data ?? null
  });

  // Cash Flow
  const cfQ = useQuery({
    queryKey: ["kpi-cf", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getCashFlow(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    select: (r: any): CashFlowData | null => r.data ?? null
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

  // Currency Exposure
  const currencyExposureQ = useQuery({
    queryKey: ["currency-exposure", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => (apiContext ? getCurrencyExposure(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: any) => (r.data ?? []) as CurrencyExposureRow[]
  });

  // Portfolio entities
  const entitiesQ = useQuery({
    queryKey: ["portfolio-entities", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => (apiContext ? getEntities(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: any) =>
      ((r.data ?? []) as Array<{ id: string; name: string; type: string }>).filter(
        (e) => e.type === "PROPERTY"
      )
  });
  const portfolioEntities: PortfolioEntity[] = entitiesQ.data ?? [];

  const portfolioQueries = useQueries({
    queries: portfolioEntities.map((entity) => ({
      queryKey: ["entity-summary", entity.id, activePeriod?.year, activePeriod?.month],
      queryFn: () =>
        apiContext && activePeriod
          ? getEntitySummary(apiContext, entity.id, activePeriod.year, activePeriod.month)
          : Promise.resolve({ data: null }),
      enabled: Boolean(apiContext && activePeriod && portfolioEntities.length > 0),
      select: (r: any) => r.data as EntitySummary | null
    }))
  });

  const bs = bsQ.data;
  const cf = cfQ.data;
  const usali = usaliQ.data;
  const currencyExposure = currencyExposureQ.data ?? [];
  const portfolioSummaries = portfolioQueries.map((q) => q.data ?? null);
  const validPortfolio = portfolioSummaries.filter(Boolean) as EntitySummary[];

  // Derived KPI values
  const totalAssets = bs ? parseFloat(bs.totalAssets) : 0;
  const totalLiabilities = bs ? parseFloat(bs.totalLiabilities) : 0;
  const totalEquity = bs ? parseFloat(bs.totalEquity) : 0;
  const netChange = cf ? parseFloat(cf.netChange) : 0;
  const ebitda = usali ? parseFloat(usali.ebitda) : 0;
  const debtEquity = totalEquity !== 0 ? totalLiabilities / Math.abs(totalEquity) : 0;
  const equityRatio = totalAssets !== 0 ? (totalEquity / totalAssets) * 100 : 0;

  const isLoading = periodsQ.isLoading || bsQ.isLoading;

  return (
    <div className="space-y-4">
      {/* Header + Period Selector */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-3 px-6">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary">
              Chief Finance Officer Dashboard
            </span>
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
          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard
              label="Total Assets"
              value={bs ? fmt(totalAssets) : "--"}
              sub="Group balance"
            />
            <KPICard
              label="Total Liabilities"
              value={bs ? fmt(totalLiabilities) : "--"}
              sub="Group obligations"
              accent="text-red-600"
            />
            <KPICard
              label="Total Equity"
              value={bs ? fmt(totalEquity) : "--"}
              sub="Net worth"
              accent="text-blue-700"
            />
            <KPICard
              label="Net Cash Change"
              value={cf ? fmt(netChange) : "--"}
              sub="Period movement"
              accent={netChange >= 0 ? "text-emerald-700" : "text-red-600"}
            />
            <KPICard
              label="EBITDA"
              value={usali ? fmt(ebitda) : "--"}
              sub="Operating profit"
              accent={ebitda > 0 ? "text-emerald-700" : "text-red-600"}
            />
            <KPICard
              label="Debt/Equity"
              value={bs ? `${debtEquity.toFixed(2)}x` : "--"}
              sub="Leverage ratio"
              accent={debtEquity <= 2.5 ? "text-emerald-700" : "text-red-600"}
            />
          </div>

          {/* ── 1. Portfolio Overview ── */}
          <SectionHeader title="Portfolio Overview" />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-primary text-base">
                Property Performance Summary
                {activePeriod && (
                  <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                    {activePeriod.name}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {validPortfolio.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No portfolio data available for this period.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Property
                        </th>
                        {["Occupancy", "RevPAR", "Revenue", "GOP", "GOP%", "EBITDA"].map((c) => (
                          <th
                            key={c}
                            className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {validPortfolio.map((s) => {
                        const gopPctVal = parseFloat(s.gopPct);
                        return (
                          <tr key={s.entityId} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-4 text-slate-700 font-medium">
                              {s.entityName}
                              <span className="ml-1.5 text-[10px] text-muted-foreground font-mono">
                                {s.currency}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmtPct(s.occupancyPct)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(s.revpar, 0)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-700 tabular-nums">
                              {fmt(s.totalRevenue)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-emerald-700 font-medium tabular-nums">
                              {fmt(s.grossOperatingProfit)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-medium tabular-nums ${pctColor(
                                gopPctVal
                              )}`}
                            >
                              {fmtPct(gopPctVal)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-blue-700 tabular-nums">
                              {fmt(s.ebitda)}
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

          {/* ── 2. Covenant Monitoring ── */}
          <SectionHeader title="Covenant Monitoring" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              {
                label: "Debt / Equity",
                value: bs ? `${debtEquity.toFixed(2)}x` : "--",
                ok: debtEquity <= 2.5,
                threshold: "\u2264 2.5x",
                note: "Leverage covenant"
              },
              {
                label: "Equity Ratio",
                value: bs ? `${equityRatio.toFixed(1)}%` : "--",
                ok: equityRatio >= 30,
                threshold: "\u2265 30%",
                note: "Capital adequacy"
              },
              {
                label: "EBITDA",
                value: usali ? fmt(ebitda) : "--",
                ok: ebitda > 0,
                threshold: "> 0",
                note: "Operating profitability"
              }
            ].map((r) => (
              <Card
                key={r.label}
                className={`border-l-4 ${r.ok ? "border-l-emerald-500" : "border-l-red-500"}`}
              >
                <CardContent className="py-4 px-5">
                  <div className={`rounded-lg p-3 ${r.ok ? "bg-emerald-50/40" : "bg-red-50/40"}`}>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {r.label}
                    </p>
                    <p
                      className={`text-2xl font-bold mt-0.5 ${
                        r.ok ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {r.value}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">{r.note}</p>
                    <p
                      className={`text-[10px] font-medium mt-0.5 ${
                        r.ok ? "text-emerald-600" : "text-red-600"
                      }`}
                    >
                      {r.ok ? "Within limit" : "BREACHED"} ({r.threshold})
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── 3. Currency Exposure ── */}
          <SectionHeader title="Currency Exposure" />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-primary text-base">Foreign Currency Position</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {currencyExposure.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No open foreign currency positions.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200">
                        <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Currency
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          AR Outstanding
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          AP Outstanding
                        </th>
                        <th className="py-2 px-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                          Net Exposure
                        </th>
                        <th className="py-2 px-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-40">
                          Position
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {currencyExposure.map((row) => {
                        const net = parseFloat(row.netExposure);
                        const ar = parseFloat(row.arOutstanding);
                        const ap = parseFloat(row.apOutstanding);
                        const maxVal = Math.max(ar, ap, 1);
                        return (
                          <tr key={row.currency} className="hover:bg-slate-50/60">
                            <td className="py-2.5 px-4 font-mono font-semibold text-slate-700">
                              {row.currency}
                            </td>
                            <td className="py-2.5 px-3 text-right text-emerald-700 tabular-nums">
                              {fmt(row.arOutstanding)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-red-600 tabular-nums">
                              {fmt(row.apOutstanding)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-semibold tabular-nums ${
                                net >= 0 ? "text-emerald-700" : "text-red-600"
                              }`}
                            >
                              {net >= 0 ? "+" : ""}
                              {fmt(net)}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="flex gap-0.5 h-3">
                                <div
                                  className="bg-emerald-500 rounded-l"
                                  style={{ width: `${(ar / maxVal) * 50}%` }}
                                  title={`AR: ${fmt(ar)}`}
                                />
                                <div
                                  className="bg-red-500 rounded-r"
                                  style={{ width: `${(ap / maxVal) * 50}%` }}
                                  title={`AP: ${fmt(ap)}`}
                                />
                              </div>
                              <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
                                <span>AR</span>
                                <span>AP</span>
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

          {/* ── 4. Cash Flow Summary ── */}
          <SectionHeader title="Cash Flow Summary" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              {
                label: "Operating CF",
                value: cf ? parseFloat(cf.operating.total) : 0,
                color: "border-l-emerald-500"
              },
              {
                label: "Investing CF",
                value: cf ? parseFloat(cf.investing.total) : 0,
                color: "border-l-blue-500"
              },
              {
                label: "Financing CF",
                value: cf ? parseFloat(cf.financing.total) : 0,
                color: "border-l-purple-500"
              }
            ].map((item) => (
              <Card key={item.label} className={`border-l-4 ${item.color}`}>
                <CardContent className="py-4 px-5">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {item.label}
                  </p>
                  <p
                    className={`text-2xl font-bold mt-1 ${
                      cf
                        ? item.value >= 0
                          ? "text-emerald-700"
                          : "text-red-600"
                        : "text-muted-foreground"
                    }`}
                  >
                    {cf ? fmt(item.value) : "--"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {item.value >= 0 ? "Inflow" : "Outflow"} this period
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Net Cash Change */}
          {cf && (
            <Card className="border-t-4 border-t-slate-800">
              <CardContent className="flex items-center justify-between py-3 px-6">
                <span className="text-sm font-semibold text-slate-600">
                  Net Cash Change (Period)
                </span>
                <span
                  className={`text-xl font-bold ${
                    netChange >= 0 ? "text-emerald-700" : "text-red-600"
                  }`}
                >
                  {netChange >= 0 ? "+" : ""}
                  {fmt(netChange)}
                </span>
              </CardContent>
            </Card>
          )}

          {/* ── 5. Balance Sheet Structure ── */}
          <SectionHeader title="Balance Sheet Structure" />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-primary text-base">
                Assets vs Liabilities + Equity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!bs ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No balance sheet data available for this period.
                </p>
              ) : (
                <div className="space-y-4">
                  {/* Assets bar */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-600">Total Assets</span>
                      <span className="text-sm font-bold text-primary tabular-nums">
                        {fmt(totalAssets)}
                      </span>
                    </div>
                    <div className="h-6 w-full bg-slate-200 rounded-md overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-md flex items-center justify-center"
                        style={{ width: "100%" }}
                      >
                        <span className="text-[10px] font-bold text-white">100%</span>
                      </div>
                    </div>
                  </div>

                  {/* Liabilities + Equity split bar */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-600">
                        Liabilities + Equity
                      </span>
                      <span className="text-sm font-bold text-primary tabular-nums">
                        {fmt(totalLiabilities + totalEquity)}
                      </span>
                    </div>
                    {(() => {
                      const total = totalLiabilities + totalEquity;
                      const isNegativeEquity = totalEquity < 0;
                      const liabPct =
                        total > 0
                          ? Math.max(0, Math.min(100, (totalLiabilities / total) * 100))
                          : 50;
                      const eqPct =
                        total > 0 ? Math.max(0, Math.min(100, (totalEquity / total) * 100)) : 50;
                      return (
                        <>
                          {isNegativeEquity && (
                            <div className="mb-2 flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-md px-2.5 py-1.5">
                              <span className="font-semibold">Negative equity position</span>
                              <span className="text-amber-500">
                                — liabilities exceed total assets
                              </span>
                            </div>
                          )}
                          <div className="h-6 w-full bg-slate-200 rounded-md overflow-hidden flex">
                            <div
                              className="h-full bg-red-500 flex items-center justify-center"
                              style={{ width: `${isNegativeEquity ? 100 : liabPct}%` }}
                            >
                              {(isNegativeEquity || liabPct > 15) && (
                                <span className="text-[10px] font-bold text-white">
                                  {isNegativeEquity ? "100" : liabPct.toFixed(0)}%
                                </span>
                              )}
                            </div>
                            {!isNegativeEquity && (
                              <div
                                className="h-full bg-blue-500 flex items-center justify-center"
                                style={{ width: `${eqPct}%` }}
                              >
                                {eqPct > 15 && (
                                  <span className="text-[10px] font-bold text-white">
                                    {eqPct.toFixed(0)}%
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-4 mt-2">
                            <div className="flex items-center gap-1.5">
                              <div className="w-3 h-3 rounded bg-red-500" />
                              <span className="text-xs text-slate-600">
                                Liabilities: {fmt(totalLiabilities)} ({liabPct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="w-3 h-3 rounded bg-blue-500" />
                              <span className="text-xs text-slate-600">
                                Equity: {fmt(totalEquity)} ({eqPct.toFixed(1)}%)
                              </span>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Equity ratio bar */}
                  <div className="pt-2 border-t border-slate-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-slate-600">Equity Ratio</span>
                      <span
                        className={`text-sm font-bold tabular-nums ${
                          equityRatio >= 30 ? "text-emerald-700" : "text-red-600"
                        }`}
                      >
                        {equityRatio.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden relative">
                      <div
                        className={`h-full rounded-full ${
                          equityRatio >= 30 ? "bg-emerald-500" : "bg-red-500"
                        }`}
                        style={{ width: `${Math.min(equityRatio, 100)}%` }}
                      />
                      {/* 30% threshold marker */}
                      <div
                        className="absolute top-0 h-full w-px bg-slate-800"
                        style={{ left: "30%" }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Threshold: 30% minimum
                      {equityRatio >= 30 ? " -- Within limit" : " -- Below threshold"}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
