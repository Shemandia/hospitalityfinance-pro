"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCcw, Plus, Search, Play, Trash2, Edit2 } from "lucide-react";
import { Card, CardContent } from "../../../../../../components/ui/card";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
import { Input } from "../../../../../../components/ui/input";
import { Label } from "../../../../../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "../../../../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  listRecurringJournals,
  createRecurringJournal,
  updateRecurringJournal,
  deactivateRecurringJournal,
  generateRecurringJournals,
  type RecurringJournal
} from "../../../../../../lib/recurring-journals-api";

type LineInput = {
  accountId: string;
  debit: string;
  credit: string;
  currency: string;
  fxRate: string;
  description: string;
};

const EMPTY_LINE: LineInput = {
  accountId: "",
  debit: "0",
  credit: "0",
  currency: "USD",
  fxRate: "1",
  description: ""
};

const FREQ_LABELS: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUALLY: "Annually"
};

export default function RecurringJournalsPage() {
  const ctx = useApiContext();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateTargetId, setGenerateTargetId] = useState("");
  const [generatePeriodId, setGeneratePeriodId] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [formError, setFormError] = useState("");
  const [actionError, setActionError] = useState("");

  // Form state
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formFrequency, setFormFrequency] = useState("MONTHLY");
  const [formDayOfMonth, setFormDayOfMonth] = useState("1");
  const [formAutoPost, setFormAutoPost] = useState(false);
  const [formAutoReverse, setFormAutoReverse] = useState(false);
  const [formMaxOccurrences, setFormMaxOccurrences] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formCurrency, setFormCurrency] = useState("USD");
  const [formLines, setFormLines] = useState<LineInput[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);

  const {
    data: journalsRes,
    isLoading,
    error
  } = useQuery({
    queryKey: ["recurring-journals", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listRecurringJournals(ctx!),
    enabled: !!ctx
  });
  const journals = journalsRes?.data ?? [];

  const filtered = journals.filter(
    (j) =>
      !searchTerm ||
      j.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (j.description ?? "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createRecurringJournal(ctx!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-journals"] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      updateRecurringJournal(ctx!, id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-journals"] });
      setEditId(null);
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateRecurringJournal(ctx!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-journals"] });
    },
    onError: (err: Error) => setActionError(err.message)
  });

  const generateMutation = useMutation({
    mutationFn: ({ id, periodId }: { id: string; periodId: string }) =>
      generateRecurringJournals(ctx!, id, periodId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["recurring-journals"] });
      setGenerateOpen(false);
      setActionError("");
      const count = res.data.generated;
      alert(`Generated ${count} journal${count !== 1 ? "s" : ""} successfully.`);
    },
    onError: (err: Error) => setActionError(err.message)
  });

  function resetForm() {
    setFormName("");
    setFormDescription("");
    setFormFrequency("MONTHLY");
    setFormDayOfMonth("1");
    setFormAutoPost(false);
    setFormAutoReverse(false);
    setFormMaxOccurrences("");
    setFormEndDate("");
    setFormCurrency("USD");
    setFormLines([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
    setFormError("");
    setEditId(null);
  }

  function openEdit(j: RecurringJournal) {
    setEditId(j.id);
    setFormName(j.name);
    setFormDescription(j.description ?? "");
    setFormFrequency(j.frequency);
    setFormDayOfMonth(String(j.dayOfMonth ?? 1));
    setFormAutoPost(j.autoPost);
    setFormAutoReverse(j.autoReverse);
    setFormMaxOccurrences(j.maxOccurrences != null ? String(j.maxOccurrences) : "");
    setFormEndDate(j.endDate?.slice(0, 10) ?? "");
    setFormCurrency(j.functionalCurrency);
    setFormLines(
      j.lines.length > 0
        ? j.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            currency: l.currency,
            fxRate: l.fxRate,
            description: l.description ?? ""
          }))
        : [{ ...EMPTY_LINE }, { ...EMPTY_LINE }]
    );
    setFormError("");
    setCreateOpen(true);
  }

  function handleSave() {
    setFormError("");
    if (!formName.trim()) {
      setFormError("Name is required.");
      return;
    }
    const validLines = formLines.filter(
      (l) => l.accountId.trim() && (Number(l.debit) > 0 || Number(l.credit) > 0)
    );
    if (validLines.length < 2) {
      setFormError("At least two journal lines are required.");
      return;
    }

    const payload = {
      name: formName.trim(),
      description: formDescription.trim() || undefined,
      frequency: formFrequency,
      dayOfMonth: Number(formDayOfMonth),
      autoPost: formAutoPost,
      autoReverse: formAutoReverse,
      maxOccurrences: formMaxOccurrences ? Number(formMaxOccurrences) : undefined,
      endDate: formEndDate || undefined,
      functionalCurrency: formCurrency,
      source: "RECURRING",
      lines: validLines.map((l) => ({
        accountId: l.accountId.trim(),
        debit: Number(l.debit),
        credit: Number(l.credit),
        currency: l.currency,
        fxRate: Number(l.fxRate),
        description: l.description
      }))
    };

    if (editId) {
      updateMutation.mutate({ id: editId, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function addLine() {
    setFormLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(index: number) {
    setFormLines((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof LineInput, value: string) {
    setFormLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  const activeCount = filtered.filter((j) => j.isActive).length;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <RefreshCcw className="h-6 w-6 text-muted-foreground" />
            Recurring Journals
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} template{filtered.length !== 1 ? "s" : ""} &middot; {activeCount}{" "}
            active
          </p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setCreateOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" /> New Template
        </Button>
      </div>

      {/* Search */}
      <div className="flex gap-3 items-end">
        <div className="grid gap-1.5 flex-1">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name or description..."
              className="pl-8"
            />
          </div>
        </div>
      </div>

      {actionError && (
        <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
          {actionError}
        </p>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading && (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          )}
          {error && (
            <div className="py-16 text-center text-sm text-destructive">
              Failed to load: {(error as Error).message}
            </div>
          )}
          {!isLoading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-4 text-left font-medium">Name</th>
                    <th className="py-2.5 px-4 text-center font-medium">Frequency</th>
                    <th className="py-2.5 px-4 text-center font-medium">Lines</th>
                    <th className="py-2.5 px-4 text-center font-medium">Auto-Post</th>
                    <th className="py-2.5 px-4 text-center font-medium">Auto-Reverse</th>
                    <th className="py-2.5 px-4 text-center font-medium">Generated</th>
                    <th className="py-2.5 px-4 text-center font-medium">Status</th>
                    <th className="py-2.5 px-4 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                        No recurring journal templates found. Create one to get started.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((j) => (
                      <tr
                        key={j.id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-sm">{j.name}</div>
                          {j.description && (
                            <div className="text-xs text-muted-foreground">{j.description}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant="outline" className="text-xs">
                            {FREQ_LABELS[j.frequency] ?? j.frequency}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center text-xs">{j.lines.length}</td>
                        <td className="py-3 px-4 text-center text-xs">
                          {j.autoPost ? (
                            <Badge variant="default" className="text-xs bg-emerald-600">
                              Yes
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center text-xs">
                          {j.autoReverse ? (
                            <Badge variant="default" className="text-xs bg-blue-600">
                              Yes
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center text-xs font-mono">
                          {j.occurrenceCount}
                          {j.maxOccurrences != null && (
                            <span className="text-muted-foreground">/{j.maxOccurrences}</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            variant="default"
                            className={`text-xs ${j.isActive ? "bg-emerald-600" : "bg-slate-500"}`}
                          >
                            {j.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1 justify-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setGenerateTargetId(j.id);
                                setGeneratePeriodId("");
                                setActionError("");
                                setGenerateOpen(true);
                              }}
                              disabled={!j.isActive}
                              title="Generate journals"
                              className="h-7 w-7 p-0"
                            >
                              <Play className="h-4 w-4 text-emerald-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(j)}
                              title="Edit"
                              className="h-7 w-7 p-0"
                            >
                              <Edit2 className="h-4 w-4 text-blue-500" />
                            </Button>
                            {j.isActive && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm(`Deactivate "${j.name}"?`)) {
                                    deactivateMutation.mutate(j.id);
                                  }
                                }}
                                disabled={deactivateMutation.isPending}
                                title="Deactivate"
                                className="h-7 w-7 p-0"
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          if (!v) {
            setCreateOpen(false);
            setEditId(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editId ? "Edit Recurring Journal" : "New Recurring Journal Template"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 max-h-[65vh] overflow-y-auto">
            {formError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {formError}
              </p>
            )}

            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Monthly Rent Accrual"
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label>Frequency</Label>
                <Select value={formFrequency} onValueChange={setFormFrequency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MONTHLY">Monthly</SelectItem>
                    <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                    <SelectItem value="ANNUALLY">Annually</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Day of Month</Label>
                <Input
                  type="number"
                  value={formDayOfMonth}
                  onChange={(e) => setFormDayOfMonth(e.target.value)}
                  min={1}
                  max={28}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Currency</Label>
                <Input
                  value={formCurrency}
                  onChange={(e) => setFormCurrency(e.target.value)}
                  placeholder="USD"
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formAutoPost}
                  onChange={(e) => setFormAutoPost(e.target.checked)}
                  className="rounded border-gray-300"
                  id="autoPost"
                />
                <Label htmlFor="autoPost" className="text-sm">
                  Auto-Post
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formAutoReverse}
                  onChange={(e) => setFormAutoReverse(e.target.checked)}
                  className="rounded border-gray-300"
                  id="autoReverse"
                />
                <Label htmlFor="autoReverse" className="text-sm">
                  Auto-Reverse
                </Label>
              </div>
              <div className="grid gap-1.5">
                <Label>Max Occurrences</Label>
                <Input
                  type="number"
                  value={formMaxOccurrences}
                  onChange={(e) => setFormMaxOccurrences(e.target.value)}
                  placeholder="Unlimited"
                  min={1}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={formEndDate}
                  onChange={(e) => setFormEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* Journal Lines */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Journal Lines</Label>
                <Button variant="outline" size="sm" onClick={addLine} className="gap-1 text-xs">
                  <Plus className="h-3 w-3" /> Add Line
                </Button>
              </div>
              <div className="border rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 text-xs text-muted-foreground uppercase">
                      <th className="py-2 px-2 text-left">Account ID</th>
                      <th className="py-2 px-2 text-right">Debit</th>
                      <th className="py-2 px-2 text-right">Credit</th>
                      <th className="py-2 px-2 text-left">Description</th>
                      <th className="py-2 px-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formLines.map((line, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="py-1 px-2">
                          <Input
                            value={line.accountId}
                            onChange={(e) => updateLine(i, "accountId", e.target.value)}
                            placeholder="Account UUID"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="py-1 px-2">
                          <Input
                            type="number"
                            value={line.debit}
                            onChange={(e) => updateLine(i, "debit", e.target.value)}
                            min={0}
                            step="0.01"
                            className="h-8 text-xs text-right"
                          />
                        </td>
                        <td className="py-1 px-2">
                          <Input
                            type="number"
                            value={line.credit}
                            onChange={(e) => updateLine(i, "credit", e.target.value)}
                            min={0}
                            step="0.01"
                            className="h-8 text-xs text-right"
                          />
                        </td>
                        <td className="py-1 px-2">
                          <Input
                            value={line.description}
                            onChange={(e) => updateLine(i, "description", e.target.value)}
                            placeholder="Line description"
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="py-1 px-2">
                          {formLines.length > 2 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeLine(i)}
                              className="h-7 w-7 p-0"
                            >
                              <Trash2 className="h-3 w-3 text-red-500" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                setEditId(null);
              }}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Saving..."
                : editId
                  ? "Update Template"
                  : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Dialog */}
      <Dialog
        open={generateOpen}
        onOpenChange={(v) => {
          if (!v) setGenerateOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Journals</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {actionError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {actionError}
              </p>
            )}
            <div className="grid gap-1.5">
              <Label>Period ID</Label>
              <Input
                value={generatePeriodId}
                onChange={(e) => setGeneratePeriodId(e.target.value)}
                placeholder="Period UUID to generate journals for"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!generatePeriodId.trim()) {
                  setActionError("Period ID is required.");
                  return;
                }
                generateMutation.mutate({
                  id: generateTargetId,
                  periodId: generatePeriodId.trim()
                });
              }}
              disabled={generateMutation.isPending}
              className="gap-1.5"
            >
              <Play className="h-4 w-4" />
              {generateMutation.isPending ? "Generating..." : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
