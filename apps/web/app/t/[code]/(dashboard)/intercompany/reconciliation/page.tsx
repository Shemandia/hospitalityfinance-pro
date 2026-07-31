"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getICReconciliation,
  createICReconciliationSnapshot,
  getPeriods,
  type ICReconciliationPairBalance
} from "../../../../../../lib/gl-api";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { Input } from "../../../../../../components/ui/input";
import { Label } from "../../../../../../components/ui/label";
import { Camera, CheckCircle, AlertTriangle } from "lucide-react";

type PeriodItem = { id: string; name?: string; year: number; month: number; status: string };

function fmt(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export default function ICReconciliationPage() {
  const ctx = useApiContext()!;
  const qc = useQueryClient();
  const [snapshotTarget, setSnapshotTarget] = useState<ICReconciliationPairBalance | null>(null);
  const [snapshotPeriodId, setSnapshotPeriodId] = useState("");
  const [snapshotNotes, setSnapshotNotes] = useState("");

  const { data: recon, isLoading } = useQuery({
    queryKey: ["ic-reconciliation"],
    queryFn: () => getICReconciliation(ctx),
    select: (r) => r.data
  });

  const { data: periods = [] } = useQuery({
    queryKey: ["periods"],
    queryFn: () => getPeriods(ctx),
    select: (r) => (r.data ?? []) as PeriodItem[]
  });

  const snapshotMutation = useMutation({
    mutationFn: () =>
      createICReconciliationSnapshot(ctx, {
        pairId: snapshotTarget!.pairId,
        periodId: snapshotPeriodId,
        notes: snapshotNotes || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-reconciliation"] });
      setSnapshotTarget(null);
      setSnapshotPeriodId("");
      setSnapshotNotes("");
    }
  });

  const pairs = recon?.pairs ?? [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Intercompany Reconciliation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live intercompany balances across all entity pairs
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Pairs</p>
            <p className="text-2xl font-bold">{pairs.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Reconciled</p>
            <p className="text-2xl font-bold text-green-700">
              {pairs.filter((p) => p.status === "RECONCILED").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Unreconciled</p>
            <p className="text-2xl font-bold text-red-700">{recon?.totalUnreconciled ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Reconciliation Matrix */}
      <Card>
        <CardHeader>
          <CardTitle>Entity Pair Balances</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">Loading...</p>
          ) : pairs.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">No entity pairs configured.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Entity A</TableHead>
                  <TableHead>Entity B</TableHead>
                  <TableHead className="text-right">A Says B Owes</TableHead>
                  <TableHead className="text-right">B Says B Owes</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Txns</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pairs.map((p) => (
                  <TableRow key={p.pairId}>
                    <TableCell className="font-medium">{p.entityAName ?? p.entityAId}</TableCell>
                    <TableCell className="font-medium">{p.entityBName ?? p.entityBId}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(p.balanceEntityA)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(p.balanceEntityB)}</TableCell>
                    <TableCell className="text-right font-mono">
                      <span className={Number(p.difference) > 0.01 ? "text-red-600 font-bold" : ""}>
                        {fmt(p.difference)}
                      </span>
                    </TableCell>
                    <TableCell>{p.currency}</TableCell>
                    <TableCell>{p.transactionCount}</TableCell>
                    <TableCell>
                      {p.status === "RECONCILED" ? (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle className="mr-1 h-3 w-3" /> Reconciled
                        </Badge>
                      ) : (
                        <Badge className="bg-yellow-100 text-yellow-800">
                          <AlertTriangle className="mr-1 h-3 w-3" /> Unreconciled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setSnapshotTarget(p)}>
                        <Camera className="mr-1 h-4 w-4" /> Snapshot
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Snapshot Dialog */}
      <Dialog open={!!snapshotTarget} onOpenChange={() => setSnapshotTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Reconciliation Snapshot</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Capture a period-end intercompany balance snapshot for{" "}
            <strong>{snapshotTarget?.entityAName}</strong> /{" "}
            <strong>{snapshotTarget?.entityBName}</strong>
          </p>
          <div className="space-y-3">
            <div>
              <Label>Period</Label>
              <Select value={snapshotPeriodId} onValueChange={setSnapshotPeriodId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period..." />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name ?? `${p.year}-${String(p.month).padStart(2, "0")}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={snapshotNotes}
                onChange={(e) => setSnapshotNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnapshotTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!snapshotPeriodId || snapshotMutation.isPending}
              onClick={() => snapshotMutation.mutate()}
            >
              {snapshotMutation.isPending ? "Creating..." : "Create Snapshot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
