"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getICTransactions,
  approveICTransaction,
  rejectICTransaction,
  type ICTransactionSummary2
} from "../../../../../../lib/gl-api";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
import { Input } from "../../../../../../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../../../../components/ui/dialog";
import { CheckCircle, XCircle } from "lucide-react";

function fmt(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ICApprovalsPage() {
  const ctx = useApiContext()!;
  const qc = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<ICTransactionSummary2 | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: pendingTxns = [], isLoading } = useQuery({
    queryKey: ["ic-transactions", "PENDING_APPROVAL"],
    queryFn: () => getICTransactions(ctx, { status: "PENDING_APPROVAL" }),
    select: (r) => r.data ?? []
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveICTransaction(ctx, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ic-transactions"] })
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectICTransaction(ctx, id, rejectReason || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-transactions"] });
      setRejectTarget(null);
      setRejectReason("");
    }
  });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Intercompany Approvals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review and approve or reject pending intercompany transactions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pending Approval ({pendingTxns.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">Loading...</p>
          ) : pendingTxns.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No transactions pending approval.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingTxns.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.reference}</TableCell>
                    <TableCell className="max-w-xs truncate">{t.description ?? "-"}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(t.amount)}</TableCell>
                    <TableCell>{t.currency}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{t.createdById}</TableCell>
                    <TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-700 border-green-300 hover:bg-green-50"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(t.id)}
                      >
                        <CheckCircle className="mr-1 h-4 w-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-700 border-red-300 hover:bg-red-50"
                        onClick={() => setRejectTarget(t)}
                      >
                        <XCircle className="mr-1 h-4 w-4" /> Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reject Dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={() => setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Intercompany Transaction</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Rejecting <strong>{rejectTarget?.reference}</strong> ({rejectTarget?.currency}{" "}
            {fmt(rejectTarget?.amount)})
          </p>
          <Input
            placeholder="Reason for rejection (optional)"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={rejectMutation.isPending}
              onClick={() => rejectTarget && rejectMutation.mutate(rejectTarget.id)}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
