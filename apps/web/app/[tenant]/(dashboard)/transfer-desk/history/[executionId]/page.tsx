"use client";

/**
 * Transfer Desk — Execution detail (UI-URL-020 / UI-PAGE-013)
 *
 * Shows one execution with:
 *   - Summary card (profile, status, times, duration, record counts, trigger)
 *   - Runtime parameter snapshot
 *   - Per-record log table (paginated, filterable by SUCCESS/FAILED/SKIPPED)
 *   - Cancel button for QUEUED / RUNNING executions (CONTROLLER+)
 *
 * Backend: getTransferExecution (TD-API-003), getTransferExecutionLogs
 * (TD-API-004), cancelTransferExecution (TD-API-006).
 *
 * Polls every 2 seconds while the execution is QUEUED or RUNNING.
 */

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useUserRole } from "../../../../../../components/use-user-role";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  getTransferExecution,
  getTransferExecutionLogs,
  cancelTransferExecution,
  type TransferExecutionSummary,
  type TransferExecutionLog,
  type TransferExecutionStatus
} from "../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
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
  ArrowLeft,
  History,
  StopCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  CircleSlash,
  Lock
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

export default function TransferDeskExecutionDetailPage() {
  const params = useParams();
  const executionId = params.executionId as string;
  const apiContext = useApiContext();
  const tenantHref = useTenantHref();
  const role = useUserRole();
  const qc = useQueryClient();

  const [logStatusFilter, setLogStatusFilter] = useState<"ALL" | "SUCCESS" | "FAILED" | "SKIPPED">(
    "ALL"
  );
  const [cancelError, setCancelError] = useState<string | null>(null);

  const executionQ = useQuery<TransferExecutionSummary | null>({
    queryKey: ["td-execution", apiContext?.tenantSlug, apiContext?.entityId, executionId],
    queryFn: async () => {
      if (!apiContext || !executionId) return null;
      const res = await getTransferExecution(apiContext, executionId);
      return (res.data as unknown as TransferExecutionSummary) ?? null;
    },
    enabled: Boolean(apiContext && executionId) && role.canTransferDeskUser,
    refetchInterval: (query) => {
      const data = query.state.data as TransferExecutionSummary | null | undefined;
      // Stop polling once we reach a terminal state
      if (!data) return 3000;
      return data.status === "QUEUED" || data.status === "RUNNING" ? 2000 : false;
    }
  });

  const logsQ = useQuery({
    queryKey: [
      "td-execution-logs",
      apiContext?.tenantSlug,
      apiContext?.entityId,
      executionId,
      logStatusFilter
    ],
    queryFn: async () => {
      if (!apiContext || !executionId)
        return { rows: [] as TransferExecutionLog[], total: 0, take: 0, skip: 0 };
      const res = await getTransferExecutionLogs(apiContext, executionId, {
        limit: 200,
        statusFilter: logStatusFilter === "ALL" ? undefined : logStatusFilter
      });
      return res.data as unknown as {
        rows: TransferExecutionLog[];
        total: number;
        take: number;
        skip: number;
      };
    },
    enabled: Boolean(apiContext && executionId) && role.canTransferDeskUser
  });

  const cancelMut = useMutation({
    mutationFn: () => {
      if (!apiContext) throw new Error("No API context");
      return cancelTransferExecution(apiContext, executionId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["td-execution", apiContext?.tenantSlug] });
      qc.invalidateQueries({ queryKey: ["td-executions"] });
    },
    onError: (e: Error) => setCancelError(e.message)
  });

  if (!role.canTransferDeskUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Access required</h2>
      </div>
    );
  }

  if (executionQ.isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div className="h-6 w-48 bg-slate-100 rounded animate-pulse" />
        <div className="h-48 bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  const execution = executionQ.data;

  if (!execution) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Link
          href={tenantHref("/transfer-desk/history")}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Execution History
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-slate-400 text-sm">
            Execution not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const style = STATUS_STYLES[execution.status];
  const StatusIcon = style.icon;
  const cancellable = execution.status === "QUEUED" || execution.status === "RUNNING";
  const logs = logsQ.data?.rows ?? [];
  const logTotal = logsQ.data?.total ?? 0;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      {/* Breadcrumb */}
      <Link
        href={tenantHref("/transfer-desk/history")}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Execution History
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold border ${style.className}`}
            >
              <StatusIcon
                className={`h-2.5 w-2.5 ${execution.status === "RUNNING" ? "animate-spin" : ""}`}
              />
              {style.label.toUpperCase()}
            </span>
          </div>
          <h1 className="text-2xl font-semibold text-(--color-primary) flex items-center gap-2 truncate">
            <History className="h-5 w-5 shrink-0" />
            {execution.profile?.name ?? execution.profileId.slice(0, 8)}
          </h1>
          <p className="text-xs font-mono text-slate-400 mt-0.5">execution {execution.id}</p>
        </div>
        {cancellable && role.canTransferDeskPowerUser && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCancelError(null);
              cancelMut.mutate();
            }}
            disabled={cancelMut.isPending}
            className="gap-1.5 shrink-0 border-red-300 text-red-700 hover:bg-red-50"
          >
            <StopCircle className="h-3.5 w-3.5" />
            {cancelMut.isPending ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>

      {cancelError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {cancelError}
        </div>
      )}

      {execution.errorMessage && (
        <Card className="border-red-200">
          <CardContent className="p-4 text-sm">
            <p className="font-semibold text-red-700 mb-1 flex items-center gap-1.5">
              <XCircle className="h-4 w-4" />
              Execution failed
            </p>
            <pre className="text-xs text-red-800 font-mono whitespace-pre-wrap">
              {execution.errorMessage}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Summary card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Created" value={new Date(execution.createdAt).toLocaleString()} />
        <SummaryTile
          label="Started"
          value={execution.startedAt ? new Date(execution.startedAt).toLocaleString() : "—"}
        />
        <SummaryTile
          label="Finished"
          value={execution.finishedAt ? new Date(execution.finishedAt).toLocaleString() : "—"}
        />
        <SummaryTile
          label="Duration"
          value={formatDuration(execution.startedAt, execution.finishedAt)}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryTile label="Records total" value={String(execution.recordsTotal)} />
        <SummaryTile
          label="Succeeded"
          value={String(execution.recordsSucceeded)}
          highlight="emerald"
        />
        <SummaryTile
          label="Failed"
          value={String(execution.recordsFailed)}
          highlight={execution.recordsFailed > 0 ? "red" : undefined}
        />
        <SummaryTile
          label="Triggered by"
          value={execution.triggeredBy ? execution.triggeredBy.slice(0, 12) : "—"}
        />
      </div>

      {/* Record logs */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Record log</CardTitle>
          <Select
            value={logStatusFilter}
            onValueChange={(v) => setLogStatusFilter(v as "ALL" | "SUCCESS" | "FAILED" | "SKIPPED")}
          >
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All records</SelectItem>
              <SelectItem value="SUCCESS">Success only</SelectItem>
              <SelectItem value="FAILED">Failed only</SelectItem>
              <SelectItem value="SKIPPED">Skipped only</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-12">#</TableHead>
                <TableHead className="text-xs w-24">Status</TableHead>
                <TableHead className="text-xs w-40">Error code</TableHead>
                <TableHead className="text-xs">Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logsQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-6 text-slate-400 text-xs">
                    Loading logs…
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    <div className="text-slate-400 text-xs">
                      {execution.status === "QUEUED"
                        ? "Execution hasn't started yet."
                        : execution.status === "RUNNING"
                          ? "No record logs emitted yet."
                          : execution.recordsTotal === 0
                            ? "No records were processed."
                            : "No records match the current filter."}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow
                    key={log.id}
                    className={log.status === "FAILED" ? "bg-red-50/30" : undefined}
                  >
                    <TableCell className="text-xs text-slate-400 tabular-nums">
                      {log.recordIndex}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          log.status === "SUCCESS"
                            ? "success"
                            : log.status === "FAILED"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-[10px]"
                      >
                        {log.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono text-slate-500">
                      {log.errorCode ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {log.errorMessage ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {logTotal > logs.length && (
        <p className="text-[11px] text-slate-400 text-center">
          Showing {logs.length} of {logTotal} records. Pagination UI coming in sprint 4.
        </p>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  highlight
}: {
  label: string;
  value: string;
  highlight?: "emerald" | "red";
}) {
  const color =
    highlight === "emerald"
      ? "text-emerald-700"
      : highlight === "red"
        ? "text-red-600"
        : "text-slate-800";
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className={`text-sm font-semibold tabular-nums mt-1 ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
