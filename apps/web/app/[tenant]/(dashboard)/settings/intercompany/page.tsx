"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  getICAccountPairs,
  createICAccountPair,
  deleteICAccountPair,
  getICJournals,
  createICJournal,
  approveICJournal,
  rejectICJournal,
  type ICAccountPairSummary,
  type ICJournalSummary
} from "../../../../../lib/gl-api";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../../../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../components/ui/tabs";
import { Plus, Trash2, Check, X, ArrowLeftRight, Settings } from "lucide-react";

const IC_STATUS_COLORS: Record<string, string> = {
  PENDING_BOTH_APPROVAL: "bg-amber-100 text-amber-800",
  PENDING_SOURCE_APPROVAL: "bg-amber-100 text-amber-800",
  PENDING_MIRROR_APPROVAL: "bg-amber-100 text-amber-800",
  APPROVED: "bg-blue-100 text-blue-800",
  POSTED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800"
};

export default function IntercompanySettingsPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState("");
  const [showCreatePair, setShowCreatePair] = useState(false);
  const [showCreateJournal, setShowCreateJournal] = useState(false);

  // Pair form
  const [cpEntityId, setCpEntityId] = useState("");
  const [icRecCode, setIcRecCode] = useState("");
  const [icPayCode, setIcPayCode] = useState("");

  // Journal form
  const [jMirrorEntityId, setJMirrorEntityId] = useState("");
  const [jPeriodId, setJPeriodId] = useState("");
  const [jAmount, setJAmount] = useState("");
  const [jCurrency, setJCurrency] = useState("USD");
  const [jReference, setJReference] = useState("");
  const [jDescription, setJDescription] = useState("");

  const pairsQ = useQuery({
    queryKey: ["ic-pairs", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getICAccountPairs(apiContext);
      return (res.data as unknown as ICAccountPairSummary[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const journalsQ = useQuery({
    queryKey: ["ic-journals", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getICJournals(apiContext);
      return (res.data as unknown as ICJournalSummary[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const createPairMut = useMutation({
    mutationFn: () =>
      createICAccountPair(apiContext!, {
        counterpartyEntityId: cpEntityId,
        icReceivableCode: icRecCode,
        icPayableCode: icPayCode
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-pairs"] });
      setShowCreatePair(false);
      setCpEntityId("");
      setIcRecCode("");
      setIcPayCode("");
      setFeedback("IC account pair created.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const deletePairMut = useMutation({
    mutationFn: (id: string) => deleteICAccountPair(apiContext!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-pairs"] });
      setFeedback("IC account pair removed.");
    }
  });

  const createJournalMut = useMutation({
    mutationFn: () =>
      createICJournal(apiContext!, {
        mirrorEntityId: jMirrorEntityId,
        periodId: jPeriodId,
        amount: parseFloat(jAmount),
        currency: jCurrency,
        reference: jReference,
        description: jDescription || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-journals"] });
      setShowCreateJournal(false);
      setJAmount("");
      setJReference("");
      setJDescription("");
      setFeedback("IC journal created. Awaiting dual approval.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveICJournal(apiContext!, id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["ic-journals"] });
      const data = res.data as unknown as ICJournalSummary;
      setFeedback(
        data.status === "POSTED"
          ? "IC journal approved and posted."
          : "IC journal approved from this entity."
      );
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => rejectICJournal(apiContext!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-journals"] });
      setFeedback("IC journal rejected.");
    }
  });

  const pairs = pairsQ.data ?? [];
  const journals = journalsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Intercompany</h1>
          <p className="text-sm text-muted-foreground">
            Manage cross-entity account pairs and intercompany journals
          </p>
        </div>
      </div>

      {feedback && (
        <p
          className={`text-sm ${feedback.includes("error") || feedback.includes("Error") ? "text-destructive" : "text-emerald-700"}`}
        >
          {feedback}
        </p>
      )}

      <Tabs defaultValue="pairs">
        <TabsList>
          <TabsTrigger value="pairs" className="gap-1">
            <Settings className="h-3 w-3" /> Account Pairs ({pairs.length})
          </TabsTrigger>
          <TabsTrigger value="journals" className="gap-1">
            <ArrowLeftRight className="h-3 w-3" /> IC Journals ({journals.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pairs">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-muted-foreground">IC Account Pairs</CardTitle>
              <Button variant="teal" size="sm" onClick={() => setShowCreatePair(true)}>
                <Plus className="mr-1 h-3 w-3" /> New Pair
              </Button>
            </CardHeader>
            <CardContent>
              {pairs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No IC account pairs configured.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Counterparty Entity</TableHead>
                      <TableHead>IC Receivable</TableHead>
                      <TableHead>IC Payable</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pairs.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium text-xs">
                          {p.counterpartyEntityId}
                        </TableCell>
                        <TableCell className="tabular-nums">{p.icReceivableCode}</TableCell>
                        <TableCell className="tabular-nums">{p.icPayableCode}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deletePairMut.mutate(p.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="journals">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm text-muted-foreground">Intercompany Journals</CardTitle>
              <Button variant="teal" size="sm" onClick={() => setShowCreateJournal(true)}>
                <Plus className="mr-1 h-3 w-3" /> New IC Journal
              </Button>
            </CardHeader>
            <CardContent>
              {journals.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No intercompany journals.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Source → Mirror</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {journals.map((j) => (
                      <TableRow key={j.id}>
                        <TableCell className="font-medium">{j.reference}</TableCell>
                        <TableCell className="text-xs">
                          {j.sourceEntityId.slice(0, 8)}... → {j.mirrorEntityId.slice(0, 8)}...
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {j.amount.toLocaleString()} {j.currency}
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${IC_STATUS_COLORS[j.status] ?? ""}`}>
                            {j.status.replace(/_/g, " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {j.status !== "POSTED" && j.status !== "REJECTED" && (
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-emerald-600 hover:text-emerald-700"
                                onClick={() => approveMut.mutate(j.id)}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => rejectMut.mutate(j.id)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
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

      {/* Create Pair Dialog */}
      <Dialog open={showCreatePair} onOpenChange={setShowCreatePair}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New IC Account Pair</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Counterparty Entity ID</Label>
              <Input
                value={cpEntityId}
                onChange={(e) => setCpEntityId(e.target.value)}
                placeholder="UUID of counterparty entity"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>IC Receivable Code</Label>
                <Input
                  value={icRecCode}
                  onChange={(e) => setIcRecCode(e.target.value)}
                  placeholder="1300"
                />
              </div>
              <div className="space-y-1">
                <Label>IC Payable Code</Label>
                <Input
                  value={icPayCode}
                  onChange={(e) => setIcPayCode(e.target.value)}
                  placeholder="2300"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePair(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!cpEntityId || !icRecCode || !icPayCode || createPairMut.isPending}
              onClick={() => createPairMut.mutate()}
            >
              {createPairMut.isPending ? "Creating..." : "Create Pair"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create IC Journal Dialog */}
      <Dialog open={showCreateJournal} onOpenChange={setShowCreateJournal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Intercompany Journal</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Mirror Entity ID</Label>
              <Input
                value={jMirrorEntityId}
                onChange={(e) => setJMirrorEntityId(e.target.value)}
                placeholder="UUID of mirror entity"
              />
            </div>
            <div className="space-y-1">
              <Label>Period ID</Label>
              <Input
                value={jPeriodId}
                onChange={(e) => setJPeriodId(e.target.value)}
                placeholder="UUID of period"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Amount</Label>
                <Input
                  type="number"
                  value={jAmount}
                  onChange={(e) => setJAmount(e.target.value)}
                  placeholder="10000"
                />
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Input
                  value={jCurrency}
                  onChange={(e) => setJCurrency(e.target.value.toUpperCase())}
                  placeholder="USD"
                  maxLength={3}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Reference</Label>
              <Input
                value={jReference}
                onChange={(e) => setJReference(e.target.value)}
                placeholder="IC-001"
              />
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input
                value={jDescription}
                onChange={(e) => setJDescription(e.target.value)}
                placeholder="Intercompany charge for shared services"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateJournal(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={
                !jMirrorEntityId ||
                !jPeriodId ||
                !jAmount ||
                !jReference ||
                createJournalMut.isPending
              }
              onClick={() => createJournalMut.mutate()}
            >
              {createJournalMut.isPending ? "Creating..." : "Create IC Journal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
