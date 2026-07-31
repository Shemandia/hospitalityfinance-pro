"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { Clock, Download, RefreshCw, Mail, AlertTriangle, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "../../../../../../components/ui/card";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
import { Input } from "../../../../../../components/ui/input";
import {
  getARAgeing,
  runARDunning,
  type AgeingRow,
  type ApiContext
} from "../../../../../../lib/gl-api";
import { fmtDecimal as fmt, fmtDecimal } from "../../../../../../lib/format";

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function sumBucket(rows: AgeingRow[], field: keyof AgeingRow) {
  return rows.reduce((s, r) => s + parseFloat(String(r[field] || "0")), 0);
}

function exportToCsv(rows: AgeingRow[], asOf: string) {
  const headers = [
    "Customer Code",
    "Customer Name",
    "Currency",
    "0–30 days",
    "31–60 days",
    "61–90 days",
    "91+ days",
    "Total Outstanding"
  ];
  const body = rows.map((r) =>
    [
      r.customerCode,
      r.customerName,
      r.currency,
      r.bucket0to30,
      r.bucket31to60,
      r.bucket61to90,
      r.bucket91Plus,
      r.totalOutstanding
    ]
      .map((f) => `"${String(f ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = [headers.join(","), ...body].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: `ar-ageing-${asOf}.csv`
  });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Bucket config ─────────────────────────────────────────────────────────────

const BUCKETS = [
  {
    key: "bucket0to30" as keyof AgeingRow,
    label: "0–30 days",
    headerClass: "text-emerald-700",
    cellClass: "text-emerald-700"
  },
  {
    key: "bucket31to60" as keyof AgeingRow,
    label: "31–60 days",
    headerClass: "text-amber-600",
    cellClass: "text-amber-600"
  },
  {
    key: "bucket61to90" as keyof AgeingRow,
    label: "61–90 days",
    headerClass: "text-orange-600",
    cellClass: "text-orange-600"
  },
  {
    key: "bucket91Plus" as keyof AgeingRow,
    label: "91+ days",
    headerClass: "text-red-700",
    cellClass: "text-red-700 font-semibold"
  }
];

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  amount,
  className,
  pct
}: {
  label: string;
  amount: number;
  className?: string;
  pct?: number;
}) {
  return (
    <div className={`rounded-lg border p-4 bg-card ${className ?? ""}`}>
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold mt-1">{fmtDecimal(amount)}</p>
      {pct !== undefined && (
        <p className="text-xs text-muted-foreground mt-0.5">{pct.toFixed(1)}% of total</p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AgeingPage() {
  const ctx = useApiContext();

  const [asOf, setAsOf] = useState(todayIso());
  const [search, setSearch] = useState("");
  const [dunningResult, setDunningResult] = useState<{ sent: number } | null>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const {
    data: ageingRes,
    isLoading,
    error: loadError,
    refetch
  } = useQuery({
    queryKey: ["ar-ageing", ctx?.tenantSlug, ctx?.entityId, asOf],
    queryFn: () => getARAgeing(ctx!, asOf),
    enabled: !!ctx
  });

  const report = ageingRes?.data;
  const rows: AgeingRow[] = report?.data ?? [];

  // ── Filter ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) => r.customerName.toLowerCase().includes(q) || r.customerCode.toLowerCase().includes(q)
    );
  }, [rows, search]);

  // ── Totals ────────────────────────────────────────────────────────────────

  const totals = useMemo(
    () => ({
      bucket0to30: sumBucket(filtered, "bucket0to30"),
      bucket31to60: sumBucket(filtered, "bucket31to60"),
      bucket61to90: sumBucket(filtered, "bucket61to90"),
      bucket91Plus: sumBucket(filtered, "bucket91Plus"),
      total: sumBucket(filtered, "totalOutstanding")
    }),
    [filtered]
  );

  const overdue = totals.bucket31to60 + totals.bucket61to90 + totals.bucket91Plus;

  // ── Dunning ───────────────────────────────────────────────────────────────

  const dunningMutation = useMutation({
    mutationFn: () => runARDunning(ctx!),
    onSuccess: (res) => setDunningResult({ sent: res.data.dunningEmailsSent })
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Clock className="h-6 w-6 text-muted-foreground" />
            Accounts Receivable Ageing Report
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Outstanding receivables grouped by days overdue
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <label htmlFor="ar-as-of" className="text-sm text-muted-foreground whitespace-nowrap">
              As of:
            </label>
            <Input
              id="ar-as-of"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="w-40 h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportToCsv(filtered, asOf)}
            disabled={filtered.length === 0}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
            onClick={() => {
              setDunningResult(null);
              dunningMutation.mutate();
            }}
            disabled={dunningMutation.isPending}
            title="Send overdue payment reminder emails (7, 14, 30 days overdue)"
          >
            <Mail className="h-3.5 w-3.5" />
            {dunningMutation.isPending ? "Sending…" : "Run Dunning"}
          </Button>
        </div>
      </div>

      {/* Dunning result */}
      {dunningResult && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-4 py-2.5">
          <Mail className="h-4 w-4 flex-shrink-0" />
          Dunning run complete — {dunningResult.sent} reminder email
          {dunningResult.sent !== 1 ? "s" : ""} sent.
          <button
            onClick={() => setDunningResult(null)}
            className="ml-auto text-emerald-600 hover:text-emerald-800 underline text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {dunningMutation.isError && (
        <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-4 py-2.5">
          Dunning failed: {(dunningMutation.error as Error).message}
        </div>
      )}

      {/* Summary cards */}
      {!isLoading && !loadError && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryCard
            label="Total Outstanding"
            amount={totals.total}
            className="border-primary/20"
          />
          <SummaryCard
            label="0–30 days (current)"
            amount={totals.bucket0to30}
            className="border-emerald-200"
            pct={totals.total > 0 ? (totals.bucket0to30 / totals.total) * 100 : 0}
          />
          <SummaryCard
            label="31–60 days"
            amount={totals.bucket31to60}
            className="border-amber-200"
            pct={totals.total > 0 ? (totals.bucket31to60 / totals.total) * 100 : 0}
          />
          <SummaryCard
            label="61–90 days"
            amount={totals.bucket61to90}
            className="border-orange-200"
            pct={totals.total > 0 ? (totals.bucket61to90 / totals.total) * 100 : 0}
          />
          <SummaryCard
            label="91+ days"
            amount={totals.bucket91Plus}
            className="border-red-200"
            pct={totals.total > 0 ? (totals.bucket91Plus / totals.total) * 100 : 0}
          />
        </div>
      )}

      {/* Overdue alert */}
      {!isLoading && overdue > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>
            <strong>{fmtDecimal(overdue)}</strong> is overdue (31+ days) across{" "}
            {
              filtered.filter(
                (r) =>
                  parseFloat(r.bucket31to60) +
                    parseFloat(r.bucket61to90) +
                    parseFloat(r.bucket91Plus) >
                  0
              ).length
            }{" "}
            customer
            {filtered.filter(
              (r) =>
                parseFloat(r.bucket31to60) +
                  parseFloat(r.bucket61to90) +
                  parseFloat(r.bucket91Plus) >
                0
            ).length !== 1
              ? "s"
              : ""}
            .
          </span>
          {totals.total > 0 && (
            <Badge variant="warning" className="ml-1 text-xs">
              {((overdue / totals.total) * 100).toFixed(1)}% of total
            </Badge>
          )}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Search customer name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs h-9"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Clear
              </button>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} customer{filtered.length !== 1 ? "s" : ""}
              {report?.asOfDate &&
                ` · as of ${new Date(report.asOfDate).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`}
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Loading ageing data…
            </div>
          )}

          {loadError && (
            <div className="py-16 text-center text-sm text-destructive">
              Failed to load: {(loadError as Error).message}
            </div>
          )}

          {!isLoading && !loadError && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide">
                    <th className="py-2.5 px-4 text-left font-medium text-muted-foreground">
                      Customer
                    </th>
                    <th className="py-2.5 px-4 text-left font-medium text-muted-foreground w-24">
                      Code
                    </th>
                    <th className="py-2.5 px-4 text-left font-medium text-muted-foreground w-20">
                      Currency
                    </th>
                    {BUCKETS.map((b) => (
                      <th
                        key={b.key}
                        className={`py-2.5 px-4 text-right font-medium w-32 ${b.headerClass}`}
                      >
                        {b.label}
                      </th>
                    ))}
                    <th className="py-2.5 px-4 text-right font-medium text-muted-foreground w-36">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                        {search
                          ? `No customers match "${search}"`
                          : "No outstanding receivables for this date."}
                      </td>
                    </tr>
                  ) : (
                    <>
                      {filtered.map((row) => {
                        const isHighRisk = parseFloat(row.bucket91Plus) > 0;
                        const isAtRisk = parseFloat(row.bucket61to90) > 0;
                        return (
                          <tr
                            key={row.customerId}
                            className={`border-b border-border/50 hover:bg-muted/30 transition-colors ${
                              isHighRisk ? "bg-red-50/40" : isAtRisk ? "bg-orange-50/30" : ""
                            }`}
                          >
                            <td className="py-2.5 px-4 font-medium">
                              <div className="flex items-center gap-1.5">
                                {isHighRisk && (
                                  <TrendingDown className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                                )}
                                {row.customerName}
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-xs font-mono text-muted-foreground">
                              {row.customerCode}
                            </td>
                            <td className="py-2.5 px-4 text-xs text-muted-foreground">
                              {row.currency}
                            </td>
                            {BUCKETS.map((b) => (
                              <td
                                key={b.key}
                                className={`py-2.5 px-4 text-right tabular-nums ${b.cellClass}`}
                              >
                                {fmt(row[b.key] as string)}
                              </td>
                            ))}
                            <td className="py-2.5 px-4 text-right font-semibold tabular-nums">
                              {fmtDecimal(row.totalOutstanding)}
                            </td>
                          </tr>
                        );
                      })}

                      {/* Totals footer */}
                      <tr className="border-t-2 border-border bg-muted/50 font-semibold text-sm">
                        <td colSpan={3} className="py-2.5 px-4 text-muted-foreground">
                          Totals ({filtered.length} customer{filtered.length !== 1 ? "s" : ""})
                        </td>
                        {BUCKETS.map((b) => (
                          <td
                            key={b.key}
                            className={`py-2.5 px-4 text-right tabular-nums ${b.headerClass}`}
                          >
                            {fmtDecimal(totals[b.key as keyof typeof totals] as number)}
                          </td>
                        ))}
                        <td className="py-2.5 px-4 text-right tabular-nums">
                          {fmtDecimal(totals.total)}
                        </td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-100 border border-red-200" />
          Row highlight: 91+ days outstanding
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-orange-50 border border-orange-200" />
          Row highlight: 61–90 days outstanding
        </div>
        <div className="flex items-center gap-1.5">
          <TrendingDown className="h-3.5 w-3.5 text-red-500" />
          High-risk customer (91+ days balance)
        </div>
      </div>
    </div>
  );
}
