"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getReportDefinitions,
  createReportDefinition,
  deleteReportDefinition,
  createReportRun,
  getReportRun,
  getReportHistory,
  getReportDownloadUrl,
  getPeriods,
  type ReportDefinitionSummary,
  type ReportRunSummary
} from "../../../../../../lib/gl-api";
import { downloadBlob, getApiErrorMessage } from "../../../../../../lib/api-client";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
import { Input } from "../../../../../../components/ui/input";
import { Label } from "../../../../../../components/ui/label";
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
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../../../../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../../components/ui/tabs";
import {
  Plus,
  Play,
  Trash2,
  Download,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  BarChart3,
  DollarSign,
  BookOpen,
  Settings2
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const REPORT_TYPES = [
  {
    value: "USALI_PL",
    label: "USALI P&L",
    icon: <BarChart3 className="h-4 w-4" />,
    description: "Revenue and expenses by operated department"
  },
  {
    value: "BALANCE_SHEET",
    label: "Balance Sheet",
    icon: <DollarSign className="h-4 w-4" />,
    description: "Assets, liabilities, and equity"
  },
  {
    value: "CASHFLOW",
    label: "Cash Flow",
    icon: <BookOpen className="h-4 w-4" />,
    description: "Operating, investing, financing cash movements"
  },
  {
    value: "TRIAL_BALANCE",
    label: "Trial Balance",
    icon: <FileText className="h-4 w-4" />,
    description: "All accounts with debits, credits, balances"
  },
  {
    value: "CUSTOM",
    label: "Custom Summary",
    icon: <Settings2 className="h-4 w-4" />,
    description: "Custom grouping by USALI department/category"
  }
];

const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

const COLUMNS = [
  { value: "code", label: "Account Code" },
  { value: "name", label: "Account Name" },
  { value: "type", label: "Account Type" },
  { value: "debit", label: "Debits" },
  { value: "credit", label: "Credits" },
  { value: "balance", label: "Balance" },
  { value: "budget", label: "Budget" },
  { value: "variance", label: "Variance" },
  { value: "variancePct", label: "Variance %" }
];

type Period = { id: string; name: string; status: string; year: number; month: number };

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
  > = {
    COMPLETE: { variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    RUNNING: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    QUEUED: { variant: "outline", icon: <Clock className="h-3 w-3" /> },
    FAILED: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> }
  };
  const cfg = map[status] ?? { variant: "outline" as const, icon: null };
  return (
    <Badge variant={cfg.variant} className="gap-1 text-[10px]">
      {cfg.icon} {status}
    </Badge>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ReportBuilderPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showRun, setShowRun] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  // Create form state
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("CUSTOM");
  const [newColumns, setNewColumns] = useState<string[]>([
    "code",
    "name",
    "debit",
    "credit",
    "balance"
  ]);
  const [newAccountTypes, setNewAccountTypes] = useState<string[]>([]);
  const [newGroupBy, setNewGroupBy] = useState("usali_department");
  const [newShowZero, setNewShowZero] = useState(false);
  const [newComparative, setNewComparative] = useState({
    ytd: false,
    priorYear: false,
    budget: false
  });

  // Run form state
  const [runPeriodId, setRunPeriodId] = useState("");
  const [runNotifyEmail, setRunNotifyEmail] = useState("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // Queries
  const defsQ = useQuery({
    queryKey: ["report-defs", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () =>
      apiContext
        ? getReportDefinitions(apiContext)
        : Promise.resolve({ data: [] as ReportDefinitionSummary[] }),
    enabled: Boolean(apiContext),
    select: (r: { data: ReportDefinitionSummary[] }) => r.data ?? []
  });

  const historyQ = useQuery({
    queryKey: ["report-history", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () =>
      apiContext
        ? getReportHistory(apiContext, { limit: 50 })
        : Promise.resolve({ data: [] as ReportRunSummary[] }),
    enabled: Boolean(apiContext),
    select: (r: { data: ReportRunSummary[] }) => r.data ?? []
  });

  const periodsQ = useQuery({
    queryKey: ["periods", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => (apiContext ? getPeriods(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: { data: unknown }) => (r.data as Period[]) ?? []
  });

  const activeRunQ = useQuery({
    queryKey: ["report-run", activeRunId],
    queryFn: () =>
      apiContext && activeRunId ? getReportRun(apiContext, activeRunId) : Promise.reject(),
    enabled: Boolean(apiContext && activeRunId),
    refetchInterval: (query) => {
      const status = (query.state.data as any)?.data?.status;
      return status === "QUEUED" || status === "RUNNING" ? 3000 : false;
    },
    select: (r: { data: ReportRunSummary }) => r.data
  });

  // Mutations
  const createDefMut = useMutation({
    mutationFn: () =>
      createReportDefinition(apiContext!, {
        name: newName,
        type: newType,
        template: {
          report: newType,
          columns: newColumns,
          accountTypes: newAccountTypes.length > 0 ? newAccountTypes : undefined,
          groupBy: newGroupBy ? [newGroupBy] : undefined,
          showZeroBalances: newShowZero,
          comparativePeriods: newComparative
        }
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-defs"] });
      setShowCreate(false);
      setNewName("");
      setFeedback("Report definition created.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const deleteDefMut = useMutation({
    mutationFn: (id: string) => deleteReportDefinition(apiContext!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-defs"] });
      setFeedback("Report deleted.");
    }
  });

  const runReportMut = useMutation({
    mutationFn: () =>
      createReportRun(apiContext!, {
        definitionId: showRun!,
        parameters: {
          periodId: runPeriodId,
          ...(runNotifyEmail ? { notifyEmail: runNotifyEmail } : {})
        }
      }),
    onSuccess: (result) => {
      const runId = (result.data as unknown as ReportRunSummary)?.id;
      if (runId) setActiveRunId(runId);
      qc.invalidateQueries({ queryKey: ["report-history"] });
      setShowRun(null);
      setFeedback("Report queued for generation.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const definitions = defsQ.data ?? [];
  const history = historyQ.data ?? [];
  const systemDefs = definitions.filter((d) => d.isSystem);
  const customDefs = definitions.filter((d) => !d.isSystem);

  async function downloadReport(runId: string) {
    if (!apiContext) return;
    setFeedback("");
    try {
      await downloadBlob(
        apiContext,
        getReportDownloadUrl(runId),
        `report-${runId.slice(0, 8)}.pdf`
      );
    } catch (error) {
      setFeedback(getApiErrorMessage(error));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Report Builder</h1>
          <p className="text-sm text-muted-foreground">Create, run, and manage financial reports</p>
        </div>
        <Button variant="teal" size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 h-3 w-3" /> New Report
        </Button>
      </div>

      {feedback && (
        <p
          className={`text-sm ${feedback.includes("error") || feedback.includes("Error") ? "text-destructive" : "text-emerald-700"}`}
        >
          {feedback}
        </p>
      )}

      {/* Active Run Status */}
      {activeRunId && activeRunQ.data && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {activeRunQ.data.status === "RUNNING" || activeRunQ.data.status === "QUEUED" ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              ) : activeRunQ.data.status === "COMPLETE" ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <XCircle className="h-5 w-5 text-destructive" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {activeRunQ.data.status === "COMPLETE"
                    ? "Report ready"
                    : activeRunQ.data.status === "FAILED"
                      ? "Report failed"
                      : "Generating report…"}
                </p>
                {activeRunQ.data.errorMessage && (
                  <p className="text-xs text-destructive">{activeRunQ.data.errorMessage}</p>
                )}
              </div>
            </div>
            {activeRunQ.data.status === "COMPLETE" && (
              <button
                type="button"
                onClick={() => downloadReport(activeRunId)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-white text-sm font-medium hover:bg-primary/90"
              >
                <Download className="h-3 w-3" /> Download PDF
              </button>
            )}
            {(activeRunQ.data.status === "COMPLETE" || activeRunQ.data.status === "FAILED") && (
              <Button variant="ghost" size="sm" onClick={() => setActiveRunId(null)}>
                Dismiss
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="definitions">
        <TabsList>
          <TabsTrigger value="definitions">Report Definitions</TabsTrigger>
          <TabsTrigger value="history">Run History</TabsTrigger>
        </TabsList>

        <TabsContent value="definitions" className="space-y-4">
          {/* System Reports */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">System Reports</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {systemDefs.map((def) => {
                  const typeInfo = REPORT_TYPES.find((t) => t.value === def.type);
                  return (
                    <div
                      key={def.id}
                      className="border rounded-lg p-3 hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {typeInfo?.icon ?? <FileText className="h-4 w-4" />}
                        <span className="text-sm font-semibold">{def.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{typeInfo?.description}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setShowRun(def.id);
                          setRunPeriodId("");
                        }}
                      >
                        <Play className="mr-1 h-3 w-3" /> Generate
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Custom Reports */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-muted-foreground">Custom Reports</CardTitle>
              <Badge variant="outline">{customDefs.length}</Badge>
            </CardHeader>
            <CardContent>
              {customDefs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No custom reports yet. Click &quot;New Report&quot; to create one.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customDefs.map((def) => (
                      <TableRow key={def.id}>
                        <TableCell className="font-medium">{def.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {def.type.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(def.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setShowRun(def.id);
                                setRunPeriodId("");
                              }}
                            >
                              <Play className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteDefMut.mutate(def.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Recent Report Runs</CardTitle>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No report runs yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Report</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Generated</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium text-sm">
                          {run.definition?.name ?? run.definitionId.slice(0, 8)}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {run.definition?.type?.replace("_", " ")}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {run.runAt ? new Date(run.runAt).toLocaleString() : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {run.status === "COMPLETE" && run.outputUrl && (
                            <button
                              type="button"
                              onClick={() => downloadReport(run.id)}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Download className="h-3 w-3" /> Download
                            </button>
                          )}
                          {run.status === "FAILED" && run.errorMessage && (
                            <span className="text-xs text-destructive">{run.errorMessage}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Report Definition</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Report Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Monthly Revenue by Department"
              />
            </div>
            <div className="space-y-1">
              <Label>Report Type</Label>
              <select
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
              >
                {REPORT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label} — {t.description}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Columns</Label>
              <div className="flex flex-wrap gap-2">
                {COLUMNS.map((col) => (
                  <label key={col.value} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newColumns.includes(col.value)}
                      onChange={(e) =>
                        setNewColumns((prev) =>
                          e.target.checked
                            ? [...prev, col.value]
                            : prev.filter((c) => c !== col.value)
                        )
                      }
                      className="rounded border-border"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Group By</Label>
              <select
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                value={newGroupBy}
                onChange={(e) => setNewGroupBy(e.target.value)}
              >
                <option value="">No grouping</option>
                <option value="usali_department">USALI Department</option>
                <option value="usali_category">USALI Category</option>
                <option value="type">Account Type</option>
                <option value="parent_code">Parent Account</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Filter by Account Type</Label>
              <div className="flex flex-wrap gap-2">
                {ACCOUNT_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newAccountTypes.includes(t)}
                      onChange={(e) =>
                        setNewAccountTypes((prev) =>
                          e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)
                        )
                      }
                      className="rounded border-border"
                    />
                    {t}
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Leave all unchecked to include all types
              </p>
            </div>
            <div className="space-y-1">
              <Label>Comparative Columns</Label>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newComparative.ytd}
                    onChange={(e) => setNewComparative((p) => ({ ...p, ytd: e.target.checked }))}
                    className="rounded border-border"
                  />
                  Year-to-Date
                </label>
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newComparative.priorYear}
                    onChange={(e) =>
                      setNewComparative((p) => ({ ...p, priorYear: e.target.checked }))
                    }
                    className="rounded border-border"
                  />
                  Prior Year
                </label>
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newComparative.budget}
                    onChange={(e) => setNewComparative((p) => ({ ...p, budget: e.target.checked }))}
                    className="rounded border-border"
                  />
                  Budget
                </label>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={newShowZero}
                onChange={(e) => setNewShowZero(e.target.checked)}
                className="rounded border-border"
              />
              Show zero-balance accounts
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!newName || createDefMut.isPending}
              onClick={() => createDefMut.mutate()}
            >
              {createDefMut.isPending ? "Creating…" : "Create Report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run Dialog */}
      <Dialog open={!!showRun} onOpenChange={(open) => !open && setShowRun(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Generate Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Period</Label>
              <select
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                value={runPeriodId}
                onChange={(e) => setRunPeriodId(e.target.value)}
              >
                <option value="">Select period…</option>
                {(periodsQ.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.year}) — {p.status}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Notify Email (optional)</Label>
              <Input
                value={runNotifyEmail}
                onChange={(e) => setRunNotifyEmail(e.target.value)}
                placeholder="user@hotel.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRun(null)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!runPeriodId || runReportMut.isPending}
              onClick={() => runReportMut.mutate()}
            >
              {runReportMut.isPending ? "Queuing…" : "Generate PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
