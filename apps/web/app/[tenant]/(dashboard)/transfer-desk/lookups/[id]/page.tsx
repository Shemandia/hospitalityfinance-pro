"use client";

/**
 * Transfer Desk — Lookup Table detail page (spreadsheet editor)
 *
 * Features:
 *   - Spreadsheet-style grid editor for rows and values
 *   - Value type selector per cell (CONSTANT, COPY, MAP_TO, OMIT, REVERSE_SIGN)
 *   - Built-in metadata columns: Business Unit, Range From, Range To
 *   - Add/remove rows and columns
 *   - CSV import with file upload
 *   - Bulk save
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useUserRole } from "../../../../../../components/use-user-role";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  getTransferLookupTable,
  saveLookupTableRows,
  importLookupTableCsv,
  type TransferLookupTableDetail,
  type LookupValueType
} from "../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { ArrowLeft, Plus, Trash2, Save, Upload, Database, FileSpreadsheet } from "lucide-react";

const VALUE_TYPES: { value: LookupValueType; label: string; color: string }[] = [
  { value: "CONSTANT", label: "Constant", color: "bg-blue-50 text-blue-700" },
  { value: "COPY", label: "Copy", color: "bg-green-50 text-green-700" },
  { value: "MAP_TO", label: "Map To", color: "bg-purple-50 text-purple-700" },
  { value: "OMIT", label: "Omit", color: "bg-slate-50 text-slate-500" },
  { value: "REVERSE_SIGN", label: "Reverse", color: "bg-amber-50 text-amber-700" }
];

type EditableRow = {
  businessUnit: string;
  rangeFrom: string;
  rangeTo: string;
  values: Map<string, { valueType: LookupValueType; valueParam: string; isDefault: boolean }>;
};

export default function LookupTableDetailPage() {
  const params = useParams<{ id: string }>();
  const apiCtx = useApiContext();
  const { canTransferDeskDesigner } = useUserRole();
  const href = useTenantHref();
  const queryClient = useQueryClient();
  const csvInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["transfer-lookup", params.id],
    queryFn: () => getTransferLookupTable(apiCtx, params.id!)
  });

  const table: TransferLookupTableDetail | null = data?.data ?? null;

  // Editable grid state
  const [editRows, setEditRows] = useState<EditableRow[] | null>(null);
  const [dirty, setDirty] = useState(false);

  // Initialize editing from loaded data
  const startEditing = useCallback(() => {
    if (!table) return;
    const rows: EditableRow[] = table.rows.map((r) => ({
      businessUnit: r.businessUnit ?? "",
      rangeFrom: r.rangeFrom ?? "",
      rangeTo: r.rangeTo ?? "",
      values: new Map(
        r.values.map((v) => [
          v.columnId,
          {
            valueType: v.valueType as LookupValueType,
            valueParam: v.valueParam ?? "",
            isDefault: v.isDefault
          }
        ])
      )
    }));
    setEditRows(rows);
    setDirty(false);
  }, [table]);

  const isEditing = editRows !== null;

  // Add a blank row
  const handleAddRow = useCallback(() => {
    if (!editRows || !table) return;
    const newRow: EditableRow = {
      businessUnit: "",
      rangeFrom: "",
      rangeTo: "",
      values: new Map(
        table.columns.map((c) => [
          c.id,
          { valueType: "CONSTANT" as LookupValueType, valueParam: "", isDefault: false }
        ])
      )
    };
    setEditRows([...editRows, newRow]);
    setDirty(true);
  }, [editRows, table]);

  // Remove a row
  const handleRemoveRow = useCallback(
    (index: number) => {
      if (!editRows) return;
      setEditRows(editRows.filter((_, i) => i !== index));
      setDirty(true);
    },
    [editRows]
  );

  // Update a metadata cell
  const updateMeta = useCallback(
    (index: number, field: "businessUnit" | "rangeFrom" | "rangeTo", value: string) => {
      if (!editRows) return;
      setEditRows(editRows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
      setDirty(true);
    },
    [editRows]
  );

  // Update a value cell
  const updateValue = useCallback(
    (
      rowIndex: number,
      columnId: string,
      field: "valueType" | "valueParam" | "isDefault",
      value: string | boolean
    ) => {
      if (!editRows) return;
      setEditRows(
        editRows.map((r, i) => {
          if (i !== rowIndex) return r;
          const newValues = new Map(r.values);
          const existing = newValues.get(columnId) ?? {
            valueType: "CONSTANT" as LookupValueType,
            valueParam: "",
            isDefault: false
          };
          newValues.set(columnId, { ...existing, [field]: value });
          return { ...r, values: newValues };
        })
      );
      setDirty(true);
    },
    [editRows]
  );

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!editRows || !table) throw new Error("No data");
      const rows = editRows.map((r, i) => ({
        businessUnit: r.businessUnit || undefined,
        rangeFrom: r.rangeFrom || undefined,
        rangeTo: r.rangeTo || undefined,
        rowOrder: i,
        values: Array.from(r.values.entries()).map(([columnId, v]) => ({
          columnId,
          valueType: v.valueType,
          valueParam: v.valueParam || undefined,
          isDefault: v.isDefault
        }))
      }));
      return saveLookupTableRows(apiCtx, table.id, rows);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-lookup", params.id] });
      setEditRows(null);
      setDirty(false);
    }
  });

  // CSV import mutation
  const csvMutation = useMutation({
    mutationFn: (csvContent: string) => importLookupTableCsv(apiCtx, params.id!, csvContent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transfer-lookup", params.id] });
      setEditRows(null);
    }
  });

  const handleCsvUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        if (content) csvMutation.mutate(content);
      };
      reader.readAsText(file);
      // Reset input
      if (csvInputRef.current) csvInputRef.current.value = "";
    },
    [csvMutation]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading lookup table...
      </div>
    );
  }

  if (error || !table) {
    return (
      <div className="flex items-center justify-center py-20 text-red-600">
        Failed to load lookup table
      </div>
    );
  }

  const columns = table.columns;
  const displayRows = isEditing
    ? editRows!
    : table.rows.map((r) => ({
        businessUnit: r.businessUnit ?? "",
        rangeFrom: r.rangeFrom ?? "",
        rangeTo: r.rangeTo ?? "",
        values: new Map(
          r.values.map((v) => [
            v.columnId,
            {
              valueType: v.valueType as LookupValueType,
              valueParam: v.valueParam ?? "",
              isDefault: v.isDefault
            }
          ])
        )
      }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href={href("/transfer-desk/lookups")}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{table.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {table.description || "No description"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canTransferDeskDesigner && (
            <>
              {/* CSV Import */}
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={handleCsvUpload}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => csvInputRef.current?.click()}
                disabled={csvMutation.isPending}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                {csvMutation.isPending ? "Importing..." : "Import CSV"}
              </Button>

              {!isEditing ? (
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={!dirty || saveMutation.isPending}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Info badges */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1">
          <Database className="h-3 w-3" />
          {columns.length} columns
        </Badge>
        <Badge variant="outline">{displayRows.length} rows</Badge>
      </div>

      {csvMutation.isSuccess && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          CSV imported successfully!
        </div>
      )}
      {csvMutation.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Import failed: {(csvMutation.error as Error).message}
        </div>
      )}

      {/* Spreadsheet grid */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-slate-400" />
            Data Grid
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {columns.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No columns defined. Edit the table to add columns.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50">
                    {isEditing && <th className="px-2 py-2 w-8" />}
                    <th className="px-3 py-2 text-left font-medium text-slate-600 text-xs uppercase tracking-wider">
                      BU
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 text-xs uppercase tracking-wider">
                      From
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-slate-600 text-xs uppercase tracking-wider">
                      To
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col.id}
                        className="px-3 py-2 text-left font-medium text-slate-600 text-xs uppercase tracking-wider min-w-[140px]"
                      >
                        {col.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3 + columns.length + (isEditing ? 1 : 0)}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No rows yet.{" "}
                        {isEditing ? 'Click "Add Row" to start.' : 'Click "Edit" to add data.'}
                      </td>
                    </tr>
                  ) : (
                    displayRows.map((row, rowIdx) => (
                      <tr key={rowIdx} className="border-b hover:bg-slate-50/50">
                        {isEditing && (
                          <td className="px-2 py-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-red-400 hover:text-red-600"
                              onClick={() => handleRemoveRow(rowIdx)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </td>
                        )}
                        {/* Metadata cells */}
                        <td className="px-1 py-1">
                          {isEditing ? (
                            <input
                              type="text"
                              value={row.businessUnit}
                              onChange={(e) => updateMeta(rowIdx, "businessUnit", e.target.value)}
                              className="w-full min-w-[60px] rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                          ) : (
                            <span className="text-xs">{row.businessUnit || "—"}</span>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          {isEditing ? (
                            <input
                              type="text"
                              value={row.rangeFrom}
                              onChange={(e) => updateMeta(rowIdx, "rangeFrom", e.target.value)}
                              className="w-full min-w-[60px] rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                          ) : (
                            <span className="text-xs">{row.rangeFrom || "—"}</span>
                          )}
                        </td>
                        <td className="px-1 py-1">
                          {isEditing ? (
                            <input
                              type="text"
                              value={row.rangeTo}
                              onChange={(e) => updateMeta(rowIdx, "rangeTo", e.target.value)}
                              className="w-full min-w-[60px] rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                          ) : (
                            <span className="text-xs">{row.rangeTo || "—"}</span>
                          )}
                        </td>
                        {/* Value cells */}
                        {columns.map((col) => {
                          const cellVal = row.values.get(col.id) ?? {
                            valueType: "CONSTANT" as LookupValueType,
                            valueParam: "",
                            isDefault: false
                          };
                          const typeInfo = VALUE_TYPES.find((vt) => vt.value === cellVal.valueType);
                          return (
                            <td key={col.id} className="px-1 py-1">
                              {isEditing ? (
                                <div className="flex flex-col gap-0.5">
                                  <Select
                                    value={cellVal.valueType}
                                    onValueChange={(v) =>
                                      updateValue(rowIdx, col.id, "valueType", v)
                                    }
                                  >
                                    <SelectTrigger className="h-7 text-[10px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {VALUE_TYPES.map((vt) => (
                                        <SelectItem key={vt.value} value={vt.value}>
                                          {vt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {cellVal.valueType !== "OMIT" &&
                                    cellVal.valueType !== "REVERSE_SIGN" && (
                                      <input
                                        type="text"
                                        value={cellVal.valueParam}
                                        onChange={(e) =>
                                          updateValue(rowIdx, col.id, "valueParam", e.target.value)
                                        }
                                        placeholder="value..."
                                        className="w-full rounded border px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                      />
                                    )}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <span
                                    className={`text-[9px] px-1.5 py-0.5 rounded ${typeInfo?.color ?? ""}`}
                                  >
                                    {typeInfo?.label ?? cellVal.valueType}
                                  </span>
                                  {cellVal.valueParam && (
                                    <span className="text-xs text-slate-700 font-mono">
                                      {cellVal.valueParam}
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Add row button */}
          {isEditing && (
            <div className="border-t px-3 py-2">
              <Button variant="outline" size="sm" onClick={handleAddRow}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Row
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {saveMutation.error && (
        <p className="text-sm text-red-600">
          Failed to save: {(saveMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
