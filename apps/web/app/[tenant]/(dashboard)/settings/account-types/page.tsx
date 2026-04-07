"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../../components/use-api-context";
import { Plus, Pencil, Trash2, Lock, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
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
import {
  getAccountTypeDefinitions,
  createAccountTypeDefinition,
  updateAccountTypeDefinition,
  deleteAccountTypeDefinition,
  type AccountTypeDefinition,
  type AccountTypeCategory,
  type NormalBalance
} from "../../../../../lib/gl-api";

const CATEGORY_LABELS: Record<AccountTypeCategory, string> = {
  BALANCE_SHEET: "Balance Sheet",
  INCOME: "Income Statement",
  STATISTICAL: "Statistical"
};

const CATEGORY_BADGE: Record<AccountTypeCategory, "info" | "success" | "outline"> = {
  BALANCE_SHEET: "info",
  INCOME: "success",
  STATISTICAL: "outline"
};

type FormState = {
  code: string;
  name: string;
  category: AccountTypeCategory;
  normalBalance: NormalBalance;
  sortOrder: number;
};

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  category: "BALANCE_SHEET",
  normalBalance: "DEBIT",
  sortOrder: 10
};

export default function AccountTypesPage() {
  const ctx = useApiContext();
  const queryClient = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ["account-type-defs", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => getAccountTypeDefinitions(ctx!),
    enabled: !!ctx
  });

  const types = res?.data ?? [];

  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<AccountTypeDefinition | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountTypeDefinition | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDialogMode("create");
  }

  function openEdit(t: AccountTypeDefinition) {
    setEditTarget(t);
    setForm({
      code: t.code,
      name: t.name,
      category: t.category,
      normalBalance: t.normalBalance,
      sortOrder: t.sortOrder
    });
    setFormError(null);
    setDialogMode("edit");
  }

  const createMut = useMutation({
    mutationFn: () =>
      createAccountTypeDefinition(ctx!, {
        code: form.code.trim(),
        name: form.name.trim(),
        category: form.category,
        normalBalance: form.normalBalance,
        sortOrder: form.sortOrder
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-type-defs"] });
      setDialogMode(null);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const updateMut = useMutation({
    mutationFn: () => {
      if (!editTarget) throw new Error("No target");
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        sortOrder: form.sortOrder
      };
      if (!editTarget.isSystem) {
        payload.category = form.category;
        payload.normalBalance = form.normalBalance;
      }
      return updateAccountTypeDefinition(ctx!, editTarget.id, payload as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-type-defs"] });
      setDialogMode(null);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAccountTypeDefinition(ctx!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account-type-defs"] });
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (err: Error) => setDeleteError(err.message)
  });

  function handleSubmit() {
    if (!form.code.trim() || !form.name.trim()) {
      setFormError("Code and name are required.");
      return;
    }
    if (dialogMode === "create") createMut.mutate();
    else updateMut.mutate();
  }

  const isSubmitting = createMut.isPending || updateMut.isPending;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-muted-foreground" />
            Account Types
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage chart of account classifications. System types cannot be deleted.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Account Type
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b border-border">
          <CardTitle className="text-base">
            {types.length} account type{types.length !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading...</div>
          )}
          {!isLoading && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-4 text-left font-medium w-16">Order</th>
                    <th className="py-2.5 px-4 text-left font-medium w-32">Code</th>
                    <th className="py-2.5 px-4 text-left font-medium">Name</th>
                    <th className="py-2.5 px-4 text-left font-medium w-36">Category</th>
                    <th className="py-2.5 px-4 text-center font-medium w-28">Normal Bal.</th>
                    <th className="py-2.5 px-4 text-center font-medium w-20">System</th>
                    <th className="py-2.5 px-4 text-right font-medium w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr
                      key={t.id}
                      className="group border-b border-border/50 hover:bg-muted/40 transition-colors"
                    >
                      <td className="py-2.5 px-4 text-muted-foreground font-mono text-xs">
                        {t.sortOrder}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs font-semibold">{t.code}</td>
                      <td className="py-2.5 px-4">{t.name}</td>
                      <td className="py-2.5 px-4">
                        <Badge variant={CATEGORY_BADGE[t.category]} className="text-xs">
                          {CATEGORY_LABELS[t.category]}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <span
                          className={`text-xs font-medium ${t.normalBalance === "DEBIT" ? "text-sky-700" : "text-violet-700"}`}
                        >
                          {t.normalBalance}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {t.isSystem && (
                          <Lock className="h-3.5 w-3.5 text-muted-foreground inline" />
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => openEdit(t)}
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {!t.isSystem && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => {
                                setDeleteTarget(t);
                                setDeleteError(null);
                              }}
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      {dialogMode && (
        <Dialog
          open={!!dialogMode}
          onOpenChange={(v) => {
            if (!v) setDialogMode(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {dialogMode === "create" ? "New Account Type" : `Edit — ${editTarget?.code}`}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>
                    Code <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    placeholder="e.g. CONTRA_REV"
                    maxLength={30}
                    disabled={dialogMode === "edit"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Contra Revenue"
                    maxLength={100}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>
                    Category <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.category}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, category: v as AccountTypeCategory }))
                    }
                    disabled={editTarget?.isSystem}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BALANCE_SHEET">Balance Sheet</SelectItem>
                      <SelectItem value="INCOME">Income Statement</SelectItem>
                      <SelectItem value="STATISTICAL">Statistical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Normal Balance <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.normalBalance}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, normalBalance: v as NormalBalance }))
                    }
                    disabled={editTarget?.isSystem}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEBIT">Debit</SelectItem>
                      <SelectItem value="CREDIT">Credit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))
                  }
                  min={0}
                />
              </div>

              {editTarget?.isSystem && (
                <p className="text-xs text-muted-foreground bg-muted/60 rounded px-3 py-2">
                  System types: only name and sort order can be changed.
                </p>
              )}

              {formError && (
                <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                  {formError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogMode(null)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : dialogMode === "create" ? "Create" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <Dialog
          open={!!deleteTarget}
          onOpenChange={(v) => {
            if (!v) setDeleteTarget(null);
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Account Type</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              Delete{" "}
              <span className="font-semibold text-foreground">
                {deleteTarget.code} — {deleteTarget.name}
              </span>
              ? This cannot be undone.
            </p>
            {deleteError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {deleteError}
              </p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMut.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMut.mutate(deleteTarget.id)}
                disabled={deleteMut.isPending}
              >
                {deleteMut.isPending ? "Deleting..." : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
