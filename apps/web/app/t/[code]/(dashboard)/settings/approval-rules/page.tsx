"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  getApprovalRules,
  createApprovalRule,
  updateApprovalRule,
  deleteApprovalRule,
  getEntityUsers,
  type ApprovalRule,
  type ApprovalRulePayload,
  type EntityUser
} from "../../../../../../lib/gl-api";
import { Button } from "../../../../../../components/ui/button";
import { Input } from "../../../../../../components/ui/input";
import { Badge } from "../../../../../../components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { Separator } from "../../../../../../components/ui/separator";
import { ShieldCheck, Plus, Pencil, Trash2, X, Check, Users } from "lucide-react";

const MODULE_OPTIONS = ["GL", "AP", "AR"] as const;

const MODULE_LABELS: Record<string, string> = {
  GL: "General Ledger",
  AP: "Accounts Payable",
  AR: "Accounts Receivable"
};

function fmt(v: string | number | null | undefined) {
  if (v == null) return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

type FormState = {
  module: "GL" | "AP" | "AR";
  minAmount: string;
  maxAmount: string;
  requiredApprovers: string[];
  requireAll: boolean;
  isActive: boolean;
};

const emptyForm: FormState = {
  module: "GL",
  minAmount: "0",
  maxAmount: "",
  requiredApprovers: [],
  requireAll: true,
  isActive: true
};

export default function ApprovalRulesPage() {
  const apiContext = useApiContext();
  const tenantHref = useTenantHref();
  const queryClient = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const rulesQuery = useQuery({
    queryKey: ["approval-rules", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getApprovalRules(apiContext);
      return (res.data ?? []) as ApprovalRule[];
    },
    enabled: Boolean(apiContext)
  });

  const usersQuery = useQuery({
    queryKey: ["entity-users", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getEntityUsers(apiContext);
      return (res.data ?? []) as EntityUser[];
    },
    enabled: Boolean(apiContext)
  });

  const createMutation = useMutation({
    mutationFn: async (payload: ApprovalRulePayload) => {
      if (!apiContext) throw new Error("Missing API context.");
      return createApprovalRule(apiContext, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-rules"] });
      resetForm();
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<ApprovalRulePayload> }) => {
      if (!apiContext) throw new Error("Missing API context.");
      return updateApprovalRule(apiContext, id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-rules"] });
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!apiContext) throw new Error("Missing API context.");
      return deleteApprovalRule(apiContext, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-rules"] });
      setDeleteConfirmId(null);
    }
  });

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  }

  function startEdit(rule: ApprovalRule) {
    setForm({
      module: rule.module,
      minAmount: String(rule.minAmount),
      maxAmount: rule.maxAmount ? String(rule.maxAmount) : "",
      requiredApprovers: rule.requiredApprovers,
      requireAll: rule.requireAll,
      isActive: rule.isActive
    });
    setEditingId(rule.id);
    setShowForm(true);
  }

  function handleSubmit() {
    const payload: ApprovalRulePayload = {
      module: form.module,
      minAmount: Number(form.minAmount),
      maxAmount: form.maxAmount ? Number(form.maxAmount) : undefined,
      requiredApprovers: form.requiredApprovers,
      requireAll: form.requireAll,
      isActive: form.isActive
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  function toggleApprover(userId: string) {
    setForm((prev) => ({
      ...prev,
      requiredApprovers: prev.requiredApprovers.includes(userId)
        ? prev.requiredApprovers.filter((id) => id !== userId)
        : [...prev.requiredApprovers, userId]
    }));
  }

  const users = usersQuery.data ?? [];
  const rules = rulesQuery.data ?? [];

  function approverNames(ids: string[]) {
    return ids
      .map((id) => {
        const u = users.find((u) => u.id === id);
        return u ? u.name || u.email : id.slice(0, 8) + "…";
      })
      .join(", ");
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-(--color-primary) flex items-center gap-2">
            <ShieldCheck className="h-6 w-6" />
            Approval Rules
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure journal approval thresholds and required approvers per module.
          </p>
        </div>
        {!showForm && (
          <Button
            size="sm"
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> New Rule
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {editingId ? "Edit Approval Rule" : "Create Approval Rule"}
            </CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              {/* Module */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Module
                </label>
                <Select
                  value={form.module}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      module: v as "GL" | "AP" | "AR"
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODULE_OPTIONS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {MODULE_LABELS[m] ?? m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Min Amount */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Min Amount
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.minAmount}
                  onChange={(e) => setForm((f) => ({ ...f, minAmount: e.target.value }))}
                />
              </div>

              {/* Max Amount */}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Max Amount <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="No limit"
                  value={form.maxAmount}
                  onChange={(e) => setForm((f) => ({ ...f, maxAmount: e.target.value }))}
                />
              </div>

              {/* Require All toggle */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-muted-foreground">Mode</label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={form.requireAll ? "default" : "outline"}
                    size="sm"
                    onClick={() => setForm((f) => ({ ...f, requireAll: true }))}
                  >
                    All must approve
                  </Button>
                  <Button
                    type="button"
                    variant={!form.requireAll ? "default" : "outline"}
                    size="sm"
                    onClick={() => setForm((f) => ({ ...f, requireAll: false }))}
                  >
                    Any one
                  </Button>
                </div>
              </div>
            </div>

            {/* Approvers */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">
                <Users className="h-3.5 w-3.5 inline mr-1" />
                Required Approvers
              </label>
              {usersQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading users…</p>
              ) : users.length === 0 ? (
                <p className="text-xs text-muted-foreground">No users found for this entity.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {users.map((user) => {
                    const selected = form.requiredApprovers.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => toggleApprover(user.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs transition-colors ${
                          selected
                            ? "bg-(--color-primary) text-white border-(--color-primary)"
                            : "bg-white text-foreground border-border hover:border-(--color-primary)/50"
                        }`}
                      >
                        {selected && <Check className="h-3 w-3" />}
                        {user.name || user.email}
                      </button>
                    );
                  })}
                </div>
              )}
              {form.requiredApprovers.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">Select at least one approver.</p>
              )}
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-muted-foreground">Active</label>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  form.isActive ? "bg-(--color-primary)" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    form.isActive ? "translate-x-4.5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {/* Actions */}
            <Separator />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={isPending || form.requiredApprovers.length === 0}
                onClick={handleSubmit}
              >
                {isPending ? "Saving…" : editingId ? "Update Rule" : "Create Rule"}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            </div>
            {(createMutation.isError || updateMutation.isError) && (
              <p className="text-xs text-destructive">
                {((createMutation.error ?? updateMutation.error) as Error).message}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rules Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active Rules ({rules.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Module</TableHead>
                <TableHead className="text-xs">Min Amount</TableHead>
                <TableHead className="text-xs">Max Amount</TableHead>
                <TableHead className="text-xs">Approvers</TableHead>
                <TableHead className="text-xs">Mode</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rulesQuery.isLoading ? (
                <>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <div className="h-8 w-full animate-pulse rounded bg-muted" />
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              ) : rulesQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-destructive text-sm">
                    {(rulesQuery.error as Error).message}
                  </TableCell>
                </TableRow>
              ) : rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                    No approval rules configured. Click "New Rule" to create one.
                  </TableCell>
                </TableRow>
              ) : (
                rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <Badge variant="info" className="text-xs">
                        {MODULE_LABELS[rule.module] ?? rule.module}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {fmt(rule.minAmount)}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {rule.maxAmount ? fmt(rule.maxAmount) : "No limit"}
                    </TableCell>
                    <TableCell className="text-xs max-w-[200px] truncate">
                      {approverNames(rule.requiredApprovers)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {rule.requireAll ? "All Required" : "Any One"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={rule.isActive ? "success" : "secondary"}
                        className="text-[10px]"
                      >
                        {rule.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {deleteConfirmId === rule.id ? (
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-xs text-destructive mr-1">Delete?</span>
                          <Button
                            size="icon"
                            variant="destructive"
                            className="h-7 w-7"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(rule.id)}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => startEdit(rule)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirmId(rule.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Info card */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="text-sm font-semibold mb-2">How it works</h3>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc ml-4">
            <li>
              When a journal is created with an amount that falls within a rule's range, its status
              becomes{" "}
              <Badge variant="warning" className="text-[10px] mx-0.5">
                PENDING APPROVAL
              </Badge>{" "}
              instead of DRAFT.
            </li>
            <li>
              Each required approver receives an email with one-click approve/reject links (requires
              Resend API key).
            </li>
            <li>
              <strong>All Required</strong> mode: journal auto-posts only when every listed approver
              approves.
            </li>
            <li>
              <strong>Any One</strong> mode: journal auto-posts as soon as any single approver
              approves.
            </li>
            <li>
              If rejected, the journal reverts to DRAFT and all pending approvals are cancelled.
            </li>
            <li>
              Approve/reject actions are also available in the{" "}
              <a href={tenantHref("/gl/journals")} className="underline text-(--color-primary)">
                Journals
              </a>{" "}
              page side panel.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
