"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  getICTransactions,
  reverseICTransaction,
  type ICTransactionSummary2
} from "../../../../../lib/gl-api";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Input } from "../../../../../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../../../components/ui/dialog";
import { useTenantHref } from "../../../../../hooks/use-tenant-router";
import Link from "next/link";
import { Plus, RotateCcw, Eye } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-800",
  PENDING_APPROVAL: "bg-yellow-100 text-yellow-800",
  POSTED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
  REVERSED: "bg-purple-100 text-purple-800"
};

function fmt(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function IntercompanyTransactionsPage() {
  const ctx = useApiContext()!;
  const qc = useQueryClient();
  const href = useTenantHref();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [reverseTarget, setReverseTarget] = useState<ICTransactionSummary2 | null>(null);
  const [reverseReason, setReverseReason] = useState("");

  const { data: txns = [], isLoading } = useQuery({
    queryKey: ["ic-transactions"],
    queryFn: () => getICTransactions(ctx),
    select: (r) => r.data ?? []
  });

  const reverseMutation = useMutation({
    mutationFn: (id: string) => reverseICTransaction(ctx, id, reverseReason || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-transactions"] });
      setReverseTarget(null);
      setReverseReason("");
    }
  });

  const filtered = txns.filter((t) => {
    if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        t.reference.toLowerCase().includes(s) ||
        (t.description ?? "").toLowerCase().includes(s) ||
        t.currency.toLowerCase().includes(s)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Intercompany Transactions</h1>
          <p className="text-sm text-muted-foreground mt-1">
            View and manage intercompany transactions across entities
          </p>
        </div>
        <Link href={href("/intercompany/new")}>
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New Transaction
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <Input
              placeholder="Search by reference, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
                <SelectItem value="POSTED">Posted</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="REVERSED">Reversed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">No transactions found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.reference}</TableCell>
                    <TableCell className="max-w-xs truncate">{t.description ?? "-"}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[t.status] ?? ""}>
                        {t.status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{fmt(t.amount)}</TableCell>
                    <TableCell>{t.currency}</TableCell>
                    <TableCell>{new Date(t.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right space-x-1">
                      {t.initiatorJournalId && (
                        <Link href={href(`/gl/journals?id=${t.initiatorJournalId}`)}>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                      {t.status === "POSTED" && !t.reversalOfId && (
                        <Button variant="ghost" size="sm" onClick={() => setReverseTarget(t)}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Reverse Dialog */}
      <Dialog open={!!reverseTarget} onOpenChange={() => setReverseTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse Intercompany Transaction</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Reversing <strong>{reverseTarget?.reference}</strong> ({reverseTarget?.currency}{" "}
            {fmt(reverseTarget?.amount)}). This will create a new reversal transaction with debits
            and credits flipped.
          </p>
          <Input
            placeholder="Reason for reversal (optional)"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverseTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reverseMutation.isPending}
              onClick={() => reverseTarget && reverseMutation.mutate(reverseTarget.id)}
            >
              {reverseMutation.isPending ? "Reversing..." : "Reverse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
