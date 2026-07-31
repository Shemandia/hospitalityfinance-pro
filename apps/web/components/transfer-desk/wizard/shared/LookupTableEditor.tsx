"use client";

/**
 * LookupTableEditor — Inline spreadsheet-like editor for lookup table entries.
 *
 * Used within TransformConfigPanel when the user selects a lookup transform.
 * Supports: add/remove rows, edit cells inline, import from CSV, search/filter.
 */

import { useCallback, useMemo, useState } from "react";
import { Input } from "../../../ui/input";
import { Button } from "../../../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../ui/table";
import { Plus, Trash2, Upload, Search, X } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

type LookupRow = {
  _id: string;
  values: Record<string, string>;
};

type LookupTableEditorProps = {
  columns: string[];
  rows: LookupRow[];
  onChange: (rows: LookupRow[]) => void;
  /** Max rows allowed (for performance) */
  maxRows?: number;
};

let _rowCounter = 0;
function newRowId(): string {
  return `lr_${Date.now()}_${++_rowCounter}`;
}

// ── Component ───────────────────────────────────────────────────────────────

export function LookupTableEditor({
  columns,
  rows,
  onChange,
  maxRows = 500
}: LookupTableEditorProps) {
  const [search, setSearch] = useState("");

  // ── Filtered rows ───────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((row) => Object.values(row.values).some((v) => v.toLowerCase().includes(q)));
  }, [rows, search]);

  // ── Row CRUD ────────────────────────────────────────────────────────────

  const addRow = useCallback(() => {
    if (rows.length >= maxRows) return;
    const empty: Record<string, string> = {};
    for (const col of columns) empty[col] = "";
    onChange([...rows, { _id: newRowId(), values: empty }]);
  }, [rows, columns, onChange, maxRows]);

  const removeRow = useCallback(
    (id: string) => {
      onChange(rows.filter((r) => r._id !== id));
    },
    [rows, onChange]
  );

  const updateCell = useCallback(
    (id: string, column: string, value: string) => {
      onChange(
        rows.map((r) => (r._id === id ? { ...r, values: { ...r.values, [column]: value } } : r))
      );
    },
    [rows, onChange]
  );

  // ── Import CSV ──────────────────────────────────────────────────────────

  const handleImportCsv = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,.tsv,.txt";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return; // need header + at least 1 data row

      // First line = headers
      const headers = lines[0].split(/[,\t]/);
      const colMap: Record<number, string> = {};
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i].trim().replace(/^["']|["']$/g, "");
        // Match to existing columns (case-insensitive)
        const match = columns.find((c) => c.toLowerCase() === h.toLowerCase());
        if (match) colMap[i] = match;
      }

      const imported: LookupRow[] = [];
      for (let li = 1; li < lines.length && imported.length < maxRows; li++) {
        const cells = lines[li].split(/[,\t]/);
        const values: Record<string, string> = {};
        for (const col of columns) values[col] = "";
        for (const [idx, col] of Object.entries(colMap)) {
          values[col] = (cells[Number(idx)] ?? "").trim().replace(/^["']|["']$/g, "");
        }
        imported.push({ _id: newRowId(), values });
      }

      onChange([...rows, ...imported].slice(0, maxRows));
    };
    input.click();
  }, [columns, rows, onChange, maxRows]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="h-3 w-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter entries..."
            className="h-7 pl-7 text-xs"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleImportCsv}
          className="h-7 text-[11px] gap-1"
        >
          <Upload className="h-3 w-3" /> Import CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={rows.length >= maxRows}
          className="h-7 text-[11px] gap-1"
        >
          <Plus className="h-3 w-3" /> Add Row
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 overflow-x-auto max-h-72">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col} className="text-[10px] whitespace-nowrap">
                  {col}
                </TableHead>
              ))}
              <TableHead className="text-[10px] w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + 1}
                  className="text-center py-6 text-xs text-slate-400"
                >
                  {rows.length === 0
                    ? "No entries. Add rows or import a CSV file."
                    : "No entries match the filter."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row._id}>
                  {columns.map((col) => (
                    <TableCell key={col} className="py-0.5 px-1">
                      <Input
                        value={row.values[col] ?? ""}
                        onChange={(e) => updateCell(row._id, col, e.target.value)}
                        className="h-7 text-xs border-transparent hover:border-slate-200 focus:border-emerald-300"
                      />
                    </TableCell>
                  ))}
                  <TableCell className="py-0.5 px-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeRow(row._id)}
                      className="h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Row count */}
      <p className="text-[10px] text-slate-400">
        {rows.length} row{rows.length !== 1 ? "s" : ""}
        {search && ` (${filtered.length} shown)`}
        {rows.length >= maxRows && (
          <span className="text-amber-500 ml-2">Max {maxRows} rows reached</span>
        )}
      </p>
    </div>
  );
}
