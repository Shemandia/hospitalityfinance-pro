"use client";

import { useQuery, useQueries } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveLine } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import { useApiContext } from "../../../components/use-api-context";
import {
  getBalanceSheet,
  getCashFlow,
  getPeriods,
  getRevPAR,
  getRevPARTrend,
  getUSALI,
  getUSALIComparative,
  getARAgeing,
  getAPInvoicesDue,
  getCurrencyExposure,
  getEntitySummary,
  getEntities
} from "../../../lib/gl-api";
import type { CurrencyExposureRow, EntitySummary } from "../../../lib/gl-api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../components/ui/select";
import { Separator } from "../../../components/ui/separator";

// ── Types ─────────────────────────────────────────────────────────────────────

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
type TrendPoint = { date: string; revpar: string; adr: string; occupancyPct: string };
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

type PortfolioEntity = { id: string; name: string };

const COLORS = ["#0e7c7b", "#0369a1", "#7c3aed", "#b45309", "#047857", "#dc2626"];

function fmt(n: string | number, d = 0) {
  return parseFloat(String(n)).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
}

function fmtPct(n: string | number) {
  return `${parseFloat(String(n)).toFixed(1)}%`;
}

function pctColor(n: number) {
  if (n >= 35) return "text-emerald-600";
  if (n >= 20) return "text-amber-600";
  return "text-red-600";
}

// ── Small components ──────────────────────────────────────────────────────────

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

// ── AR Ageing Chart ───────────────────────────────────────────────────────────

function ARAgeingChart({ rows }: { rows: AgeingRow[] }) {
  const barData = rows.map((r) => ({
    customer: r.customerName.slice(0, 16),
    "0–30": parseFloat(r.bucket0to30),
    "31–60": parseFloat(r.bucket31to60),
    "61–90": parseFloat(r.bucket61to90),
    "91+": parseFloat(r.bucket91Plus)
  }));
  const totals = {
    "0–30": rows.reduce((s, r) => s + parseFloat(r.bucket0to30), 0),
    "31–60": rows.reduce((s, r) => s + parseFloat(r.bucket31to60), 0),
    "61–90": rows.reduce((s, r) => s + parseFloat(r.bucket61to90), 0),
    "91+": rows.reduce((s, r) => s + parseFloat(r.bucket91Plus), 0)
  };
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-primary text-base">AR Ageing</CardTitle>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>
              0–30: <strong className="text-emerald-700">{fmt(totals["0–30"])}</strong>
            </span>
            <span>
              31–60: <strong className="text-amber-600">{fmt(totals["31–60"])}</strong>
            </span>
            <span>
              61–90: <strong className="text-orange-600">{fmt(totals["61–90"])}</strong>
            </span>
            <span>
              91+: <strong className="text-red-700">{fmt(totals["91+"])}</strong>
            </span>
            <span className="font-bold text-foreground">Total: {fmt(grandTotal)}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No outstanding AR invoices.
          </p>
        ) : (
          <div className="h-52">
            <ResponsiveBar
              data={barData}
              keys={["0–30", "31–60", "61–90", "91+"]}
              indexBy="customer"
              layout="horizontal"
              margin={{ top: 4, right: 16, bottom: 24, left: 110 }}
              padding={0.3}
              colors={["#059669", "#d97706", "#ea580c", "#dc2626"]}
              axisBottom={{ format: (v) => `${(Number(v) / 1000).toFixed(0)}k` }}
              tooltip={({ id, value, indexValue }) => (
                <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                  {indexValue} · {id}: <strong>{fmt(value)}</strong>
                </div>
              )}
              legends={[
                {
                  anchor: "bottom-right",
                  direction: "row",
                  itemWidth: 55,
                  itemHeight: 14,
                  dataFrom: "keys",
                  symbolSize: 10,
                  translateY: 24
                }
              ]}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── AP Due This Week ──────────────────────────────────────────────────────────

function APDueWidget({ invoices }: { invoices: APInvoice[] }) {
  const outstanding = invoices.filter((i) => !["PAID", "CANCELLED", "DRAFT"].includes(i.status));
  const total = outstanding.reduce((s, i) => s + parseFloat(i.grossAmount), 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-primary text-base">AP Due This Week</CardTitle>
          <span className="text-sm font-bold text-red-700">{fmt(total)}</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {outstanding.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No AP invoices due this week.
          </p>
        ) : (
          <div className="divide-y divide-slate-50">
            {outstanding.slice(0, 6).map((inv) => {
              const daysUntil = Math.ceil(
                (new Date(inv.dueDate).getTime() - Date.now()) / 86400000
              );
              return (
                <div key={inv.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      {(inv.supplier as any)?.name ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {inv.invoiceNumber} · Due {new Date(inv.dueDate).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-slate-800">
                      {inv.currency} {fmt(inv.grossAmount)}
                    </p>
                    <Badge
                      variant={
                        daysUntil <= 1 ? "destructive" : daysUntil <= 3 ? "secondary" : "outline"
                      }
                      className="text-[10px]"
                    >
                      {daysUntil <= 0 ? "Overdue" : `${daysUntil}d`}
                    </Badge>
                  </div>
                </div>
              );
            })}
            {outstanding.length > 6 && (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                +{outstanding.length - 6} more…
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Bank Balance Summary ──────────────────────────────────────────────────────

function BankBalanceSummary({ bs }: { bs: BalanceSheetData | null | undefined }) {
  const cashSection = bs?.assets.find((s) => s.name === "Cash & Cash Equivalents");
  const accounts = cashSection?.accounts ?? [];
  const total = accounts.reduce((s, a) => s + parseFloat(a.balance), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-primary text-base">Bank Balances</CardTitle>
          <span className="text-sm font-bold text-emerald-700">{fmt(total)}</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No cash accounts found.</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {accounts.map((a) => {
              const bal = parseFloat(a.balance);
              return (
                <div key={a.code} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm text-slate-700">{a.name}</p>
                    <p className="text-xs font-mono text-slate-400">{a.code}</p>
                  </div>
                  <span
                    className={`text-sm font-semibold tabular-nums ${bal >= 0 ? "text-emerald-700" : "text-red-600"}`}
                  >
                    {fmt(bal)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Revenue vs Budget Sparklines ──────────────────────────────────────────────

function RevenueBudgetChart({ usaliComparative }: { usaliComparative: any }) {
  if (!usaliComparative) return null;
  const depts = usaliComparative.departments ?? [];
  if (depts.length === 0) return null;

  const barData = depts.map((d: any) => ({
    dept: d.name.slice(0, 12),
    Actual: parseFloat(d.revenue),
    Budget: parseFloat(d.budgetRevenue)
  }));

  const hasBudget = usaliComparative.hasBudget;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-primary text-base">
          Revenue vs Budget
          {!hasBudget && (
            <Badge variant="outline" className="ml-2 text-[10px] text-amber-600 border-amber-300">
              No budget loaded
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-52">
          <ResponsiveBar
            data={barData}
            keys={hasBudget ? ["Actual", "Budget"] : ["Actual"]}
            indexBy="dept"
            margin={{ top: 8, right: 16, bottom: 40, left: 60 }}
            padding={0.25}
            groupMode="grouped"
            colors={["#0e7c7b", "#d1d5db"]}
            axisLeft={{ format: (v) => `${(Number(v) / 1000).toFixed(0)}k` }}
            axisBottom={{ tickRotation: -20 }}
            tooltip={({ id, value, indexValue }) => (
              <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                {indexValue} · {id}: <strong>{fmt(value)}</strong>
              </div>
            )}
            legends={
              hasBudget
                ? [
                    {
                      anchor: "top-right",
                      direction: "row",
                      itemWidth: 70,
                      itemHeight: 14,
                      dataFrom: "keys",
                      symbolSize: 10
                    }
                  ]
                : []
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Portfolio Table ────────────────────────────────────────────────────────────

function PortfolioTable({ summaries }: { summaries: Array<EntitySummary | null> }) {
  const valid = summaries.filter(Boolean) as EntitySummary[];

  if (valid.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          No portfolio data available for this period.
        </CardContent>
      </Card>
    );
  }

  const cols = ["Occupancy", "ADR", "RevPAR", "Revenue", "GOP", "GOP%", "EBITDA"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-primary text-base">Portfolio Summary</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200">
                <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Property
                </th>
                {cols.map((c) => (
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
              {valid.map((s) => {
                const gopPct = parseFloat(s.gopPct);
                return (
                  <tr key={s.entityId} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-4 text-slate-700 font-medium">
                      {s.entityName}
                      <span className="ml-1.5 text-[10px] text-muted-foreground font-mono">
                        {s.currency}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700">
                      {fmtPct(s.occupancyPct)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700">{fmt(s.adr, 0)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-700">{fmt(s.revpar, 0)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-700">{fmt(s.totalRevenue)}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-700 font-medium">
                      {fmt(s.grossOperatingProfit)}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-medium ${pctColor(gopPct)}`}>
                      {fmtPct(gopPct)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-blue-700">{fmt(s.ebitda)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Currency Exposure ─────────────────────────────────────────────────────────

function CurrencyExposureChart({ rows }: { rows: CurrencyExposureRow[] }) {
  const filtered = rows.filter((r) => Math.abs(parseFloat(r.netExposure)) > 0.01);
  const barData = filtered.map((r) => ({
    currency: r.currency,
    AR: parseFloat(r.arOutstanding),
    AP: parseFloat(r.apOutstanding),
    Net: parseFloat(r.netExposure)
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-primary text-base">Currency Exposure</CardTitle>
      </CardHeader>
      <CardContent>
        {barData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No open foreign currency positions.
          </p>
        ) : (
          <>
            <div className="h-48">
              <ResponsiveBar
                data={barData}
                keys={["AR", "AP"]}
                indexBy="currency"
                margin={{ top: 8, right: 16, bottom: 28, left: 70 }}
                padding={0.35}
                groupMode="grouped"
                colors={["#0e7c7b", "#dc2626"]}
                axisLeft={{ format: (v) => `${(Number(v) / 1000).toFixed(0)}k` }}
                tooltip={({ id, value, indexValue }) => (
                  <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                    {indexValue} · {id}: <strong>{fmt(value)}</strong>
                  </div>
                )}
                legends={[
                  {
                    anchor: "top-right",
                    direction: "row",
                    itemWidth: 50,
                    itemHeight: 14,
                    dataFrom: "keys",
                    symbolSize: 10
                  }
                ]}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              {filtered.map((r) => {
                const net = parseFloat(r.netExposure);
                return (
                  <div key={r.currency} className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono font-semibold text-slate-600">{r.currency}</span>
                    <span className={`font-bold ${net >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {net >= 0 ? "+" : ""}
                      {fmt(net)}
                    </span>
                    <span className="text-muted-foreground">net</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Covenant Ratios ───────────────────────────────────────────────────────────

function CovenantRatios({
  bs,
  cf,
  usali
}: {
  bs: BalanceSheetData | null | undefined;
  cf: CashFlowData | null | undefined;
  usali: USALIData | null | undefined;
}) {
  if (!bs) return null;

  const assets = parseFloat(bs.totalAssets);
  const liabilities = parseFloat(bs.totalLiabilities);
  const equity = parseFloat(bs.totalEquity);

  // Current assets = cash + AR (codes 10xx–14xx) from balance sheet sections
  const currentAssets = (bs.assets ?? [])
    .filter((s) =>
      [
        "Cash & Cash Equivalents",
        "Accounts Receivable",
        "Inventories",
        "Prepaid Expenses"
      ].includes(s.name)
    )
    .reduce((s, section) => s + parseFloat(section.total), 0);

  const debtEquity = equity !== 0 ? liabilities / Math.abs(equity) : 0;
  const equityRatio = assets !== 0 ? (equity / assets) * 100 : 0;
  const ebitda = usali ? parseFloat(usali.ebitda) : 0;

  const ratios = [
    {
      label: "Debt / Equity",
      value: debtEquity.toFixed(2) + "x",
      ok: debtEquity <= 2.5,
      threshold: "≤ 2.5x",
      note: "Leverage covenant"
    },
    {
      label: "Equity Ratio",
      value: `${equityRatio.toFixed(1)}%`,
      ok: equityRatio >= 30,
      threshold: "≥ 30%",
      note: "Capital adequacy"
    },
    {
      label: "EBITDA",
      value: fmt(ebitda),
      ok: ebitda > 0,
      threshold: "> 0",
      note: "Operating profitability"
    }
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-primary text-base">Covenant Ratios</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {ratios.map((r) => (
            <div
              key={r.label}
              className={`rounded-lg border p-3 ${r.ok ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/40"}`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {r.label}
              </p>
              <p
                className={`text-xl font-bold mt-0.5 ${r.ok ? "text-emerald-700" : "text-red-600"}`}
              >
                {r.value}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">{r.note}</p>
              <p
                className={`text-[10px] font-medium mt-0.5 ${r.ok ? "text-emerald-600" : "text-red-600"}`}
              >
                {r.ok ? "✓ Within limit" : "⚠ Breached"} ({r.threshold})
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const apiContext = useApiContext();
  const [roleView, setRoleView] = useState<"GM" | "CONTROLLER" | "CFO">("GM");
  const [periodId, setPeriodId] = useState("");

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

  // Common queries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revparQ = useQuery({
    queryKey: ["kpi-revpar", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getRevPAR(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    select: (r: any): RevPARData | null => r.data ?? null
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usaliQ = useQuery({
    queryKey: ["kpi-usali", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getUSALI(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId),
    select: (r: any): USALIData | null => r.data ?? null
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bsQ = useQuery({
    queryKey: ["kpi-bs", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getBalanceSheet(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId) && roleView !== "GM",
    select: (r: any): BalanceSheetData | null => r.data ?? null
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfQ = useQuery({
    queryKey: ["kpi-cf", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getCashFlow(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId) && roleView === "CFO",
    select: (r: any): CashFlowData | null => r.data ?? null
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendQ = useQuery({
    queryKey: ["kpi-trend", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getRevPARTrend(apiContext, activePeriodId)
        : Promise.resolve({ data: [] }),
    enabled: Boolean(apiContext && activePeriodId) && roleView === "GM",
    select: (r: any): TrendPoint[] => r.data ?? []
  });

  // Controller-specific queries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arAgeingQ = useQuery({
    queryKey: ["ar-ageing", apiContext?.entityId],
    queryFn: () =>
      apiContext ? getARAgeing(apiContext) : Promise.resolve({ data: { asOfDate: "", data: [] } }),
    enabled: Boolean(apiContext) && roleView === "CONTROLLER",
    select: (r: any) => (r.data?.data ?? []) as AgeingRow[]
  });

  const nextWeek = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  }, []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apDueQ = useQuery({
    queryKey: ["ap-due", apiContext?.entityId, nextWeek],
    queryFn: () =>
      apiContext ? getAPInvoicesDue(apiContext, nextWeek) : Promise.resolve({ data: [] }),
    enabled: Boolean(apiContext) && roleView === "CONTROLLER",
    select: (r: any) => (r.data ?? []) as APInvoice[]
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usaliComparativeQ = useQuery({
    queryKey: ["usali-comparative", apiContext?.entityId, activePeriodId],
    queryFn: () =>
      apiContext && activePeriodId
        ? getUSALIComparative(apiContext, activePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && activePeriodId) && roleView === "CONTROLLER",
    select: (r: any) => r.data ?? null
  });

  // CFO-specific queries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currencyExposureQ = useQuery({
    queryKey: ["currency-exposure", apiContext?.entityId],
    queryFn: () => (apiContext ? getCurrencyExposure(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext) && roleView === "CFO",
    select: (r: any) => (r.data ?? []) as CurrencyExposureRow[]
  });

  // Load portfolio entities dynamically (all entities the user has access to)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entitiesQ = useQuery({
    queryKey: ["portfolio-entities", apiContext?.entityId],
    queryFn: () => (apiContext ? getEntities(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext) && roleView === "CFO",
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
      enabled: Boolean(
        apiContext && activePeriod && roleView === "CFO" && portfolioEntities.length > 0
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select: (r: any) => r.data as EntitySummary | null
    }))
  });

  const revpar = revparQ.data as RevPARData | null | undefined;
  const usali = usaliQ.data as USALIData | null | undefined;
  const bs = bsQ.data as BalanceSheetData | null | undefined;
  const cf = cfQ.data as CashFlowData | null | undefined;

  const deptBarData = (usali?.departments ?? []).map((d) => ({
    department: d.name.slice(0, 14),
    Revenue: parseFloat(d.revenue),
    Income: parseFloat(d.departmentalIncome)
  }));

  const cfPieData = cf
    ? [
        {
          id: "Operating",
          label: "Operating",
          value: Math.abs(parseFloat(cf.operating.total)),
          color: "#0e7c7b"
        },
        {
          id: "Investing",
          label: "Investing",
          value: Math.abs(parseFloat(cf.investing.total)),
          color: "#0369a1"
        },
        {
          id: "Financing",
          label: "Financing",
          value: Math.abs(parseFloat(cf.financing.total)),
          color: "#7c3aed"
        }
      ].filter((d) => d.value > 0)
    : [];

  const bsPieData = bs
    ? [
        { id: "Assets", label: "Assets", value: parseFloat(bs.totalAssets), color: "#0e7c7b" },
        {
          id: "Liabilities",
          label: "Liabilities",
          value: parseFloat(bs.totalLiabilities),
          color: "#dc2626"
        },
        { id: "Equity", label: "Equity", value: parseFloat(bs.totalEquity), color: "#0369a1" }
      ].filter((d) => d.value > 0)
    : [];

  const revenuePieData = (usali?.departments ?? [])
    .filter((d) => parseFloat(d.revenue) > 0)
    .map((d, i) => ({
      id: d.name,
      label: d.name,
      value: parseFloat(d.revenue),
      color: COLORS[i % COLORS.length]
    }));

  const trendPoints = trendQ.data ?? [];
  const revparLineData =
    trendPoints.length > 0
      ? [
          {
            id: "RevPAR",
            color: "#0e7c7b",
            data: trendPoints.map((p) => ({ x: p.date.slice(5), y: parseFloat(p.revpar) }))
          },
          {
            id: "ADR",
            color: "#0369a1",
            data: trendPoints.map((p) => ({ x: p.date.slice(5), y: parseFloat(p.adr) }))
          }
        ]
      : [];
  const occupancyLineData =
    trendPoints.length > 0
      ? [
          {
            id: "Occupancy %",
            color: "#7c3aed",
            data: trendPoints.map((p) => ({ x: p.date.slice(5), y: parseFloat(p.occupancyPct) }))
          }
        ]
      : [];

  const portfolioSummaries = portfolioQueries.map((q) => q.data ?? null);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-3 px-6">
          <span className="text-sm font-semibold text-primary">Dashboard View:</span>
          <div className="flex gap-1.5">
            {(["GM", "CONTROLLER", "CFO"] as const).map((role) => (
              <Button
                key={role}
                size="sm"
                variant={roleView === role ? "teal" : "outline"}
                onClick={() => setRoleView(role)}
              >
                {role === "GM" ? "General Manager" : role === "CONTROLLER" ? "Controller" : "CFO"}
              </Button>
            ))}
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

      {/* ── GM View ── */}
      {roleView === "GM" && (
        <>
          <div className="flex flex-wrap gap-3">
            <KPICard
              label="Occupancy"
              value={revpar ? `${fmt(revpar.occupancyPct, 1)}%` : "–"}
              sub="Occupied / Available"
            />
            <KPICard label="ADR" value={revpar ? fmt(revpar.adr) : "–"} sub="Average Daily Rate" />
            <KPICard
              label="RevPAR"
              value={revpar ? fmt(revpar.revpar) : "–"}
              sub="Rev per Available Room"
            />
            <KPICard
              label="TRevPAR"
              value={revpar ? fmt(revpar.trevpar) : "–"}
              sub="Total Rev per Avail. Room"
            />
            <KPICard
              label="GOP %"
              value={revpar ? `${fmt(revpar.gopPct, 1)}%` : "–"}
              sub="Gross Operating Profit"
              accent="text-emerald-700"
            />
            <KPICard
              label="F&B Cost %"
              value={revpar ? `${fmt(revpar.fbCostPct, 1)}%` : "–"}
              sub="Food & Bev Cost Ratio"
            />
          </div>

          {revparLineData.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-primary text-base">
                    RevPAR &amp; ADR Trend
                    {revpar?.periodName ? (
                      <Badge variant="info" className="ml-2 font-normal">
                        {revpar.periodName}
                      </Badge>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-56">
                    <ResponsiveLine
                      data={revparLineData}
                      margin={{ top: 8, right: 80, bottom: 36, left: 52 }}
                      xScale={{ type: "point" }}
                      yScale={{ type: "linear", min: "auto", max: "auto" }}
                      curve="monotoneX"
                      colors={({ color }) => color}
                      pointSize={4}
                      pointBorderWidth={1}
                      pointBorderColor={{ from: "serieColor" }}
                      enableArea={false}
                      axisBottom={{
                        tickRotation: -45,
                        tickValues:
                          revparLineData[0].data.length > 14
                            ? revparLineData[0].data.filter((_, i) => i % 7 === 0).map((p) => p.x)
                            : undefined
                      }}
                      axisLeft={{ format: (v) => `${Number(v).toFixed(0)}` }}
                      tooltip={({ point }) => (
                        <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                          {point.seriesId}: <strong>{fmt(point.data.y as number)}</strong>
                        </div>
                      )}
                      legends={[
                        {
                          anchor: "top-right",
                          direction: "column",
                          itemWidth: 70,
                          itemHeight: 16,
                          translateX: 80,
                          symbolSize: 10
                        }
                      ]}
                    />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-primary text-base">Occupancy % Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-56">
                    <ResponsiveLine
                      data={occupancyLineData}
                      margin={{ top: 8, right: 20, bottom: 36, left: 52 }}
                      xScale={{ type: "point" }}
                      yScale={{ type: "linear", min: 0, max: 100 }}
                      curve="monotoneX"
                      colors={["#7c3aed"]}
                      enableArea
                      areaOpacity={0.12}
                      pointSize={4}
                      pointBorderWidth={1}
                      pointBorderColor={{ from: "serieColor" }}
                      axisBottom={{
                        tickRotation: -45,
                        tickValues:
                          occupancyLineData[0].data.length > 14
                            ? occupancyLineData[0].data
                                .filter((_, i) => i % 7 === 0)
                                .map((p) => p.x)
                            : undefined
                      }}
                      axisLeft={{ format: (v) => `${v}%` }}
                      tooltip={({ point }) => (
                        <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                          Occupancy: <strong>{fmt(point.data.y as number, 1)}%</strong>
                        </div>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {usali ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {revenuePieData.length > 0 ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-primary text-base">Revenue Mix</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-60">
                      <ResponsivePie
                        data={revenuePieData}
                        margin={{ top: 16, right: 80, bottom: 16, left: 80 }}
                        innerRadius={0.45}
                        padAngle={1.5}
                        colors={{ datum: "data.color" }}
                        arcLabel={(d) =>
                          `${((d.value / parseFloat(usali.totalRevenue)) * 100).toFixed(0)}%`
                        }
                        arcLabelsSkipAngle={12}
                        tooltip={({ datum }) => (
                          <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                            {datum.label}: <strong>{fmt(datum.value)}</strong>
                          </div>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              ) : null}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-primary text-base">
                    Departmental Performance
                    {revpar?.periodName ? (
                      <Badge variant="info" className="ml-2 font-normal">
                        {revpar.periodName}
                      </Badge>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-60">
                    <ResponsiveBar
                      data={deptBarData}
                      keys={["Revenue", "Income"]}
                      indexBy="department"
                      margin={{ top: 8, right: 20, bottom: 40, left: 60 }}
                      padding={0.3}
                      groupMode="grouped"
                      colors={["#0e7c7b", "#0369a1"]}
                      axisLeft={{ format: (v) => `${(Number(v) / 1000).toFixed(0)}k` }}
                      axisBottom={{ tickRotation: -20 }}
                      tooltip={({ id, value }) => (
                        <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                          {id}: <strong>{fmt(value)}</strong>
                        </div>
                      )}
                      legends={[
                        {
                          anchor: "top-right",
                          direction: "row",
                          itemWidth: 80,
                          itemHeight: 14,
                          dataFrom: "keys",
                          symbolSize: 10
                        }
                      ]}
                    />
                  </div>
                  <div className="flex gap-4 mt-2 text-sm text-muted-foreground">
                    <span>
                      Total Revenue:{" "}
                      <strong className="text-foreground">{fmt(usali.totalRevenue)}</strong>
                    </span>
                    <span>
                      GOP:{" "}
                      <strong className="text-emerald-700">
                        {fmt(usali.grossOperatingProfit)}
                      </strong>
                    </span>
                    <span>
                      EBITDA: <strong className="text-[#0369a1]">{fmt(usali.ebitda)}</strong>
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </>
      )}

      {/* ── Controller View ── */}
      {roleView === "CONTROLLER" && (
        <>
          {/* KPI row */}
          <div className="flex flex-wrap gap-3">
            <KPICard label="Total Revenue" value={revpar ? fmt(revpar.totalRevenue) : "–"} />
            <KPICard
              label="Room Revenue"
              value={revpar ? fmt(revpar.roomRevenue) : "–"}
              accent="text-[var(--color-accent)]"
            />
            <KPICard
              label="F&B Revenue"
              value={revpar ? fmt(revpar.fbRevenue) : "–"}
              accent="text-[#0369a1]"
            />
            <KPICard
              label="GOP"
              value={revpar ? fmt(revpar.gopAmount) : "–"}
              accent="text-emerald-700"
            />
            {bs ? (
              <KPICard label="Total Assets" value={fmt(bs.totalAssets)} accent="text-[#7c3aed]" />
            ) : null}
            {bs ? (
              <KPICard label="Total Equity" value={fmt(bs.totalEquity)} accent="text-[#b45309]" />
            ) : null}
          </div>

          <SectionHeader title="Receivables &amp; Payables" />

          {/* AR Ageing + AP Due */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ARAgeingChart rows={arAgeingQ.data ?? []} />
            <APDueWidget invoices={apDueQ.data ?? []} />
          </div>

          <SectionHeader title="Cash &amp; Revenue Performance" />

          {/* Bank balances + Revenue vs Budget */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BankBalanceSummary bs={bs} />
            <RevenueBudgetChart usaliComparative={usaliComparativeQ.data} />
          </div>

          <SectionHeader title="Departmental Analysis" />

          {usali ? (
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-primary text-base">Revenue Mix</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-60">
                    <ResponsivePie
                      data={revenuePieData}
                      margin={{ top: 16, right: 80, bottom: 16, left: 80 }}
                      innerRadius={0.4}
                      padAngle={1.5}
                      colors={{ datum: "data.color" }}
                      arcLabel={(d) =>
                        `${((d.value / parseFloat(usali.totalRevenue)) * 100).toFixed(0)}%`
                      }
                      arcLabelsSkipAngle={12}
                      tooltip={({ datum }) => (
                        <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                          {datum.label}: <strong>{fmt(datum.value)}</strong>
                        </div>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-primary text-base">Department Income %</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-60">
                    <ResponsiveBar
                      data={usali.departments.map((d) => ({
                        dept: d.name.slice(0, 12),
                        pct: parseFloat(d.incomePct)
                      }))}
                      keys={["pct"]}
                      indexBy="dept"
                      layout="horizontal"
                      margin={{ top: 8, right: 16, bottom: 8, left: 100 }}
                      colors={["#0e7c7b"]}
                      axisBottom={{ format: (v) => `${v}%` }}
                      tooltip={({ value }) => (
                        <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                          {fmt(value, 1)}%
                        </div>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </>
      )}

      {/* ── CFO View ── */}
      {roleView === "CFO" && (
        <>
          {/* KPI row */}
          <div className="flex flex-wrap gap-3">
            <KPICard
              label="Total Assets"
              value={bs ? fmt(bs.totalAssets) : "–"}
              accent="text-[#7c3aed]"
            />
            <KPICard
              label="Total Liabilities"
              value={bs ? fmt(bs.totalLiabilities) : "–"}
              accent="text-destructive"
            />
            <KPICard
              label="Total Equity"
              value={bs ? fmt(bs.totalEquity) : "–"}
              accent="text-emerald-700"
            />
            <KPICard
              label="Net Cash Change"
              value={cf ? fmt(cf.netChange) : "–"}
              accent={
                parseFloat(cf?.netChange ?? "0") >= 0 ? "text-emerald-700" : "text-destructive"
              }
            />
            <KPICard
              label="Operating CF"
              value={cf ? fmt(cf.operating.total) : "–"}
              accent="text-[var(--color-accent)]"
            />
            <KPICard
              label="EBITDA"
              value={usali ? fmt(usali.ebitda) : "–"}
              accent="text-[#0369a1]"
            />
          </div>

          <SectionHeader title="Portfolio Overview" />
          <PortfolioTable summaries={portfolioSummaries} />

          <SectionHeader title="Currency Exposure" />
          <CurrencyExposureChart rows={currencyExposureQ.data ?? []} />

          <SectionHeader title="Covenant Monitoring" />
          <CovenantRatios bs={bs} cf={cf} usali={usali} />

          <Separator />

          <div className="grid grid-cols-2 gap-4">
            {bs && bsPieData.length > 0 ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-primary text-base">Balance Sheet Structure</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-60">
                    <ResponsivePie
                      data={bsPieData}
                      margin={{ top: 16, right: 80, bottom: 16, left: 80 }}
                      innerRadius={0.5}
                      padAngle={1.5}
                      colors={{ datum: "data.color" }}
                      arcLabel={(d) => `${d.id}`}
                      arcLabelsSkipAngle={15}
                      tooltip={({ datum }) => (
                        <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                          {datum.label}: <strong>{fmt(datum.value)}</strong>
                        </div>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            ) : null}
            {cf && cfPieData.length > 0 ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-primary text-base">Cash Flow Components</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-60">
                    <ResponsivePie
                      data={cfPieData}
                      margin={{ top: 16, right: 80, bottom: 16, left: 80 }}
                      innerRadius={0.4}
                      padAngle={1.5}
                      colors={{ datum: "data.color" }}
                      arcLabel={(d) => `${d.id}`}
                      arcLabelsSkipAngle={15}
                      tooltip={({ datum }) => (
                        <div className="bg-white border border-border rounded px-2 py-1 text-xs shadow">
                          {datum.label}: <strong>{fmt(datum.value)}</strong>
                        </div>
                      )}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Net Cash Change:{" "}
                    <strong
                      className={
                        parseFloat(cf.netChange) >= 0 ? "text-emerald-700" : "text-destructive"
                      }
                    >
                      {fmt(cf.netChange)}
                    </strong>
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
