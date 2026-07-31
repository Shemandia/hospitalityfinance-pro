"use client";

/**
 * JournalPreview — Debit/credit balanced view of preview journal entries.
 *
 * Shows what GL journals would look like, with running totals
 * and a balance check at the bottom.
 */

import { useMemo } from "react";
import type { JournalPreviewEntry } from "../../../../lib/transfer-desk/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../ui/table";
import { Badge } from "../../../ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

type JournalPreviewProps = {
  entries: JournalPreviewEntry[];
};

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function JournalPreview({ entries }: JournalPreviewProps) {
  const totals = useMemo(() => {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const e of entries) {
      totalDebit += e.debit;
      totalCredit += e.credit;
    }
    return {
      totalDebit,
      totalCredit,
      balanced: Math.abs(totalDebit - totalCredit) < 0.005
    };
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-slate-500">No journal entries to preview.</p>
        <p className="text-xs text-slate-400 mt-1">Run a test to see journal output.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Balance indicator */}
      <div className="flex items-center gap-2">
        {totals.balanced ? (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> Balanced
          </Badge>
        ) : (
          <Badge variant="destructive" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Unbalanced
          </Badge>
        )}
        <span className="text-xs text-slate-500">
          {entries.length} line{entries.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Journal table */}
      <div className="rounded-lg border border-slate-200 overflow-auto max-h-[420px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-[10px] text-center">#</TableHead>
              <TableHead className="text-[11px]">Account</TableHead>
              <TableHead className="text-[11px]">Description</TableHead>
              <TableHead className="text-[11px]">Currency</TableHead>
              <TableHead className="text-[11px] text-right">Debit</TableHead>
              <TableHead className="text-[11px] text-right">Credit</TableHead>
              <TableHead className="text-[11px]">Dim 1</TableHead>
              <TableHead className="text-[11px]">Dim 2</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.lineNumber}>
                <TableCell className="text-[10px] text-slate-400 text-center tabular-nums">
                  {entry.lineNumber}
                </TableCell>
                <TableCell className="text-xs font-mono">{entry.account}</TableCell>
                <TableCell className="text-xs max-w-[200px] truncate">
                  {entry.description}
                </TableCell>
                <TableCell className="text-xs font-mono">{entry.currency}</TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {entry.debit > 0 ? (
                    <span className="text-slate-800">{formatAmount(entry.debit)}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-right tabular-nums">
                  {entry.credit > 0 ? (
                    <span className="text-slate-800">{formatAmount(entry.credit)}</span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs font-mono">{entry.analysisCode1 ?? "—"}</TableCell>
                <TableCell className="text-xs font-mono">{entry.analysisCode2 ?? "—"}</TableCell>
              </TableRow>
            ))}

            {/* Totals row */}
            <TableRow className="bg-slate-50 font-semibold">
              <TableCell colSpan={4} className="text-xs text-right">
                Totals
              </TableCell>
              <TableCell className="text-xs text-right tabular-nums">
                {formatAmount(totals.totalDebit)}
              </TableCell>
              <TableCell className="text-xs text-right tabular-nums">
                {formatAmount(totals.totalCredit)}
              </TableCell>
              <TableCell colSpan={2}>
                {!totals.balanced && (
                  <span className="text-[10px] text-red-500">
                    Diff: {formatAmount(Math.abs(totals.totalDebit - totals.totalCredit))}
                  </span>
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
