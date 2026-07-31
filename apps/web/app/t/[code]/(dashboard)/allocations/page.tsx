"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SlidersHorizontal,
  Plus,
  Play,
  Eye,
  Trash2,
  ArrowRightLeft,
  ListOrdered
} from "lucide-react";
import { Card, CardContent } from "../../../../../components/ui/card";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "../../../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  listAllocations,
  createAllocation,
  deleteAllocation,
  dryRunAllocation,
  executeAllocation,
  runAllSteppedAllocations,
  type AllocationDefinition,
  type AllocationResult
} from "../../../../../lib/allocations-api";

export default function AllocationsPage() {
  const ctx = useApiContext();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<AllocationResult | null>(null);
  const [formError, setFormError] = useState("");

  // Create form state
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newType, setNewType] = useState<"CHARGE" | "SPLIT">("CHARGE");
  const [newSourceFrom, setNewSourceFrom] = useState("");
  const [newSourceTo, setNewSourceTo] = useState("");
  const [newTargetAccount, setNewTargetAccount] = useState("");
  const [newOffsetAccount, setNewOffsetAccount] = useState("");
  const [newBasisType, setNewBasisType] = useState("FIXED_PERCENTAGE");
  const [newPercentage, setNewPercentage] = useState("100");

  const {
    data: res,
    isLoading,
    error
  } = useQuery({
    queryKey: ["allocations", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listAllocations(ctx!),
    enabled: !!ctx
  });
  const allocations = res?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createAllocation(ctx!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allocations"] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAllocation(ctx!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allocations"] })
  });

  const dryRunMutation = useMutation({
    mutationFn: (id: string) => dryRunAllocation(ctx!, id),
    onSuccess: (res) => {
      setPreviewResult(res.data);
      setPreviewOpen(true);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const executeMutation = useMutation({
    mutationFn: (id: string) => executeAllocation(ctx!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allocations"] })
  });

  const runAllMutation = useMutation({
    mutationFn: () => runAllSteppedAllocations(ctx!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["allocations"] })
  });

  function resetForm() {
    setNewName("");
    setNewDescription("");
    setNewType("CHARGE");
    setNewSourceFrom("");
    setNewSourceTo("");
    setNewTargetAccount("");
    setNewOffsetAccount("");
    setNewBasisType("FIXED_PERCENTAGE");
    setNewPercentage("100");
    setFormError("");
  }

  function handleCreate() {
    setFormError("");
    if (!newName.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!newSourceFrom.trim()) {
      setFormError("Source account code is required.");
      return;
    }
    if (!newTargetAccount.trim()) {
      setFormError("Target account code is required.");
      return;
    }

    createMutation.mutate({
      name: newName.trim(),
      description: newDescription.trim() || undefined,
      allocationType: newType,
      sources: [
        {
          accountCodeFrom: newSourceFrom.trim(),
          accountCodeTo: newSourceTo.trim() || newSourceFrom.trim()
        }
      ],
      targets: [
        {
          targetAccountCode: newTargetAccount.trim(),
          offsetAccountCode:
            newType === "CHARGE" ? newOffsetAccount.trim() || undefined : undefined,
          basisType: newBasisType,
          fixedPercentage: newBasisType === "FIXED_PERCENTAGE" ? Number(newPercentage) : undefined
        }
      ]
    });
  }

  const activeCount = allocations.filter((a) => a.isActive).length;
  const steppedCount = allocations.filter((a) => a.isSteppedSequence).length;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-muted-foreground" />
            Corporate Allocations
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {allocations.length} definition{allocations.length !== 1 ? "s" : ""} &middot;{" "}
            {activeCount} active
          </p>
        </div>
        <div className="flex gap-2">
          {steppedCount > 0 && (
            <Button
              variant="outline"
              onClick={() => runAllMutation.mutate()}
              disabled={runAllMutation.isPending}
              className="gap-1.5"
            >
              <ListOrdered className="h-4 w-4" />
              {runAllMutation.isPending ? "Running…" : "Run All Stepped"}
            </Button>
          )}
          <Button
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" /> New Allocation
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
            <p className="text-2xl font-bold">{allocations.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Active</p>
            <p className="text-2xl font-bold text-emerald-600">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Stepped</p>
            <p className="text-2xl font-bold text-blue-600">{steppedCount}</p>
          </CardContent>
        </Card>
      </div>

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
                    <th className="py-2.5 px-4 text-left font-medium">Type</th>
                    <th className="py-2.5 px-4 text-center font-medium">Sources</th>
                    <th className="py-2.5 px-4 text-center font-medium">Targets</th>
                    <th className="py-2.5 px-4 text-center font-medium">Stepped</th>
                    <th className="py-2.5 px-4 text-center font-medium">Status</th>
                    <th className="py-2.5 px-4 text-right font-medium w-48">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {allocations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-sm text-muted-foreground">
                        No allocation definitions yet. Create one to get started.
                      </td>
                    </tr>
                  ) : (
                    allocations.map((alloc) => (
                      <AllocationRow
                        key={alloc.id}
                        alloc={alloc}
                        onDryRun={() => dryRunMutation.mutate(alloc.id)}
                        onExecute={() => {
                          if (
                            confirm(`Execute allocation "${alloc.name}"? This will post a journal.`)
                          ) {
                            executeMutation.mutate(alloc.id);
                          }
                        }}
                        onDelete={() => {
                          if (confirm(`Delete allocation "${alloc.name}"?`)) {
                            deleteMutation.mutate(alloc.id);
                          }
                        }}
                        isExecuting={executeMutation.isPending}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          if (!v) setCreateOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Allocation Definition</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {formError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {formError}
              </p>
            )}

            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Utilities to Departments"
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Optional description"
              />
            </div>

            <div className="grid gap-1.5">
              <Label>Allocation Type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as "CHARGE" | "SPLIT")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CHARGE">
                    CHARGE — offset to contra account, source untouched
                  </SelectItem>
                  <SelectItem value="SPLIT">SPLIT — reverse source, post to targets</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="border rounded-md p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase">Source</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Account Code From</Label>
                  <Input
                    value={newSourceFrom}
                    onChange={(e) => setNewSourceFrom(e.target.value)}
                    placeholder="e.g. 5000"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Account Code To</Label>
                  <Input
                    value={newSourceTo}
                    onChange={(e) => setNewSourceTo(e.target.value)}
                    placeholder="e.g. 5999 (or same)"
                  />
                </div>
              </div>
            </div>

            <div className="border rounded-md p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase">Target</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Target Account</Label>
                  <Input
                    value={newTargetAccount}
                    onChange={(e) => setNewTargetAccount(e.target.value)}
                    placeholder="e.g. 6100"
                  />
                </div>
                {newType === "CHARGE" && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Offset Account</Label>
                    <Input
                      value={newOffsetAccount}
                      onChange={(e) => setNewOffsetAccount(e.target.value)}
                      placeholder="e.g. 5000"
                    />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Basis Type</Label>
                  <Select value={newBasisType} onValueChange={setNewBasisType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIXED_PERCENTAGE">Fixed Percentage</SelectItem>
                      <SelectItem value="FIXED_AMOUNT">Fixed Amount</SelectItem>
                      <SelectItem value="ACCOUNT_BALANCE">Account Balance Ratio</SelectItem>
                      <SelectItem value="STATISTICAL_KEY">Statistical Key</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newBasisType === "FIXED_PERCENTAGE" && (
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Percentage (%)</Label>
                    <Input
                      type="number"
                      value={newPercentage}
                      onChange={(e) => setNewPercentage(e.target.value)}
                      min={0}
                      max={100}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog
        open={previewOpen}
        onOpenChange={(v) => {
          if (!v) setPreviewOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Dry Run Preview — {previewResult?.definitionName ?? "Allocation"}
            </DialogTitle>
          </DialogHeader>
          {previewResult && (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span>
                  <strong>Type:</strong> {previewResult.allocationType}
                </span>
                <span>
                  <strong>Source Amount:</strong>{" "}
                  {Number(previewResult.sourceAmount).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 4
                  })}
                </span>
                <span>
                  <strong>Lines:</strong> {previewResult.lines.length}
                </span>
              </div>
              {previewResult.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No lines generated — source amount is zero.
                </p>
              ) : (
                <div className="overflow-x-auto max-h-80 border rounded">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted">
                      <tr className="text-xs text-muted-foreground uppercase">
                        <th className="py-2 px-3 text-left">Account</th>
                        <th className="py-2 px-3 text-right">Debit</th>
                        <th className="py-2 px-3 text-right">Credit</th>
                        <th className="py-2 px-3 text-left">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewResult.lines.map((line, i) => (
                        <tr key={i} className="border-t border-border/50">
                          <td className="py-1.5 px-3 font-mono text-xs">{line.accountCode}</td>
                          <td className="py-1.5 px-3 text-right font-mono text-xs">
                            {Number(line.debit) > 0
                              ? Number(line.debit).toLocaleString(undefined, {
                                  minimumFractionDigits: 2
                                })
                              : "—"}
                          </td>
                          <td className="py-1.5 px-3 text-right font-mono text-xs">
                            {Number(line.credit) > 0
                              ? Number(line.credit).toLocaleString(undefined, {
                                  minimumFractionDigits: 2
                                })
                              : "—"}
                          </td>
                          <td className="py-1.5 px-3 text-xs text-muted-foreground">
                            {line.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Row component ────────────────────────────────────────────────────────────

function AllocationRow({
  alloc,
  onDryRun,
  onExecute,
  onDelete,
  isExecuting
}: {
  alloc: AllocationDefinition;
  onDryRun: () => void;
  onExecute: () => void;
  onDelete: () => void;
  isExecuting: boolean;
}) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors group">
      <td className="py-3 px-4">
        <div className="font-medium">{alloc.name}</div>
        {alloc.description && (
          <div className="text-xs text-muted-foreground mt-0.5">{alloc.description}</div>
        )}
      </td>
      <td className="py-3 px-4">
        <Badge
          variant={alloc.allocationType === "CHARGE" ? "default" : "secondary"}
          className="text-xs"
        >
          <ArrowRightLeft className="h-3 w-3 mr-1" />
          {alloc.allocationType}
        </Badge>
      </td>
      <td className="py-3 px-4 text-center text-muted-foreground">{alloc.sources.length}</td>
      <td className="py-3 px-4 text-center text-muted-foreground">{alloc.targets.length}</td>
      <td className="py-3 px-4 text-center">
        {alloc.isSteppedSequence ? (
          <Badge variant="outline" className="text-xs">
            #{alloc.sequenceOrder}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-3 px-4 text-center">
        <Badge
          variant={alloc.isActive ? "default" : "secondary"}
          className={`text-xs ${alloc.isActive ? "bg-emerald-600" : ""}`}
        >
          {alloc.isActive ? "Active" : "Inactive"}
        </Badge>
      </td>
      <td className="py-3 px-4 text-right">
        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onDryRun}>
            <Eye className="h-3.5 w-3.5" /> Preview
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onExecute}
            disabled={isExecuting || !alloc.isActive}
          >
            <Play className="h-3.5 w-3.5" /> Run
          </Button>
          {!alloc.isSystem && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
