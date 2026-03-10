"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useApiContext } from "../../../components/use-api-context";
import {
  getPeriodList,
  runConsolidation,
  getConsolidationRuns,
} from "../../../lib/gl-api";
import type { ConsolidationResult, ConsolidationRun, ConsolidatedLine } from "../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Separator } from "../../../components/ui/separator";
import {
  Building2,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Download,
} from "lucide-react";

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (v: string | number) => {
  const n = Number(v);
  if (isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

const TYPE_LABELS: Record<string, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expenses",
};

const TYPE_COLORS: Record<string, string> = {
  ASSET: "bg-blue-600",
  LIABILITY: "bg-slate-600",
  EQUITY: "bg-emerald-600",
  REVENUE: "bg-teal-600",
  EXPENSE: "bg-red-700",
};

// ── DEMO entity data ─────────────────────────────────────────────────────────
// In production this would be fetched from /api/v1/entities or similar.
// For now we hardcode the known demo entities from the seed data.
const DEMO_ENTITIES = [
  { id: "00000000-0000-0000-0000-000000000001", name: "HFP Demo Group", type: "GROUP" },
  { id: "00000000-0000-0000-0000-000000000002", name: "HFP Demo Resort - Jumeirah", type: "PROPERTY" },
  { id: "00000000-0000-0000-0000-000000000003", name: "HFP Demo Resort - Marina", type: "PROPERTY" },
];

// ── Type-grouped results ──────────────────────────────────────────────────────

function TypeSection({
  accountType,
  lines,
  entityIds,
  open,
  onToggle,
}: {
  accountType: string;
  lines: ConsolidatedLine[];
  entityIds: string[];
  open: boolean;
  onToggle: () => void;
}) {
  const sectionTotal = lines.reduce(
    (sum, l) => sum + Number(l.consolidatedAmount),
    0
  );

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${TYPE_COLORS[accountType] ?? "bg-slate-400"}`} />
          <span className="text-sm font-semibold text-slate-700">
            {TYPE_LABELS[accountType] ?? accountType}
          </span>
          <Badge variant="outline" className="text-[10px]">{lines.length}</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-slate-800 tabular-nums">
            {fmt(sectionTotal)}
          </span>
          {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="py-2 px-4 text-left font-semibold text-slate-500 w-20">Code</th>
                <th className="py-2 px-4 text-left font-semibold text-slate-500">Account</th>
                {entityIds.map((eid) => {
                  const entity = DEMO_ENTITIES.find((e) => e.id === eid);
                  return (
                    <th key={eid} className="py-2 px-3 text-right font-semibold text-slate-500 whitespace-nowrap">
                      {entity?.name ?? eid.slice(0, 8)}
                    </th>
                  );
                })}
                <th className="py-2 px-3 text-right font-semibold text-slate-500">Eliminations</th>
                <th className="py-2 px-3 text-right font-semibold text-slate-800">Consolidated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {lines.map((line) => (
                <tr key={line.accountId} className="hover:bg-slate-50/40">
                  <td className="py-1.5 px-4 font-mono text-slate-400">{line.accountCode}</td>
                  <td className="py-1.5 px-4 text-slate-700">{line.accountName}</td>
                  {entityIds.map((eid) => (
                    <td key={eid} className="py-1.5 px-3 text-right tabular-nums text-slate-600">
                      {fmt(line.entityAmounts[eid] ?? "0")}
                    </td>
                  ))}
                  <td className={`py-1.5 px-3 text-right tabular-nums ${Number(line.eliminationsAmount) !== 0 ? "text-amber-600" : "text-slate-400"}`}>
                    {Number(line.eliminationsAmount) !== 0 ? fmt(line.eliminationsAmount) : "—"}
                  </td>
                  <td className="py-1.5 px-3 text-right tabular-nums font-medium text-slate-800">
                    {fmt(line.consolidatedAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Run history row ───────────────────────────────────────────────────────────

function RunRow({ run }: { run: ConsolidationRun }) {
  const date = new Date(run.runAt).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  return (
    <tr className="border-b border-slate-50 hover:bg-slate-50/40">
      <td className="py-2.5 px-4 text-xs font-mono text-slate-400">{run.id.slice(0, 8)}…</td>
      <td className="py-2.5 px-4 text-sm text-slate-700">{run.reportingCurrency}</td>
      <td className="py-2.5 px-4 text-sm text-slate-600">{run.entityResults.length} entities</td>
      <td className="py-2.5 px-4 text-xs text-slate-500">{date}</td>
      <td className="py-2.5 px-4">
        <Badge variant={run.status === "COMPLETE" ? "default" : "secondary"} className="text-[10px]">
          {run.status}
        </Badge>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConsolidationPage() {
  const apiContext = useApiContext();
  const queryClient = useQueryClient();

  const [parentEntityId, setParentEntityId] = useState("NONE");
  const [childEntityIds, setChildEntityIds] = useState<string[]>([]);
  const [reportingCurrency, setReportingCurrency] = useState("USD");
  const [periodId, setPeriodId] = useState("NONE");

  const [result, setResult] = useState<ConsolidationResult | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(TYPE_ORDER));

  const periodsQuery = useQuery({
    queryKey: ["periods", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getPeriodList(apiContext);
      return res.data ?? [];
    },
    enabled: Boolean(apiContext),
  });

  const runHistoryQuery = useQuery({
    queryKey: ["consolidation-runs", parentEntityId],
    queryFn: async () => {
      if (!apiContext || parentEntityId === "NONE") return [];
      const res = await getConsolidationRuns(apiContext, parentEntityId);
      return res.data ?? [];
    },
    enabled: Boolean(apiContext && parentEntityId !== "NONE"),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("Missing API context.");
      const res = await runConsolidation(apiContext, {
        parentEntityId,
        childEntityIds,
        reportingCurrency,
        periodId,
      });
      return res.data as ConsolidationResult;
    },
    onSuccess: (data) => {
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ["consolidation-runs", parentEntityId] });
    },
  });

  const toggleChild = (id: string) => {
    setChildEntityIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const canRun =
    parentEntityId !== "NONE" &&
    childEntityIds.length > 0 &&
    reportingCurrency.length === 3 &&
    periodId !== "NONE" &&
    !runMutation.isPending;

  // Group result lines by account type
  const groupedLines = useMemo(() => {
    if (!result) return new Map<string, ConsolidatedLine[]>();
    const map = new Map<string, ConsolidatedLine[]>();
    for (const line of result.consolidatedLines) {
      if (!map.has(line.accountType)) map.set(line.accountType, []);
      map.get(line.accountType)!.push(line);
    }
    return map;
  }, [result]);

  const toggleSection = (type: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  function exportCSV() {
    if (!result) return;
    const rows: string[][] = [
      ["Account Code", "Account Name", "Type", ...childEntityIds.map(
        (eid) => DEMO_ENTITIES.find((e) => e.id === eid)?.name ?? eid
      ), "Eliminations", "Consolidated"],
    ];
    for (const line of result.consolidatedLines) {
      rows.push([
        line.accountCode,
        line.accountName,
        line.accountType,
        ...childEntityIds.map((eid) => line.entityAmounts[eid] ?? "0"),
        line.eliminationsAmount,
        line.consolidatedAmount,
      ]);
    }
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `consolidation-${result.runId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--color-primary)">Consolidation</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Multi-entity consolidation with IAS 21 currency translation and IC eliminations
          </p>
        </div>
        {result && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Run form */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Run Consolidation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Parent entity */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Parent Entity
              </Label>
              <Select value={parentEntityId} onValueChange={setParentEntityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select group entity…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Select group entity…</SelectItem>
                  {DEMO_ENTITIES.filter((e) => e.type === "GROUP").map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Child entities */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Child Entities
              </Label>
              <div className="space-y-1.5 rounded-md border border-border p-2.5">
                {DEMO_ENTITIES.filter((e) => e.type === "PROPERTY").map((e) => (
                  <label key={e.id} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={childEntityIds.includes(e.id)}
                      onChange={() => toggleChild(e.id)}
                      className="rounded border-border"
                    />
                    {e.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Reporting currency */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Reporting Currency
              </Label>
              <Input
                value={reportingCurrency}
                onChange={(e) => setReportingCurrency(e.target.value.toUpperCase().slice(0, 3))}
                placeholder="USD"
                maxLength={3}
                className="font-mono uppercase"
              />
            </div>

            {/* Period */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Period
              </Label>
              <Select value={periodId} onValueChange={setPeriodId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Select period…</SelectItem>
                  {(periodsQuery.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      <Badge variant="outline" className="ml-2 text-[10px]">{p.status}</Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full gap-1.5"
              disabled={!canRun}
              onClick={() => runMutation.mutate()}
            >
              {runMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</>
                : <><Play className="h-3.5 w-3.5" /> Run Consolidation</>
              }
            </Button>

            {runMutation.isError && (
              <p className="text-sm text-red-600">{(runMutation.error as Error).message}</p>
            )}

            {result && (
              <div className="space-y-2 rounded-lg border border-slate-200 p-3 bg-slate-50">
                <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  Consolidation complete
                </div>
                <p className="text-xs text-slate-500">
                  CTA adjustment: <strong>{fmt(result.ctaTotalAmount)}</strong>
                </p>
                {result.eliminationWarnings.length > 0 && (
                  <div className="space-y-1">
                    {result.eliminationWarnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-700 flex items-start gap-1">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {result ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                  Consolidated Trial Balance — {reportingCurrency}
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setOpenSections(
                    openSections.size === TYPE_ORDER.length
                      ? new Set()
                      : new Set(TYPE_ORDER)
                  )}
                >
                  {openSections.size === TYPE_ORDER.length ? "Collapse all" : "Expand all"}
                </Button>
              </div>
              <div className="space-y-2">
                {TYPE_ORDER.filter((t) => groupedLines.has(t)).map((type) => (
                  <TypeSection
                    key={type}
                    accountType={type}
                    lines={groupedLines.get(type)!}
                    entityIds={childEntityIds}
                    open={openSections.has(type)}
                    onToggle={() => toggleSection(type)}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2 border-2 border-dashed border-slate-200 rounded-lg">
              <Building2 className="h-8 w-8 opacity-30" />
              <p className="text-sm">Configure and run consolidation to view results.</p>
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Run history */}
      {parentEntityId !== "NONE" && (
        <div>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <History className="h-4 w-4" />
            Run History
          </h2>
          <Card>
            <CardContent className="p-0">
              {runHistoryQuery.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">Loading…</p>
              ) : (runHistoryQuery.data ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No consolidation runs yet.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Run ID</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Currency</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Entities</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                      <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(runHistoryQuery.data ?? []).map((run) => (
                      <RunRow key={run.id} run={run} />
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
