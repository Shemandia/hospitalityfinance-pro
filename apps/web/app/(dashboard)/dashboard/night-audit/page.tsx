"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import { useUserRole } from "../../../../components/use-user-role";
import {
  getRevPAR,
  getUSALI,
  getGLJournals,
  getPeriods,
  getOperaCloudLogs,
  postGLJournal
} from "../../../../lib/gl-api";
import type { JournalSummary } from "../../../../lib/gl-api";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";

// ── Types ────────────────────────────────────────────────────────────────────

type Period = {
  id: string;
  name: string;
  status: string;
  year: number;
  month: number;
};

type RevPARData = {
  occupancyPct: number;
  adr: string;
  revpar: string;
  roomRevenue: string;
  totalRevenue: string;
  fbRevenue: string;
};

type USALIDept = {
  name: string;
  revenue: string;
  expenses: string;
  departmentalIncome: string;
  incomePct: string;
};

type USALIData = {
  departments: USALIDept[];
  totalRevenue: string;
  grossOperatingProfit: string;
  ebitda: string;
};

type ImportLog = {
  id: string;
  entityId: string;
  connectorType: string;
  businessDate: string | null;
  status: string;
  recordsImported: number;
  recordsFailed: number;
  errorMessage: string | null;
  createdAt: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: string | number, d = 0) {
  return parseFloat(String(n)).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d
  });
}

function fmtPct(n: string | number) {
  return `${parseFloat(String(n)).toFixed(1)}%`;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    OPEN: "bg-emerald-100 text-emerald-800",
    CLOSED: "bg-slate-100 text-slate-700",
    LOCKED: "bg-red-100 text-red-700",
    SUCCESS: "bg-emerald-100 text-emerald-800",
    FAILED: "bg-red-100 text-red-700",
    PARTIAL: "bg-amber-100 text-amber-800",
    RUNNING: "bg-blue-100 text-blue-800",
    DRAFT: "bg-yellow-100 text-yellow-800",
    POSTED: "bg-emerald-100 text-emerald-800"
  };
  return map[status] ?? "bg-slate-100 text-slate-700";
}

function daysRemaining(period: Period): number {
  const endOfMonth = new Date(period.year, period.month, 0);
  const today = new Date();
  const diff = Math.ceil((endOfMonth.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, diff);
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

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

// ── Main Page ────────────────────────────────────────────────────────────────

export default function NightAuditDashboard() {
  const apiContext = useApiContext();
  const { canWrite, canApprove } = useUserRole();
  const queryClient = useQueryClient();
  const [postingId, setPostingId] = useState<string | null>(null);

  // Periods
  const periodsQ = useQuery({
    queryKey: ["periods"],
    queryFn: () => getPeriods(apiContext!),
    enabled: !!apiContext
  });

  const periods = (periodsQ.data?.data ?? []) as Period[];
  const currentPeriod = useMemo(
    () =>
      periods.find((p) => p.status === "OPEN") ??
      periods.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      })[0],
    [periods]
  );

  const periodId = currentPeriod?.id ?? "";

  // RevPAR
  const revparQ = useQuery({
    queryKey: ["revpar", periodId],
    queryFn: () => getRevPAR(apiContext!, periodId),
    enabled: !!apiContext && !!periodId
  });
  const revpar = revparQ.data?.data as RevPARData | undefined;

  // USALI
  const usaliQ = useQuery({
    queryKey: ["usali", periodId],
    queryFn: () => getUSALI(apiContext!, periodId),
    enabled: !!apiContext && !!periodId
  });
  const usali = usaliQ.data?.data as USALIData | undefined;

  // Draft Journals
  const draftsQ = useQuery({
    queryKey: ["journals", "DRAFT"],
    queryFn: () => getGLJournals(apiContext!, { status: "DRAFT", limit: 20 }),
    enabled: !!apiContext
  });
  const draftJournals = (draftsQ.data?.data ?? []) as JournalSummary[];

  // Opera Cloud Logs
  const logsQ = useQuery({
    queryKey: ["opera-cloud-logs"],
    queryFn: () => getOperaCloudLogs(apiContext!),
    enabled: !!apiContext
  });
  const importLogs = (logsQ.data?.data ?? []) as ImportLog[];
  const latestLog = importLogs[0] ?? null;

  // Post Journal mutation
  const postMutation = useMutation({
    mutationFn: (journalId: string) => postGLJournal(apiContext!, journalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journals"] });
      setPostingId(null);
    },
    onError: () => {
      setPostingId(null);
    }
  });

  function handlePost(journalId: string) {
    setPostingId(journalId);
    postMutation.mutate(journalId);
  }

  // Build revenue summary from USALI departments
  const revenueSummary = useMemo(() => {
    if (!usali?.departments) return [];
    const knownDepts = ["Rooms", "Food & Beverage", "Spa", "Other"];
    const mapped = usali.departments.map((d) => ({
      name: d.name,
      revenue: parseFloat(d.revenue),
      expenses: parseFloat(d.expenses),
      net: parseFloat(d.departmentalIncome)
    }));
    // Group unknown departments under "Other"
    const result: { name: string; revenue: number; expenses: number; net: number }[] = [];
    const otherRow = { name: "Other", revenue: 0, expenses: 0, net: 0 };
    for (const dept of mapped) {
      if (knownDepts.some((k) => dept.name.toLowerCase().includes(k.toLowerCase()))) {
        result.push(dept);
      } else {
        otherRow.revenue += dept.revenue;
        otherRow.expenses += dept.expenses;
        otherRow.net += dept.net;
      }
    }
    if (otherRow.revenue !== 0 || otherRow.expenses !== 0) {
      result.push(otherRow);
    }
    return result;
  }, [usali]);

  const totalRevenue = revenueSummary.reduce((s, r) => s + r.revenue, 0);
  const totalExpenses = revenueSummary.reduce((s, r) => s + r.expenses, 0);
  const totalNet = revenueSummary.reduce((s, r) => s + r.net, 0);

  const isLoading = periodsQ.isLoading || revparQ.isLoading || usaliQ.isLoading;

  if (!apiContext) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Please sign in to view the Night Audit dashboard.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Night Audit Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Daily reconciliation and posting overview
          {currentPeriod && (
            <span>
              {" "}
              &mdash; Period: <strong>{currentPeriod.name}</strong>
            </span>
          )}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="flex flex-wrap gap-3">
        <KPICard label="Room Revenue" value={revpar ? fmt(revpar.roomRevenue) : "--"} sub="Today" />
        <KPICard label="F&B Revenue" value={revpar ? fmt(revpar.fbRevenue) : "--"} sub="Today" />
        <KPICard
          label="Occupancy %"
          value={revpar ? fmtPct(revpar.occupancyPct) : "--"}
          accent={
            revpar
              ? parseFloat(String(revpar.occupancyPct)) >= 70
                ? "text-emerald-600"
                : parseFloat(String(revpar.occupancyPct)) >= 50
                  ? "text-amber-600"
                  : "text-red-600"
              : undefined
          }
        />
        <KPICard
          label="RevPAR"
          value={revpar ? fmt(revpar.revpar, 2) : "--"}
          sub={revpar ? `ADR: ${fmt(revpar.adr, 2)}` : undefined}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — spans 2 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Daily Revenue Summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Daily Revenue Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : revenueSummary.length === 0 ? (
                <p className="text-sm text-muted-foreground">No revenue data available.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 pr-4">Department</th>
                        <th className="py-2 pr-4 text-right">Revenue</th>
                        <th className="py-2 pr-4 text-right">Expenses</th>
                        <th className="py-2 text-right">Net</th>
                        <th className="py-2 pl-4">Contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revenueSummary.map((row) => {
                        const pct = totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0;
                        return (
                          <tr key={row.name} className="border-b last:border-0">
                            <td className="py-2 pr-4 font-medium">{row.name}</td>
                            <td className="py-2 pr-4 text-right tabular-nums">
                              {fmt(row.revenue)}
                            </td>
                            <td className="py-2 pr-4 text-right tabular-nums text-red-600">
                              ({fmt(Math.abs(row.expenses))})
                            </td>
                            <td
                              className={`py-2 text-right tabular-nums font-medium ${
                                row.net >= 0 ? "text-emerald-700" : "text-red-600"
                              }`}
                            >
                              {fmt(row.net)}
                            </td>
                            <td className="py-2 pl-4 w-32">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-full transition-all"
                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs text-muted-foreground w-10 text-right">
                                  {pct.toFixed(0)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 font-semibold">
                        <td className="py-2 pr-4">Total</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{fmt(totalRevenue)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums text-red-600">
                          ({fmt(Math.abs(totalExpenses))})
                        </td>
                        <td
                          className={`py-2 text-right tabular-nums ${
                            totalNet >= 0 ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {fmt(totalNet)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unposted Journals */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Unposted Journals</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {draftJournals.length} draft{draftJournals.length !== 1 ? "s" : ""}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {draftsQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : draftJournals.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  All journals have been posted. Nothing pending.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 pr-4">Reference</th>
                        <th className="py-2 pr-4">Description</th>
                        <th className="py-2 pr-4 text-right">Lines</th>
                        <th className="py-2 pr-4">Source</th>
                        <th className="py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draftJournals.map((j) => (
                        <tr key={j.id} className="border-b last:border-0">
                          <td className="py-2 pr-4 font-mono text-xs">{j.reference}</td>
                          <td className="py-2 pr-4 max-w-[200px] truncate">{j.description}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{j._count.lines}</td>
                          <td className="py-2 pr-4">
                            <Badge variant="secondary" className="text-[10px]">
                              {j.source}
                            </Badge>
                          </td>
                          <td className="py-2 text-right">
                            {canApprove ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={postingId === j.id || postMutation.isPending}
                                onClick={() => handlePost(j.id)}
                              >
                                {postingId === j.id ? "Posting..." : "Post"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">View only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Period Status */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Period Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!currentPeriod ? (
                <p className="text-sm text-muted-foreground">No open period found.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{currentPeriod.name}</span>
                    <Badge className={`text-xs ${statusBadge(currentPeriod.status)}`}>
                      {currentPeriod.status}
                    </Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Days Remaining</span>
                      <span className="font-semibold text-foreground">
                        {daysRemaining(currentPeriod)}
                      </span>
                    </div>
                  </div>
                  {/* Progress bar for period */}
                  {(() => {
                    const totalDays = new Date(
                      currentPeriod.year,
                      currentPeriod.month,
                      0
                    ).getDate();
                    const elapsed = totalDays - daysRemaining(currentPeriod);
                    const pct = Math.min(100, (elapsed / totalDays) * 100);
                    return (
                      <div className="space-y-1">
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground text-right">
                          {elapsed} of {totalDays} days elapsed
                        </p>
                      </div>
                    );
                  })()}
                </>
              )}
            </CardContent>
          </Card>

          {/* PMS Import Status */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">PMS Import Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {logsQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : !latestLog ? (
                <p className="text-sm text-muted-foreground">No import logs found.</p>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{latestLog.connectorType}</span>
                    <Badge className={`text-xs ${statusBadge(latestLog.status)}`}>
                      {latestLog.status}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {latestLog.businessDate && (
                      <div className="flex justify-between">
                        <span>Business Date</span>
                        <span className="text-foreground">
                          {new Date(latestLog.businessDate).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Records Imported</span>
                      <span className="text-emerald-700 font-medium">
                        {latestLog.recordsImported}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Records Failed</span>
                      <span
                        className={`font-medium ${
                          latestLog.recordsFailed > 0 ? "text-red-600" : "text-muted-foreground"
                        }`}
                      >
                        {latestLog.recordsFailed}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Imported At</span>
                      <span className="text-foreground text-xs">
                        {new Date(latestLog.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  {latestLog.errorMessage && (
                    <div className="p-2 bg-red-50 rounded text-xs text-red-700 mt-2">
                      {latestLog.errorMessage}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                className="w-full justify-start"
                variant="outline"
                disabled={!canApprove || draftJournals.length === 0}
                onClick={() => {
                  // Post all draft journals sequentially
                  if (draftJournals.length > 0) {
                    handlePost(draftJournals[0].id);
                  }
                }}
              >
                <span className="mr-2 text-base">&#9654;</span>
                Run Night Audit Posting
                {draftJournals.length > 0 && (
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {draftJournals.length}
                  </Badge>
                )}
              </Button>
              <Button
                className="w-full justify-start"
                variant="outline"
                disabled={!canApprove}
                onClick={() => {
                  // Navigate to period management — placeholder
                  window.location.href = "/periods";
                }}
              >
                <span className="mr-2 text-base">&#10004;</span>
                Close Day
              </Button>
              <Button
                className="w-full justify-start"
                variant="outline"
                onClick={() => {
                  window.location.href = "/gl/journals";
                }}
              >
                <span className="mr-2 text-base">&#128196;</span>
                View All Journals
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
