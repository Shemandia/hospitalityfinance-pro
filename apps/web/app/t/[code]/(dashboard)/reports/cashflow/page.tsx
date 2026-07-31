"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import { getPeriodList, getCashFlow, getCashFlowPdfUrl } from "../../../../../../lib/gl-api";
import { downloadBlob, getApiErrorMessage } from "../../../../../../lib/api-client";
import type { CashFlowResult, CashFlowSection } from "../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import { Activity, Download, TrendingUp, TrendingDown, Minus, FileText } from "lucide-react";

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: string | number) =>
  Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function amountColor(v: string) {
  const n = Number(v);
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-red-700";
  return "text-slate-600";
}

function exportCSV(report: CashFlowResult, periodName: string) {
  const rows: string[][] = [
    ["Cash Flow Statement"],
    [`Period: ${periodName}`],
    [],
    ["Section", "Description", "Amount"]
  ];
  const addSection = (s: CashFlowSection) => {
    rows.push([s.label, "", ""]);
    for (const item of s.items) rows.push(["", item.description, item.amount]);
    rows.push(["", `Net ${s.label}`, s.total]);
    rows.push([]);
  };
  addSection(report.operating);
  addSection(report.investing);
  addSection(report.financing);
  rows.push(["Net Change in Cash", "", report.netChange]);
  rows.push(["Opening Cash", "", report.openingCash]);
  rows.push(["Closing Cash", "", report.closingCash]);

  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cashflow-${periodName}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ section, accentClass }: { section: CashFlowSection; accentClass: string }) {
  const total = Number(section.total);
  return (
    <Card className="overflow-hidden">
      <CardHeader className={`py-3 px-4 ${accentClass}`}>
        <CardTitle className="text-sm text-white">{section.label}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {section.items.map((item, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50/40 last:border-0"
          >
            <span className="text-sm text-slate-700">{item.description}</span>
            <span className={`text-sm tabular-nums font-medium ${amountColor(item.amount)}`}>
              {fmt(item.amount)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200">
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Net {section.label}
          </span>
          <span className={`text-sm font-bold tabular-nums ${amountColor(section.total)}`}>
            {fmt(section.total)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Reconciliation row ────────────────────────────────────────────────────────

function RecRow({
  label,
  amount,
  bold = false,
  separator = false
}: {
  label: string;
  amount: string;
  bold?: boolean;
  separator?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-2.5 ${separator ? "border-t-2 border-slate-300 bg-slate-50" : "border-b border-slate-50"}`}
    >
      <span className={`text-sm ${bold ? "font-bold text-slate-800" : "text-slate-600"}`}>
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${bold ? "font-bold " + amountColor(amount) : amountColor(amount)}`}
      >
        {fmt(amount)}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CashFlowPage() {
  const apiContext = useApiContext();
  const [periodId, setPeriodId] = useState("NONE");
  const [exportError, setExportError] = useState("");

  const periodsQuery = useQuery({
    queryKey: ["periods", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getPeriodList(apiContext);
      return res.data ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const activePeriodId = periodId === "NONE" ? undefined : periodId;

  const reportQuery = useQuery({
    queryKey: ["cashflow", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: async () => {
      if (!apiContext || !activePeriodId) return null;
      const res = await getCashFlow(apiContext, activePeriodId);
      return res.data as CashFlowResult;
    },
    enabled: Boolean(apiContext && activePeriodId)
  });

  const report = reportQuery.data ?? null;
  const selectedPeriod = periodsQuery.data?.find((p) => p.id === activePeriodId);

  const netChangeVal = report ? Number(report.netChange) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--color-primary)">Cash Flow Statement</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Indirect method — operating, investing, financing
          </p>
        </div>
        {report && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => exportCSV(report, selectedPeriod?.name ?? "")}
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
                const url = getCashFlowPdfUrl(activePeriodId);
                setExportError("");
                try {
                  await downloadBlob(
                    apiContext,
                    url,
                    `cashflow-${selectedPeriod?.name ?? "report"}.pdf`
                  );
                } catch (error) {
                  setExportError(getApiErrorMessage(error));
                }
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Export PDF
            </Button>
          </div>
        )}
      </div>
      {exportError && <p className="text-sm text-destructive">{exportError}</p>}

      {/* Period selector */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-6">
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
              <div
                className={`flex items-center gap-1.5 pt-5 text-sm font-medium ${netChangeVal >= 0 ? "text-emerald-600" : "text-red-600"}`}
              >
                {netChangeVal > 0 ? (
                  <TrendingUp className="h-4 w-4" />
                ) : netChangeVal < 0 ? (
                  <TrendingDown className="h-4 w-4" />
                ) : (
                  <Minus className="h-4 w-4" />
                )}
                Net change: {fmt(report.netChange)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading / error */}
      {reportQuery.isLoading && (
        <div className="flex items-center justify-center h-48 text-muted-foreground">
          Loading report…
        </div>
      )}
      {reportQuery.isError && (
        <div className="flex items-center justify-center h-48 text-red-600">
          {(reportQuery.error as Error).message}
        </div>
      )}

      {report && (
        <>
          {/* KPI summary row */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Operating Cash Flow", value: report.operating.total, icon: TrendingUp },
              { label: "Investing Cash Flow", value: report.investing.total, icon: TrendingDown },
              { label: "Financing Cash Flow", value: report.financing.total, icon: Activity }
            ].map(({ label, value, icon: Icon }) => {
              const n = Number(value);
              return (
                <Card key={label}>
                  <CardContent className="pt-5 pb-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {label}
                    </p>
                    <p
                      className={`text-xl font-bold mt-1 ${n >= 0 ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {fmt(value)}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Three sections */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <SectionCard section={report.operating} accentClass="bg-blue-600" />
            <SectionCard section={report.investing} accentClass="bg-violet-600" />
            <SectionCard section={report.financing} accentClass="bg-amber-600" />
          </div>

          {/* Reconciliation */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cash Reconciliation</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <RecRow label="Operating Activities" amount={report.operating.total} />
              <RecRow label="Investing Activities" amount={report.investing.total} />
              <RecRow label="Financing Activities" amount={report.financing.total} />
              <RecRow label="Net Change in Cash" amount={report.netChange} bold separator />
              <RecRow label="Opening Cash Balance" amount={report.openingCash} />
              <RecRow label="Closing Cash Balance" amount={report.closingCash} bold />
            </CardContent>
          </Card>
        </>
      )}

      {/* No period selected */}
      {!activePeriodId && !reportQuery.isLoading && (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <Activity className="h-8 w-8 opacity-30" />
          <p className="text-sm">Select a reporting period to view the Cash Flow Statement.</p>
        </div>
      )}
    </div>
  );
}
