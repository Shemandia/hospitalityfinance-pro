"use client";

/**
 * SchemaEditor — Visual FSD schema editor for Transfer Desk.
 *
 * Shows a table/grid of fields with name, type, position, options.
 * Supports:
 * - Adding/removing fields
 * - Editing field properties inline
 * - Real-time duplicate position / overlapping fixed-width warnings
 *
 * Shared by both Upload and Manual tabs in Step 2.
 */

import { useCallback, useMemo, useState } from "react";
import type { FsdFieldType, FormatType } from "../../../../lib/transfer-desk/types";
import type { Step2FormData } from "../../../../lib/transfer-desk/validation";
import { FORMAT_TYPES } from "../../../../lib/transfer-desk/constants";
import { Input } from "../../../ui/input";
import { Button } from "../../../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../ui/table";
import { Plus, Trash2, AlertTriangle } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

type FieldRow = Step2FormData["fields"][number];

type SchemaEditorProps = {
  formatType: FormatType;
  fields: FieldRow[];
  onFieldsChange: (fields: FieldRow[]) => void;
  /** Format options */
  formatConfig: Step2FormData["format"];
  onFormatConfigChange: (config: Step2FormData["format"]) => void;
};

const FIELD_TYPES: FsdFieldType[] = [
  "string",
  "integer",
  "decimal",
  "currency",
  "date",
  "datetime",
  "boolean",
  "enum",
  "account"
];

// ── Component ───────────────────────────────────────────────────────────────

export function SchemaEditor({
  formatType,
  fields,
  onFieldsChange,
  formatConfig,
  onFormatConfigChange
}: SchemaEditorProps) {
  // ── Validation warnings ─────────────────────────────────────────────────

  const warnings = useMemo(() => {
    const warns: Map<number, string[]> = new Map();

    // Duplicate column indices (CSV/TSV)
    if (formatType === "csv" || formatType === "tsv") {
      const indexMap = new Map<number, number[]>();
      fields.forEach((f, i) => {
        if (f.columnIndex !== undefined) {
          const existing = indexMap.get(f.columnIndex) ?? [];
          existing.push(i);
          indexMap.set(f.columnIndex, existing);
        }
      });
      for (const [colIdx, rows] of indexMap) {
        if (rows.length > 1) {
          rows.forEach((r) => {
            const existing = warns.get(r) ?? [];
            existing.push(`Duplicate column index ${colIdx}`);
            warns.set(r, existing);
          });
        }
      }
    }

    // Overlapping fixed-width ranges
    if (formatType === "fixed") {
      const ranges: Array<{ start: number; end: number; idx: number }> = [];
      fields.forEach((f, i) => {
        if (f.fixedStart !== undefined && f.fixedLength !== undefined) {
          ranges.push({ start: f.fixedStart, end: f.fixedStart + f.fixedLength, idx: i });
        }
      });
      for (let a = 0; a < ranges.length; a++) {
        for (let b = a + 1; b < ranges.length; b++) {
          if (ranges[a].start < ranges[b].end && ranges[b].start < ranges[a].end) {
            const msgA = warns.get(ranges[a].idx) ?? [];
            msgA.push(`Overlaps with field ${ranges[b].idx + 1}`);
            warns.set(ranges[a].idx, msgA);
            const msgB = warns.get(ranges[b].idx) ?? [];
            msgB.push(`Overlaps with field ${ranges[a].idx + 1}`);
            warns.set(ranges[b].idx, msgB);
          }
        }
      }
    }

    return warns;
  }, [fields, formatType]);

  // ── Field CRUD ──────────────────────────────────────────────────────────

  const addField = useCallback(() => {
    const newField: FieldRow = {
      name: "",
      target: "",
      type: "string",
      columnIndex: fields.length
    };
    onFieldsChange([...fields, newField]);
  }, [fields, onFieldsChange]);

  const removeField = useCallback(
    (index: number) => {
      onFieldsChange(fields.filter((_, i) => i !== index));
    },
    [fields, onFieldsChange]
  );

  const updateField = useCallback(
    (index: number, patch: Partial<FieldRow>) => {
      onFieldsChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
    },
    [fields, onFieldsChange]
  );

  // ── Position column label based on format ───────────────────────────────

  const positionLabel = formatType === "fixed" ? "Start / Length" : "Col Index";

  return (
    <div className="space-y-4">
      {/* Format options */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(formatType === "csv" || formatType === "tsv") && (
          <>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-500">Delimiter</label>
              <Input
                value={formatConfig.delimiter ?? ""}
                onChange={(e) =>
                  onFormatConfigChange({ ...formatConfig, delimiter: e.target.value })
                }
                placeholder={formatType === "csv" ? "," : "\\t"}
                maxLength={5}
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-500">Quote Char</label>
              <Input
                value={formatConfig.quoteChar ?? ""}
                onChange={(e) =>
                  onFormatConfigChange({ ...formatConfig, quoteChar: e.target.value })
                }
                placeholder={'"'}
                maxLength={1}
                className="h-8 text-xs font-mono"
              />
            </div>
          </>
        )}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-slate-500">Encoding</label>
          <Input
            value={formatConfig.encoding ?? ""}
            onChange={(e) => onFormatConfigChange({ ...formatConfig, encoding: e.target.value })}
            placeholder="UTF-8"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1 flex items-end gap-2">
          <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={formatConfig.hasHeaderRow ?? false}
              onChange={(e) =>
                onFormatConfigChange({ ...formatConfig, hasHeaderRow: e.target.checked })
              }
              className="rounded border-slate-300"
            />
            Header Row
          </label>
        </div>
        {formatType === "fixed" && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">Record Length</label>
            <Input
              type="number"
              value={formatConfig.fixedRecordLength ?? ""}
              onChange={(e) =>
                onFormatConfigChange({
                  ...formatConfig,
                  fixedRecordLength: e.target.value ? Number(e.target.value) : undefined
                })
              }
              placeholder="e.g. 200"
              className="h-8 text-xs"
            />
          </div>
        )}
        {formatType === "xlsx" && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">Sheet Index</label>
            <Input
              type="number"
              value={formatConfig.sheetIndex ?? 0}
              onChange={(e) =>
                onFormatConfigChange({
                  ...formatConfig,
                  sheetIndex: Number(e.target.value)
                })
              }
              min={0}
              className="h-8 text-xs"
            />
          </div>
        )}
        {formatType === "xml_ssml" && (
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">XML Root Element</label>
            <Input
              value={formatConfig.xmlRootElement ?? ""}
              onChange={(e) =>
                onFormatConfigChange({ ...formatConfig, xmlRootElement: e.target.value })
              }
              placeholder="e.g. Records"
              className="h-8 text-xs"
            />
          </div>
        )}
      </div>

      {/* Fields table */}
      <div className="rounded-lg border border-slate-200 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[10px] w-8">#</TableHead>
              <TableHead className="text-[10px] min-w-[140px]">Field Name</TableHead>
              <TableHead className="text-[10px] min-w-[120px]">Target Path</TableHead>
              <TableHead className="text-[10px] w-28">Type</TableHead>
              <TableHead className="text-[10px] w-28">{positionLabel}</TableHead>
              <TableHead className="text-[10px] w-20">Required</TableHead>
              <TableHead className="text-[10px] w-24">Date Format</TableHead>
              <TableHead className="text-[10px] w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-xs text-slate-400">
                  No fields defined. Click "Add Field" to start.
                </TableCell>
              </TableRow>
            ) : (
              fields.map((field, idx) => {
                const fieldWarnings = warnings.get(idx);
                return (
                  <TableRow key={idx} className={fieldWarnings ? "bg-amber-50/50" : ""}>
                    <TableCell className="text-[10px] text-slate-400 font-mono">
                      {idx + 1}
                      {fieldWarnings && (
                        <span title={fieldWarnings.join("; ")}>
                          <AlertTriangle className="h-3 w-3 text-amber-500 ml-1 inline" />
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={field.name}
                        onChange={(e) => updateField(idx, { name: e.target.value })}
                        placeholder="field_name"
                        className="h-7 text-xs font-mono"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={field.target}
                        onChange={(e) => updateField(idx, { target: e.target.value })}
                        placeholder="journal.date"
                        className="h-7 text-xs font-mono"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={field.type}
                        onValueChange={(v) => updateField(idx, { type: v as FsdFieldType })}
                      >
                        <SelectTrigger className="h-7 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((t) => (
                            <SelectItem key={t} value={t} className="text-xs">
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {formatType === "fixed" ? (
                        <div className="flex gap-1">
                          <Input
                            type="number"
                            value={field.fixedStart ?? ""}
                            onChange={(e) =>
                              updateField(idx, {
                                fixedStart: e.target.value ? Number(e.target.value) : undefined
                              })
                            }
                            placeholder="Start"
                            className="h-7 text-xs w-14"
                            min={0}
                          />
                          <Input
                            type="number"
                            value={field.fixedLength ?? ""}
                            onChange={(e) =>
                              updateField(idx, {
                                fixedLength: e.target.value ? Number(e.target.value) : undefined
                              })
                            }
                            placeholder="Len"
                            className="h-7 text-xs w-14"
                            min={1}
                          />
                        </div>
                      ) : formatType === "xml_ssml" ? (
                        <Input
                          value={field.xmlPath ?? ""}
                          onChange={(e) => updateField(idx, { xmlPath: e.target.value })}
                          placeholder="XPath"
                          className="h-7 text-xs font-mono"
                        />
                      ) : (
                        <Input
                          type="number"
                          value={field.columnIndex ?? ""}
                          onChange={(e) =>
                            updateField(idx, {
                              columnIndex: e.target.value ? Number(e.target.value) : undefined
                            })
                          }
                          placeholder="0"
                          className="h-7 text-xs"
                          min={0}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={field.required ?? false}
                        onChange={(e) => updateField(idx, { required: e.target.checked })}
                        className="rounded border-slate-300"
                      />
                    </TableCell>
                    <TableCell>
                      {(field.type === "date" || field.type === "datetime") && (
                        <Input
                          value={field.dateFormat ?? ""}
                          onChange={(e) => updateField(idx, { dateFormat: e.target.value })}
                          placeholder="DD/MM/YYYY"
                          className="h-7 text-[10px] font-mono"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeField(idx)}
                        className="h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Field button */}
      <Button type="button" variant="outline" size="sm" onClick={addField} className="gap-1.5">
        <Plus className="h-3.5 w-3.5" /> Add Field
      </Button>

      {/* Warnings summary */}
      {warnings.size > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          <p className="font-semibold flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            {warnings.size} field{warnings.size > 1 ? "s" : ""} with warnings
          </p>
          {Array.from(warnings.entries()).map(([idx, msgs]) => (
            <p key={idx}>
              Field {idx + 1} ({fields[idx]?.name || "unnamed"}): {msgs.join("; ")}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
