"use client";

import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../components/use-api-context";
import {
  createReportRun,
  getPeriodList,
  getReportDefinitions,
  getReportRun,
} from "../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { Separator } from "../../../components/ui/separator";
import {
  BarChart2,
  Scale,
  Activity,
  FileText,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

// ── Report cards ──────────────────────────────────────────────────────────────

const REPORT_CARDS = [
  {
    title: "USALI P&L",
    description: "Departmental operating statement — Rooms, F&B, Spa, GOP, EBITDA. 11th Edition format.",
    href: "/reports/usali-pl",
    icon: BarChart2,
    accentClass: "bg-blue-600",
    badge: "Operational",
  },
  {
    title: "Balance Sheet",
    description: "Statement of financial position — Assets, Liabilities, Equity with section drill-down.",
    href: "/reports/balance-sheet",
    icon: Scale,
    accentClass: "bg-emerald-600",
    badge: "Financial",
  },
  {
    title: "Cash Flow",
    description: "Cash flow statement (indirect method) — Operating, Investing, Financing activities.",
    href: "/reports/cashflow",
    icon: Activity,
    accentClass: "bg-violet-600",
    badge: "Financial",
  },
];

// ── Run status badge ──────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ReactNode }> = {
    QUEUED: { label: "Queued", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
    RUNNING: { label: "Running", variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    DONE: { label: "Done", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    FAILED: { label: "Failed", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  };
  const cfg = map[status] ?? { label: status, variant: "outline" as const, icon: null };
  return (
    <Badge variant={cfg.variant} className="gap-1">
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type ReportDefinition = { id: string; name: string; type: string; isSystem: boolean };
type ReportRun = { id: string; status: string; outputUrl?: string | null; errorMessage?: string | null };

export default function ReportsPage() {
  const apiContext = useApiContext();
  const [definitionId, setDefinitionId] = useState("NONE");
  const [periodId, setPeriodId] = useState("NONE");
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const definitionsQuery = useQuery({
    queryKey: ["report-definitions", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getReportDefinitions(apiContext);
      return (res.data as unknown as ReportDefinition[]) ?? [];
    },
    enabled: Boolean(apiContext),
  });

  const periodsQuery = useQuery({
    queryKey: ["periods", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getPeriodList(apiContext);
      return res.data ?? [];
    },
    enabled: Boolean(apiContext),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("Missing API context.");
      const res = await createReportRun(apiContext, {
        definitionId,
        parameters: { periodId },
      });
      return res.data as ReportRun;
    },
    onSuccess: (run) => setLastRunId(run.id),
  });

  const runStatusQuery = useQuery({
    queryKey: ["report-run", apiContext?.entityId, lastRunId],
    queryFn: async () => {
      if (!apiContext || !lastRunId) return null;
      const res = await getReportRun(apiContext, lastRunId);
      return res.data as ReportRun;
    },
    enabled: Boolean(apiContext && lastRunId),
    refetchInterval: (query) => {
      const status = (query.state.data as ReportRun | null)?.status;
      return status === "QUEUED" || status === "RUNNING" ? 3000 : false;
    },
  });

  const canRun = definitionId !== "NONE" && periodId !== "NONE" && !runMutation.isPending;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-(--color-primary)">Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Financial statements and operational reports for your property.
        </p>
      </div>

      {/* Quick-access report cards */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Financial Statements</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {REPORT_CARDS.map(({ title, description, href, icon: Icon, accentClass, badge }) => (
            <Link key={href} href={href} className="block group">
              <Card className="h-full transition-shadow group-hover:shadow-md border-slate-200">
                <CardContent className="pt-5 pb-5 flex flex-col gap-3 h-full">
                  <div className="flex items-start justify-between">
                    <div className={`p-2.5 rounded-lg ${accentClass}`}>
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <Badge variant="outline" className="text-[10px]">{badge}</Badge>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-800 group-hover:text-(--color-primary) transition-colors">
                      {title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-medium text-(--color-primary) opacity-0 group-hover:opacity-100 transition-opacity">
                    Open report <ArrowRight className="h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <Separator />

      {/* Custom / queued report runner */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Custom Report Queue</h2>
        <Card className="max-w-xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Queue a Report Run
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Queued reports are processed asynchronously. Check status below once submitted.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Report Definition
              </label>
              <Select value={definitionId} onValueChange={setDefinitionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select definition…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Select definition…</SelectItem>
                  {(definitionsQuery.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                      <Badge variant="outline" className="ml-2 text-[10px]">{d.type}</Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Period
              </label>
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
              onClick={() => runMutation.mutate()}
              disabled={!canRun}
              className="gap-1.5"
            >
              {runMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {runMutation.isPending ? "Queueing…" : "Run Report"}
            </Button>

            {runMutation.isError && (
              <p className="text-sm text-red-600">{(runMutation.error as Error).message}</p>
            )}

            {/* Run status */}
            {runStatusQuery.data && (
              <div className="rounded-lg border border-slate-200 p-4 space-y-2 bg-slate-50">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Latest Run</p>
                  <RunStatusBadge status={runStatusQuery.data.status} />
                </div>
                <p className="text-xs text-slate-500 font-mono">{runStatusQuery.data.id}</p>
                {runStatusQuery.data.outputUrl && (
                  <a
                    href={runStatusQuery.data.outputUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    Download output <ArrowRight className="h-3 w-3" />
                  </a>
                )}
                {runStatusQuery.data.errorMessage && (
                  <p className="text-xs text-red-600">{runStatusQuery.data.errorMessage}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
