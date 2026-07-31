"use client";

/**
 * ParsePreview — Table showing raw parsed output from FSD.
 *
 * Displays the first N rows of parsed data in a scrollable table,
 * with column headers auto-derived from the row keys.
 */

import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../ui/table";
import { Input } from "../../../ui/input";
import { Badge } from "../../../ui/badge";
import { Search } from "lucide-react";

type ParsePreviewProps = {
  rows: Array<Record<string, unknown>>;
  maxDisplay?: number;
  /** Row indices that have errors (highlighted in red) */
  errorRowIndices?: Set<number>;
};

export function ParsePreview({ rows, maxDisplay = 100, errorRowIndices }: ParsePreviewProps) {
  const [filter, setFilter] = useState("");

  // Derive column headers from all rows
  const columns = useMemo(() => {
    const colSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        colSet.add(key);
      }
    }
    return Array.from(colSet);
  }, [rows]);

  // Filter rows
  const filteredRows = useMemo(() => {
    const display = rows.slice(0, maxDisplay);
    if (!filter.trim()) return display;
    const q = filter.toLowerCase();
    return display.filter((row) =>
      Object.values(row).some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(q)
      )
    );
  }, [rows, maxDisplay, filter]);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-slate-500">No parsed data available.</p>
        <p className="text-xs text-slate-400 mt-1">Run a test to see parsed output.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rows..."
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Badge variant="outline" className="text-[10px]">
          {rows.length} row{rows.length !== 1 ? "s" : ""}
          {rows.length > maxDisplay && ` (showing ${maxDisplay})`}
        </Badge>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 overflow-auto max-h-[420px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12 text-[10px] text-center">#</TableHead>
              {columns.map((col) => (
                <TableHead key={col} className="text-[11px] font-mono whitespace-nowrap">
                  {col}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((row, idx) => {
              const originalIdx = rows.indexOf(row);
              const hasError = errorRowIndices?.has(originalIdx);
              return (
                <TableRow key={idx} className={hasError ? "bg-red-50" : undefined}>
                  <TableCell className="text-[10px] text-slate-400 text-center tabular-nums">
                    {originalIdx + 1}
                  </TableCell>
                  {columns.map((col) => (
                    <TableCell
                      key={col}
                      className="text-xs font-mono whitespace-nowrap max-w-[200px] truncate"
                    >
                      {row[col] == null ? (
                        <span className="text-slate-300 italic">null</span>
                      ) : (
                        String(row[col])
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
