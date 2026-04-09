"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import {
  getYearEndConfig,
  saveYearEndConfig,
  runYearEndCleardownApi,
  type YearEndConfig,
  type YearEndCleardownResult
} from "../../../../lib/gl-api";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../../components/ui/dialog";
import { CalendarDays, Play, Settings } from "lucide-react";

export default function YearEndPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [showConfig, setShowConfig] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [result, setResult] = useState<YearEndCleardownResult | null>(null);

  // Config form state
  const [reCode, setReCode] = useState("");
  const [jtCode, setJtCode] = useState("");
  const [fyStart, setFyStart] = useState(1);
  const [configDesc, setConfigDesc] = useState("");

  // Run form state
  const [periodId, setPeriodId] = useState("");

  const configQ = useQuery({
    queryKey: ["year-end-config", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return null;
      const res = await getYearEndConfig(apiContext);
      return (res.data as unknown as YearEndConfig | null) ?? null;
    },
    enabled: Boolean(apiContext)
  });

  const periodsQ = useQuery({
    queryKey: ["periods-list", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await fetch(`/api/proxy/api/v1/periods?entityId=${apiContext.entityId}`, {
        headers: { "X-Entity-ID": apiContext.entityId ?? "" }
      });
      const json = await res.json();
      return (json.data ?? []) as Array<{
        id: string;
        year: number;
        month: number;
        name: string;
        status: string;
      }>;
    },
    enabled: Boolean(apiContext)
  });

  const saveMut = useMutation({
    mutationFn: () =>
      saveYearEndConfig(apiContext!, {
        retainedEarningsCode: reCode,
        journalTypeCode: jtCode || undefined,
        fiscalYearStartMonth: fyStart,
        description: configDesc || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["year-end-config"] });
      setShowConfig(false);
      setFeedback("Year-end config saved.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const runMut = useMutation({
    mutationFn: () => runYearEndCleardownApi(apiContext!, { periodId }),
    onSuccess: (res) => {
      const data = res.data as unknown as YearEndCleardownResult;
      setResult(data);
      setShowRun(false);
      setFeedback(
        data.journalId
          ? `Year-end cleardown posted. Net P&L: ${data.netProfitLoss.toLocaleString()}`
          : "No P&L balances to clear."
      );
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  function openConfigDialog() {
    const c = configQ.data;
    setReCode(c?.retainedEarningsCode ?? "");
    setJtCode(c?.journalTypeCode ?? "");
    setFyStart(c?.fiscalYearStartMonth ?? 1);
    setConfigDesc(c?.description ?? "");
    setShowConfig(true);
  }

  const config = configQ.data;
  const periods = periodsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Year-End Cleardown</h1>
          <p className="text-sm text-muted-foreground">
            Sweep P&L balances to Retained Earnings at fiscal year-end
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={openConfigDialog}>
            <Settings className="mr-1 h-3 w-3" /> Configure
          </Button>
          <Button variant="teal" size="sm" onClick={() => setShowRun(true)} disabled={!config}>
            <Play className="mr-1 h-3 w-3" /> Run Cleardown
          </Button>
        </div>
      </div>

      {feedback && (
        <p
          className={`text-sm ${feedback.includes("error") || feedback.includes("Error") ? "text-destructive" : "text-emerald-700"}`}
        >
          {feedback}
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Current Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          {!config ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No year-end configuration set. Click Configure to set up.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Retained Earnings Account:</span>
                <span className="ml-2 font-medium">{config.retainedEarningsCode}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Fiscal Year Start:</span>
                <span className="ml-2 font-medium">Month {config.fiscalYearStartMonth}</span>
              </div>
              {config.journalTypeCode && (
                <div>
                  <span className="text-muted-foreground">Journal Type:</span>
                  <span className="ml-2 font-medium">{config.journalTypeCode}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {result && result.lines.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Cleardown Result — FY{result.fiscalYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4 text-sm">
              <div>
                <span className="text-muted-foreground">Total Revenue:</span>
                <span className="ml-2 font-medium tabular-nums">
                  {result.totalRevenue.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Total Expense:</span>
                <span className="ml-2 font-medium tabular-nums">
                  {result.totalExpense.toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Net P&L:</span>
                <Badge
                  variant={result.netProfitLoss >= 0 ? "default" : "destructive"}
                  className="ml-2"
                >
                  {result.netProfitLoss.toLocaleString()}
                </Badge>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Closing Balance</TableHead>
                  <TableHead className="text-right">Cleardown</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">
                      {l.accountCode} — {l.accountName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {l.accountType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.closingBalance.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.cleardownAmount.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Config Dialog */}
      <Dialog open={showConfig} onOpenChange={setShowConfig}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Year-End Configuration</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Retained Earnings Account Code</Label>
              <Input
                value={reCode}
                onChange={(e) => setReCode(e.target.value)}
                placeholder="3100"
              />
            </div>
            <div className="space-y-1">
              <Label>Journal Type Code (optional)</Label>
              <Input value={jtCode} onChange={(e) => setJtCode(e.target.value)} placeholder="YE" />
            </div>
            <div className="space-y-1">
              <Label>Fiscal Year Start Month (1-12)</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={fyStart}
                onChange={(e) => setFyStart(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input value={configDesc} onChange={(e) => setConfigDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfig(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!reCode || saveMut.isPending}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Run Dialog */}
      <Dialog open={showRun} onOpenChange={setShowRun}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run Year-End Cleardown</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Period (must be final period of fiscal year)</Label>
              <select
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                <option value="">Select period...</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ?? `${p.year}-${String(p.month).padStart(2, "0")}`} ({p.status})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRun(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!periodId || runMut.isPending}
              onClick={() => runMut.mutate()}
            >
              <CalendarDays className="mr-1 h-3 w-3" />
              {runMut.isPending ? "Processing..." : "Run Cleardown"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
