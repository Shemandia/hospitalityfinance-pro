"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import {
  approveGLJournal,
  getGLJournal,
  getGLJournals,
  postGLJournal,
  rejectGLJournal,
  reverseGLJournal
} from "../../../../lib/gl-api";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Badge } from "../../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../components/ui/select";
import { Separator } from "../../../../components/ui/separator";
import { Download, CheckCircle, XCircle, X, RotateCcw, Send } from "lucide-react";
import Link from "next/link";

type JournalRow = {
  id: string;
  reference?: string | null;
  description?: string | null;
  status: string;
  source: string;
  createdAt: string;
  lines?: Array<{ debit: string; credit: string }>;
};

type JournalLine = {
  id: string;
  lineNumber: number;
  accountId: string;
  account?: { code: string; name: string };
  debit: string;
  credit: string;
  currency: string;
  description?: string | null;
};

const statusVariant: Record<
  string,
  "default" | "success" | "warning" | "destructive" | "secondary" | "info"
> = {
  POSTED: "success",
  DRAFT: "secondary",
  PENDING_APPROVAL: "warning",
  REVERSED: "destructive",
  REJECTED: "destructive"
};

function fmt(v: string | number) {
  const n = Number(v);
  if (!n) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

export default function GLJournalsPage() {
  const apiContext = useApiContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [selectedJournalId, setSelectedJournalId] = useState<string | null>(null);
  const [confirmReverse, setConfirmReverse] = useState(false);

  const journalsQuery = useQuery({
    queryKey: ["journals", apiContext?.entityId, status, search],
    queryFn: async () => {
      if (!apiContext) return [];
      const response = await getGLJournals(apiContext, {
        status: status || undefined,
        search: search || undefined,
        limit: 100
      });
      return (response.data as unknown as JournalRow[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const journalDetailQuery = useQuery({
    queryKey: ["journal", apiContext?.entityId, selectedJournalId],
    queryFn: async () => {
      if (!apiContext || !selectedJournalId) return null;
      const response = await getGLJournal(apiContext, selectedJournalId);
      return response.data;
    },
    enabled: Boolean(apiContext && selectedJournalId)
  });

  const approveMutation = useMutation({
    mutationFn: async (journalId: string) => {
      if (!apiContext) throw new Error("Missing API context.");
      return approveGLJournal(apiContext, journalId, "Approved from journals screen");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["journals"] });
      await queryClient.invalidateQueries({ queryKey: ["journal"] });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async (journalId: string) => {
      if (!apiContext) throw new Error("Missing API context.");
      return rejectGLJournal(apiContext, journalId, "Rejected from journals screen");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["journals"] });
      await queryClient.invalidateQueries({ queryKey: ["journal"] });
    }
  });

  const reverseMutation = useMutation({
    mutationFn: async (journalId: string) => {
      if (!apiContext) throw new Error("Missing API context.");
      return reverseGLJournal(apiContext, journalId);
    },
    onSuccess: async () => {
      setConfirmReverse(false);
      await queryClient.invalidateQueries({ queryKey: ["journals"] });
      await queryClient.invalidateQueries({ queryKey: ["journal"] });
    }
  });

  const postMutation = useMutation({
    mutationFn: async (journalId: string) => {
      if (!apiContext) throw new Error("Missing API context.");
      return postGLJournal(apiContext, journalId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["journals"] });
      await queryClient.invalidateQueries({ queryKey: ["journal"] });
    }
  });

  const columns = useMemo<ColumnDef<JournalRow>[]>(
    () => [
      {
        accessorKey: "reference",
        header: "Reference",
        cell: (ctx) => <span className="font-mono text-xs">{String(ctx.getValue() ?? "—")}</span>
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: (ctx) => (
          <span className="text-xs text-muted-foreground truncate max-w-[160px] block">
            {String(ctx.getValue() ?? "—")}
          </span>
        )
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: (ctx) => {
          const s = String(ctx.getValue());
          return (
            <Badge variant={statusVariant[s] ?? "secondary"} className="text-xs">
              {s.replace("_", " ")}
            </Badge>
          );
        }
      },
      {
        accessorKey: "source",
        header: "Source",
        cell: (ctx) => (
          <Badge variant="info" className="text-xs">
            {String(ctx.getValue() ?? "—")}
          </Badge>
        )
      },
      {
        id: "amount",
        header: "Amount",
        cell: (ctx) => {
          const lines = ctx.row.original.lines ?? [];
          const total = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
          return <span className="font-mono text-xs tabular-nums">{total ? fmt(total) : "—"}</span>;
        }
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: (ctx) => (
          <span className="text-xs text-muted-foreground">
            {new Date(String(ctx.getValue())).toLocaleString()}
          </span>
        )
      }
    ],
    []
  );

  const table = useReactTable({
    data: journalsQuery.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  function exportCsv(rows: JournalRow[]) {
    const headers = ["ID", "Reference", "Status", "Source", "Created At"];
    const csvRows = rows.map((r) =>
      [r.id, r.reference ?? "", r.status, r.source, r.createdAt]
        .map((f) => `"${String(f).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [headers.join(","), ...csvRows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "journals.csv" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const detail = journalDetailQuery.data as any;
  const selectedStatus = detail?.status;
  const lines: JournalLine[] = detail?.lines ?? [];

  const lineTotals = useMemo(
    () => ({
      debit: lines.reduce((s, l) => s + Number(l.debit || 0), 0),
      credit: lines.reduce((s, l) => s + Number(l.credit || 0), 0)
    }),
    [lines]
  );

  return (
    <div className={`grid gap-4 ${selectedJournalId ? "grid-cols-[1fr_420px]" : "grid-cols-1"}`}>
      {/* ── List ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-(--color-primary)">Journal Entries</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              placeholder="Search reference or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-52"
            />
            <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v)}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
                <SelectItem value="POSTED">Posted</SelectItem>
                <SelectItem value="REVERSED">Reversed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => exportCsv(journalsQuery.data ?? [])}>
              <Download className="h-3.5 w-3.5 mr-1" /> Export
            </Button>
            <Button size="sm" asChild>
              <Link href="/gl/journals/new">+ New Journal</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableHead key={header.id} className="text-xs">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {journalsQuery.isLoading ? (
                <>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <div className="h-8 w-full animate-pulse rounded bg-muted" />
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              ) : journalsQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-destructive text-sm">
                    {(journalsQuery.error as Error).message}
                  </TableCell>
                </TableRow>
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                    No journals found
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={() => {
                      setSelectedJournalId(row.original.id);
                      setConfirmReverse(false);
                    }}
                    className={`cursor-pointer ${selectedJournalId === row.original.id ? "bg-(--color-primary)/5 border-l-2 border-l-(--color-primary)" : "hover:bg-muted/40"}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Detail panel ── */}
      {selectedJournalId && (
        <Card className="sticky top-4 h-fit max-h-[calc(100vh-6rem)] flex flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-3 shrink-0">
            <div>
              <CardTitle className="text-base">Journal Detail</CardTitle>
              {detail?.reference && (
                <p className="text-xs font-mono text-muted-foreground mt-0.5">{detail.reference}</p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={() => setSelectedJournalId(null)}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <Separator className="shrink-0" />

          <div className="overflow-y-auto flex-1">
            <CardContent className="pt-4 text-sm space-y-3">
              {journalDetailQuery.isLoading ? (
                <p className="text-muted-foreground text-sm">Loading details…</p>
              ) : detail ? (
                <>
                  {/* Meta grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div className="text-muted-foreground">Status</div>
                    <div>
                      <Badge
                        variant={statusVariant[selectedStatus] ?? "secondary"}
                        className="text-xs"
                      >
                        {selectedStatus?.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">Source</div>
                    <div>
                      <Badge variant="info" className="text-xs">
                        {detail.source}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground">Period</div>
                    <div className="font-medium">{detail.period?.name ?? "—"}</div>
                    <div className="text-muted-foreground">Currency</div>
                    <div className="font-mono">{detail.functionalCurrency ?? "—"}</div>
                    {detail.description && (
                      <>
                        <div className="text-muted-foreground">Description</div>
                        <div>{detail.description}</div>
                      </>
                    )}
                  </div>

                  <Separator />

                  {/* Lines */}
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">
                      Journal Lines
                    </p>
                    <div className="rounded-md border border-border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/60">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground w-6">
                              #
                            </th>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                              Account
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium text-muted-foreground w-20">
                              Debit
                            </th>
                            <th className="px-2 py-1.5 text-right font-medium text-muted-foreground w-20">
                              Credit
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {lines.length === 0 ? (
                            <tr>
                              <td
                                colSpan={4}
                                className="px-2 py-3 text-center text-muted-foreground"
                              >
                                No lines
                              </td>
                            </tr>
                          ) : (
                            lines.map((line) => (
                              <tr key={line.id} className="hover:bg-muted/30">
                                <td className="px-2 py-1.5 text-muted-foreground">
                                  {line.lineNumber}
                                </td>
                                <td className="px-2 py-1.5">
                                  <span className="font-mono text-muted-foreground">
                                    {line.account?.code ?? "—"}
                                  </span>
                                  <span className="ml-1 text-foreground">
                                    {line.account?.name ?? ""}
                                  </span>
                                  {line.description && (
                                    <div className="text-muted-foreground/70 italic mt-0.5">
                                      {line.description}
                                    </div>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums font-mono text-emerald-700">
                                  {Number(line.debit) > 0 ? fmt(line.debit) : ""}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums font-mono text-violet-700">
                                  {Number(line.credit) > 0 ? fmt(line.credit) : ""}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                        <tfoot className="bg-muted/40 border-t border-border">
                          <tr>
                            <td
                              colSpan={2}
                              className="px-2 py-1.5 text-xs font-semibold text-muted-foreground"
                            >
                              {lines.length} lines ·{" "}
                              <span
                                className={
                                  Math.abs(lineTotals.debit - lineTotals.credit) < 0.001
                                    ? "text-emerald-700"
                                    : "text-destructive"
                                }
                              >
                                {Math.abs(lineTotals.debit - lineTotals.credit) < 0.001
                                  ? "Balanced ✓"
                                  : "Unbalanced ✗"}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-mono font-semibold text-emerald-700">
                              {fmt(lineTotals.debit)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-mono font-semibold text-violet-700">
                              {fmt(lineTotals.credit)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Approvals */}
                  {(detail.approvals ?? []).length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">
                          Approval History
                        </p>
                        <ul className="space-y-1">
                          {(
                            detail.approvals as Array<{
                              id: string;
                              status: string;
                              approver?: { email?: string };
                            }>
                          ).map((a) => (
                            <li key={a.id} className="flex items-center justify-between text-xs">
                              <span>{a.approver?.email ?? a.id}</span>
                              <Badge
                                variant={
                                  a.status === "APPROVED"
                                    ? "success"
                                    : a.status === "REJECTED"
                                      ? "destructive"
                                      : "secondary"
                                }
                                className="text-[10px]"
                              >
                                {a.status}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}

                  {/* Actions */}
                  {selectedStatus === "DRAFT" && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Button
                          size="sm"
                          className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1"
                          disabled={postMutation.isPending}
                          onClick={() => postMutation.mutate(selectedJournalId!)}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {postMutation.isPending ? "Posting…" : "Post Journal"}
                        </Button>
                        {postMutation.isError && (
                          <p className="text-xs text-destructive">
                            {(postMutation.error as Error).message}
                          </p>
                        )}
                      </div>
                    </>
                  )}

                  {selectedStatus === "PENDING_APPROVAL" && (
                    <>
                      <Separator />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1"
                          disabled={approveMutation.isPending}
                          onClick={() => approveMutation.mutate(selectedJournalId)}
                        >
                          <CheckCircle className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1"
                          disabled={rejectMutation.isPending}
                          onClick={() => rejectMutation.mutate(selectedJournalId)}
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </>
                  )}

                  {selectedStatus === "POSTED" && (
                    <>
                      <Separator />
                      {!confirmReverse ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50"
                          onClick={() => setConfirmReverse(true)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Reverse Journal
                        </Button>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                            Creates a mirror journal with all debits/credits swapped and marks this
                            as Reversed. Continue?
                          </p>
                          {reverseMutation.isError && (
                            <p className="text-xs text-destructive">
                              {(reverseMutation.error as Error).message}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={reverseMutation.isPending}
                              onClick={() => reverseMutation.mutate(selectedJournalId!)}
                            >
                              {reverseMutation.isPending ? "Reversing…" : "Confirm Reversal"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmReverse(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              ) : null}
            </CardContent>
          </div>
        </Card>
      )}
    </div>
  );
}
