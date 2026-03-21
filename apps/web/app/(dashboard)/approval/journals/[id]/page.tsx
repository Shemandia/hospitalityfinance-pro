"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  approveGLJournal,
  getGLJournal,
  rejectGLJournal,
  type JournalDetail
} from "../../../../../lib/gl-api";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../components/ui/table";
import { Label } from "../../../../../components/ui/label";
import { cn } from "../../../../../lib/utils";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  PENDING_APPROVAL: "bg-amber-100 text-amber-800",
  POSTED: "bg-emerald-100 text-emerald-800",
  REVERSED: "bg-red-100 text-red-700"
};

export default function ApprovalJournalPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const apiContext = useApiContext();
  const journalId = params.id as string;
  const presetAction = searchParams.get("action") as "approve" | "reject" | null;
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<{ action: string; success: boolean; message: string } | null>(
    null
  );

  const journalQ = useQuery({
    queryKey: ["journal-approval", journalId, apiContext?.entityId],
    queryFn: () =>
      apiContext ? getGLJournal(apiContext, journalId) : Promise.reject("No context"),
    enabled: Boolean(apiContext && journalId),
    select: (r) => r.data as unknown as JournalDetail
  });

  const approveMut = useMutation({
    mutationFn: () => approveGLJournal(apiContext!, journalId, reason || undefined),
    onSuccess: () =>
      setDone({ action: "approved", success: true, message: "Journal approved successfully." }),
    onError: (e) => setDone({ action: "approved", success: false, message: (e as Error).message })
  });

  const rejectMut = useMutation({
    mutationFn: () => rejectGLJournal(apiContext!, journalId, reason || undefined),
    onSuccess: () =>
      setDone({
        action: "rejected",
        success: true,
        message: "Journal rejected. It has been returned to Draft status."
      }),
    onError: (e) => setDone({ action: "rejected", success: false, message: (e as Error).message })
  });

  const journal = journalQ.data;
  const isPending = journal?.status === "PENDING_APPROVAL";
  const isLoading = approveMut.isPending || rejectMut.isPending;

  const fmt = (v: string) => {
    const n = parseFloat(v);
    return n === 0
      ? "-"
      : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  if (journalQ.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Loading journal details…</p>
      </div>
    );
  }

  if (!journal) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive font-medium">Journal not found</p>
            <p className="text-sm text-muted-foreground mt-2">
              This journal may have been deleted or you may not have access to it.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-primary">Journal Approval</CardTitle>
            <Badge className={STATUS_COLORS[journal.status] ?? "bg-gray-100"}>
              {journal.status.replace("_", " ")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Journal Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/40 rounded-lg">
            <div>
              <Label className="text-xs text-muted-foreground">Reference</Label>
              <p className="font-semibold text-sm">{journal.reference}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Description</Label>
              <p className="text-sm">{journal.description || "-"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Source</Label>
              <p className="text-sm">{journal.source}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Currency</Label>
              <p className="text-sm">{journal.functionalCurrency}</p>
            </div>
          </div>

          {/* Journal Lines */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {journal.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="text-xs text-muted-foreground">{line.lineNumber}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {line.account.code} – {line.account.name}
                  </TableCell>
                  <TableCell className="text-xs">{line.description || "-"}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmt(line.debitFunctional)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmt(line.creditFunctional)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold bg-muted/30">
                <TableCell colSpan={3} className="text-right">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fmt(
                    journal.lines.reduce((s, l) => s + parseFloat(l.debitFunctional), 0).toString()
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {fmt(
                    journal.lines.reduce((s, l) => s + parseFloat(l.creditFunctional), 0).toString()
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          {/* Done State */}
          {done && (
            <div
              className={cn(
                "rounded-lg p-4 text-sm",
                done.success
                  ? done.action === "approved"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                    : "bg-amber-50 text-amber-800 border border-amber-200"
                  : "bg-red-50 text-destructive border border-red-200"
              )}
            >
              <p className="font-medium">{done.success ? "Action completed" : "Action failed"}</p>
              <p className="mt-1">{done.message}</p>
            </div>
          )}

          {/* Action Area */}
          {isPending && !done && (
            <div className="border-t pt-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Reason (optional)</Label>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
                  placeholder="Add a reason for your decision…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="teal"
                  disabled={isLoading}
                  onClick={() => approveMut.mutate()}
                  className={presetAction === "approve" ? "ring-2 ring-emerald-400" : ""}
                >
                  {approveMut.isPending ? "Approving…" : "Approve Journal"}
                </Button>
                <Button
                  variant="destructive"
                  disabled={isLoading}
                  onClick={() => rejectMut.mutate()}
                  className={presetAction === "reject" ? "ring-2 ring-red-400" : ""}
                >
                  {rejectMut.isPending ? "Rejecting…" : "Reject Journal"}
                </Button>
              </div>
            </div>
          )}

          {/* Already processed */}
          {!isPending && !done && (
            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground">
                This journal is in <strong>{journal.status}</strong> status and does not require
                approval action.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
