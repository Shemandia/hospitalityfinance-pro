"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApiContext } from "../../../components/use-api-context";
import {
  createBudgetDefinition,
  getBudgetDefinitions,
  getBudgetLines,
  getBudgetVariance,
  getGLAccounts,
  getPeriods,
  upsertBudgetLines
} from "../../../lib/gl-api";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../components/ui/dialog";
import { cn } from "../../../lib/utils";

type BudgetDefinition = { id: string; name: string; year: number; isActive: boolean };
type BudgetLine = {
  id: string;
  accountId: string;
  month: number;
  amount: string;
  account?: { id: string; code: string; name: string };
};
type VarianceLine = {
  accountId: string;
  accountCode: string;
  accountName: string;
  budgetAmount: string;
  actualAmount: string;
  variance: string;
  variancePct: string | null;
};
type Period = { id: string; name: string; status: string };
type AccountNode = { id: string; code: string; name: string; children?: AccountNode[] };

function flattenAccounts(nodes: AccountNode[], d = 0): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const n of nodes) {
    out.push({ id: n.id, label: `${"\u00a0\u00a0".repeat(d)}${n.code} – ${n.name}` });
    if (n.children?.length) out.push(...flattenAccounts(n.children, d + 1));
  }
  return out;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

const defSchema = z.object({
  name: z.string().min(1, "Required"),
  year: z.coerce.number().int().min(2000).max(2100)
});

export default function BudgetPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [selectedDefId, setSelectedDefId] = useState<string | null>(null);
  const [showNewDef, setShowNewDef] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [lineAccountId, setLineAccountId] = useState("");
  const [lineMonth, setLineMonth] = useState("");
  const [lineAmount, setLineAmount] = useState("");
  const [variancePeriodId, setVariancePeriodId] = useState("");

  const form = useForm<z.infer<typeof defSchema>>({
    resolver: zodResolver(defSchema),
    defaultValues: { year: new Date().getFullYear() }
  });

  const definitionsQ = useQuery({
    queryKey: ["budget-defs", apiContext?.entityId],
    queryFn: () => (apiContext ? getBudgetDefinitions(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r) => (r.data as unknown as BudgetDefinition[]) ?? []
  });
  const linesQ = useQuery({
    queryKey: ["budget-lines", apiContext?.entityId, selectedDefId],
    queryFn: () =>
      apiContext && selectedDefId
        ? getBudgetLines(apiContext, selectedDefId)
        : Promise.resolve({ data: [] }),
    enabled: Boolean(apiContext && selectedDefId),
    select: (r) => (r.data as unknown as BudgetLine[]) ?? []
  });
  const varianceQ = useQuery({
    queryKey: ["budget-variance", apiContext?.entityId, selectedDefId, variancePeriodId],
    queryFn: () =>
      apiContext && selectedDefId && variancePeriodId
        ? getBudgetVariance(apiContext, selectedDefId, variancePeriodId)
        : Promise.resolve({ data: null }),
    enabled: Boolean(apiContext && selectedDefId && variancePeriodId),
    select: (r) => {
      const outer = r.data as unknown as { data: VarianceLine[] } | null;
      return outer?.data ?? [];
    }
  });
  const periodsQ = useQuery({
    queryKey: ["periods", apiContext?.entityId],
    queryFn: () => (apiContext ? getPeriods(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r) => (r.data as unknown as Period[]) ?? []
  });
  const accountsQ = useQuery({
    queryKey: ["gl-accounts", apiContext?.entityId],
    queryFn: () => (apiContext ? getGLAccounts(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r) => flattenAccounts((r.data as unknown as AccountNode[]) ?? [])
  });

  const createDefMut = useMutation({
    mutationFn: (v: z.infer<typeof defSchema>) => createBudgetDefinition(apiContext!, v),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["budget-defs"] });
      setShowNewDef(false);
      form.reset();
      setFeedback("Budget definition created.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const addLineMut = useMutation({
    mutationFn: () =>
      upsertBudgetLines(apiContext!, selectedDefId!, [
        { accountId: lineAccountId, month: parseInt(lineMonth, 10), amount: lineAmount }
      ]),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["budget-lines"] });
      setLineAmount("");
      setFeedback("Line saved.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const fmt = (v: string) => parseFloat(v).toLocaleString(undefined, { minimumFractionDigits: 2 });
  const varianceClass = (v: string) =>
    parseFloat(v) > 0 ? "text-emerald-700" : parseFloat(v) < 0 ? "text-destructive" : "";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-primary">Budget Management</CardTitle>
          <Button size="sm" variant="teal" onClick={() => setShowNewDef(true)}>
            + Budget
          </Button>
        </CardHeader>
        <CardContent className="px-6 pb-4 pt-0">
          {feedback && (
            <p
              className={`mb-3 text-sm ${feedback.toLowerCase().includes("error") ? "text-destructive" : "text-emerald-700"}`}
            >
              {feedback}
            </p>
          )}
          <Tabs defaultValue="definitions">
            <TabsList className="mb-4">
              <TabsTrigger value="definitions">Definitions</TabsTrigger>
              <TabsTrigger value="lines" disabled={!selectedDefId}>
                Lines
              </TabsTrigger>
              <TabsTrigger value="variance" disabled={!selectedDefId}>
                Variance Report
              </TabsTrigger>
            </TabsList>

            <TabsContent value="definitions">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Year</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {definitionsQ.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : (
                    (definitionsQ.data ?? []).map((def) => (
                      <TableRow
                        key={def.id}
                        className={selectedDefId === def.id ? "bg-emerald-50" : ""}
                      >
                        <TableCell className="font-semibold">{def.name}</TableCell>
                        <TableCell>{def.year}</TableCell>
                        <TableCell>
                          <Badge variant={def.isActive ? "success" : "warning"}>
                            {def.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedDefId(def.id)}
                          >
                            View Lines
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="lines">
              {selectedDefId && (
                <>
                  <div className="grid grid-cols-4 gap-3 mb-4 p-4 bg-muted/40 rounded-lg items-end">
                    <div className="space-y-1.5">
                      <Label>Account</Label>
                      <select
                        aria-label="Account"
                        value={lineAccountId}
                        onChange={(e) => setLineAccountId(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                      >
                        <option value="">Select account</option>
                        {(accountsQ.data ?? []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Month</Label>
                      <select
                        aria-label="Month"
                        value={lineMonth}
                        onChange={(e) => setLineMonth(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                      >
                        <option value="">Select month</option>
                        {MONTHS.map((m, i) => (
                          <option key={i + 1} value={String(i + 1)}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={lineAmount}
                        onChange={(e) => setLineAmount(e.target.value)}
                      />
                    </div>
                    <Button
                      variant="teal"
                      disabled={addLineMut.isPending || !lineAccountId || !lineMonth || !lineAmount}
                      onClick={() => addLineMut.mutate()}
                    >
                      {addLineMut.isPending ? "Saving…" : "Add Line"}
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Account</TableHead>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Budget Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linesQ.isLoading ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                            Loading…
                          </TableCell>
                        </TableRow>
                      ) : (
                        (linesQ.data ?? []).map((line) => (
                          <TableRow key={line.id}>
                            <TableCell>
                              {line.account
                                ? `${line.account.code} – ${line.account.name}`
                                : line.accountId.slice(0, 8)}
                            </TableCell>
                            <TableCell>{MONTHS[line.month - 1] ?? line.month}</TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {fmt(line.amount)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </>
              )}
            </TabsContent>

            <TabsContent value="variance">
              {selectedDefId && (
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <Label>Period</Label>
                    <select
                      aria-label="Variance period"
                      value={variancePeriodId}
                      onChange={(e) => setVariancePeriodId(e.target.value)}
                      className="flex h-9 w-48 rounded-md border border-border bg-white px-3 py-1 text-sm"
                    >
                      <option value="">Select period</option>
                      {(periodsQ.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {variancePeriodId && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead className="text-right">Budget</TableHead>
                          <TableHead className="text-right">Actual</TableHead>
                          <TableHead className="text-right">Variance</TableHead>
                          <TableHead className="text-right">Var %</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {varianceQ.isLoading ? (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="text-center py-6 text-muted-foreground"
                            >
                              Loading…
                            </TableCell>
                          </TableRow>
                        ) : (
                          (varianceQ.data ?? []).map((line) => (
                            <TableRow key={line.accountId}>
                              <TableCell>
                                {line.accountCode} – {line.accountName}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {fmt(line.budgetAmount)}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs">
                                {fmt(line.actualAmount)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right font-mono text-xs font-semibold",
                                  varianceClass(line.variance)
                                )}
                              >
                                {fmt(line.variance)}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  "text-right text-xs",
                                  varianceClass(line.variancePct ?? "0")
                                )}
                              >
                                {line.variancePct != null
                                  ? `${parseFloat(line.variancePct).toFixed(1)}%`
                                  : "-"}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* New Budget Dialog */}
      <Dialog open={showNewDef} onOpenChange={setShowNewDef}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Budget Definition</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((v: z.infer<typeof defSchema>) => createDefMut.mutate(v))}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input {...form.register("name")} />
            </div>
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Input type="number" {...form.register("year")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowNewDef(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="teal" disabled={createDefMut.isPending}>
                {createDefMut.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
