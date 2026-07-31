"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package,
  Plus,
  Search,
  Play,
  Calculator,
  Trash2,
  ArrowRightLeft,
  TrendingUp,
  XCircle
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
  listFixedAssets,
  listAssetCategories,
  createFixedAsset,
  previewDepreciation,
  runDepreciation,
  disposeAsset,
  transferAsset,
  revalueAsset,
  writeOffAsset,
  type FixedAsset,
  type DepreciationLine
} from "../../../../../lib/fixed-assets-api";

export default function FixedAssetsPage() {
  const ctx = useApiContext();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [depnPreviewOpen, setDepnPreviewOpen] = useState(false);
  const [depnLines, setDepnLines] = useState<DepreciationLine[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchTerm, setSearchTerm] = useState("");
  const [formError, setFormError] = useState("");

  // Create form state
  const [newCode, setNewCode] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newGrossValue, setNewGrossValue] = useState("");
  const [newFinalValue, setNewFinalValue] = useState("0");
  const [newUsefulLife, setNewUsefulLife] = useState("60");
  const [newMethod, setNewMethod] = useState("STRAIGHT_LINE");
  const [newRate, setNewRate] = useState("");
  const [newBsAccount, setNewBsAccount] = useState("");
  const [newPlAccount, setNewPlAccount] = useState("");
  const [newAcquisitionDate, setNewAcquisitionDate] = useState("");
  const [depnPeriodId, setDepnPeriodId] = useState("");

  // Lifecycle dialog state
  const [lifecycleAction, setLifecycleAction] = useState<
    "dispose" | "transfer" | "revalue" | "writeoff" | null
  >(null);
  const [lifecycleAssetId, setLifecycleAssetId] = useState("");
  const [lifecycleAssetCode, setLifecycleAssetCode] = useState("");
  const [disposeDate, setDisposeDate] = useState("");
  const [disposeProceeds, setDisposeProceeds] = useState("0");
  const [transferTarget, setTransferTarget] = useState("");
  const [revalueAmount, setRevalueAmount] = useState("");

  const {
    data: assetsRes,
    isLoading,
    error
  } = useQuery({
    queryKey: ["fixed-assets", ctx?.tenantSlug, ctx?.entityId, statusFilter, searchTerm],
    queryFn: () =>
      listFixedAssets(ctx!, {
        status: statusFilter !== "ALL" ? statusFilter : undefined,
        search: searchTerm || undefined
      }),
    enabled: !!ctx
  });
  const assets = assetsRes?.data ?? [];

  const { data: categoriesRes } = useQuery({
    queryKey: ["asset-categories", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listAssetCategories(ctx!),
    enabled: !!ctx
  });
  const categories = categoriesRes?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createFixedAsset(ctx!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const previewMutation = useMutation({
    mutationFn: (periodId: string) => previewDepreciation(ctx!, periodId),
    onSuccess: (res) => {
      setDepnLines(res.data);
      setDepnPreviewOpen(true);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const runDepnMutation = useMutation({
    mutationFn: (periodId: string) => runDepreciation(ctx!, periodId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      setDepnPreviewOpen(false);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const disposeMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      disposeAsset(ctx!, id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      setLifecycleAction(null);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const transferMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      transferAsset(ctx!, id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      setLifecycleAction(null);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const revalueMutation = useMutation({
    mutationFn: ({ id, newGrossValue }: { id: string; newGrossValue: number }) =>
      revalueAsset(ctx!, id, { newGrossValue }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      setLifecycleAction(null);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const writeOffMutation = useMutation({
    mutationFn: (id: string) => writeOffAsset(ctx!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed-assets"] });
      setLifecycleAction(null);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  function openLifecycle(
    asset: FixedAsset,
    action: "dispose" | "transfer" | "revalue" | "writeoff"
  ) {
    setLifecycleAssetId(asset.id);
    setLifecycleAssetCode(asset.assetCode);
    setDisposeDate("");
    setDisposeProceeds("0");
    setTransferTarget("");
    setRevalueAmount(String(asset.grossValue));
    setFormError("");
    setLifecycleAction(action);
  }

  function handleLifecycleConfirm() {
    setFormError("");
    if (lifecycleAction === "dispose") {
      if (!disposeDate) {
        setFormError("Disposal date is required.");
        return;
      }
      disposeMutation.mutate({
        id: lifecycleAssetId,
        payload: { disposalDate: disposeDate, disposalProceeds: Number(disposeProceeds) }
      });
    } else if (lifecycleAction === "transfer") {
      if (!transferTarget.trim()) {
        setFormError("Target entity ID is required.");
        return;
      }
      transferMutation.mutate({
        id: lifecycleAssetId,
        payload: { targetEntityId: transferTarget.trim() }
      });
    } else if (lifecycleAction === "revalue") {
      const val = Number(revalueAmount);
      if (!val || val <= 0) {
        setFormError("New gross value must be greater than zero.");
        return;
      }
      revalueMutation.mutate({ id: lifecycleAssetId, newGrossValue: val });
    } else if (lifecycleAction === "writeoff") {
      writeOffMutation.mutate(lifecycleAssetId);
    }
  }

  function resetForm() {
    setNewCode("");
    setNewDescription("");
    setNewCategoryId("");
    setNewGrossValue("");
    setNewFinalValue("0");
    setNewUsefulLife("60");
    setNewMethod("STRAIGHT_LINE");
    setNewRate("");
    setNewBsAccount("");
    setNewPlAccount("");
    setNewAcquisitionDate("");
    setFormError("");
  }

  function handleCreate() {
    setFormError("");
    if (!newCode.trim()) {
      setFormError("Asset code is required.");
      return;
    }
    if (!newDescription.trim()) {
      setFormError("Description is required.");
      return;
    }
    if (!newGrossValue || Number(newGrossValue) <= 0) {
      setFormError("Gross value must be greater than zero.");
      return;
    }
    if (!newBsAccount.trim() || !newPlAccount.trim()) {
      setFormError("BS and PL depreciation accounts are required.");
      return;
    }
    if (!newAcquisitionDate) {
      setFormError("Acquisition date is required.");
      return;
    }

    createMutation.mutate({
      assetCode: newCode.trim(),
      description: newDescription.trim(),
      categoryId: newCategoryId || undefined,
      grossValue: Number(newGrossValue),
      finalValue: Number(newFinalValue),
      usefulLifeMonths: Number(newUsefulLife),
      depreciationMethod: newMethod,
      depreciationRate: newRate ? Number(newRate) : undefined,
      bsDepreciationAccount: newBsAccount.trim(),
      plDepreciationAccount: newPlAccount.trim(),
      acquisitionDate: newAcquisitionDate
    });
  }

  const activeCount = assets.filter((a) => a.status === "ACTIVE").length;
  const fullyDepreciatedCount = assets.filter((a) => a.status === "FULLY_DEPRECIATED").length;
  const disposedCount = assets.filter((a) => a.status === "DISPOSED").length;
  const totalGross = assets.reduce((s, a) => s + Number(a.grossValue), 0);
  const totalNet = assets.reduce((s, a) => s + Number(a.netValue), 0);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Package className="h-6 w-6 text-muted-foreground" />
            Fixed Asset Register
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {assets.length} asset{assets.length !== 1 ? "s" : ""} &middot; {activeCount} active
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              if (!depnPeriodId) {
                setFormError("Enter a period ID for depreciation preview.");
                return;
              }
              previewMutation.mutate(depnPeriodId);
            }}
            disabled={previewMutation.isPending}
            className="gap-1.5"
          >
            <Calculator className="h-4 w-4" />
            {previewMutation.isPending ? "Calculating..." : "Depreciation"}
          </Button>
          <Button
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" /> New Asset
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Assets</p>
            <p className="text-2xl font-bold">{assets.length}</p>
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
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Fully Depreciated
            </p>
            <p className="text-2xl font-bold text-amber-600">{fullyDepreciatedCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Gross Value</p>
            <p className="text-2xl font-bold">
              {totalGross.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Net Book Value</p>
            <p className="text-2xl font-bold text-blue-600">
              {totalNet.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-end">
        <div className="grid gap-1.5 w-48">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="FULLY_DEPRECIATED">Fully Depreciated</SelectItem>
              <SelectItem value="DISPOSED">Disposed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5 flex-1">
          <Label className="text-xs">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by code or description..."
              className="pl-8"
            />
          </div>
        </div>
        <div className="grid gap-1.5 w-72">
          <Label className="text-xs">Depreciation Period ID</Label>
          <Input
            value={depnPeriodId}
            onChange={(e) => setDepnPeriodId(e.target.value)}
            placeholder="Period UUID for depreciation"
          />
        </div>
      </div>

      {formError && (
        <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
          {formError}
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
                    <th className="py-2.5 px-4 text-left font-medium">Code</th>
                    <th className="py-2.5 px-4 text-left font-medium">Description</th>
                    <th className="py-2.5 px-4 text-left font-medium">Method</th>
                    <th className="py-2.5 px-4 text-right font-medium">Gross Value</th>
                    <th className="py-2.5 px-4 text-right font-medium">Accum. Depn</th>
                    <th className="py-2.5 px-4 text-right font-medium">Net Value</th>
                    <th className="py-2.5 px-4 text-center font-medium">Status</th>
                    <th className="py-2.5 px-4 text-left font-medium">Acquired</th>
                    <th className="py-2.5 px-4 text-center font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-sm text-muted-foreground">
                        No fixed assets found. Create one to get started.
                      </td>
                    </tr>
                  ) : (
                    assets.map((asset) => (
                      <AssetRow
                        key={asset.id}
                        asset={asset}
                        onDispose={() => openLifecycle(asset, "dispose")}
                        onTransfer={() => openLifecycle(asset, "transfer")}
                        onRevalue={() => openLifecycle(asset, "revalue")}
                        onWriteOff={() => openLifecycle(asset, "writeoff")}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Asset Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          if (!v) setCreateOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Register New Fixed Asset</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 max-h-[60vh] overflow-y-auto">
            {formError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {formError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Asset Code</Label>
                <Input
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="e.g. FA-001"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Category</Label>
                <Select value={newCategoryId} onValueChange={setNewCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.code} — {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="e.g. Guest Room Furniture — Building A"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label>Gross Value</Label>
                <Input
                  type="number"
                  value={newGrossValue}
                  onChange={(e) => setNewGrossValue(e.target.value)}
                  min={0}
                  step="0.01"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Residual Value</Label>
                <Input
                  type="number"
                  value={newFinalValue}
                  onChange={(e) => setNewFinalValue(e.target.value)}
                  min={0}
                  step="0.01"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Useful Life (months)</Label>
                <Input
                  type="number"
                  value={newUsefulLife}
                  onChange={(e) => setNewUsefulLife(e.target.value)}
                  min={1}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Depreciation Method</Label>
                <Select value={newMethod} onValueChange={setNewMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STRAIGHT_LINE">Straight Line</SelectItem>
                    <SelectItem value="REDUCING_BALANCE">Reducing Balance</SelectItem>
                    <SelectItem value="SUM_OF_DIGITS">Sum of Digits</SelectItem>
                    <SelectItem value="NONE">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newMethod === "REDUCING_BALANCE" && (
                <div className="grid gap-1.5">
                  <Label>Rate (%)</Label>
                  <Input
                    type="number"
                    value={newRate}
                    onChange={(e) => setNewRate(e.target.value)}
                    min={0}
                    max={100}
                    step="0.01"
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>BS Depreciation Account</Label>
                <Input
                  value={newBsAccount}
                  onChange={(e) => setNewBsAccount(e.target.value)}
                  placeholder="e.g. 1800"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>PL Depreciation Account</Label>
                <Input
                  value={newPlAccount}
                  onChange={(e) => setNewPlAccount(e.target.value)}
                  placeholder="e.g. 8200"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>Acquisition Date</Label>
              <Input
                type="date"
                value={newAcquisitionDate}
                onChange={(e) => setNewAcquisitionDate(e.target.value)}
              />
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
              {createMutation.isPending ? "Registering..." : "Register Asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Depreciation Preview Dialog */}
      <Dialog
        open={depnPreviewOpen}
        onOpenChange={(v) => {
          if (!v) setDepnPreviewOpen(false);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Depreciation Preview</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-4 text-sm">
              <span>
                <strong>Assets:</strong> {depnLines.length}
              </span>
              <span>
                <strong>Total Depreciation:</strong>{" "}
                {depnLines
                  .reduce((s, l) => s + Number(l.depreciationAmount), 0)
                  .toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                  })}
              </span>
            </div>
            {depnLines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No assets require depreciation this period.
              </p>
            ) : (
              <div className="overflow-x-auto max-h-80 border rounded">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted">
                    <tr className="text-xs text-muted-foreground uppercase">
                      <th className="py-2 px-3 text-left">Asset</th>
                      <th className="py-2 px-3 text-left">Method</th>
                      <th className="py-2 px-3 text-right">Gross</th>
                      <th className="py-2 px-3 text-right">NBV Before</th>
                      <th className="py-2 px-3 text-right">Depreciation</th>
                      <th className="py-2 px-3 text-right">NBV After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {depnLines.map((line, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="py-1.5 px-3">
                          <span className="font-mono text-xs">{line.assetCode}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {line.description}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-xs">{line.method}</td>
                        <td className="py-1.5 px-3 text-right font-mono text-xs">
                          {Number(line.grossValue).toLocaleString(undefined, {
                            minimumFractionDigits: 2
                          })}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-xs">
                          {Number(line.netValueBefore).toLocaleString(undefined, {
                            minimumFractionDigits: 2
                          })}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-xs text-amber-600 font-medium">
                          {Number(line.depreciationAmount).toLocaleString(undefined, {
                            minimumFractionDigits: 2
                          })}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-xs">
                          {Number(line.netValueAfter).toLocaleString(undefined, {
                            minimumFractionDigits: 2
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepnPreviewOpen(false)}>
              Close
            </Button>
            {depnLines.length > 0 && (
              <Button
                onClick={() => {
                  if (confirm("Post depreciation journal? This will update asset balances.")) {
                    runDepnMutation.mutate(depnPeriodId);
                  }
                }}
                disabled={runDepnMutation.isPending}
                className="gap-1.5"
              >
                <Play className="h-4 w-4" />
                {runDepnMutation.isPending ? "Posting..." : "Post Depreciation"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lifecycle Action Dialog */}
      <Dialog
        open={lifecycleAction !== null}
        onOpenChange={(v) => {
          if (!v) setLifecycleAction(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {lifecycleAction === "dispose" && `Dispose Asset — ${lifecycleAssetCode}`}
              {lifecycleAction === "transfer" && `Transfer Asset — ${lifecycleAssetCode}`}
              {lifecycleAction === "revalue" && `Revalue Asset — ${lifecycleAssetCode}`}
              {lifecycleAction === "writeoff" && `Write Off Asset — ${lifecycleAssetCode}`}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {formError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {formError}
              </p>
            )}

            {lifecycleAction === "dispose" && (
              <>
                <div className="grid gap-1.5">
                  <Label>Disposal Date</Label>
                  <Input
                    type="date"
                    value={disposeDate}
                    onChange={(e) => setDisposeDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Disposal Proceeds</Label>
                  <Input
                    type="number"
                    value={disposeProceeds}
                    onChange={(e) => setDisposeProceeds(e.target.value)}
                    min={0}
                    step="0.01"
                  />
                </div>
              </>
            )}

            {lifecycleAction === "transfer" && (
              <div className="grid gap-1.5">
                <Label>Target Entity ID</Label>
                <Input
                  value={transferTarget}
                  onChange={(e) => setTransferTarget(e.target.value)}
                  placeholder="Entity UUID to transfer to"
                />
              </div>
            )}

            {lifecycleAction === "revalue" && (
              <div className="grid gap-1.5">
                <Label>New Gross Value</Label>
                <Input
                  type="number"
                  value={revalueAmount}
                  onChange={(e) => setRevalueAmount(e.target.value)}
                  min={0}
                  step="0.01"
                />
              </div>
            )}

            {lifecycleAction === "writeoff" && (
              <p className="text-sm text-muted-foreground">
                This will write off the remaining net book value of asset{" "}
                <strong>{lifecycleAssetCode}</strong>. This action cannot be undone.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLifecycleAction(null)}
              disabled={
                disposeMutation.isPending ||
                transferMutation.isPending ||
                revalueMutation.isPending ||
                writeOffMutation.isPending
              }
            >
              Cancel
            </Button>
            <Button
              variant={
                lifecycleAction === "writeoff" || lifecycleAction === "dispose"
                  ? "destructive"
                  : "default"
              }
              onClick={handleLifecycleConfirm}
              disabled={
                disposeMutation.isPending ||
                transferMutation.isPending ||
                revalueMutation.isPending ||
                writeOffMutation.isPending
              }
            >
              {disposeMutation.isPending ||
              transferMutation.isPending ||
              revalueMutation.isPending ||
              writeOffMutation.isPending
                ? "Processing..."
                : lifecycleAction === "dispose"
                  ? "Dispose"
                  : lifecycleAction === "transfer"
                    ? "Transfer"
                    : lifecycleAction === "revalue"
                      ? "Revalue"
                      : "Write Off"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Row component ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-600",
  FULLY_DEPRECIATED: "bg-amber-600",
  DISPOSED: "bg-slate-500"
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  FULLY_DEPRECIATED: "Fully Depn",
  DISPOSED: "Disposed"
};

const METHOD_LABELS: Record<string, string> = {
  STRAIGHT_LINE: "SL",
  REDUCING_BALANCE: "RB",
  SUM_OF_DIGITS: "SoYD",
  USER_TABLE: "Table",
  NONE: "None"
};

function AssetRow({
  asset,
  onDispose,
  onTransfer,
  onRevalue,
  onWriteOff
}: {
  asset: FixedAsset;
  onDispose: () => void;
  onTransfer: () => void;
  onRevalue: () => void;
  onWriteOff: () => void;
}) {
  const isActive = asset.status === "ACTIVE";
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      <td className="py-3 px-4 font-mono text-xs font-medium">{asset.assetCode}</td>
      <td className="py-3 px-4">
        <div className="font-medium text-sm">{asset.description}</div>
        {asset.lookupCode && (
          <div className="text-xs text-muted-foreground">Lookup: {asset.lookupCode}</div>
        )}
      </td>
      <td className="py-3 px-4">
        <Badge variant="outline" className="text-xs">
          {METHOD_LABELS[asset.depreciationMethod] ?? asset.depreciationMethod}
        </Badge>
      </td>
      <td className="py-3 px-4 text-right font-mono text-xs">
        {Number(asset.grossValue).toLocaleString(undefined, {
          minimumFractionDigits: 2
        })}
      </td>
      <td className="py-3 px-4 text-right font-mono text-xs text-muted-foreground">
        {Number(asset.accumulatedDepreciation).toLocaleString(undefined, {
          minimumFractionDigits: 2
        })}
      </td>
      <td className="py-3 px-4 text-right font-mono text-xs font-medium">
        {Number(asset.netValue).toLocaleString(undefined, {
          minimumFractionDigits: 2
        })}
      </td>
      <td className="py-3 px-4 text-center">
        <Badge variant="default" className={`text-xs ${STATUS_STYLES[asset.status] ?? ""}`}>
          {STATUS_LABELS[asset.status] ?? asset.status}
        </Badge>
      </td>
      <td className="py-3 px-4 text-xs text-muted-foreground">
        {asset.acquisitionDate?.slice(0, 10)}
      </td>
      <td className="py-3 px-4">
        {isActive && (
          <div className="flex gap-1 justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={onDispose}
              title="Dispose"
              className="h-7 w-7 p-0"
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onTransfer}
              title="Transfer"
              className="h-7 w-7 p-0"
            >
              <ArrowRightLeft className="h-4 w-4 text-blue-500" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRevalue}
              title="Revalue"
              className="h-7 w-7 p-0"
            >
              <TrendingUp className="h-4 w-4 text-amber-600" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onWriteOff}
              title="Write Off"
              className="h-7 w-7 p-0"
            >
              <XCircle className="h-4 w-4 text-slate-500" />
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
