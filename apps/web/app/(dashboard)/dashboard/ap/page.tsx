"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import { useUserRole } from "../../../../components/use-user-role";
import {
  getAPInvoices,
  getSuppliers,
  getPeriods,
  approveAPInvoice,
  postAPInvoice
} from "../../../../lib/gl-api";
import type { APInvoice, Supplier } from "../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../components/ui/table";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: string | number, decimals = 0): string {
  return parseFloat(String(n)).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "DRAFT":
      return "secondary";
    case "PENDING_APPROVAL":
      return "outline";
    case "APPROVED":
      return "default";
    case "POSTED":
      return "default";
    case "PAID":
      return "default";
    case "DISPUTED":
      return "destructive";
    case "CANCELLED":
      return "destructive";
    default:
      return "secondary";
  }
}

function daysUntilDue(dueDate: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

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

// ── Main page ────────────────────────────────────────────────────────────────

export default function APDashboardPage() {
  const apiContext = useApiContext();
  const { canApprove } = useUserRole();
  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const allInvoicesQuery = useQuery({
    queryKey: ["ap-invoices-all"],
    queryFn: () => getAPInvoices(apiContext!, {}),
    enabled: !!apiContext
  });

  const suppliersQuery = useQuery({
    queryKey: ["ap-suppliers"],
    queryFn: () => getSuppliers(apiContext!),
    enabled: !!apiContext
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveAPInvoice(apiContext!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ap-invoices-all"] });
      setActionLoading(null);
    },
    onError: () => setActionLoading(null)
  });

  const postMutation = useMutation({
    mutationFn: (id: string) => postAPInvoice(apiContext!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ap-invoices-all"] });
      setActionLoading(null);
    },
    onError: () => setActionLoading(null)
  });

  // ── Derived data ─────────────────────────────────────────────────────────

  const invoices: APInvoice[] = allInvoicesQuery.data?.data ?? [];
  const suppliers: Supplier[] = suppliersQuery.data?.data ?? [];

  const supplierMap = useMemo(() => {
    const m = new Map<string, Supplier>();
    for (const s of suppliers) m.set(s.id, s);
    return m;
  }, [suppliers]);

  const pendingApproval = useMemo(
    () => invoices.filter((inv) => inv.status === "DRAFT" || inv.status === "PENDING_APPROVAL"),
    [invoices]
  );

  const overdueInvoices = useMemo(
    () =>
      invoices.filter((inv) => {
        if (inv.status === "PAID" || inv.status === "CANCELLED") return false;
        return daysUntilDue(inv.dueDate) < 0;
      }),
    [invoices]
  );

  const outstandingTotal = useMemo(
    () =>
      invoices
        .filter((inv) => inv.status !== "PAID" && inv.status !== "CANCELLED")
        .reduce((sum, inv) => sum + parseFloat(inv.grossAmount || "0"), 0),
    [invoices]
  );

  const dueThisWeek = useMemo(
    () =>
      invoices.filter((inv) => {
        if (inv.status === "PAID" || inv.status === "CANCELLED") return false;
        const days = daysUntilDue(inv.dueDate);
        return days >= 0 && days <= 7;
      }),
    [invoices]
  );

  const upcomingPayments = useMemo(
    () =>
      invoices
        .filter((inv) => {
          if (inv.status === "PAID" || inv.status === "CANCELLED") return false;
          const days = daysUntilDue(inv.dueDate);
          return days >= 0 && days <= 7;
        })
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()),
    [invoices]
  );

  const supplierBalances = useMemo(() => {
    const balances = new Map<string, { name: string; total: number }>();
    for (const inv of invoices) {
      if (inv.status === "PAID" || inv.status === "CANCELLED") continue;
      const supplierName =
        inv.supplier?.name ?? supplierMap.get(inv.supplierId)?.name ?? inv.supplierId.slice(0, 8);
      const existing = balances.get(inv.supplierId) ?? {
        name: supplierName,
        total: 0
      };
      existing.total += parseFloat(inv.grossAmount || "0");
      balances.set(inv.supplierId, existing);
    }
    return [...balances.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [invoices, supplierMap]);

  const recentInvoices = useMemo(
    () =>
      [...invoices]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    [invoices]
  );

  // ── Loading / error states ───────────────────────────────────────────────

  if (!apiContext) {
    return (
      <div className="p-6 text-muted-foreground">
        Connecting... Please ensure you are logged in.
      </div>
    );
  }

  if (allInvoicesQuery.isLoading || suppliersQuery.isLoading) {
    return <LoadingSkeleton />;
  }

  if (allInvoicesQuery.isError) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive font-medium">Failed to load AP data</p>
            <p className="text-sm text-muted-foreground mt-1">
              {(allInvoicesQuery.error as Error)?.message ?? "Unknown error"}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => allInvoicesQuery.refetch()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const maxSupplierBalance =
    supplierBalances.length > 0 ? Math.max(...supplierBalances.map((s) => s.total)) : 1;

  return (
    <div className="space-y-6 p-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Accounts Payable Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Invoice workflow, upcoming payments, and supplier summary
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Pending Approval"
          value={String(pendingApproval.length)}
          sub={`${pendingApproval.length === 0 ? "All clear" : "invoices awaiting review"}`}
          accent={pendingApproval.length > 0 ? "text-amber-600" : "text-emerald-600"}
        />
        <KPICard
          label="Total AP Outstanding"
          value={fmt(outstandingTotal, 2)}
          sub="All open invoices"
        />
        <KPICard
          label="Due This Week"
          value={String(dueThisWeek.length)}
          sub={`${fmt(
            dueThisWeek.reduce((s, inv) => s + parseFloat(inv.grossAmount || "0"), 0),
            2
          )} total`}
          accent={dueThisWeek.length > 0 ? "text-amber-600" : "text-emerald-600"}
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
      </div>

      {/* Recent AP Invoices */}
      <SectionHeader title="Recent AP Invoices" />
      <Card>
        <CardContent className="pt-4 px-0">
          {recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground px-6 py-4">No invoices found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  {canApprove && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentInvoices.map((inv) => {
                  const supplierName =
                    inv.supplier?.name ?? supplierMap.get(inv.supplierId)?.name ?? "—";
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{supplierName}</TableCell>
                      <TableCell className="font-mono text-sm">{inv.invoiceNumber}</TableCell>
                      <TableCell>{fmtDate(inv.invoiceDate)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {fmt(inv.grossAmount, 2)}{" "}
                        <span className="text-muted-foreground text-xs">{inv.currency}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(inv.status)}>
                          {inv.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      {canApprove && (
                        <TableCell>
                          <div className="flex gap-1">
                            {(inv.status === "DRAFT" || inv.status === "PENDING_APPROVAL") && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={actionLoading === inv.id}
                                onClick={() => {
                                  setActionLoading(inv.id);
                                  approveMutation.mutate(inv.id);
                                }}
                              >
                                {actionLoading === inv.id ? "..." : "Approve"}
                              </Button>
                            )}
                            {inv.status === "APPROVED" && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={actionLoading === inv.id}
                                onClick={() => {
                                  setActionLoading(inv.id);
                                  postMutation.mutate(inv.id);
                                }}
                              >
                                {actionLoading === inv.id ? "..." : "Post"}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
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
        {/* Upcoming Payments */}
        <div>
          <SectionHeader title="Upcoming Payments (Next 7 Days)" />
          <Card className="mt-2">
            <CardContent className="pt-4">
              {upcomingPayments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No payments due in the next 7 days.
                </p>
              ) : (
                <div className="space-y-3">
                  {upcomingPayments.map((inv) => {
                    const supplierName =
                      inv.supplier?.name ?? supplierMap.get(inv.supplierId)?.name ?? "Unknown";
                    const days = daysUntilDue(inv.dueDate);
                    return (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between border-b pb-2 last:border-b-0 last:pb-0"
                      >
                        <div>
                          <p className="text-sm font-medium">{supplierName}</p>
                          <p className="text-xs text-muted-foreground">
                            Due {fmtDate(inv.dueDate)}
                            {days === 0 && (
                              <span className="ml-1 text-amber-600 font-semibold">(today)</span>
                            )}
                            {days === 1 && <span className="ml-1 text-amber-600">(tomorrow)</span>}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-mono font-medium">{fmt(inv.grossAmount, 2)}</p>
                          <p className="text-xs text-muted-foreground">{inv.currency}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Supplier Summary */}
        <div>
          <SectionHeader title="Top 5 Suppliers by Outstanding" />
          <Card className="mt-2">
            <CardContent className="pt-4">
              {supplierBalances.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No outstanding supplier balances.
                </p>
              ) : (
                <div className="space-y-3">
                  {supplierBalances.map((s, i) => {
                    const pct = (s.total / maxSupplierBalance) * 100;
                    return (
                      <div key={i}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate max-w-[200px]">
                            {s.name}
                          </span>
                          <span className="text-sm font-mono font-medium">{fmt(s.total, 2)}</span>
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
      </div>
    </div>
  );
}
