"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  ExternalLink
} from "lucide-react";
import { Card, CardContent, CardHeader } from "../../../../../components/ui/card";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  getAccountLedger,
  getPeriodList,
  type AccountLedgerResult,
  type LedgerLine,
  type AccountType
} from "../../../../../lib/gl-api";

// ── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: "ALL", label: "All Statuses" },
  { value: "POSTED", label: "Posted" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_APPROVAL", label: "Pending Approval" },
  { value: "REVERSED", label: "Reversed" }
];

const STATUS_COLORS: Record<string, string> = {
  POSTED: "bg-emerald-100 text-emerald-800",
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  REVERSED: "bg-red-100 text-red-800"
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

const TYPE_COLORS: Record<AccountType, string> = {
  ASSET: "bg-blue-100 text-blue-800",
  LIABILITY: "bg-amber-100 text-amber-800",
  EQUITY: "bg-teal-100 text-teal-800",
  REVENUE: "bg-emerald-100 text-emerald-800",
  EXPENSE: "bg-slate-100 text-slate-700"
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAmount(value: string): string {
  const num = parseFloat(value);
  if (num === 0) return "—";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(dateStr: string): string {
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
        formatDate(l.journalDate),
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
  const router = useRouter();
  const ctx = useApiContext();
  const accountId = params.id as string;

  // Filters
  const [periodFilter, setPeriodFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(0);

  // Fetch periods for filter dropdown
  const { data: periodsRes } = useQuery({
    queryKey: ["periods", ctx?.entityId],
    queryFn: () => getPeriodList(ctx!),
    enabled: !!ctx
  });
  const periods = (periodsRes?.data ?? []) as Array<{ id: string; name: string }>;

  // Fetch ledger data
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

  // Use functional amounts when available, fall back to original amounts
  function effectiveDebit(line: LedgerLine): number {
    const fn = parseFloat(line.debitFunctional);
    return fn !== 0 ? fn : parseFloat(line.debit);
  }
  function effectiveCredit(line: LedgerLine): number {
    const fn = parseFloat(line.creditFunctional);
    return fn !== 0 ? fn : parseFloat(line.credit);
  }

  // Running balance calculation — only POSTED journals affect the balance
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

  // Totals for the current page
  const pageTotals = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      totalDebit += effectiveDebit(line);
      totalCredit += effectiveCredit(line);
    }
    return { totalDebit, totalCredit };
  }, [lines]);

  return (
    <div className="p-6 space-y-4">
      {/* Back + Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <button
            onClick={() => router.push("/gl/accounts")}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Chart of Accounts
          </button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-muted-foreground" />
            Account Ledger
          </h1>
          {account && (
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-lg font-semibold">{account.code}</span>
              <span className="text-lg text-muted-foreground">—</span>
              <span className="text-lg">{account.name}</span>
              <Badge className={`ml-2 text-xs ${TYPE_COLORS[account.type]}`}>{account.type}</Badge>
              <Badge variant="outline" className="text-xs">
                {account.normalBalance === "DEBIT" ? "Dr" : "Cr"} Normal
              </Badge>
              {account.usaliCategory && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  {account.usaliCategory}
                </Badge>
              )}
            </div>
          )}
        </div>
        {account && lines.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => exportCSV(account, lines)}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        )}
      </div>

      {/* Summary cards */}
      {account && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Total Transactions
              </p>
              <p className="text-2xl font-bold mt-1">{total.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Page Debits
              </p>
              <p className="text-2xl font-bold mt-1 text-sky-700">
                {pageTotals.totalDebit.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Page Credits
              </p>
              <p className="text-2xl font-bold mt-1 text-violet-700">
                {pageTotals.totalCredit.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select
              value={periodFilter}
              onValueChange={(v) => {
                setPeriodFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-52">
                <SelectValue placeholder="All Periods" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Periods</SelectItem>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(0);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(periodFilter !== "ALL" || statusFilter !== "ALL") && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setPeriodFilter("ALL");
                  setStatusFilter("ALL");
                  setPage(0);
                }}
              >
                Clear filters
              </Button>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages} ({total} rows)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Loading transactions...
            </div>
          )}

          {error && (
            <div className="py-16 text-center text-sm text-destructive">
              Failed to load ledger: {(error as Error).message}
            </div>
          )}

          {!isLoading && !error && lines.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No transactions found for this account.
            </div>
          )}

          {!isLoading && !error && lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-3 text-left font-medium w-28">Date</th>
                    <th className="py-2.5 px-3 text-left font-medium w-32">Reference</th>
                    <th className="py-2.5 px-3 text-left font-medium">Description</th>
                    <th className="py-2.5 px-3 text-left font-medium w-24">Source</th>
                    <th className="py-2.5 px-3 text-center font-medium w-28">Status</th>
                    <th className="py-2.5 px-3 text-left font-medium w-32">Period</th>
                    <th className="py-2.5 px-3 text-right font-medium w-32">Debit</th>
                    <th className="py-2.5 px-3 text-right font-medium w-32">Credit</th>
                    <th className="py-2.5 px-3 text-right font-medium w-36">Running Balance</th>
                    <th className="py-2.5 px-3 text-center font-medium w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {linesWithBalance.map((line) => {
                    const isReversed = line.journalStatus === "REVERSED";
                    // Extract invoice/voucher number from reference (e.g. "PROC-1003" → "1003")
                    const invoiceNum = line.journalRef?.includes("-")
                      ? line.journalRef.split("-").slice(1).join("-")
                      : line.journalRef;
                    return (
                      <tr
                        key={line.id}
                        className={`group border-b border-border/50 hover:bg-muted/40 transition-colors ${isReversed ? "opacity-50 line-through decoration-muted-foreground/40" : ""}`}
                      >
                        <td className="py-2 px-3 text-sm text-muted-foreground whitespace-nowrap">
                          {formatDate(line.journalDate)}
                        </td>
                        <td className="py-2 px-3 text-sm font-mono" title={line.journalRef ?? ""}>
                          {invoiceNum ?? "—"}
                        </td>
                        <td
                          className="py-2 px-3 text-sm truncate max-w-xs"
                          title={line.description ?? line.journalDescription ?? ""}
                        >
                          {line.description ?? line.journalDescription ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          {SOURCE_LABELS[line.journalSource] ?? line.journalSource}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[line.journalStatus] ?? "bg-gray-100 text-gray-700"}`}
                          >
                            {line.journalStatus.replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          {line.periodName ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-sm text-right font-mono text-sky-700">
                          {formatAmount(String(line.effectiveDebit))}
                        </td>
                        <td className="py-2 px-3 text-sm text-right font-mono text-violet-700">
                          {formatAmount(String(line.effectiveCredit))}
                        </td>
                        <td className="py-2 px-3 text-sm text-right font-mono font-medium">
                          {line.runningBalance.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => router.push(`/gl/journals?highlight=${line.journalId}`)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                            title="View journal"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                    <td colSpan={6} className="py-2 px-3 text-xs uppercase text-muted-foreground">
                      Page Total
                    </td>
                    <td className="py-2 px-3 text-sm text-right font-mono text-sky-700">
                      {pageTotals.totalDebit.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </td>
                    <td className="py-2 px-3 text-sm text-right font-mono text-violet-700">
                      {pageTotals.totalCredit.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })}
                    </td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}{" "}
            transactions
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
