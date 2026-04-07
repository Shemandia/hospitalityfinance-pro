"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  ExternalLink,
  FileText,
  TrendingUp,
  History,
  Layers
} from "lucide-react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getAccountLedger,
  getPeriodList,
  type AccountLedgerResult,
  type LedgerLine
} from "../../../../../../lib/gl-api";

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: "ALL", label: "All Statuses" },
  { value: "POSTED", label: "Posted" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_APPROVAL", label: "Pending Approval" },
  { value: "REVERSED", label: "Reversed" }
];

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  POSTED: { bg: "bg-emerald-100", text: "text-emerald-700" },
  DRAFT: { bg: "bg-slate-100", text: "text-slate-600" },
  PENDING_APPROVAL: { bg: "bg-amber-100", text: "text-amber-700" },
  REVERSED: { bg: "bg-purple-100", text: "text-purple-700" }
};

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Manual",
  PMS: "PMS",
  POS: "POS",
  PAYROLL: "Payroll",
  FX_REVAL: "FX Reval",
  AP: "AP",
  AR: "AR"
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmount(value: number): string {
  if (value === 0) return "\u2014";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function exportCSV(account: AccountLedgerResult["account"], lines: LedgerLine[]) {
  const header = "Date,Reference,Description,Source,Status,Period,Debit,Credit,Currency\n";
  const rows = lines
    .map((l) =>
      [
        fmtDate(l.journalDate),
        l.journalRef ?? "",
        `"${(l.journalDescription ?? "").replace(/"/g, '""')}"`,
        l.journalSource,
        l.journalStatus,
        l.periodName ?? "",
        l.debitFunctional,
        l.creditFunctional,
        l.currency
      ].join(",")
    )
    .join("\n");

  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledger-${account.code}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function AccountLedgerPage() {
  const params = useParams();
  const tenantHref = useTenantHref();
  const ctx = useApiContext();
  const accountId = params.id as string;

  const [periodFilter, setPeriodFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(0);

  const { data: periodsRes } = useQuery({
    queryKey: ["periods", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => getPeriodList(ctx!),
    enabled: !!ctx
  });
  const periods = (periodsRes?.data ?? []) as Array<{ id: string; name: string }>;

  const {
    data: ledgerRes,
    isLoading,
    error
  } = useQuery({
    queryKey: ["account-ledger", accountId, periodFilter, statusFilter, page, ctx?.entityId],
    queryFn: () =>
      getAccountLedger(ctx!, accountId, {
        periodId: periodFilter !== "ALL" ? periodFilter : undefined,
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      }),
    enabled: !!ctx && !!accountId
  });

  const ledger = ledgerRes?.data;
  const account = ledger?.account;
  const lines = ledger?.lines ?? [];
  const total = ledger?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function effectiveDebit(line: LedgerLine): number {
    const fn = parseFloat(line.debitFunctional);
    return fn !== 0 ? fn : parseFloat(line.debit);
  }
  function effectiveCredit(line: LedgerLine): number {
    const fn = parseFloat(line.creditFunctional);
    return fn !== 0 ? fn : parseFloat(line.credit);
  }

  const linesWithBalance = useMemo(() => {
    let running = 0;
    return lines.map((line) => {
      const debit = effectiveDebit(line);
      const credit = effectiveCredit(line);
      const isActive = line.journalStatus === "POSTED";
      if (isActive) {
        if (account?.normalBalance === "DEBIT") {
          running += debit - credit;
        } else {
          running += credit - debit;
        }
      }
      return { ...line, runningBalance: running, effectiveDebit: debit, effectiveCredit: credit };
    });
  }, [lines, account?.normalBalance]);

  const pageTotals = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      totalDebit += effectiveDebit(line);
      totalCredit += effectiveCredit(line);
    }
    return { totalDebit, totalCredit };
  }, [lines]);

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading && !account) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 p-6">
        <div className="h-8 w-48 bg-slate-100 rounded-xl animate-pulse" />
        <div className="h-48 bg-white rounded-3xl border border-slate-100 animate-pulse" />
        <div className="grid grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 bg-white rounded-2xl border border-slate-100 animate-pulse"
            />
          ))}
        </div>
        <div className="h-64 bg-white rounded-3xl border border-slate-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6 pb-20">
      {/* 1. TOP NAVIGATION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <Link
          href={tenantHref("/gl/accounts")}
          className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors"
        >
          <ArrowLeft size={18} />
          <span className="font-medium">Back to Chart of Accounts</span>
        </Link>
        {account && lines.length > 0 && (
          <button
            type="button"
            onClick={() => exportCSV(account, lines)}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-600 hover:bg-slate-50 font-medium text-sm transition-colors"
          >
            <Download size={16} /> Export CSV
          </button>
        )}
      </div>

      {/* 2. HEADER CARD */}
      {account && (
        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-slate-900">{account.code}</h1>
              <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-bold uppercase tracking-wider">
                {account.type}
              </span>
              <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wider">
                {account.normalBalance === "DEBIT" ? "Dr Normal" : "Cr Normal"}
              </span>
            </div>
            <p className="text-slate-500 text-lg">{account.name}</p>
            {account.usaliCategory && (
              <p className="text-sm text-slate-400">USALI: {account.usaliCategory}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400 font-medium">Running Balance</p>
            <p className="text-3xl font-bold text-emerald-600 tabular-nums">
              {linesWithBalance.length > 0
                ? fmtAmount(linesWithBalance[linesWithBalance.length - 1].runningBalance)
                : "0.00"}
            </p>
          </div>
        </div>
      )}

      {/* 3. INFORMATION GRID */}
      {account && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Transactions */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
              <Layers size={14} /> Transactions
            </p>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Total Lines</span>
                <span className="font-bold text-slate-800">{total.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">This Page</span>
                <span className="font-bold text-slate-800">{lines.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Allow Posting</span>
                <span className="font-bold text-slate-800">
                  {(account as any).allowPosting ? "Yes" : "No"}
                </span>
              </div>
            </div>
          </div>

          {/* Page Debits */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
              <TrendingUp size={14} /> Page Debits
            </p>
            <p className="text-3xl font-bold text-emerald-600 tabular-nums">
              {pageTotals.totalDebit.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </p>
            <p className="text-xs text-slate-400 mt-2">Debit total on current page</p>
          </div>

          {/* Page Credits */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
              <History size={14} /> Page Credits
            </p>
            <p className="text-3xl font-bold text-slate-800 tabular-nums">
              {pageTotals.totalCredit.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </p>
            <p className="text-xs text-slate-400 mt-2">Credit total on current page</p>
          </div>
        </div>
      )}

      {/* 4. LEDGER TABLE */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Filters bar */}
        <div className="p-6 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <Filter size={16} className="text-slate-400" />

          <select
            aria-label="Filter by period"
            value={periodFilter}
            onChange={(e) => {
              setPeriodFilter(e.target.value);
              setPage(0);
            }}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
          >
            <option value="ALL">All Periods</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {(periodFilter !== "ALL" || statusFilter !== "ALL") && (
            <button
              type="button"
              onClick={() => {
                setPeriodFilter("ALL");
                setStatusFilter("ALL");
                setPage(0);
              }}
              className="text-xs font-medium text-emerald-600 hover:underline"
            >
              Clear filters
            </button>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-slate-400 font-medium">
                Page {page + 1} of {totalPages} ({total} rows)
              </span>
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-30 transition-colors"
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Table content */}
        {isLoading && (
          <div className="py-16 text-center text-sm text-slate-400">Loading transactions...</div>
        )}

        {error && (
          <div className="py-16 text-center text-sm text-red-500">
            Failed to load: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && lines.length === 0 && (
          <div className="py-16 text-center">
            <BookOpen className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">No transactions found for this account.</p>
            <p className="text-xs text-slate-300 mt-1">
              Try adjusting your period or status filters.
            </p>
          </div>
        )}

        {!isLoading && !error && lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50">
                <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Reference</th>
                  <th className="px-6 py-4">Description</th>
                  <th className="px-6 py-4">Source</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Period</th>
                  <th className="px-6 py-4 text-right">Debit</th>
                  <th className="px-6 py-4 text-right">Credit</th>
                  <th className="px-6 py-4 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {linesWithBalance.map((line) => {
                  const st = STATUS_STYLES[line.journalStatus] ?? STATUS_STYLES.DRAFT;
                  return (
                    <tr key={line.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 text-sm text-slate-600 tabular-nums whitespace-nowrap">
                        {fmtDate(line.journalDate)}
                      </td>
                      <td className="px-6 py-4">
                        {line.journalId ? (
                          <Link
                            href={tenantHref(`/gl/journals/${line.journalId}`)}
                            className="font-bold text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1 text-sm"
                          >
                            {line.journalRef ?? "View"}
                            <ExternalLink size={12} />
                          </Link>
                        ) : (
                          <span className="text-sm text-slate-400">
                            {line.journalRef ?? "\u2014"}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500 italic max-w-xs truncate">
                        {line.journalDescription || line.description || "\u2014"}
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-medium text-slate-500">
                          {SOURCE_LABELS[line.journalSource] ?? line.journalSource}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-0.5 rounded-full ${st.bg} ${st.text} text-[10px] font-bold uppercase tracking-wider`}
                        >
                          {line.journalStatus.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-400">
                        {line.periodName ?? "\u2014"}
                      </td>
                      <td className="px-6 py-4 text-right tabular-nums">
                        {line.effectiveDebit > 0 ? (
                          <span className="font-bold text-emerald-600">
                            {fmtAmount(line.effectiveDebit)}
                          </span>
                        ) : (
                          <span className="text-slate-300">\u2014</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right tabular-nums">
                        {line.effectiveCredit > 0 ? (
                          <span className="font-bold text-slate-800">
                            {fmtAmount(line.effectiveCredit)}
                          </span>
                        ) : (
                          <span className="text-slate-300">\u2014</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right tabular-nums">
                        <span
                          className={`font-bold ${line.runningBalance >= 0 ? "text-slate-800" : "text-red-600"}`}
                        >
                          {fmtAmount(line.runningBalance)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr className="font-bold text-slate-800">
                  <td
                    colSpan={6}
                    className="px-6 py-4 text-right uppercase text-xs text-slate-400 tracking-[0.15em]"
                  >
                    Page Totals
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums border-t-2 border-emerald-500 text-emerald-600">
                    {pageTotals.totalDebit.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums border-t-2 border-emerald-500 text-slate-800">
                    {pageTotals.totalCredit.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums border-t-2 border-emerald-500">
                    {linesWithBalance.length > 0 && (
                      <span
                        className={
                          linesWithBalance[linesWithBalance.length - 1].runningBalance >= 0
                            ? "text-slate-800"
                            : "text-red-600"
                        }
                      >
                        {fmtAmount(linesWithBalance[linesWithBalance.length - 1].runningBalance)}
                      </span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
