"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import {
  getGLAccountTree,
  getOperaCloudLogs,
  runOperaCloudImport,
  runSkyJanaSync,
  importBankStatement,
  getBankStatements,
  getBankTransactions,
  getConnectorMappings,
  upsertConnectorMapping,
  deleteConnectorMapping,
} from "../../../../lib/gl-api";
import type { ImportLog, BankStatement, ConnectorMapping } from "../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../components/ui/select";
import { Separator } from "../../../../components/ui/separator";
import Link from "next/link";
import {
  Loader2,
  RefreshCw,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  Trash2,
  Plus,
  ChevronRight,
  Building2,
  ArrowDownToLine,
  Network,
  Landmark,
  GitBranch,
} from "lucide-react";

// ── helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    SUCCESS: { variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    COMPLETE: { variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
    FAILED: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
    RUNNING: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    PENDING: { variant: "outline", icon: <Clock className="h-3 w-3" /> },
  };
  const cfg = map[status] ?? { variant: "outline" as const, icon: null };
  return (
    <Badge variant={cfg.variant} className="gap-1 text-[10px]">
      {cfg.icon}
      {status}
    </Badge>
  );
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = "opera" | "skyjana" | "bank" | "mappings";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "opera", label: "Opera Cloud (OHIP)", icon: <Building2 className="h-4 w-4" /> },
  { id: "skyjana", label: "Sky Jana", icon: <Network className="h-4 w-4" /> },
  { id: "bank", label: "Bank Feeds", icon: <Landmark className="h-4 w-4" /> },
  { id: "mappings", label: "Connector Mappings", icon: <ArrowDownToLine className="h-4 w-4" /> },
];

// ── Opera Cloud tab ───────────────────────────────────────────────────────────

function OperaTab() {
  const apiContext = useApiContext();
  const [hotelId, setHotelId] = useState("");
  const [businessDate, setBusinessDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);

  const logsQuery = useQuery({
    queryKey: ["opera-logs", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getOperaCloudLogs(apiContext);
      return (res.data as ImportLog[]) ?? [];
    },
    enabled: Boolean(apiContext),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("Missing context.");
      const res = await runOperaCloudImport(apiContext, {
        hotelId,
        businessDate,
        notifyEmail: notifyEmail || undefined,
      });
      return res.data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      setImportResult(data);
      logsQuery.refetch();
    },
  });

  return (
    <div className="space-y-6">
      {/* Import form */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Manual Import</CardTitle>
          <p className="text-xs text-muted-foreground">
            Trigger an Opera Cloud (OHIP) revenue trial balance import for a specific business date.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Hotel ID</Label>
            <Input value={hotelId} onChange={(e) => setHotelId(e.target.value)} placeholder="e.g. JUMEIRAH_001" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Business Date</Label>
            <Input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Notify Email <span className="text-slate-400">(optional)</span>
            </Label>
            <Input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="controller@hotel.com"
            />
          </div>
          <div className="md:col-span-3 flex items-center gap-3">
            <Button
              disabled={!hotelId || !businessDate || importMutation.isPending}
              onClick={() => importMutation.mutate()}
              className="gap-1.5"
            >
              {importMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing…</>
                : <><ArrowDownToLine className="h-3.5 w-3.5" /> Run Import</>
              }
            </Button>
            {importMutation.isError && (
              <p className="text-sm text-red-600">{(importMutation.error as Error).message}</p>
            )}
            {importResult && (
              <p className="text-sm text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Import complete
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Import log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            Import History
            <Button variant="ghost" size="sm" onClick={() => logsQuery.refetch()} className="gap-1">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {logsQuery.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : (logsQuery.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No import logs yet.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Business Date</th>
                  <th className="py-2 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Imported</th>
                  <th className="py-2 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Failed</th>
                  <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {(logsQuery.data ?? []).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/40">
                    <td className="py-2.5 px-4 text-xs text-slate-500">
                      {new Date(log.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2.5 px-4 text-sm text-slate-700">{log.businessDate ?? "—"}</td>
                    <td className="py-2.5 px-4 text-sm text-right text-emerald-700">{log.recordsImported}</td>
                    <td className="py-2.5 px-4 text-sm text-right text-red-600">{log.recordsFailed}</td>
                    <td className="py-2.5 px-4"><StatusBadge status={log.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sky Jana tab ──────────────────────────────────────────────────────────────

function SkyJanaTab() {
  const apiContext = useApiContext();
  const [syncResult, setSyncResult] = useState<Record<string, unknown> | null>(null);

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("Missing context.");
      const res = await runSkyJanaSync(apiContext);
      return res.data as Record<string, unknown>;
    },
    onSuccess: (data) => setSyncResult(data),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sky Jana Procurement Connector</CardTitle>
        <p className="text-xs text-muted-foreground">
          Polls the Sky Jana SFTP for new POs, GRNs, and supplier invoices. Runs three-way matching on new GRNs.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-slate-200 p-4 bg-slate-50 space-y-2">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Connector Status</p>
          <div className="flex items-center gap-2">
            <Badge variant="outline">SFTP Poll</Badge>
            <span className="text-xs text-slate-500">Every 15 minutes via BullMQ job</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Auto-Matching</Badge>
            <span className="text-xs text-slate-500">3-way match on GRN receipt with ±2% tolerance</span>
          </div>
        </div>

        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="gap-1.5"
        >
          {syncMutation.isPending
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…</>
            : <><RefreshCw className="h-3.5 w-3.5" /> Trigger Sync Now</>
          }
        </Button>

        {syncMutation.isError && (
          <p className="text-sm text-red-600">{(syncMutation.error as Error).message}</p>
        )}

        {syncResult && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm space-y-1">
            <p className="font-semibold text-emerald-700 flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4" />
              Sync complete
            </p>
            <pre className="text-xs text-emerald-800 whitespace-pre-wrap">
              {JSON.stringify(syncResult, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Bank Feeds tab ────────────────────────────────────────────────────────────

function BankTab() {
  const apiContext = useApiContext();
  const [format, setFormat] = useState<"MT940" | "OFX">("MT940");
  const [bankAccountRef, setBankAccountRef] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [expandedStatement, setExpandedStatement] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);

  const statementsQuery = useQuery({
    queryKey: ["bank-statements", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getBankStatements(apiContext);
      return (res.data as BankStatement[]) ?? [];
    },
    enabled: Boolean(apiContext),
  });

  const txQuery = useQuery({
    queryKey: ["bank-transactions", apiContext?.entityId, expandedStatement],
    queryFn: async () => {
      if (!apiContext || !expandedStatement) return [];
      const res = await getBankTransactions(apiContext, expandedStatement);
      return (res.data as Array<Record<string, unknown>>) ?? [];
    },
    enabled: Boolean(apiContext && expandedStatement),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("Missing context.");
      const res = await importBankStatement(apiContext, { format, bankAccountRef, fileContent });
      return res.data as Record<string, unknown>;
    },
    onSuccess: (data) => {
      setImportResult(data);
      setFileContent("");
      statementsQuery.refetch();
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Upload Bank Statement</CardTitle>
          <p className="text-xs text-muted-foreground">Paste MT940 or OFX file content to import transactions.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as "MT940" | "OFX")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MT940">MT940 (SWIFT)</SelectItem>
                  <SelectItem value="OFX">OFX</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Bank Account Ref</Label>
              <Input value={bankAccountRef} onChange={(e) => setBankAccountRef(e.target.value)} placeholder="e.g. HSBC-001-AED" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">File Content</Label>
            <textarea
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              rows={8}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y"
              placeholder={format === "MT940" ? ":20:STMT001\n:25:AE123456789\n:28C:001/001\n:60F:C260101USD10000,00\n..." : "<OFX>...</OFX>"}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              disabled={!bankAccountRef || !fileContent || importMutation.isPending}
              onClick={() => importMutation.mutate()}
              className="gap-1.5"
            >
              {importMutation.isPending
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing…</>
                : <><Upload className="h-3.5 w-3.5" /> Import</>
              }
            </Button>
            {importMutation.isError && (
              <p className="text-sm text-red-600">{(importMutation.error as Error).message}</p>
            )}
            {importResult && (
              <p className="text-sm text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Imported successfully
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Statements list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bank Statements</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {statementsQuery.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : (statementsQuery.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No statements imported yet.</p>
          ) : (
            <div>
              {(statementsQuery.data ?? []).map((stmt) => (
                <div key={stmt.id} className="border-b border-slate-100 last:border-0">
                  <button
                    onClick={() => setExpandedStatement(expandedStatement === stmt.id ? null : stmt.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50/60 transition-colors"
                  >
                    <div className="flex items-center gap-4 text-sm">
                      <span className="font-medium text-slate-800">{stmt.account?.code ?? stmt.accountId.slice(0, 8)}</span>
                      <Badge variant="outline" className="text-[10px]">{stmt.currency}</Badge>
                      <span className="text-slate-500">{stmt._count?.transactions ?? 0} txns</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-slate-500">
                        {new Date(stmt.statementDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                      <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${expandedStatement === stmt.id ? "rotate-90" : ""}`} />
                    </div>
                  </button>

                  {expandedStatement === stmt.id && (
                    <div className="border-t border-slate-100 bg-slate-50/40">
                      {txQuery.isLoading ? (
                        <p className="p-4 text-xs text-muted-foreground">Loading transactions…</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-200">
                              <th className="py-2 px-4 text-left text-slate-500 font-semibold">Date</th>
                              <th className="py-2 px-4 text-left text-slate-500 font-semibold">Description</th>
                              <th className="py-2 px-4 text-right text-slate-500 font-semibold">Amount</th>
                              <th className="py-2 px-4 text-left text-slate-500 font-semibold">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(txQuery.data ?? []).map((tx, i) => (
                              <tr key={i} className="border-b border-slate-50 hover:bg-white/60">
                                <td className="py-1.5 px-4 text-slate-500">{String(tx.valueDate ?? "").slice(0, 10)}</td>
                                <td className="py-1.5 px-4 text-slate-700">{String(tx.description ?? "")}</td>
                                <td className={`py-1.5 px-4 text-right tabular-nums ${Number(tx.amount) >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                                  {Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-1.5 px-4">
                                  <StatusBadge status={String(tx.reconciliationStatus ?? "UNMATCHED")} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Connector Mappings tab ────────────────────────────────────────────────────

function MappingsTab() {
  const apiContext = useApiContext();
  const queryClient = useQueryClient();

  const [connectorType, setConnectorType] = useState("OPERA_CLOUD");
  const [newSourceCode, setNewSourceCode] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newGlAccountId, setNewGlAccountId] = useState("NONE");

  const mappingsQuery = useQuery({
    queryKey: ["connector-mappings", apiContext?.entityId, connectorType],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getConnectorMappings(apiContext, connectorType);
      return (res.data as ConnectorMapping[]) ?? [];
    },
    enabled: Boolean(apiContext),
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts-flat", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getGLAccountTree(apiContext);
      // Flatten tree
      const flat: Array<{ id: string; code: string; name: string }> = [];
      const walk = (nodes: typeof res.data) => {
        for (const n of nodes) {
          if (n.allowPosting) flat.push({ id: n.id, code: n.code, name: n.name });
          if (n.children?.length) walk(n.children);
        }
      };
      walk(res.data);
      return flat;
    },
    enabled: Boolean(apiContext),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("Missing context.");
      await upsertConnectorMapping(apiContext, {
        connectorType,
        sourceCode: newSourceCode,
        notes: newNotes || undefined,
        glAccountId: newGlAccountId,
      });
    },
    onSuccess: () => {
      setNewSourceCode("");
      setNewNotes("");
      setNewGlAccountId("NONE");
      queryClient.invalidateQueries({ queryKey: ["connector-mappings", apiContext?.entityId, connectorType] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!apiContext) throw new Error("Missing context.");
      await deleteConnectorMapping(apiContext, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connector-mappings", apiContext?.entityId, connectorType] });
    },
  });

  const canAdd = newSourceCode && newGlAccountId !== "NONE" && !addMutation.isPending;

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex items-center gap-3">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">Connector</Label>
        <Select value={connectorType} onValueChange={setConnectorType}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OPERA_CLOUD">Opera Cloud (OHIP)</SelectItem>
            <SelectItem value="OPERA_SUN">Opera SUN</SelectItem>
            <SelectItem value="SKY_JANA">Sky Jana</SelectItem>
            <SelectItem value="BANK">Bank Feed</SelectItem>
            <SelectItem value="CUSTOM">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {connectorType.replace("_", " ")} Mappings
            <Badge variant="outline" className="ml-2 text-[10px]">{(mappingsQuery.data ?? []).length}</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Map external revenue/cost codes to GL accounts. Unmapped codes are flagged during import.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Source Code</th>
                <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                <th className="py-2 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">GL Account</th>
                <th className="py-2 px-4 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(mappingsQuery.data ?? []).map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/40">
                  <td className="py-2.5 px-4 text-sm font-mono text-slate-700">{m.sourceCode}</td>
                  <td className="py-2.5 px-4 text-sm text-slate-500">{m.notes ?? "—"}</td>
                  <td className="py-2.5 px-4 text-sm text-slate-700">
                    {m.glAccount
                      ? <><span className="font-mono text-slate-400 mr-1">{m.glAccount.code}</span>{m.glAccount.name}</>
                      : m.glAccountId.slice(0, 8) + "…"
                    }
                  </td>
                  <td className="py-2.5 px-4">
                    <button
                      onClick={() => deleteMutation.mutate(m.id)}
                      disabled={deleteMutation.isPending}
                      className="text-slate-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Add row */}
              <tr className="bg-slate-50/60 border-t border-dashed border-slate-200">
                <td className="py-2 px-4">
                  <Input
                    value={newSourceCode}
                    onChange={(e) => setNewSourceCode(e.target.value)}
                    placeholder="e.g. ROOM_REV"
                    className="h-7 text-xs font-mono"
                  />
                </td>
                <td className="py-2 px-4">
                  <Input
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                    placeholder="Room Revenue (optional)"
                    className="h-7 text-xs"
                  />
                </td>
                <td className="py-2 px-4">
                  <Select value={newGlAccountId} onValueChange={setNewGlAccountId}>
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="Select GL account…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Select GL account…</SelectItem>
                      {(accountsQuery.data ?? []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          <span className="font-mono text-slate-400 mr-1">{a.code}</span>{a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-2 px-4">
                  <Button
                    size="sm"
                    disabled={!canAdd}
                    onClick={() => addMutation.mutate()}
                    className="h-7 gap-1 text-xs"
                  >
                    {addMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Add
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
          {addMutation.isError && (
            <p className="px-4 py-2 text-xs text-red-600">{(addMutation.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("opera");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-(--color-primary)">Integrations</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          PMS connectors, bank feeds, and GL account mapping configuration.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200 pb-0">
        {TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === id
                ? "border-(--color-primary) text-(--color-primary)"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "opera" && <OperaTab />}
        {activeTab === "skyjana" && <SkyJanaTab />}
        {activeTab === "bank" && <BankTab />}
        {activeTab === "mappings" && <MappingsTab />}
      </div>

      <Separator />

      {/* Transfer Desk CTA */}
      <Link
        href="/settings/integrations/transfer-desk"
        className="flex items-center justify-between p-4 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-(--color-primary) transition-colors group"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-(--color-primary)/10">
            <GitBranch className="h-5 w-5 text-(--color-primary)" />
          </div>
          <div>
            <p className="text-sm font-semibold text-(--color-primary)">Transfer Desk</p>
            <p className="text-xs text-muted-foreground">
              Build field transformation rules for Opera Cloud & Sky Jana imports (Infor SunSystems–style interface definitions)
            </p>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-(--color-primary) transition-colors" />
      </Link>
    </div>
  );
}
