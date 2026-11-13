"use client";

/**
 * Transfer Desk — Execution history (UI-URL-019 / UI-PAGE-012)
 *
 * List of every execution across every profile in this tenant, sortable by
 * recency (newest first). Filters by profile + status.
 *
 * Each row shows: profile name, start time, duration, status, record counts,
 * triggered by. Clicking a row navigates to the execution detail page
 * (UI-URL-020).
 *
 * Backend: listTransferExecutions (TD-API-002).
 */

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../components/use-permissions";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  listTransferExecutions,
  type TransferExecutionSummary,
  type TransferExecutionStatus
} from "../../../../../../lib/gl-api";
import { Card, CardContent } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../../components/ui/table";
import {
  History,
  ArrowLeft,
  RefreshCw,
  Lock,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  CircleSlash
} from "lucide-react";

const STATUS_STYLES: Record<
  TransferExecutionStatus,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  QUEUED: {
    label: "Queued",
    className: "bg-slate-50 text-slate-700 border-slate-200",
    icon: Clock
  },
  RUNNING: {
    label: "Running",
    className: "bg-blue-50 text-blue-700 border-blue-200",
    icon: Loader2
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-50 text-red-700 border-red-200",
    icon: XCircle
  },
  CANCELLED: {
    label: "Cancelled",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    icon: CircleSlash
  }
};

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const ms = endMs - startMs;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function TransferDeskHistoryListPage() {
  const apiContext = useApiContext();
  const tenantHref = useTenantHref();
  const role = usePermissions();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<TransferExecutionStatus | "ALL">("ALL");

  const executionsQ = useQuery({
    queryKey: ["td-executions", apiContext?.tenantSlug, apiContext?.entityId, statusFilter],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await listTransferExecutions(apiContext, {
        status: statusFilter === "ALL" ? undefined : statusFilter,
        limit: 100
      });
      return (res.data as unknown as TransferExecutionSummary[]) ?? [];
    },
    enabled: Boolean(apiContext) && role.canTransferDeskUser,
    // Poll every 5 seconds so QUEUED → RUNNING → COMPLETED transitions appear live
    refetchInterval: 5000
  });

  if (!role.canTransferDeskUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Access required</h2>
      </div>
    );
  }

  const executions = executionsQ.data ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <Link
        href={tenantHref("/transfer-desk")}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Transfer Desk
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-(--color-primary) flex items-center gap-2">
            <History className="h-5 w-5" /> Execution History
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Every Transfer Desk profile run, newest first. Click a row for per-record logs.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => qc.invalidateQueries({ queryKey: ["td-executions"] })}
          disabled={executionsQ.isFetching}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${executionsQ.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as TransferExecutionStatus | "ALL")}
          >
            <SelectTrigger className="w-40 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="QUEUED">Queued</SelectItem>
              <SelectItem value="RUNNING">Running</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-slate-400 ml-auto">
            {executions.length} execution{executions.length !== 1 ? "s" : ""}
          </span>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-28">Status</TableHead>
                <TableHead className="text-xs">Profile</TableHead>
                <TableHead className="text-xs">Started</TableHead>
                <TableHead className="text-xs w-20">Duration</TableHead>
                <TableHead className="text-xs text-right w-28">
                  Records
                  <br />
                  <span className="text-[9px] text-slate-300 normal-case">ok / fail / total</span>
                </TableHead>
                <TableHead className="text-xs">Triggered by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {executionsQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-400">
                    Loading executions…
                  </TableCell>
                </TableRow>
              ) : executionsQ.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-red-500 text-sm">
                    {(executionsQ.error as Error).message}
                  </TableCell>
                </TableRow>
              ) : executions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <div className="text-slate-400 text-sm">
                      {statusFilter === "ALL"
                        ? "No executions yet. Run a profile from /transfer-desk/profiles."
                        : "No executions match the current filter."}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                executions.map((e) => {
                  const style = STATUS_STYLES[e.status];
                  const Icon = style.icon;
                  return (
                    <TableRow
                      key={e.id}
                      className="hover:bg-slate-50/50 cursor-pointer"
                      onClick={(evt) => {
                        // Let clicks inside links behave normally
                        if ((evt.target as HTMLElement).closest("a")) return;
                        window.location.href = tenantHref(`/transfer-desk/history/${e.id}`);
                      }}
                    >
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold border ${style.className}`}
                        >
                          <Icon
                            className={`h-2.5 w-2.5 ${e.status === "RUNNING" ? "animate-spin" : ""}`}
                          />
                          {style.label.toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={tenantHref(`/transfer-desk/history/${e.id}`)}
                          className="text-sm font-semibold text-slate-800 hover:text-emerald-600"
                        >
                          {e.profile?.name ?? e.profileId.slice(0, 8)}
                        </Link>
                        {e.profile?.profileType && (
                          <span className="ml-2 text-[10px] text-slate-400 font-mono">
                            {e.profile.profileType}
                          </span>
                        )}
                        {e.automation && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            via automation: <em>{e.automation.name}</em>
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 tabular-nums">
                        {formatDate(e.startedAt ?? e.createdAt)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 tabular-nums">
                        {formatDuration(e.startedAt, e.finishedAt)}
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums">
                        <span className="text-emerald-700">{e.recordsSucceeded}</span>
                        <span className="text-slate-300 mx-1">/</span>
                        <span className={e.recordsFailed > 0 ? "text-red-600" : "text-slate-400"}>
                          {e.recordsFailed}
                        </span>
                        <span className="text-slate-300 mx-1">/</span>
                        <span className="text-slate-500">{e.recordsTotal}</span>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 font-mono">
                        {e.triggeredBy ? e.triggeredBy.slice(0, 8) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-[11px] text-slate-400 text-center">
        Auto-refreshing every 5 seconds. Execution history is retained for 90 days.
      </p>
    </div>
  );
}
