"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../components/use-api-context";
import { useTenantHref } from "../../../../../hooks/use-tenant-router";
import {
  getBankStatements,
  getReconciliationSummary,
  getUnreconciledTransactions,
  getMatchCandidates,
  matchBankTransaction,
  unmatchBankTransaction,
  autoMatchStatement,
  type BankStatement,
  type ReconciliationSummary,
  type BankTransactionRow,
  type MatchCandidate
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import { Separator } from "../../../../../components/ui/separator";
import { Landmark, Zap, Link2, Unlink, CheckCircle2, AlertCircle, X } from "lucide-react";
import { fmtDecimal as fmt } from "../../../../../lib/format";

export default function BankReconciliationPage() {
  const apiContext = useApiContext();
  const tenantHref = useTenantHref();
  const queryClient = useQueryClient();

  const [selectedStatementId, setSelectedStatementId] = useState<string>("");
  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  // Fetch bank statements
  const statementsQuery = useQuery({
    queryKey: ["bank-statements", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getBankStatements(apiContext);
      return (res.data ?? []) as BankStatement[];
    },
    enabled: Boolean(apiContext)
  });

  const statements = statementsQuery.data ?? [];
  const activeStatementId = selectedStatementId || statements[0]?.id || "";

  // Reconciliation summary
  const summaryQuery = useQuery({
    queryKey: ["recon-summary", apiContext?.tenantSlug, apiContext?.entityId, activeStatementId],
    queryFn: async () => {
      if (!apiContext || !activeStatementId) return null;
      const res = await getReconciliationSummary(apiContext, activeStatementId);
      return res.data as ReconciliationSummary | null;
    },
    enabled: Boolean(apiContext && activeStatementId)
  });

  // Unreconciled transactions
  const unreconciledQuery = useQuery({
    queryKey: ["unreconciled", apiContext?.tenantSlug, apiContext?.entityId, activeStatementId],
    queryFn: async () => {
      if (!apiContext || !activeStatementId) return [];
      const res = await getUnreconciledTransactions(apiContext, activeStatementId);
      return (res.data ?? []) as BankTransactionRow[];
    },
    enabled: Boolean(apiContext && activeStatementId)
  });

  // All transactions (for full view)
  const allTxQuery = useQuery({
    queryKey: [
      "bank-transactions",
      apiContext?.tenantSlug,
      apiContext?.entityId,
      activeStatementId
    ],
    queryFn: async () => {
      if (!apiContext || !activeStatementId) return [];
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500"}/api/v1/integration/bank/statements/${activeStatementId}/transactions`,
        {
          headers: {
            Authorization: `Bearer ${apiContext.accessToken}`,
            "X-Entity-ID": apiContext.entityId
          }
        }
      );
      const json = await res.json();
      return (json.data ?? []) as BankTransactionRow[];
    },
    enabled: Boolean(apiContext && activeStatementId)
  });

  // Match candidates for selected transaction
  const candidatesQuery = useQuery({
    queryKey: ["match-candidates", apiContext?.tenantSlug, apiContext?.entityId, selectedTxId],
    queryFn: async () => {
      if (!apiContext || !selectedTxId) return [];
      const res = await getMatchCandidates(apiContext, selectedTxId);
      return (res.data ?? []) as MatchCandidate[];
    },
    enabled: Boolean(apiContext && selectedTxId)
  });

  // Auto-match mutation
  const autoMatchMut = useMutation({
    mutationFn: async () => {
      if (!apiContext || !activeStatementId) throw new Error("No statement selected");
      return autoMatchStatement(apiContext, activeStatementId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recon-summary"] });
      queryClient.invalidateQueries({ queryKey: ["unreconciled"] });
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
    }
  });

  // Manual match mutation
  const matchMut = useMutation({
    mutationFn: async ({ txId, lineId }: { txId: string; lineId: string }) => {
      if (!apiContext) throw new Error("No API context");
      return matchBankTransaction(apiContext, txId, lineId);
    },
    onSuccess: () => {
      setSelectedTxId(null);
      queryClient.invalidateQueries({ queryKey: ["recon-summary"] });
      queryClient.invalidateQueries({ queryKey: ["unreconciled"] });
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
    }
  });

  // Unmatch mutation
  const unmatchMut = useMutation({
    mutationFn: async (txId: string) => {
      if (!apiContext) throw new Error("No API context");
      return unmatchBankTransaction(apiContext, txId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recon-summary"] });
      queryClient.invalidateQueries({ queryKey: ["unreconciled"] });
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
    }
  });

  const summary = summaryQuery.data;
  const unreconciled = unreconciledQuery.data ?? [];
  const allTx = allTxQuery.data ?? [];

  const reconciledPct = summary
    ? summary.totalTransactions > 0
      ? ((summary.reconciledCount / summary.totalTransactions) * 100).toFixed(0)
      : "0"
    : "—";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--color-primary) flex items-center gap-2">
            <Landmark className="h-6 w-6" />
            Bank Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Match bank transactions to GL journal entries.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={activeStatementId || "NONE"}
            onValueChange={(v) => setSelectedStatementId(v === "NONE" ? "" : v)}
          >
            <SelectTrigger className="w-80">
              <SelectValue placeholder="Select a bank statement…" />
            </SelectTrigger>
            <SelectContent>
              {statements.length === 0 ? (
                <SelectItem value="NONE" disabled>
                  No statements imported
                </SelectItem>
              ) : (
                statements.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {(s.account as any)?.code ?? "—"} ·{" "}
                    {new Date(s.statementDate).toLocaleDateString()} · {s.currency?.trim()} ·{" "}
                    {(s._count as any)?.transactions ?? 0} txns
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!activeStatementId || autoMatchMut.isPending}
            onClick={() => autoMatchMut.mutate()}
            className="gap-1.5"
          >
            <Zap className="h-4 w-4" />
            {autoMatchMut.isPending ? "Matching…" : "Auto-Match"}
          </Button>
        </div>
      </div>

      {/* Auto-match result */}
      {autoMatchMut.isSuccess && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="py-3 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span className="text-sm text-emerald-800">
              Auto-match complete: <strong>{autoMatchMut.data?.data?.matched ?? 0}</strong> matched,{" "}
              <strong>{autoMatchMut.data?.data?.unmatched ?? 0}</strong> remaining.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Account</p>
              <p className="text-lg font-bold text-(--color-primary)">{summary.accountCode}</p>
              <p className="text-xs text-muted-foreground">{summary.accountName}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Opening</p>
              <p className="text-lg font-bold tabular-nums">{fmt(summary.openingBalance)}</p>
              <p className="text-xs text-muted-foreground">{summary.currency}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Closing</p>
              <p className="text-lg font-bold tabular-nums">{fmt(summary.closingBalance)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Total Txns
              </p>
              <p className="text-lg font-bold">{summary.totalTransactions}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Reconciled
              </p>
              <p className="text-lg font-bold text-emerald-700">{summary.reconciledCount}</p>
              <p className="text-xs text-muted-foreground">{fmt(summary.reconciledAmount)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Progress</p>
              <p
                className={`text-lg font-bold ${Number(reconciledPct) >= 100 ? "text-emerald-700" : "text-amber-600"}`}
              >
                {reconciledPct}%
              </p>
              <div className="h-1.5 rounded-full bg-gray-200 mt-1">
                <div
                  className="h-1.5 rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(Number(reconciledPct), 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main layout: transactions + matching panel */}
      <div className={`grid gap-4 ${selectedTxId ? "grid-cols-[1fr_400px]" : "grid-cols-1"}`}>
        {/* Transactions Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Bank Transactions ({allTx.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs">Reference</TableHead>
                  <TableHead className="text-xs text-right">Amount</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allTx.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-muted-foreground text-sm"
                    >
                      {activeStatementId
                        ? "No transactions found."
                        : "Select a bank statement to begin."}
                    </TableCell>
                  </TableRow>
                ) : (
                  allTx.map((tx) => {
                    const amt = Number(tx.amount);
                    return (
                      <TableRow
                        key={tx.id}
                        className={`${selectedTxId === tx.id ? "bg-(--color-primary)/5 border-l-2 border-l-(--color-primary)" : ""} ${tx.isReconciled ? "bg-emerald-50/30" : ""}`}
                      >
                        <TableCell className="text-xs">
                          {new Date(tx.valueDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">
                          {tx.description}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {tx.reference ?? "—"}
                        </TableCell>
                        <TableCell
                          className={`text-xs text-right tabular-nums font-mono font-medium ${amt >= 0 ? "text-emerald-700" : "text-red-600"}`}
                        >
                          {fmt(tx.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={tx.isReconciled ? "success" : "secondary"}
                            className="text-[10px]"
                          >
                            {tx.isReconciled ? "Matched" : "Unmatched"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {tx.isReconciled ? (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              disabled={unmatchMut.isPending}
                              onClick={() => unmatchMut.mutate(tx.id)}
                              title="Unmatch"
                            >
                              <Unlink className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => setSelectedTxId(selectedTxId === tx.id ? null : tx.id)}
                              title="Find matches"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Matching panel */}
        {selectedTxId && (
          <Card className="sticky top-4 h-fit max-h-[calc(100vh-6rem)] flex flex-col overflow-hidden">
            <CardHeader className="pb-3 flex flex-row items-center justify-between shrink-0">
              <CardTitle className="text-base">Match Candidates</CardTitle>
              <Button variant="ghost" size="icon" onClick={() => setSelectedTxId(null)}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <Separator className="shrink-0" />
            <div className="overflow-y-auto flex-1">
              <CardContent className="pt-4 space-y-3">
                {candidatesQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Searching for matches…</p>
                ) : (candidatesQuery.data ?? []).length === 0 ? (
                  <div className="text-center py-6">
                    <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No matching journal entries found.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Try posting more journals or adjusting dates.
                    </p>
                  </div>
                ) : (
                  (candidatesQuery.data ?? []).map((c) => (
                    <div
                      key={c.journalLineId}
                      className="border rounded-lg p-3 space-y-2 hover:border-(--color-primary)/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-mono text-muted-foreground">
                            {c.journalRef ?? c.journalId.slice(0, 8)}
                          </p>
                          <p className="text-sm font-medium">{c.journalDescription ?? "—"}</p>
                        </div>
                        <Badge
                          variant={
                            c.score >= 70 ? "success" : c.score >= 40 ? "warning" : "secondary"
                          }
                          className="text-[10px]"
                        >
                          {c.score}%
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                        <span>
                          Amount:{" "}
                          <strong className="text-foreground tabular-nums">{fmt(c.amount)}</strong>
                        </span>
                        <span>Date: {new Date(c.journalDate).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground italic">{c.matchReason}</p>
                      <Button
                        size="sm"
                        className="w-full gap-1"
                        disabled={matchMut.isPending}
                        onClick={() =>
                          matchMut.mutate({
                            txId: selectedTxId,
                            lineId: c.journalLineId
                          })
                        }
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {matchMut.isPending ? "Matching…" : "Match"}
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </div>
          </Card>
        )}
      </div>

      {/* Info card */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="text-sm font-semibold mb-2">How it works</h3>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc ml-4">
            <li>
              Import bank statements via{" "}
              <a
                href={tenantHref("/settings/integrations")}
                className="underline text-(--color-primary)"
              >
                Integrations
              </a>{" "}
              (MT940 or OFX format).
            </li>
            <li>
              <strong>Auto-Match</strong> scans unreconciled transactions and matches them to posted
              GL journal lines by amount, date, and reference (score &ge; 70).
            </li>
            <li>
              Click <Link2 className="inline h-3 w-3" /> on an unmatched transaction to see
              candidates ranked by match score.
            </li>
            <li>
              Click <Unlink className="inline h-3 w-3" /> on a matched transaction to undo the
              match.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
