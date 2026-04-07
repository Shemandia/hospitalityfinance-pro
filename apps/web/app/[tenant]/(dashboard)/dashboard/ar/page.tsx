"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTenantRouter } from "../../../../../hooks/use-tenant-router";
import { useApiContext } from "../../../../../components/use-api-context";
import { useUserRole } from "../../../../../components/use-user-role";
import {
  getARInvoices,
  getARAgeing,
  getARCustomers,
  runARDunning
} from "../../../../../lib/gl-api";
import type { AgeingRow } from "../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../components/ui/table";
import { fmt, fmtDate } from "../../../../../lib/format";

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "DRAFT":
      return "secondary";
    case "POSTED":
      return "default";
    case "PAID":
      return "default";
    case "OVERDUE":
      return "destructive";
    case "CANCELLED":
      return "destructive";
    case "PARTIALLY_PAID":
      return "outline";
    default:
      return "secondary";
  }
}

type ARInvoice = {
  id: string;
  customerId: string;
  customer?: { id: string; name: string; code: string };
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  grossAmount: string;
  taxAmount: string;
  netAmount: string;
  status: string;
  createdAt: string;
  paidAmount?: string;
};

type ARCustomer = {
  id: string;
  name: string;
  code: string;
  currency: string;
};

// ── Small components ─────────────────────────────────────────────────────────

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
    <Card>
      <CardContent className="pt-6">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </p>
        <p className={`text-2xl font-bold leading-tight mt-1 ${accent ?? "text-primary"}`}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2 pt-4">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="h-3 w-24 bg-muted rounded animate-pulse" />
              <div className="h-8 w-32 bg-muted rounded animate-pulse mt-2" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Ageing bucket colors ─────────────────────────────────────────────────────

const BUCKET_CONFIG = [
  {
    label: "0 – 30 days",
    key: "bucket0to30" as const,
    color: "bg-emerald-500",
    textColor: "text-emerald-700"
  },
  {
    label: "31 – 60 days",
    key: "bucket31to60" as const,
    color: "bg-amber-500",
    textColor: "text-amber-700"
  },
  {
    label: "61 – 90 days",
    key: "bucket61to90" as const,
    color: "bg-orange-500",
    textColor: "text-orange-700"
  },
  {
    label: "91+ days",
    key: "bucket91Plus" as const,
    color: "bg-red-500",
    textColor: "text-red-700"
  }
] as const;

// ── Main page ────────────────────────────────────────────────────────────────

export default function ARDashboardPage() {
  const router = useTenantRouter();
  const apiContext = useApiContext();
  const { canAdmin } = useUserRole();
  const queryClient = useQueryClient();
  const [dunningStatus, setDunningStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle"
  );
  const [dunningResult, setDunningResult] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const invoicesQuery = useQuery({
    queryKey: ["ar-invoices-all"],
    queryFn: () => getARInvoices(apiContext!),
    enabled: !!apiContext
  });

  const ageingQuery = useQuery({
    queryKey: ["ar-ageing"],
    queryFn: () => getARAgeing(apiContext!),
    enabled: !!apiContext
  });

  const customersQuery = useQuery({
    queryKey: ["ar-customers"],
    queryFn: () => getARCustomers(apiContext!),
    enabled: !!apiContext
  });

  // ── Dunning mutation ─────────────────────────────────────────────────────

  const dunningMutation = useMutation({
    mutationFn: () => runARDunning(apiContext!),
    onSuccess: (result) => {
      setDunningStatus("success");
      const count = result.data?.dunningEmailsSent ?? 0;
      setDunningResult(`${count} dunning email${count !== 1 ? "s" : ""} sent`);
      queryClient.invalidateQueries({ queryKey: ["ar-invoices-all"] });
    },
    onError: (err: Error) => {
      setDunningStatus("error");
      setDunningResult(err.message ?? "Failed to run dunning");
    }
  });

  // ── Derived data ─────────────────────────────────────────────────────────

  const invoices = (invoicesQuery.data?.data ?? []) as ARInvoice[];
  const ageingRows =
    (ageingQuery.data?.data as { data?: AgeingRow[] })?.data ??
    (ageingQuery.data?.data as AgeingRow[] | undefined) ??
    [];
  const customers = (customersQuery.data?.data ?? []) as ARCustomer[];

  const customerMap = useMemo(() => {
    const m = new Map<string, ARCustomer>();
    for (const c of customers) m.set(c.id, c);
    return m;
  }, [customers]);

  // KPI calculations
  const outstandingInvoices = useMemo(
    () => invoices.filter((inv) => inv.status !== "PAID" && inv.status !== "CANCELLED"),
    [invoices]
  );

  const totalOutstanding = useMemo(
    () => outstandingInvoices.reduce((sum, inv) => sum + parseFloat(inv.grossAmount || "0"), 0),
    [outstandingInvoices]
  );

  const overdueInvoices = useMemo(
    () =>
      outstandingInvoices.filter((inv) => {
        return daysSince(inv.dueDate) > 0;
      }),
    [outstandingInvoices]
  );

  const receiptsThisMonth = useMemo(() => {
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();
    return invoices.filter((inv) => {
      if (inv.status !== "PAID") return false;
      const d = new Date(inv.createdAt);
      return d.getFullYear() === thisYear && d.getMonth() === thisMonth;
    });
  }, [invoices]);

  const receiptsTotal = useMemo(
    () => receiptsThisMonth.reduce((sum, inv) => sum + parseFloat(inv.grossAmount || "0"), 0),
    [receiptsThisMonth]
  );

  const collectionRate = useMemo(() => {
    const totalInvoiced = invoices.reduce(
      (sum, inv) => sum + parseFloat(inv.grossAmount || "0"),
      0
    );
    const totalPaid = invoices
      .filter((inv) => inv.status === "PAID")
      .reduce((sum, inv) => sum + parseFloat(inv.grossAmount || "0"), 0);
    if (totalInvoiced === 0) return 0;
    return (totalPaid / totalInvoiced) * 100;
  }, [invoices]);

  // Ageing bucket totals
  const bucketTotals = useMemo(() => {
    const actualRows = Array.isArray(ageingRows) ? ageingRows : [];
    return {
      bucket0to30: actualRows.reduce((s, r) => s + parseFloat(r.bucket0to30 || "0"), 0),
      bucket31to60: actualRows.reduce((s, r) => s + parseFloat(r.bucket31to60 || "0"), 0),
      bucket61to90: actualRows.reduce((s, r) => s + parseFloat(r.bucket61to90 || "0"), 0),
      bucket91Plus: actualRows.reduce((s, r) => s + parseFloat(r.bucket91Plus || "0"), 0)
    };
  }, [ageingRows]);

  // Recent invoices sorted by creation
  const recentInvoices = useMemo(
    () =>
      [...invoices]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    [invoices]
  );

  // Top debtors
  const topDebtors = useMemo(() => {
    const balances = new Map<string, { name: string; total: number }>();
    for (const inv of outstandingInvoices) {
      const customerName =
        inv.customer?.name ??
        customerMap.get(inv.customerId)?.name ??
        inv.customerId?.slice(0, 8) ??
        "Unknown";
      const cid = inv.customerId ?? "unknown";
      const existing = balances.get(cid) ?? { name: customerName, total: 0 };
      existing.total += parseFloat(inv.grossAmount || "0");
      balances.set(cid, existing);
    }
    return [...balances.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [outstandingInvoices, customerMap]);

  // ── Loading / error states ───────────────────────────────────────────────

  if (!apiContext) {
    return (
      <div className="p-6 text-muted-foreground">
        Connecting... Please ensure you are logged in.
      </div>
    );
  }

  if (invoicesQuery.isLoading || ageingQuery.isLoading) {
    return <LoadingSkeleton />;
  }

  if (invoicesQuery.isError) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load AR data</p>
            <p className="text-sm text-muted-foreground mt-1">
              {(invoicesQuery.error as Error)?.message ?? "Unknown error"}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => invoicesQuery.refetch()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const maxDebtorBalance = topDebtors.length > 0 ? Math.max(...topDebtors.map((d) => d.total)) : 1;

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Accounts Receivable Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Outstanding receivables, ageing analysis, and collections overview
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Total AR Outstanding"
          value={fmt(totalOutstanding, 2)}
          sub={`${outstandingInvoices.length} open invoices`}
        />
        <KPICard
          label="Overdue Invoices"
          value={String(overdueInvoices.length)}
          sub={
            overdueInvoices.length > 0
              ? `${fmt(
                  overdueInvoices.reduce((s, inv) => s + parseFloat(inv.grossAmount || "0"), 0),
                  2
                )} overdue`
              : "No overdue invoices"
          }
          accent={overdueInvoices.length > 0 ? "text-red-600" : "text-emerald-600"}
        />
        <KPICard
          label="Receipts This Month"
          value={fmt(receiptsTotal, 2)}
          sub={`${receiptsThisMonth.length} payments received`}
          accent="text-emerald-600"
        />
        <KPICard
          label="Collection Rate"
          value={`${collectionRate.toFixed(1)}%`}
          sub="Paid vs total invoiced"
          accent={
            collectionRate >= 80
              ? "text-emerald-600"
              : collectionRate >= 50
                ? "text-amber-600"
                : "text-red-600"
          }
        />
      </div>

      {/* AR Ageing Summary */}
      <SectionHeader title="AR Ageing Summary" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {BUCKET_CONFIG.map((bucket) => {
          const value = bucketTotals[bucket.key];
          const grandTotal =
            bucketTotals.bucket0to30 +
            bucketTotals.bucket31to60 +
            bucketTotals.bucket61to90 +
            bucketTotals.bucket91Plus;
          const pct = grandTotal > 0 ? (value / grandTotal) * 100 : 0;
          return (
            <Card key={bucket.key}>
              <CardContent className="pt-6">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {bucket.label}
                </p>
                <p className={`text-xl font-bold mt-1 ${bucket.textColor}`}>{fmt(value, 2)}</p>
                <div className="mt-2">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full ${bucket.color} rounded-full transition-all`}
                      style={{ width: `${Math.max(pct, 1)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{pct.toFixed(1)}% of total</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recent AR Invoices */}
      <SectionHeader title="Recent AR Invoices" />
      <Card>
        <CardContent className="pt-4 px-0">
          {recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 py-4">No invoices found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Days Overdue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentInvoices.map((inv) => {
                  const customerName =
                    inv.customer?.name ?? customerMap.get(inv.customerId)?.name ?? "—";
                  const overdueDays = daysSince(inv.dueDate);
                  const isOverdue =
                    overdueDays > 0 && inv.status !== "PAID" && inv.status !== "CANCELLED";
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{customerName}</TableCell>
                      <TableCell className="font-mono text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-right font-mono">
                        {fmt(inv.grossAmount, 2)}{" "}
                        <span className="text-muted-foreground text-xs">{inv.currency}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(inv.status)}>
                          {inv.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isOverdue ? (
                          <span className="text-red-600 font-medium">{overdueDays}d</span>
                        ) : inv.status === "PAID" || inv.status === "CANCELLED" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="text-emerald-600">Current</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Bottom two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Debtors */}
        <div>
          <SectionHeader title="Top 5 Debtors" />
          <Card className="mt-2">
            <CardContent className="pt-4">
              {topDebtors.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No outstanding debtor balances.
                </p>
              ) : (
                <div className="space-y-3">
                  {topDebtors.map((d, i) => {
                    const pct = (d.total / maxDebtorBalance) * 100;
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate max-w-[200px]">
                            {d.name}
                          </span>
                          <span className="text-sm font-mono font-medium">{fmt(d.total, 2)}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <div>
          <SectionHeader title="Quick Actions" />
          <Card className="mt-2">
            <CardContent className="pt-4">
              <div className="space-y-4">
                {/* Run Dunning */}
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Run Dunning</p>
                    <p className="text-xs text-muted-foreground">
                      Send reminder emails for overdue invoices
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canAdmin || dunningMutation.isPending}
                    onClick={() => {
                      setDunningStatus("loading");
                      setDunningResult(null);
                      dunningMutation.mutate();
                    }}
                  >
                    {dunningMutation.isPending ? "Running..." : "Run Dunning"}
                  </Button>
                </div>
                {dunningResult && (
                  <div
                    className={`text-sm px-3 py-2 rounded ${
                      dunningStatus === "success"
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-red-50 text-red-700 border border-red-200"
                    }`}
                  >
                    {dunningResult}
                  </div>
                )}

                {/* Create Receipt */}
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Create Receipt</p>
                    <p className="text-xs text-muted-foreground">
                      Record a new payment received from a customer
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      router.push("/ar");
                    }}
                  >
                    Go to AR
                  </Button>
                </div>

                {/* View Ageing Report */}
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Ageing Report</p>
                    <p className="text-xs text-muted-foreground">
                      View detailed AR ageing breakdown by customer
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      router.push("/ar/ageing");
                    }}
                  >
                    View Report
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
