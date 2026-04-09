"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShieldCheck,
  Search,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  History
} from "lucide-react";
import { Card, CardContent } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "../../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../components/ui/select";
import { useApiContext } from "../../../../components/use-api-context";
import {
  getAuthorizationQueue,
  listRejectionCodes,
  approveJournal,
  rejectJournal,
  returnJournal,
  bulkApprove,
  bulkReject,
  getAuthorizationHistory,
  type QueueItem,
  type RejectionCode,
  type AuthHistoryEntry
} from "../../../../lib/authorization-api";

export default function AuthorizationsPage() {
  const ctx = useApiContext();
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState("");
  const [comments, setComments] = useState("");
  const [rejectionCodeId, setRejectionCodeId] = useState("");
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null); // null = bulk
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<AuthHistoryEntry[]>([]);
  const [historyJournalRef, setHistoryJournalRef] = useState("");

  // Filters
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const {
    data: queueRes,
    isLoading,
    error
  } = useQuery({
    queryKey: [
      "auth-queue",
      ctx?.tenantSlug,
      ctx?.entityId,
      minAmount,
      maxAmount,
      dateFrom,
      dateTo
    ],
    queryFn: () =>
      getAuthorizationQueue(ctx!, {
        minAmount: minAmount ? Number(minAmount) : undefined,
        maxAmount: maxAmount ? Number(maxAmount) : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined
      }),
    enabled: !!ctx
  });
  const queue = queueRes?.data ?? [];

  const { data: rejCodesRes } = useQuery({
    queryKey: ["rejection-codes", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listRejectionCodes(ctx!),
    enabled: !!ctx
  });
  const rejectionCodes = rejCodesRes?.data ?? [];

  const approveMutation = useMutation({
    mutationFn: ({ journalId, comments }: { journalId: string; comments?: string }) =>
      approveJournal(ctx!, journalId, comments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-queue"] });
      setActionError("");
      setComments("");
    },
    onError: (err: Error) => setActionError(err.message)
  });

  const rejectMutation = useMutation({
    mutationFn: ({
      journalId,
      rejectionCodeId,
      comments
    }: {
      journalId: string;
      rejectionCodeId: string;
      comments?: string;
    }) => rejectJournal(ctx!, journalId, rejectionCodeId, comments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-queue"] });
      setRejectDialogOpen(false);
      setActionError("");
      setComments("");
      setRejectionCodeId("");
    },
    onError: (err: Error) => setActionError(err.message)
  });

  const returnMutation = useMutation({
    mutationFn: ({ journalId, comments }: { journalId: string; comments?: string }) =>
      returnJournal(ctx!, journalId, comments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-queue"] });
      setActionError("");
      setComments("");
    },
    onError: (err: Error) => setActionError(err.message)
  });

  const bulkApproveMutation = useMutation({
    mutationFn: ({ journalIds, comments }: { journalIds: string[]; comments?: string }) =>
      bulkApprove(ctx!, journalIds, comments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-queue"] });
      setSelectedIds(new Set());
      setActionError("");
      setComments("");
    },
    onError: (err: Error) => setActionError(err.message)
  });

  const bulkRejectMutation = useMutation({
    mutationFn: ({
      journalIds,
      rejectionCodeId,
      comments
    }: {
      journalIds: string[];
      rejectionCodeId: string;
      comments?: string;
    }) => bulkReject(ctx!, journalIds, rejectionCodeId, comments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-queue"] });
      setSelectedIds(new Set());
      setRejectDialogOpen(false);
      setActionError("");
      setComments("");
      setRejectionCodeId("");
    },
    onError: (err: Error) => setActionError(err.message)
  });

  const historyMutation = useMutation({
    mutationFn: (journalId: string) => getAuthorizationHistory(ctx!, journalId),
    onSuccess: (res) => {
      setHistoryEntries(res.data);
      setHistoryOpen(true);
    },
    onError: (err: Error) => setActionError(err.message)
  });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === queue.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(queue.map((q) => q.journalId)));
    }
  }

  function openRejectDialog(journalId: string | null) {
    setRejectTarget(journalId);
    setRejectionCodeId("");
    setComments("");
    setRejectDialogOpen(true);
  }

  function handleRejectConfirm() {
    if (!rejectionCodeId) {
      setActionError("Select a rejection code.");
      return;
    }
    if (rejectTarget) {
      rejectMutation.mutate({ journalId: rejectTarget, rejectionCodeId, comments });
    } else {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      bulkRejectMutation.mutate({ journalIds: ids, rejectionCodeId, comments });
    }
  }

  const pendingCount = queue.length;
  const totalAmount = queue.reduce((s, q) => s + Number(q.journalAmount), 0);
  const anyPending =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    returnMutation.isPending ||
    bulkApproveMutation.isPending ||
    bulkRejectMutation.isPending;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-muted-foreground" />
            Authorization Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {pendingCount} item{pendingCount !== 1 ? "s" : ""} pending your approval
          </p>
        </div>
        {selectedIds.size > 0 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const ids = Array.from(selectedIds);
                bulkApproveMutation.mutate({ journalIds: ids, comments });
              }}
              disabled={anyPending}
              className="gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Approve {selectedIds.size}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => openRejectDialog(null)}
              disabled={anyPending}
              className="gap-1.5"
            >
              <XCircle className="h-4 w-4 text-red-600" />
              Reject {selectedIds.size}
            </Button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pending Items</p>
            <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Amount</p>
            <p className="text-2xl font-bold">
              {totalAmount.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Selected</p>
            <p className="text-2xl font-bold text-blue-600">{selectedIds.size}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="grid gap-1.5 w-36">
          <Label className="text-xs">Min Amount</Label>
          <Input
            type="number"
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="0.00"
            min={0}
            step="0.01"
          />
        </div>
        <div className="grid gap-1.5 w-36">
          <Label className="text-xs">Max Amount</Label>
          <Input
            type="number"
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="No limit"
            min={0}
            step="0.01"
          />
        </div>
        <div className="grid gap-1.5 w-40">
          <Label className="text-xs">Date From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5 w-40">
          <Label className="text-xs">Date To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      {actionError && (
        <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
          {actionError}
        </p>
      )}

      {/* Queue Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}
          {error && (
            <div className="py-16 text-center text-sm text-destructive">
              Failed to load: {(error as Error).message}
            </div>
          )}
          {!isLoading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-4 text-center w-10">
                      <input
                        type="checkbox"
                        checked={queue.length > 0 && selectedIds.size === queue.length}
                        onChange={toggleAll}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="py-2.5 px-4 text-left font-medium">Reference</th>
                    <th className="py-2.5 px-4 text-left font-medium">Description</th>
                    <th className="py-2.5 px-4 text-left font-medium">Source</th>
                    <th className="py-2.5 px-4 text-right font-medium">Amount</th>
                    <th className="py-2.5 px-4 text-center font-medium">Stage</th>
                    <th className="py-2.5 px-4 text-left font-medium">Created</th>
                    <th className="py-2.5 px-4 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                        <Clock className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                        No items pending your authorization.
                      </td>
                    </tr>
                  ) : (
                    queue.map((item) => (
                      <QueueRow
                        key={item.journalId}
                        item={item}
                        selected={selectedIds.has(item.journalId)}
                        onToggle={() => toggleSelect(item.journalId)}
                        onApprove={() =>
                          approveMutation.mutate({ journalId: item.journalId, comments })
                        }
                        onReject={() => openRejectDialog(item.journalId)}
                        onReturn={() =>
                          returnMutation.mutate({ journalId: item.journalId, comments })
                        }
                        onHistory={() => {
                          setHistoryJournalRef(item.reference ?? item.journalId.slice(0, 8));
                          historyMutation.mutate(item.journalId);
                        }}
                        disabled={anyPending}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <Dialog
        open={rejectDialogOpen}
        onOpenChange={(v) => {
          if (!v) setRejectDialogOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Reject {rejectTarget ? "Journal" : `${selectedIds.size} Journal(s)`}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {actionError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {actionError}
              </p>
            )}
            <div className="grid gap-1.5">
              <Label>Rejection Code</Label>
              <Select value={rejectionCodeId} onValueChange={setRejectionCodeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select reason..." />
                </SelectTrigger>
                <SelectContent>
                  {rejectionCodes
                    .filter((rc) => rc.isActive)
                    .map((rc) => (
                      <SelectItem key={rc.id} value={rc.id}>
                        {rc.code} — {rc.description}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Comments (optional)</Label>
              <Input
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Reason for rejection..."
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialogOpen(false)}
              disabled={rejectMutation.isPending || bulkRejectMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectConfirm}
              disabled={rejectMutation.isPending || bulkRejectMutation.isPending}
            >
              {rejectMutation.isPending || bulkRejectMutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History Dialog */}
      <Dialog
        open={historyOpen}
        onOpenChange={(v) => {
          if (!v) setHistoryOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Authorization History — {historyJournalRef}</DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto max-h-80 border rounded">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-xs text-muted-foreground uppercase">
                  <th className="py-2 px-3 text-left">Stage</th>
                  <th className="py-2 px-3 text-center">Order</th>
                  <th className="py-2 px-3 text-center">Status</th>
                  <th className="py-2 px-3 text-left">Decided By</th>
                  <th className="py-2 px-3 text-left">Comments</th>
                  <th className="py-2 px-3 text-left">Date</th>
                </tr>
              </thead>
              <tbody>
                {historyEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No authorization history.
                    </td>
                  </tr>
                ) : (
                  historyEntries.map((entry, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="py-1.5 px-3 font-medium">{entry.stageName}</td>
                      <td className="py-1.5 px-3 text-center text-xs">{entry.stageOrder}</td>
                      <td className="py-1.5 px-3 text-center">
                        <HistoryStatusBadge status={entry.status} />
                      </td>
                      <td className="py-1.5 px-3 text-xs">{entry.decidedByName ?? "—"}</td>
                      <td className="py-1.5 px-3 text-xs text-muted-foreground">
                        {entry.comments ?? "—"}
                      </td>
                      <td className="py-1.5 px-3 text-xs text-muted-foreground">
                        {entry.decidedAt ? new Date(entry.decidedAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  RETURNED: "bg-blue-100 text-blue-800",
  VOIDED: "bg-slate-100 text-slate-800"
};

function HistoryStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`text-xs ${STAGE_COLORS[status] ?? ""}`}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

function QueueRow({
  item,
  selected,
  onToggle,
  onApprove,
  onReject,
  onReturn,
  onHistory,
  disabled
}: {
  item: QueueItem;
  selected: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onReject: () => void;
  onReturn: () => void;
  onHistory: () => void;
  disabled: boolean;
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      <td className="py-3 px-4 text-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="rounded border-gray-300"
        />
      </td>
      <td className="py-3 px-4 font-mono text-xs font-medium">
        {item.reference ?? item.journalId.slice(0, 8)}
      </td>
      <td className="py-3 px-4">
        <div className="font-medium text-sm">{item.description ?? "—"}</div>
      </td>
      <td className="py-3 px-4">
        <Badge variant="outline" className="text-xs">
          {item.source}
        </Badge>
      </td>
      <td className="py-3 px-4 text-right font-mono text-xs font-medium">
        {Number(item.journalAmount).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}
      </td>
      <td className="py-3 px-4 text-center">
        <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700">
          {item.stageName} (#{item.currentStageOrder})
        </Badge>
      </td>
      <td className="py-3 px-4 text-xs text-muted-foreground">
        {new Date(item.createdAt).toLocaleDateString()}
      </td>
      <td className="py-3 px-4">
        <div className="flex gap-1 justify-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={onApprove}
            disabled={disabled}
            title="Approve"
            className="h-7 w-7 p-0"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReject}
            disabled={disabled}
            title="Reject"
            className="h-7 w-7 p-0"
          >
            <XCircle className="h-4 w-4 text-red-500" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReturn}
            disabled={disabled}
            title="Return for Amendment"
            className="h-7 w-7 p-0"
          >
            <RotateCcw className="h-4 w-4 text-blue-500" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onHistory}
            title="History"
            className="h-7 w-7 p-0"
          >
            <History className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
