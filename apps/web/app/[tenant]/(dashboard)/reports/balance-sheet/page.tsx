"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../components/use-api-context";
import { getPeriodList, getBalanceSheet, getBalanceSheetPdfUrl } from "../../../../../lib/gl-api";
import type { BalanceSheetResult, BalanceSheetSection } from "../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import { Badge } from "../../../../../components/ui/badge";
import { Separator } from "../../../../../components/ui/separator";
import { Button } from "../../../../../components/ui/button";
import { Scale, Download, CheckCircle2, AlertTriangle, FileText } from "lucide-react";

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: string | number) =>
  Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function exportCSV(report: BalanceSheetResult, periodName: string) {
  const rows: string[][] = [
    ["Balance Sheet"],
    [`As of: ${report.asOf}  |  Period: ${periodName}`],
    [],
    ["Section", "Code", "Account", "Balance"]
  ];
  for (const s of report.assets) {
    for (const a of s.accounts) rows.push([s.name, a.code, a.name, a.balance]);
    rows.push([`TOTAL ${s.name}`, "", "", s.total]);
  }
  rows.push(["TOTAL ASSETS", "", "", report.totalAssets]);
  rows.push([]);
  for (const s of report.liabilities) {
    for (const a of s.accounts) rows.push([s.name, a.code, a.name, a.balance]);
    rows.push([`TOTAL ${s.name}`, "", "", s.total]);
  }
  for (const s of report.equity) {
    for (const a of s.accounts) rows.push([s.name, a.code, a.name, a.balance]);
    rows.push([`TOTAL ${s.name}`, "", "", s.total]);
  }
  rows.push(["TOTAL LIABILITIES & EQUITY", "", "", report.totalLiabilitiesAndEquity]);

  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `balance-sheet-${report.asOf}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Section block ─────────────────────────────────────────────────────────────

function SectionBlock({ section }: { section: BalanceSheetSection }) {
  return (
    <div>
      <p className="px-3 py-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50 border-b border-slate-100">
        {section.name}
      </p>
      {section.accounts.map((acct) => (
        <div
          key={acct.code}
          className="flex items-center justify-between px-4 py-1.5 border-b border-slate-50 hover:bg-slate-50/40 last:border-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono text-slate-400 w-14 shrink-0">{acct.code}</span>
            <span className="text-sm text-slate-700 truncate">{acct.name}</span>
          </div>
          <span className="text-sm text-slate-700 tabular-nums ml-4 shrink-0">
            {fmt(acct.balance)}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-t border-slate-200">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Total {section.name}
        </span>
        <span className="text-sm font-semibold text-slate-800 tabular-nums">
          {fmt(section.total)}
        </span>
      </div>
    </div>
  );
}

// ── Grand total row ───────────────────────────────────────────────────────────

function GrandTotal({
  label,
  amount,
  highlight = false
}: {
  label: string;
  amount: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 border-t-2 border-slate-300 ${highlight ? "bg-(--color-primary)/5" : "bg-slate-100"}`}
    >
      <span
        className={`text-sm font-bold ${highlight ? "text-(--color-primary)" : "text-slate-800"}`}
      >
        {label}
      </span>
      <span
        className={`text-base font-bold tabular-nums ${highlight ? "text-(--color-primary)" : "text-slate-800"}`}
      >
        {fmt(amount)}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BalanceSheetPage() {
  const apiContext = useApiContext();
  const [periodId, setPeriodId] = useState("NONE");

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
    queryKey: ["balance-sheet", apiContext?.tenantSlug, apiContext?.entityId, activePeriodId],
    queryFn: async () => {
      if (!apiContext || !activePeriodId) return null;
      const res = await getBalanceSheet(apiContext, activePeriodId);
      return res.data as BalanceSheetResult;
    },
    enabled: Boolean(apiContext && activePeriodId)
  });

  const report = reportQuery.data ?? null;

  const balanced = report
    ? Math.abs(Number(report.totalAssets) - Number(report.totalLiabilitiesAndEquity)) < 0.01
    : null;

  const selectedPeriod = periodsQuery.data?.find((p) => p.id === activePeriodId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--color-primary)">Balance Sheet</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Statement of Financial Position</p>
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
                const url = getBalanceSheetPdfUrl(activePeriodId);
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
                a.download = `balance-sheet-${report.asOf}.pdf`;
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
                className={`flex items-center gap-1.5 pt-5 text-sm font-medium ${balanced ? "text-emerald-600" : "text-red-600"}`}
              >
                {balanced ? (
                  <>
                    <CheckCircle2 className="h-4 w-4" /> Balanced
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4" /> Out of balance
                  </>
                )}
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Assets column */}
          <Card className="overflow-hidden">
            <CardHeader className="bg-blue-600 py-3 px-4">
              <CardTitle className="text-sm text-white">Assets</CardTitle>
            </CardHeader>
            <CardContent className="p-0 divide-y divide-slate-100">
              {report.assets.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  No asset accounts with balances.
                </p>
              ) : (
                report.assets.map((s) => <SectionBlock key={s.name} section={s} />)
              )}
              <GrandTotal label="Total Assets" amount={report.totalAssets} highlight />
            </CardContent>
          </Card>

          {/* Liabilities + Equity column */}
          <div className="space-y-6">
            <Card className="overflow-hidden">
              <CardHeader className="bg-slate-700 py-3 px-4">
                <CardTitle className="text-sm text-white">Liabilities</CardTitle>
              </CardHeader>
              <CardContent className="p-0 divide-y divide-slate-100">
                {report.liabilities.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    No liability accounts with balances.
                  </p>
                ) : (
                  report.liabilities.map((s) => <SectionBlock key={s.name} section={s} />)
                )}
                <GrandTotal label="Total Liabilities" amount={report.totalLiabilities} />
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader className="bg-emerald-700 py-3 px-4">
                <CardTitle className="text-sm text-white">Equity</CardTitle>
              </CardHeader>
              <CardContent className="p-0 divide-y divide-slate-100">
                {report.equity.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    No equity accounts with balances.
                  </p>
                ) : (
                  report.equity.map((s) => <SectionBlock key={s.name} section={s} />)
                )}
                <GrandTotal label="Total Equity" amount={report.totalEquity} />
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-2 border-(--color-primary)/30">
              <GrandTotal
                label="Total Liabilities & Equity"
                amount={report.totalLiabilitiesAndEquity}
                highlight
              />
            </Card>
          </div>
        </div>
      )}

      {/* No period selected */}
      {!activePeriodId && !reportQuery.isLoading && (
        <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
          <Scale className="h-8 w-8 opacity-30" />
          <p className="text-sm">Select a reporting period to view the Balance Sheet.</p>
        </div>
      )}
    </div>
  );
}
