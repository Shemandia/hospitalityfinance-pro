"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getReportDefinitions,
  getPeriodList,
  executeReportSync,
  drillDown,
  cloneReportDefinition,
  seedSystemReportDefinitions,
  type ReportResult,
  type ReportRow,
  type ReportColumnDef,
  type DrillDownRow,
  type ReportDefinitionSummary
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
import { Play, Loader2, Copy, Database, Search, ChevronDown, ChevronRight } from "lucide-react";

// ── Formatting helpers ───────────────────────────────────────────────────────

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function rowClassName(row: ReportRow): string {
  const classes: string[] = [];
  if (row.type === "heading") classes.push("bg-slate-50 font-bold");
  if (row.type === "subtotal") classes.push("bg-slate-50/50");
  if (row.type === "formula") classes.push("bg-slate-100/50");
  if (row.type === "blank") classes.push("h-4");
  if (row.formatting?.bold) classes.push("font-bold");
  return classes.join(" ");
}

function labelStyle(row: ReportRow): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (row.formatting?.indent) {
    style.paddingLeft = `${row.formatting.indent * 1.5}rem`;
  }
  if (row.formatting?.level && row.formatting.level >= 2) {
    style.fontSize = "0.8rem";
  }
  return style;
}

function underlineClass(row: ReportRow): string {
  if (row.formatting?.underline === "DOUBLE") return "border-b-4 border-double border-slate-800";
  if (row.formatting?.underline === "SINGLE") return "border-b border-slate-400";
  return "";
}

// ── Period type ──────────────────────────────────────────────────────────────

type Period = { id: string; name: string; status: string; year: number; month: number };

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ReportRunnerPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();

  const [definitionId, setDefinitionId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [comparativePeriodId, setComparativePeriodId] = useState("");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [drillDownData, setDrillDownData] = useState<DrillDownRow[] | null>(null);
  const [drillDownLabel, setDrillDownLabel] = useState("");

  // ── Queries ────────────────────────────────────────────────────────────────

  const definitionsQ = useQuery({
    queryKey: ["report-definitions", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getReportDefinitions(apiContext);
      return (res.data as unknown as ReportDefinitionSummary[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const periodsQ = useQuery({
    queryKey: ["periods", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getPeriodList(apiContext);
      return (res.data as unknown as Period[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const executeMut = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("Missing API context.");
      const res = await executeReportSync(apiContext, {
        definitionId,
        periodId,
        ...(comparativePeriodId ? { comparativePeriodId } : {})
      });
      return res.data as unknown as ReportResult;
    },
    onSuccess: (data) => setResult(data)
  });

  const drillDownMut = useMutation({
    mutationFn: async (params: {
      accountCodeFrom: string;
      accountCodeTo: string;
      periodId: string;
      accountTypes?: string[];
    }) => {
      if (!apiContext) throw new Error("Missing API context.");
      const res = await drillDown(apiContext, params);
      return (res.data as unknown as { rows: DrillDownRow[] }).rows;
    },
    onSuccess: (rows) => setDrillDownData(rows)
  });

  const cloneMut = useMutation({
    mutationFn: async (defId: string) => {
      if (!apiContext) throw new Error("Missing API context.");
      return cloneReportDefinition(apiContext, defId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-definitions"] });
    }
  });

  const seedMut = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("Missing API context.");
      return seedSystemReportDefinitions(apiContext);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-definitions"] });
    }
  });

  // ── Derived ────────────────────────────────────────────────────────────────

  const definitions = definitionsQ.data ?? [];
  const periods = periodsQ.data ?? [];
  const falFslFtlDefs = definitions.filter((d) => ["FAL", "FSL", "FTL"].includes(d.type));
  const canExecute = definitionId && periodId && !executeMut.isPending;
  const selectedDef = definitions.find((d) => d.id === definitionId);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleDrillDown(row: ReportRow) {
    if (!row.drillDown) return;
    setDrillDownLabel(row.label);
    drillDownMut.mutate(row.drillDown);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Report Runner</h1>
          <p className="text-sm text-muted-foreground">
            Execute FAL, FSL, and FTL reports with live results
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => seedMut.mutate()}
          disabled={seedMut.isPending}
        >
          <Database className="mr-1 h-3 w-3" />
          {seedMut.isPending ? "Seeding…" : "Seed System Reports"}
        </Button>
      </div>

      {seedMut.isSuccess && (
        <p className="text-sm text-emerald-700">System report definitions seeded successfully.</p>
      )}

      {/* Parameter Bar */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1 min-w-[220px] flex-1">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Report Definition
              </label>
              <Select value={definitionId} onValueChange={setDefinitionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select report…" />
                </SelectTrigger>
                <SelectContent>
                  {falFslFtlDefs.length === 0 && (
                    <SelectItem value="__none" disabled>
                      No FAL/FSL/FTL definitions — seed system reports first
                    </SelectItem>
                  )}
                  {falFslFtlDefs.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {d.type}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Period
              </label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period…" />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Comparative Period
              </label>
              <Select
                value={comparativePeriodId || "__none"}
                onValueChange={(v) => setComparativePeriodId(v === "__none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="(auto-detect)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">(auto-detect)</SelectItem>
                  {periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={() => executeMut.mutate()}
                disabled={!canExecute}
                className="gap-1.5"
              >
                {executeMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {executeMut.isPending ? "Running…" : "Execute"}
              </Button>

              {selectedDef && (
                <Button
                  variant="outline"
                  size="icon"
                  title="Clone this definition"
                  onClick={() => cloneMut.mutate(selectedDef.id)}
                  disabled={cloneMut.isPending}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {executeMut.isError && (
        <p className="text-sm text-red-600">{(executeMut.error as Error).message}</p>
      )}

      {cloneMut.isSuccess && (
        <p className="text-sm text-emerald-700">Definition cloned successfully.</p>
      )}

      {/* Report Result Grid */}
      {result && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">{result.metadata.reportName}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {result.metadata.periodName} &middot; {result.metadata.reportType} &middot;
                Generated {new Date(result.metadata.generatedAt).toLocaleString()}
              </p>
            </div>
            <Badge variant="outline">{result.rows.length} rows</Badge>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[300px]">Description</TableHead>
                  {result.columns.map((col: ReportColumnDef) => (
                    <TableHead key={col.key} className="text-right min-w-[120px]">
                      {col.label}
                    </TableHead>
                  ))}
                  <TableHead className="w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row: ReportRow) => (
                  <TableRow key={row.rowIndex} className={rowClassName(row)}>
                    <TableCell className={underlineClass(row)} style={labelStyle(row)}>
                      {row.type === "heading" ? (
                        <span className="text-sm font-semibold text-slate-700">{row.label}</span>
                      ) : (
                        row.label
                      )}
                    </TableCell>
                    {result.columns.map((col: ReportColumnDef) => (
                      <TableCell
                        key={col.key}
                        className={`text-right tabular-nums ${underlineClass(row)} ${
                          (row.values[col.key] ?? 0) < 0 ? "text-red-600" : ""
                        }`}
                      >
                        {row.type === "blank" ? "" : formatNumber(row.values[col.key])}
                      </TableCell>
                    ))}
                    <TableCell className="text-center">
                      {row.drillDown && (
                        <button
                          onClick={() => handleDrillDown(row)}
                          className="text-primary hover:text-primary/80 p-1"
                          title="Drill down to transactions"
                        >
                          <Search className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Drill-Down Dialog */}
      <Dialog
        open={drillDownData !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDrillDownData(null);
            setDrillDownLabel("");
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Transaction Detail — {drillDownLabel}</DialogTitle>
          </DialogHeader>
          {drillDownMut.isPending ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : drillDownData && drillDownData.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drillDownData.map((tx, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs">
                      {new Date(tx.date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{tx.reference}</TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">
                      {tx.description}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-mono">{tx.accountCode}</span>{" "}
                      <span className="text-muted-foreground">{tx.accountName}</span>
                    </TableCell>
                    <TableCell className="text-xs">{tx.journalType}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {tx.debit ? formatNumber(tx.debit) : ""}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {tx.credit ? formatNumber(tx.credit) : ""}
                    </TableCell>
                    <TableCell
                      className={`text-right text-xs tabular-nums ${tx.amount < 0 ? "text-red-600" : ""}`}
                    >
                      {formatNumber(tx.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No transactions found for this account range and period.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
