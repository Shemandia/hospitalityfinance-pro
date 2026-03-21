"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import { getPeriodList, getUSALIComparative, getUSALIPdfUrl } from "../../../../lib/gl-api";
import type { USALIComparativeReport, USALIDepartmentComparative } from "../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../components/ui/select";
import { Badge } from "../../../../components/ui/badge";
import { Button } from "../../../../components/ui/button";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Download,
  BarChart2,
  Table2,
  FileText
} from "lucide-react";

// ── Formatters ────────────────────────────────────────────────────────────────

const fmt = (v: string | number) =>
  Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtPct = (v: string | number) => `${Number(v).toFixed(1)}%`;

const fmtVar = (v: string | number) => {
  const n = Number(v);
  return n >= 0 ? `+${fmt(n)}` : fmt(n);
};

const fmtVarPct = (v: string | number) => {
  const n = Number(v);
  return n >= 0 ? `+${n.toFixed(1)}%` : `${n.toFixed(1)}%`;
};

function pctColor(pct: number) {
  if (pct >= 35) return "text-emerald-600";
  if (pct >= 20) return "text-amber-600";
  return "text-red-600";
}

function varColor(v: number) {
  return v >= 0 ? "text-emerald-600" : "text-red-600";
}

// ── KPI Summary Card ──────────────────────────────────────────────────────────

function KpiCard({
  label,
  current,
  ytd,
  budget,
  varAmt,
  varPct,
  prior
}: {
  label: string;
  current: string;
  ytd?: string;
  budget?: string;
  varAmt?: string;
  varPct?: string;
  prior?: string;
}) {
  const isPos = Number(current) >= 0;
  const varN = Number(varAmt ?? "0");
  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        <p className={`text-xl font-bold ${isPos ? "text-emerald-700" : "text-red-600"}`}>
          {fmt(current)}
        </p>
        <div className="grid grid-cols-3 gap-x-3 text-xs text-muted-foreground border-t border-slate-100 pt-2">
          {budget && (
            <div>
              <p className="text-[10px] uppercase tracking-wide mb-0.5">Budget</p>
              <p className="font-medium text-slate-600">{fmt(budget)}</p>
            </div>
          )}
          {varAmt !== undefined && (
            <div>
              <p className="text-[10px] uppercase tracking-wide mb-0.5">Var</p>
              <p className={`font-medium ${varColor(varN)}`}>{fmtVar(varAmt)}</p>
              {varPct && <p className={`text-[10px] ${varColor(varN)}`}>{fmtVarPct(varPct)}</p>}
            </div>
          )}
          {ytd && (
            <div>
              <p className="text-[10px] uppercase tracking-wide mb-0.5">YTD</p>
              <p className="font-medium text-slate-600">{fmt(ytd)}</p>
            </div>
          )}
          {prior && (
            <div>
              <p className="text-[10px] uppercase tracking-wide mb-0.5">Prior Yr</p>
              <p className="font-medium text-slate-500">{fmt(prior)}</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Detail table (current period: Revenue / Expenses / Income / %) ───────────

function DetailTable({ report }: { report: USALIComparativeReport }) {
  const gopPct = Number(report.gopPct);
  const ebitdaPct = Number(report.ebitdaPct);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-100 border-b border-slate-200">
            <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-2/5">
              Department
            </th>
            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Revenue
            </th>
            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Expenses
            </th>
            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Dept Income
            </th>
            <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
              Income %
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {report.departments.map((d) => {
            const inc = Number(d.departmentalIncome);
            const pct = Number(d.incomePct);
            return (
              <tr key={d.name} className="hover:bg-slate-50/60">
                <td className="py-2.5 px-4 text-slate-700">{d.name}</td>
                <td className="py-2.5 px-4 text-right text-slate-700">{fmt(d.revenue)}</td>
                <td className="py-2.5 px-4 text-right text-slate-700">{fmt(d.expenses)}</td>
                <td
                  className={`py-2.5 px-4 text-right font-medium ${inc < 0 ? "text-red-600" : "text-slate-800"}`}
                >
                  {fmt(d.departmentalIncome)}
                </td>
                <td className={`py-2.5 px-4 text-right ${pctColor(pct)}`}>{fmtPct(pct)}</td>
              </tr>
            );
          })}

          {/* Total Operated */}
          <tr className="bg-slate-50 font-semibold border-t border-slate-200">
            <td className="py-3 px-4 text-slate-800" colSpan={3}>
              Total Operated Departments
            </td>
            <td className="py-3 px-4 text-right text-slate-800">
              {fmt(report.totalDepartmentalIncome)}
            </td>
            <td className="py-3 px-4 text-right text-muted-foreground">
              {Number(report.totalRevenue) > 0
                ? fmtPct(
                    (Number(report.totalDepartmentalIncome) / Number(report.totalRevenue)) * 100
                  )
                : "—"}
            </td>
          </tr>

          {/* Undistributed header */}
          <tr>
            <td
              colSpan={5}
              className="py-2 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50"
            >
              Undistributed Operating Expenses
            </td>
          </tr>
          <tr className="hover:bg-slate-50/60">
            <td className="py-2.5 px-4 pl-8 text-slate-700">Administrative &amp; General</td>
            <td className="py-2.5 px-4 text-right text-slate-400">—</td>
            <td className="py-2.5 px-4 text-right text-slate-700">
              {fmt(report.undistributedExpenses)}
            </td>
            <td className="py-2.5 px-4 text-right text-slate-700">
              ({fmt(report.undistributedExpenses)})
            </td>
            <td className="py-2.5 px-4 text-right text-slate-400">—</td>
          </tr>

          {/* GOP */}
          <tr className="bg-(--color-primary)/5 font-bold text-(--color-primary)">
            <td className="py-3 px-4 text-sm" colSpan={3}>
              Gross Operating Profit (GOP)
            </td>
            <td className="py-3 px-4 text-sm text-right">{fmt(report.grossOperatingProfit)}</td>
            <td className="py-3 px-4 text-sm text-right text-muted-foreground">{fmtPct(gopPct)}</td>
          </tr>

          {/* Management Fees */}
          <tr className="hover:bg-slate-50/60 border-t border-slate-100">
            <td className="py-2.5 px-4 text-slate-700">Management Fees</td>
            <td className="py-2.5 px-4 text-right text-slate-400">—</td>
            <td className="py-2.5 px-4 text-right text-slate-700">{fmt(report.managementFees)}</td>
            <td className="py-2.5 px-4 text-right text-slate-700">
              ({fmt(report.managementFees)})
            </td>
            <td className="py-2.5 px-4 text-right text-slate-400">—</td>
          </tr>

          {/* EBITDA */}
          <tr className="bg-(--color-primary)/5 font-bold text-(--color-primary)">
            <td className="py-3 px-4 text-sm" colSpan={3}>
              EBITDA
            </td>
            <td className="py-3 px-4 text-sm text-right">{fmt(report.ebitda)}</td>
            <td className="py-3 px-4 text-sm text-right text-muted-foreground">
              {fmtPct(ebitdaPct)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Comparative table (Dept Income only, all columns) ────────────────────────

function ComparativeTable({ report }: { report: USALIComparativeReport }) {
  type SummaryLine = {
    label: string;
    current: string;
    currentPct?: string;
    ytd?: string;
    ytdPct?: string;
    budget?: string;
    varAmt?: string;
    varPct?: string;
    prior?: string;
    priorPct?: string;
    highlight?: boolean;
  };

  const deptLines: SummaryLine[] = report.departments.map((d: USALIDepartmentComparative) => ({
    label: d.name,
    current: d.departmentalIncome,
    currentPct: d.incomePct,
    ytd: d.ytdDeptIncome,
    ytdPct: d.ytdIncomePct,
    budget: d.budgetDeptIncome,
    varAmt: d.varianceAmount,
    varPct: d.variancePct,
    prior: d.priorDeptIncome,
    priorPct: d.priorIncomePct
  }));

  const gopPct = Number(report.gopPct);
  const ytdGOPPct = Number(report.ytdGOPPct);
  const priorGOPPct = Number(report.priorGOPPct);
  const ebitdaPct = Number(report.ebitdaPct);
  const ytdEBITDAPct = Number(report.ytdEBITDAPct);

  const summaryLines: SummaryLine[] = [
    {
      label: "Total Revenue",
      current: report.totalRevenue,
      ytd: report.ytdTotalRevenue,
      budget: report.budgetTotalRevenue,
      varAmt: report.revenueVariance,
      varPct: report.revenueVariancePct,
      prior: report.priorTotalRevenue
    },
    {
      label: "Gross Operating Profit (GOP)",
      current: report.grossOperatingProfit,
      currentPct: report.gopPct,
      ytd: report.ytdGOP,
      ytdPct: report.ytdGOPPct,
      budget: report.budgetGOP,
      varAmt: report.gopVariance,
      varPct: report.gopVariancePct,
      prior: report.priorGOP,
      priorPct: report.priorGOPPct,
      highlight: true
    },
    {
      label: "EBITDA",
      current: report.ebitda,
      currentPct: report.ebitdaPct,
      ytd: report.ytdEBITDA,
      ytdPct: report.ytdEBITDAPct,
      budget: report.budgetEBITDA,
      varAmt: report.ebitdaVariance,
      varPct: report.ebitdaVariancePct,
      highlight: true
    }
  ];

  const ColGroup = () => (
    <>
      <colgroup>
        <col className="w-[22%]" />
        {/* Current */}
        <col className="w-[8%]" />
        <col className="w-[5%]" />
        {/* YTD */}
        {report.hasYTD && (
          <>
            <col className="w-[8%]" />
            <col className="w-[5%]" />
          </>
        )}
        {/* Budget + Variance */}
        {report.hasBudget && (
          <>
            <col className="w-[8%]" />
            <col className="w-[7%]" />
            <col className="w-[5%]" />
          </>
        )}
        {/* Prior Year */}
        {report.hasPriorYear && (
          <>
            <col className="w-[8%]" />
            <col className="w-[5%]" />
          </>
        )}
      </colgroup>
    </>
  );

  const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
    <th
      className={`py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );

  const Td = ({
    children,
    right,
    className = ""
  }: {
    children: React.ReactNode;
    right?: boolean;
    className?: string;
  }) => (
    <td className={`py-2.5 px-3 text-sm ${right ? "text-right" : ""} ${className}`}>{children}</td>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <ColGroup />
        <thead>
          {/* Column group labels */}
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="py-1.5 px-3" scope="col" aria-label="Department" />
            <th
              colSpan={2}
              className="py-1.5 px-3 text-center text-[10px] font-semibold text-(--color-primary) uppercase tracking-wider border-x border-slate-200"
            >
              Current Period
            </th>
            {report.hasYTD && (
              <th
                colSpan={2}
                className="py-1.5 px-3 text-center text-[10px] font-semibold text-blue-600 uppercase tracking-wider border-x border-slate-200"
              >
                YTD
              </th>
            )}
            {report.hasBudget && (
              <th
                colSpan={3}
                className="py-1.5 px-3 text-center text-[10px] font-semibold text-violet-600 uppercase tracking-wider border-x border-slate-200"
              >
                vs Budget
              </th>
            )}
            {report.hasPriorYear && (
              <th
                colSpan={2}
                className="py-1.5 px-3 text-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider border-x border-slate-200"
              >
                Prior Year
              </th>
            )}
          </tr>
          <tr className="bg-slate-100 border-b border-slate-200">
            <Th>Department</Th>
            <Th right>Income</Th>
            <Th right>%</Th>
            {report.hasYTD && (
              <>
                <Th right>Income</Th>
                <Th right>%</Th>
              </>
            )}
            {report.hasBudget && (
              <>
                <Th right>Budget</Th>
                <Th right>Variance</Th>
                <Th right>Var%</Th>
              </>
            )}
            {report.hasPriorYear && (
              <>
                <Th right>Income</Th>
                <Th right>%</Th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {/* Operated departments */}
          {deptLines.map((line) => {
            const inc = Number(line.current);
            const pct = Number(line.currentPct ?? "0");
            const vn = Number(line.varAmt ?? "0");
            return (
              <tr key={line.label} className="hover:bg-slate-50/60">
                <Td>{line.label}</Td>
                <Td
                  right
                  className={inc < 0 ? "text-red-600 font-medium" : "text-slate-800 font-medium"}
                >
                  {fmt(line.current)}
                </Td>
                <Td right className={pctColor(pct)}>
                  {fmtPct(pct)}
                </Td>
                {report.hasYTD && (
                  <>
                    <Td right className="text-blue-700">
                      {fmt(line.ytd ?? "0")}
                    </Td>
                    <Td right className={pctColor(Number(line.ytdPct ?? "0"))}>
                      {fmtPct(line.ytdPct ?? "0")}
                    </Td>
                  </>
                )}
                {report.hasBudget && (
                  <>
                    <Td right className="text-slate-500">
                      {fmt(line.budget ?? "0")}
                    </Td>
                    <Td right className={varColor(vn)}>
                      {fmtVar(line.varAmt ?? "0")}
                    </Td>
                    <Td right className={varColor(vn)}>
                      {fmtVarPct(line.varPct ?? "0")}
                    </Td>
                  </>
                )}
                {report.hasPriorYear && (
                  <>
                    <Td right className="text-slate-400">
                      {fmt(line.prior ?? "0")}
                    </Td>
                    <Td right className={pctColor(Number(line.priorPct ?? "0"))}>
                      {fmtPct(line.priorPct ?? "0")}
                    </Td>
                  </>
                )}
              </tr>
            );
          })}

          {/* Summary lines */}
          {summaryLines.map((line) => {
            const inc = Number(line.current);
            const pct = Number(line.currentPct ?? "0");
            const ytdPct = Number(line.ytdPct ?? "0");
            const priorPct = Number(line.priorPct ?? "0");
            const vn = Number(line.varAmt ?? "0");
            const rowCls = line.highlight
              ? "bg-(--color-primary)/5 font-bold text-(--color-primary) border-t-2 border-(--color-primary)/20"
              : "bg-slate-50 font-semibold border-t border-slate-200";
            return (
              <tr key={line.label} className={rowCls}>
                <td className="py-3 px-3 text-sm">{line.label}</td>
                <td className={`py-3 px-3 text-sm text-right ${inc < 0 ? "text-red-600" : ""}`}>
                  {fmt(line.current)}
                </td>
                <td
                  className={`py-3 px-3 text-sm text-right ${line.currentPct !== undefined ? pctColor(pct) : "text-muted-foreground"}`}
                >
                  {line.currentPct !== undefined ? fmtPct(pct) : "—"}
                </td>
                {report.hasYTD && (
                  <>
                    <td className="py-3 px-3 text-sm text-right text-blue-700">
                      {fmt(line.ytd ?? "0")}
                    </td>
                    <td
                      className={`py-3 px-3 text-sm text-right ${line.ytdPct !== undefined ? pctColor(ytdPct) : "text-muted-foreground"}`}
                    >
                      {line.ytdPct !== undefined ? fmtPct(ytdPct) : "—"}
                    </td>
                  </>
                )}
                {report.hasBudget && (
                  <>
                    <td className="py-3 px-3 text-sm text-right text-slate-500">
                      {fmt(line.budget ?? "0")}
                    </td>
                    <td className={`py-3 px-3 text-sm text-right ${varColor(vn)}`}>
                      {fmtVar(line.varAmt ?? "0")}
                    </td>
                    <td className={`py-3 px-3 text-sm text-right ${varColor(vn)}`}>
                      {fmtVarPct(line.varPct ?? "0")}
                    </td>
                  </>
                )}
                {report.hasPriorYear && (
                  <>
                    <td className="py-3 px-3 text-sm text-right text-slate-400">
                      {fmt(line.prior ?? "0")}
                    </td>
                    <td
                      className={`py-3 px-3 text-sm text-right ${line.priorPct !== undefined ? pctColor(priorPct) : "text-muted-foreground"}`}
                    >
                      {line.priorPct !== undefined ? fmtPct(priorPct) : "—"}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCSV(report: USALIComparativeReport) {
  const header = [
    "Department",
    "Revenue",
    "Expenses",
    "Dept Income",
    "Income%",
    "YTD Revenue",
    "YTD Income",
    "YTD%",
    "Budget Income",
    "Variance",
    "Var%",
    "Prior Yr Income",
    "Prior Yr%"
  ];
  const rows: string[][] = [
    ["USALI Summary Operating Statement — Comparative"],
    [`Period: ${report.periodName}`],
    [],
    header,
    ...report.departments.map((d: USALIDepartmentComparative) => [
      d.name,
      d.revenue,
      d.expenses,
      d.departmentalIncome,
      d.incomePct,
      d.ytdRevenue,
      d.ytdDeptIncome,
      d.ytdIncomePct,
      d.budgetDeptIncome,
      d.varianceAmount,
      d.variancePct,
      d.priorDeptIncome,
      d.priorIncomePct
    ]),
    [],
    [
      "Total Revenue",
      report.totalRevenue,
      "",
      "",
      "",
      report.ytdTotalRevenue,
      "",
      "",
      report.budgetTotalRevenue,
      report.revenueVariance,
      report.revenueVariancePct,
      report.priorTotalRevenue,
      ""
    ],
    [
      "GOP",
      report.grossOperatingProfit,
      "",
      "",
      report.gopPct,
      report.ytdGOP,
      "",
      report.ytdGOPPct,
      report.budgetGOP,
      report.gopVariance,
      report.gopVariancePct,
      report.priorGOP,
      report.priorGOPPct
    ],
    [
      "EBITDA",
      report.ebitda,
      "",
      "",
      report.ebitdaPct,
      report.ytdEBITDA,
      "",
      report.ytdEBITDAPct,
      report.budgetEBITDA,
      report.ebitdaVariance,
      report.ebitdaVariancePct,
      "",
      ""
    ]
  ];
  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `usali-pl-${report.periodName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function USALIPLPage() {
  const apiContext = useApiContext();
  const [periodId, setPeriodId] = useState("NONE");
  const [viewMode, setViewMode] = useState<"detail" | "comparative">("detail");

  const periodsQuery = useQuery({
    queryKey: ["periods", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getPeriodList(apiContext);
      return res.data ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const activePeriodId = periodId === "NONE" ? undefined : periodId;

  const reportQuery = useQuery({
    queryKey: ["usali-comparative", apiContext?.entityId, activePeriodId],
    queryFn: async () => {
      if (!apiContext || !activePeriodId) return null;
      const res = await getUSALIComparative(apiContext, activePeriodId);
      return res.data as USALIComparativeReport;
    },
    enabled: Boolean(apiContext && activePeriodId)
  });

  const report = reportQuery.data ?? null;

  const gopPct = Number(report?.gopPct ?? "0");
  const ebitdaPct = Number(report?.ebitdaPct ?? "0");
  const ytdGOPPct = Number(report?.ytdGOPPct ?? "0");

  const availableColumns = useMemo(() => {
    if (!report) return [];
    const cols = ["Current Period"];
    if (report.hasYTD) cols.push("YTD");
    if (report.hasBudget) cols.push("vs Budget");
    if (report.hasPriorYear) cols.push("Prior Year");
    return cols;
  }, [report]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-(--color-primary)">
            USALI Summary Operating Statement
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Departmental P&amp;L — 11th Edition · Current Period / YTD / Budget / Prior Year
          </p>
        </div>
        {report && (
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => exportCSV(report)}
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                if (!apiContext || !activePeriodId) return;
                const url = getUSALIPdfUrl(activePeriodId);
                const res = await fetch(url, {
                  headers: {
                    Authorization: `Bearer ${apiContext.accessToken}`,
                    "X-Entity-ID": apiContext.entityId
                  }
                });
                if (!res.ok) return;
                const blob = await res.blob();
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `usali-pl-${report.periodName}.pdf`;
                a.click();
                URL.revokeObjectURL(a.href);
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Export PDF
            </Button>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="space-y-1 w-72">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Reporting Period
          </label>
          <Select value={periodId} onValueChange={setPeriodId}>
            <SelectTrigger>
              <SelectValue placeholder="Select period…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Select period…</SelectItem>
              {(periodsQuery.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    {p.status}
                  </Badge>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {report && (
          <div className="flex gap-1 pb-0.5">
            <Button
              variant={viewMode === "detail" ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setViewMode("detail")}
            >
              <Table2 className="h-3.5 w-3.5" />
              Detail
            </Button>
            <Button
              variant={viewMode === "comparative" ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setViewMode("comparative")}
            >
              <BarChart2 className="h-3.5 w-3.5" />
              Comparative
            </Button>
          </div>
        )}

        {report && availableColumns.length > 0 && (
          <div className="flex items-center gap-1.5 pb-0.5">
            {availableColumns.map((col) => (
              <Badge key={col} variant="outline" className="text-[10px]">
                {col}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Loading / error */}
      {reportQuery.isLoading && (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Loading report…
        </div>
      )}
      {reportQuery.isError && (
        <div className="flex items-center justify-center h-48 text-red-600 text-sm">
          {(reportQuery.error as Error).message}
        </div>
      )}

      {report && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              label="Total Revenue"
              current={report.totalRevenue}
              ytd={report.hasYTD ? report.ytdTotalRevenue : undefined}
              budget={report.hasBudget ? report.budgetTotalRevenue : undefined}
              varAmt={report.hasBudget ? report.revenueVariance : undefined}
              varPct={report.hasBudget ? report.revenueVariancePct : undefined}
              prior={report.hasPriorYear ? report.priorTotalRevenue : undefined}
            />
            <KpiCard
              label="Gross Operating Profit"
              current={report.grossOperatingProfit}
              ytd={report.hasYTD ? report.ytdGOP : undefined}
              budget={report.hasBudget ? report.budgetGOP : undefined}
              varAmt={report.hasBudget ? report.gopVariance : undefined}
              varPct={report.hasBudget ? report.gopVariancePct : undefined}
              prior={report.hasPriorYear ? report.priorGOP : undefined}
            />
            <KpiCard
              label="EBITDA"
              current={report.ebitda}
              ytd={report.hasYTD ? report.ytdEBITDA : undefined}
              budget={report.hasBudget ? report.budgetEBITDA : undefined}
              varAmt={report.hasBudget ? report.ebitdaVariance : undefined}
              varPct={report.hasBudget ? report.ebitdaVariancePct : undefined}
            />
            <Card>
              <CardContent className="pt-4 pb-4 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  GOP Margin
                </p>
                <p className={`text-xl font-bold ${pctColor(gopPct)}`}>{fmtPct(gopPct)}</p>
                <div className="grid grid-cols-2 gap-x-3 text-xs border-t border-slate-100 pt-2">
                  {report.hasYTD && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                        YTD GOP%
                      </p>
                      <p className={`font-medium ${pctColor(ytdGOPPct)}`}>{fmtPct(ytdGOPPct)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">
                      EBITDA%
                    </p>
                    <p className={`font-medium ${pctColor(ebitdaPct)}`}>{fmtPct(ebitdaPct)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {viewMode === "detail"
                  ? "Departmental Performance — Current Period"
                  : "Departmental Performance — Comparative"}
                {viewMode === "comparative" && !report.hasBudget && (
                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                    No budget loaded — upload a budget to enable variance columns
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {viewMode === "detail" ? (
                <DetailTable report={report} />
              ) : (
                <ComparativeTable report={report} />
              )}
            </CardContent>
          </Card>

          {/* Bottom metrics strip */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-sm">
            <Card>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-50">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Dept Income</p>
                  <p className="font-semibold">{fmt(report.totalDepartmentalIncome)}</p>
                  <p className="text-[11px] text-muted-foreground">before undistributed</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-50">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Undistributed Exp.</p>
                  <p className="font-semibold">{fmt(report.undistributedExpenses)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4 flex items-center gap-3">
                <div
                  className={`p-2 rounded-lg ${Number(report.ebitda) >= 0 ? "bg-emerald-50" : "bg-red-50"}`}
                >
                  {Number(report.ebitda) >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">EBITDA Margin</p>
                  <p className={`font-semibold ${pctColor(ebitdaPct)}`}>{fmtPct(ebitdaPct)}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Empty state */}
      {!activePeriodId && !reportQuery.isLoading && (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <DollarSign className="h-8 w-8 opacity-30" />
          <p className="text-sm">Select a reporting period to generate the USALI P&amp;L.</p>
        </div>
      )}
    </div>
  );
}
