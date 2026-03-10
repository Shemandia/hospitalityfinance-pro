"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileSpreadsheet } from "lucide-react";
import { useApiContext } from "../../../../components/use-api-context";
import { getPeriods, getTrialBalance } from "../../../../lib/gl-api";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";

type TrialBalanceRow = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  accountLevel: number;
  openingBalance: string;
  periodDebits: string;
  periodCredits: string;
  closingBalance: string;
  comparativeClosingBalance?: string | null;
};

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
const TYPE_LABELS: Record<string, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expenses",
};
const TYPE_COLORS: Record<string, string> = {
  ASSET: "text-blue-700",
  LIABILITY: "text-red-700",
  EQUITY: "text-purple-700",
  REVENUE: "text-emerald-700",
  EXPENSE: "text-amber-700",
};

function fmt(v: string | number) {
  const n = parseFloat(String(v));
  if (isNaN(n)) return "–";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sectionTotal(rows: TrialBalanceRow[], field: keyof TrialBalanceRow) {
  return rows.reduce((s, r) => s + parseFloat(String(r[field] ?? "0")), 0);
}

function exportToCsv(rows: TrialBalanceRow[]) {
  const headers = ["Account Code", "Account Name", "Type", "Opening Balance", "Period Debits", "Period Credits", "Closing Balance", "Comparative Closing"];
  const body = rows.map(r =>
    [r.accountCode, r.accountName, r.accountType, r.openingBalance, r.periodDebits, r.periodCredits, r.closingBalance, r.comparativeClosingBalance ?? ""]
      .map(f => `"${String(f).replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = [headers.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "trial-balance.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportToExcel(rows: TrialBalanceRow[], periodName: string) {
  const tableRows = rows.map(r =>
    `<tr>
      <td>${r.accountCode}</td>
      <td>${r.accountName}</td>
      <td>${r.accountType}</td>
      <td style="mso-number-format:'#,##0.00'">${r.openingBalance}</td>
      <td style="mso-number-format:'#,##0.00'">${r.periodDebits}</td>
      <td style="mso-number-format:'#,##0.00'">${r.periodCredits}</td>
      <td style="mso-number-format:'#,##0.00'">${r.closingBalance}</td>
      <td style="mso-number-format:'#,##0.00'">${r.comparativeClosingBalance ?? ""}</td>
    </tr>`
  ).join("");

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="UTF-8">
<style>
  th { background:#0f2d5e; color:#fff; font-weight:bold; padding:4px 8px; }
  td { padding:3px 8px; border:1px solid #e2e8f0; }
</style>
</head>
<body>
<h2>Trial Balance — ${periodName}</h2>
<table border="1">
  <thead><tr>
    <th>Account Code</th><th>Account Name</th><th>Type</th>
    <th>Opening Balance</th><th>Period Debits</th><th>Period Credits</th>
    <th>Closing Balance</th><th>Comparative Closing</th>
  </tr></thead>
  <tbody>${tableRows}</tbody>
</table>
</body></html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "trial-balance.xls";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function SectionRow({ row, hasComparative }: { row: TrialBalanceRow; hasComparative: boolean }) {
  const indent = Math.max(0, (row.accountLevel ?? 1) - 1) * 16;
  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="py-1.5 px-3 text-sm font-mono text-muted-foreground w-24">{row.accountCode}</td>
      <td className="py-1.5 px-3 text-sm" style={{ paddingLeft: `${12 + indent}px` }}>{row.accountName}</td>
      <td className="py-1.5 px-3 text-sm text-right tabular-nums">{fmt(row.openingBalance)}</td>
      <td className="py-1.5 px-3 text-sm text-right tabular-nums">{fmt(row.periodDebits)}</td>
      <td className="py-1.5 px-3 text-sm text-right tabular-nums">{fmt(row.periodCredits)}</td>
      <td className="py-1.5 px-3 text-sm text-right tabular-nums font-medium">{fmt(row.closingBalance)}</td>
      {hasComparative && (
        <td className="py-1.5 px-3 text-sm text-right tabular-nums text-muted-foreground">
          {row.comparativeClosingBalance != null ? fmt(row.comparativeClosingBalance) : "–"}
        </td>
      )}
    </tr>
  );
}

function SectionGroup({
  type,
  rows,
  hasComparative,
}: {
  type: string;
  rows: TrialBalanceRow[];
  hasComparative: boolean;
}) {
  const [open, setOpen] = useState(true);
  if (rows.length === 0) return null;

  const totals = {
    opening: sectionTotal(rows, "openingBalance"),
    debits: sectionTotal(rows, "periodDebits"),
    credits: sectionTotal(rows, "periodCredits"),
    closing: sectionTotal(rows, "closingBalance"),
  };

  return (
    <>
      <tr
        className="cursor-pointer select-none bg-muted/50 hover:bg-muted/70 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <td colSpan={hasComparative ? 7 : 6} className="py-2 px-3">
          <div className="flex items-center gap-2">
            {open
              ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <span className={`text-sm font-semibold ${TYPE_COLORS[type] ?? "text-foreground"}`}>
              {TYPE_LABELS[type] ?? type}
            </span>
            <span className="text-xs text-muted-foreground ml-1">({rows.length} accounts)</span>
          </div>
        </td>
      </tr>

      {open && rows.map(row => (
        <SectionRow key={row.accountId} row={row} hasComparative={hasComparative} />
      ))}

      <tr className="bg-muted/20 border-t border-border/60">
        <td className="py-1.5 px-3 text-xs text-muted-foreground font-medium" colSpan={2}>
          Total {TYPE_LABELS[type] ?? type}
        </td>
        <td className="py-1.5 px-3 text-xs text-right tabular-nums font-semibold">{fmt(totals.opening)}</td>
        <td className="py-1.5 px-3 text-xs text-right tabular-nums font-semibold">{fmt(totals.debits)}</td>
        <td className="py-1.5 px-3 text-xs text-right tabular-nums font-semibold">{fmt(totals.credits)}</td>
        <td className="py-1.5 px-3 text-xs text-right tabular-nums font-semibold">{fmt(totals.closing)}</td>
        {hasComparative && <td />}
      </tr>
    </>
  );
}

export default function TrialBalancePage() {
  const apiContext = useApiContext();
  const [periodId, setPeriodId] = useState("");
  const [comparativePeriodId, setComparativePeriodId] = useState("");
  const [showZero, setShowZero] = useState(false);

  const periodsQuery = useQuery({
    queryKey: ["periods", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const r = await getPeriods(apiContext);
      return (r.data as unknown as Array<{ id: string; name: string; status: string }>) ?? [];
    },
    enabled: Boolean(apiContext),
  });
  const periods = periodsQuery.data ?? [];

  const trialBalanceQuery = useQuery({
    queryKey: ["trial-balance", apiContext?.entityId, periodId, comparativePeriodId, showZero],
    queryFn: async () => {
      if (!apiContext || !periodId) return { rows: [] as TrialBalanceRow[], isBalanced: true };
      const r = await getTrialBalance(apiContext, {
        periodId,
        comparativePeriodId: comparativePeriodId || undefined,
        showZeroBalances: showZero,
      });
      return {
        rows: (r.data as unknown as TrialBalanceRow[]) ?? [],
        isBalanced: Boolean(r.meta?.isBalanced),
      };
    },
    enabled: Boolean(apiContext && periodId),
  });

  const rows = trialBalanceQuery.data?.rows ?? [];
  const isBalanced = trialBalanceQuery.data?.isBalanced ?? true;
  const hasComparative = Boolean(comparativePeriodId) && rows.some(r => r.comparativeClosingBalance != null);

  const grouped = useMemo(() => {
    const map = new Map<string, TrialBalanceRow[]>();
    for (const type of TYPE_ORDER) map.set(type, []);
    for (const row of rows) {
      const t = row.accountType ?? "ASSET";
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(row);
    }
    return map;
  }, [rows]);

  const grandTotals = useMemo(() => ({
    opening: rows.reduce((s, r) => s + parseFloat(r.openingBalance), 0),
    debits: rows.reduce((s, r) => s + parseFloat(r.periodDebits), 0),
    credits: rows.reduce((s, r) => s + parseFloat(r.periodCredits), 0),
    closing: rows.reduce((s, r) => s + parseFloat(r.closingBalance), 0),
  }), [rows]);

  const selectedPeriod = periods.find(p => p.id === periodId);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 py-3 px-6">
          <div className="flex items-center gap-2">
            <label htmlFor="tb-period" className="text-sm font-medium whitespace-nowrap">Period</label>
            <select
              id="tb-period"
              value={periodId}
              onChange={e => setPeriodId(e.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2.5 text-sm"
            >
              <option value="">Select period</option>
              {periods.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.status === "OPEN" ? " (Open)" : ""}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="tb-comp" className="text-sm font-medium whitespace-nowrap">Comparative</label>
            <select
              id="tb-comp"
              value={comparativePeriodId}
              onChange={e => setComparativePeriodId(e.target.value)}
              className="h-8 rounded-md border border-border bg-white px-2.5 text-sm"
            >
              <option value="">None</option>
              {periods.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={showZero}
              onChange={e => setShowZero(e.target.checked)}
              className="rounded"
            />
            Show zero balances
          </label>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportToCsv(rows)}
              disabled={rows.length === 0}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportToExcel(rows, selectedPeriod?.name ?? "Trial Balance")}
              disabled={rows.length === 0}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1" />
              Excel
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Balance Status */}
      {rows.length > 0 && (
        <div className="flex items-center gap-3 px-1">
          <Badge variant={isBalanced ? "success" : "destructive"}>
            {isBalanced ? "Balanced" : "Not Balanced"}
          </Badge>
          <span className="text-sm text-muted-foreground">
            Period Debits:{" "}
            <strong className="text-foreground">{fmt(grandTotals.debits)}</strong>
            {" · "}
            Period Credits:{" "}
            <strong className="text-foreground">{fmt(grandTotals.credits)}</strong>
          </span>
          <span className="text-sm text-muted-foreground ml-auto">{rows.length} accounts</span>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-2 px-6 pt-4">
          <CardTitle className="text-primary text-base">
            Trial Balance
            {selectedPeriod && (
              <Badge variant="info" className="ml-2 font-normal">{selectedPeriod.name}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {!periodId ? (
            <p className="text-sm text-muted-foreground px-6 pb-6">Select a period to load the trial balance.</p>
          ) : trialBalanceQuery.isLoading ? (
            <p className="text-sm text-muted-foreground px-6 pb-6">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 pb-6">No data for the selected period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground w-24">Code</th>
                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground">Account</th>
                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground text-right">Opening</th>
                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground text-right">Debits</th>
                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground text-right">Credits</th>
                    <th className="py-2 px-3 text-xs font-semibold text-muted-foreground text-right">Closing</th>
                    {hasComparative && (
                      <th className="py-2 px-3 text-xs font-semibold text-muted-foreground text-right">Comparative</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {TYPE_ORDER.map(type => (
                    <SectionGroup
                      key={type}
                      type={type}
                      rows={grouped.get(type) ?? []}
                      hasComparative={hasComparative}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-primary/20 bg-primary/5">
                    <td className="py-2.5 px-3 text-sm font-bold text-primary" colSpan={2}>
                      Grand Total
                    </td>
                    <td className="py-2.5 px-3 text-sm text-right tabular-nums font-bold">{fmt(grandTotals.opening)}</td>
                    <td className="py-2.5 px-3 text-sm text-right tabular-nums font-bold">{fmt(grandTotals.debits)}</td>
                    <td className="py-2.5 px-3 text-sm text-right tabular-nums font-bold">{fmt(grandTotals.credits)}</td>
                    <td className="py-2.5 px-3 text-sm text-right tabular-nums font-bold">{fmt(grandTotals.closing)}</td>
                    {hasComparative && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
