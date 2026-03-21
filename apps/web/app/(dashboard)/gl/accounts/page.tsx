"use client";

import { useState, useMemo, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
  Building2,
  BookOpen
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "../../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../components/ui/select";
import {
  getGLAccountTree,
  createGLAccount,
  updateGLAccount,
  deleteGLAccount,
  type AccountNode,
  type AccountType,
  type NormalBalance,
  type AccountFormPayload,
  type ApiContext
} from "../../../../lib/gl-api";

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

const TYPE_LABELS: Record<AccountType, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expenses"
};

const TYPE_BADGE_VARIANT: Record<
  AccountType,
  "info" | "success" | "warning" | "teal" | "secondary"
> = {
  ASSET: "info",
  LIABILITY: "warning",
  EQUITY: "teal",
  REVENUE: "success",
  EXPENSE: "secondary"
};

const NORMAL_BALANCE_LABELS: Record<NormalBalance, string> = {
  DEBIT: "Debit",
  CREDIT: "Credit"
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function flattenTree(nodes: AccountNode[]): AccountNode[] {
  const result: AccountNode[] = [];
  function walk(node: AccountNode) {
    result.push(node);
    for (const child of node.children) walk(child);
  }
  for (const node of nodes) walk(node);
  return result;
}

function countDescendants(node: AccountNode): number {
  let count = 0;
  for (const child of node.children) {
    count += 1 + countDescendants(child);
  }
  return count;
}

// ── Empty form state ──────────────────────────────────────────────────────────

const EMPTY_FORM = {
  code: "",
  name: "",
  type: "ASSET" as AccountType,
  normalBalance: "DEBIT" as NormalBalance,
  allowPosting: true,
  isControlAccount: false,
  parentId: "NONE",
  usaliCategory: "",
  usaliDepartment: ""
};

// ── Account form dialog ───────────────────────────────────────────────────────

type FormState = typeof EMPTY_FORM;

function AccountFormDialog({
  open,
  mode,
  initial,
  flatAccounts,
  onClose,
  onSubmit,
  isSubmitting,
  error
}: {
  open: boolean;
  mode: "create" | "edit";
  initial: FormState;
  flatAccounts: AccountNode[];
  onClose: () => void;
  onSubmit: (form: FormState) => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<FormState>(initial);

  // Reset form when the dialog opens with a new initial value
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const parentOptions = flatAccounts.filter((a) => a.type === form.type);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Account" : "Edit Account"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Code + Name */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ac-code">
                Account Code <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ac-code"
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="e.g. 1100"
                maxLength={30}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-name">
                Account Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ac-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Cash at Bank"
                maxLength={200}
              />
            </div>
          </div>

          {/* Type + Normal Balance */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                Account Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.type}
                onValueChange={(v) => {
                  set("type", v as AccountType);
                  set("parentId", "NONE");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                Normal Balance <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.normalBalance}
                onValueChange={(v) => set("normalBalance", v as NormalBalance)}
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

          {/* Parent account */}
          <div className="space-y-1.5">
            <Label>Parent Account</Label>
            <Select value={form.parentId} onValueChange={(v) => set("parentId", v)}>
              <SelectTrigger>
                <SelectValue placeholder="No parent (top-level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">— No parent (top-level) —</SelectItem>
                {parentOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* USALI */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ac-usali-cat">USALI Category</Label>
              <Input
                id="ac-usali-cat"
                value={form.usaliCategory}
                onChange={(e) => set("usaliCategory", e.target.value)}
                placeholder="e.g. Rooms"
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-usali-dept">USALI Department</Label>
              <Input
                id="ac-usali-dept"
                value={form.usaliDepartment}
                onChange={(e) => set("usaliDepartment", e.target.value)}
                placeholder="e.g. Food & Beverage"
                maxLength={100}
              />
            </div>
          </div>

          {/* Checkboxes */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.allowPosting}
                onChange={(e) => set("allowPosting", e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-sm">Allow posting</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.isControlAccount}
                onChange={(e) => set("isControlAccount", e.target.checked)}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              <span className="text-sm">Control account</span>
            </label>
          </div>

          {error && (
            <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(form)} disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : mode === "create" ? "Create Account" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete confirm dialog ─────────────────────────────────────────────────────

function DeleteDialog({
  account,
  onClose,
  onConfirm,
  isDeleting,
  error
}: {
  account: AccountNode | null;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  error: string | null;
}) {
  if (!account) return null;
  const hasChildren = account.children.length > 0;
  return (
    <Dialog
      open={!!account}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Deactivate Account</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Deactivate{" "}
            <span className="font-semibold text-foreground">
              {account.code} — {account.name}
            </span>
            ? The account will be hidden from pickers but historical data is preserved.
          </p>
          {hasChildren && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              This account has {countDescendants(account)} child account
              {countDescendants(account) !== 1 ? "s" : ""}. They will not be affected.
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? "Deactivating…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Account row ───────────────────────────────────────────────────────────────

function AccountRow({
  node,
  depth,
  expanded,
  onToggle,
  onEdit,
  onDelete
}: {
  node: AccountNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onEdit: (node: AccountNode) => void;
  onDelete: (node: AccountNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const indent = depth * 20;

  return (
    <>
      <tr className="group border-b border-border/50 hover:bg-muted/40 transition-colors">
        {/* Code */}
        <td className="py-2 px-3 text-sm font-mono text-muted-foreground whitespace-nowrap">
          <div style={{ paddingLeft: indent }} className="flex items-center gap-1">
            {hasChildren ? (
              <button
                onClick={() => onToggle(node.id)}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            ) : (
              <span className="w-5 inline-block" />
            )}
            {node.code}
          </div>
        </td>

        {/* Name */}
        <td className="py-2 px-3 text-sm">
          <span style={{ paddingLeft: depth > 0 ? 4 : 0 }} className="flex items-center gap-1.5">
            <Link
              href={`/gl/accounts/${node.id}`}
              className="hover:text-primary hover:underline transition-colors"
            >
              {node.name}
            </Link>
            <Link
              href={`/gl/accounts/${node.id}`}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
              title="View ledger"
            >
              <BookOpen className="h-3.5 w-3.5" />
            </Link>
          </span>
        </td>

        {/* Normal balance */}
        <td className="py-2 px-3 text-sm text-center">
          <span
            className={`text-xs font-medium ${node.normalBalance === "DEBIT" ? "text-sky-700" : "text-violet-700"}`}
          >
            {NORMAL_BALANCE_LABELS[node.normalBalance as NormalBalance]}
          </span>
        </td>

        {/* Allow posting */}
        <td className="py-2 px-3 text-sm text-center">
          {node.allowPosting ? (
            <span
              className="inline-block w-2 h-2 rounded-full bg-emerald-500"
              title="Posting allowed"
            />
          ) : (
            <span
              className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30"
              title="No posting"
            />
          )}
        </td>

        {/* USALI */}
        <td className="py-2 px-3 text-xs text-muted-foreground">{node.usaliCategory ?? "—"}</td>

        {/* Actions */}
        <td className="py-2 px-3 text-right">
          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => onEdit(node)}
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={() => onDelete(node)}
              title="Deactivate"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>

      {/* Children */}
      {isExpanded &&
        hasChildren &&
        node.children.map((child) => (
          <AccountRow
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}

// ── Type section ──────────────────────────────────────────────────────────────

function TypeSection({
  type,
  roots,
  expanded,
  sectionExpanded,
  onToggle,
  onToggleSection,
  onEdit,
  onDelete
}: {
  type: AccountType;
  roots: AccountNode[];
  expanded: Set<string>;
  sectionExpanded: boolean;
  onToggle: (id: string) => void;
  onToggleSection: (type: AccountType) => void;
  onEdit: (node: AccountNode) => void;
  onDelete: (node: AccountNode) => void;
}) {
  const totalCount = roots.reduce((sum, r) => sum + 1 + countDescendants(r), 0);

  return (
    <>
      <tr className="bg-muted/60 cursor-pointer select-none" onClick={() => onToggleSection(type)}>
        <td colSpan={6} className="py-2 px-3">
          <div className="flex items-center gap-2">
            {sectionExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <Badge variant={TYPE_BADGE_VARIANT[type]} className="text-xs">
              {TYPE_LABELS[type]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {totalCount} account{totalCount !== 1 ? "s" : ""}
            </span>
          </div>
        </td>
      </tr>
      {sectionExpanded &&
        roots.map((root) => (
          <AccountRow
            key={root.id}
            node={root}
            depth={0}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const ctx: ApiContext | null = session?.user?.entityIds?.[0]
    ? {
        accessToken: (session as unknown as { accessToken?: string }).accessToken ?? "dev-token",
        entityId: session.user.entityIds[0]
      }
    : null;

  // ── Data ──────────────────────────────────────────────────────────────────

  const {
    data: treeRes,
    isLoading,
    error: loadError
  } = useQuery({
    queryKey: ["gl-accounts", ctx?.entityId],
    queryFn: () => getGLAccountTree(ctx!),
    enabled: !!ctx
  });

  const tree = treeRes?.data ?? [];
  const flatAccounts = useMemo(() => flattenTree(tree), [tree]);

  // ── UI state ──────────────────────────────────────────────────────────────

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | AccountType>("ALL");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [sectionExpanded, setSectionExpanded] = useState<Set<AccountType>>(
    () => new Set(ACCOUNT_TYPES)
  );

  // Dialog state
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editTarget, setEditTarget] = useState<AccountNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountNode | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Tree helpers ──────────────────────────────────────────────────────────

  function toggleRow(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSection(type: AccountType) {
    setSectionExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(flatAccounts.map((a) => a.id)));
    setSectionExpanded(new Set(ACCOUNT_TYPES));
  }

  function collapseAll() {
    setExpanded(new Set());
    setSectionExpanded(new Set());
  }

  // ── Search / filter ───────────────────────────────────────────────────────

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return flatAccounts.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        (a.usaliCategory?.toLowerCase().includes(q) ?? false)
    );
  }, [search, flatAccounts]);

  const filteredTree = useMemo(() => {
    if (filterType === "ALL") return tree;
    return tree.filter((root) => {
      // roots may have mixed types — filter recursively
      function keep(node: AccountNode): AccountNode | null {
        if (node.type === filterType) return node;
        const filteredChildren = node.children.flatMap((c) => {
          const k = keep(c);
          return k ? [k] : [];
        });
        if (filteredChildren.length > 0) return { ...node, children: filteredChildren };
        return null;
      }
      return keep(root) !== null;
    });
  }, [tree, filterType]);

  // Group roots by type for the type sections
  const rootsByType = useMemo(() => {
    const groups: Record<AccountType, AccountNode[]> = {
      ASSET: [],
      LIABILITY: [],
      EQUITY: [],
      REVENUE: [],
      EXPENSE: []
    };
    for (const root of filteredTree) {
      if (root.type in groups) {
        groups[root.type as AccountType].push(root);
      }
    }
    return groups;
  }, [filteredTree]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (form: typeof EMPTY_FORM) => {
      const payload: AccountFormPayload = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        normalBalance: form.normalBalance,
        allowPosting: form.allowPosting,
        isControlAccount: form.isControlAccount,
        level:
          form.parentId === "NONE"
            ? 1
            : (flatAccounts.find((a) => a.id === form.parentId)?.level ?? 0) + 1,
        ...(form.parentId !== "NONE" ? { parentId: form.parentId } : {}),
        ...(form.usaliCategory.trim() ? { usaliCategory: form.usaliCategory.trim() } : {}),
        ...(form.usaliDepartment.trim() ? { usaliDepartment: form.usaliDepartment.trim() } : {})
      };
      return createGLAccount(ctx!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gl-accounts"] });
      setDialogMode(null);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: typeof EMPTY_FORM }) => {
      const payload: Partial<AccountFormPayload> = {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        normalBalance: form.normalBalance,
        allowPosting: form.allowPosting,
        isControlAccount: form.isControlAccount,
        level:
          form.parentId === "NONE"
            ? 1
            : (flatAccounts.find((a) => a.id === form.parentId)?.level ?? 0) + 1,
        ...(form.parentId !== "NONE" ? { parentId: form.parentId } : { parentId: undefined }),
        usaliCategory: form.usaliCategory.trim() || undefined,
        usaliDepartment: form.usaliDepartment.trim() || undefined
      };
      return updateGLAccount(ctx!, id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gl-accounts"] });
      setDialogMode(null);
      setEditTarget(null);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGLAccount(ctx!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gl-accounts"] });
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (err: Error) => setDeleteError(err.message)
  });

  // ── Dialog helpers ────────────────────────────────────────────────────────

  function openCreate() {
    setEditTarget(null);
    setFormError(null);
    setDialogMode("create");
  }

  function openEdit(node: AccountNode) {
    setEditTarget(node);
    setFormError(null);
    setDialogMode("edit");
  }

  function handleFormSubmit(form: typeof EMPTY_FORM) {
    if (!form.code.trim() || !form.name.trim()) {
      setFormError("Account code and name are required.");
      return;
    }
    if (dialogMode === "create") {
      createMutation.mutate(form);
    } else if (dialogMode === "edit" && editTarget) {
      updateMutation.mutate({ id: editTarget.id, form });
    }
  }

  // ── Form initial state ────────────────────────────────────────────────────

  const formInitial: typeof EMPTY_FORM = useMemo(() => {
    if (!editTarget) return EMPTY_FORM;
    return {
      code: editTarget.code,
      name: editTarget.name,
      type: editTarget.type,
      normalBalance: editTarget.normalBalance,
      allowPosting: editTarget.allowPosting,
      isControlAccount: false,
      parentId: editTarget.parentId ?? "NONE",
      usaliCategory: editTarget.usaliCategory ?? "",
      usaliDepartment: editTarget.usaliDepartment ?? ""
    };
  }, [editTarget]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-6 w-6 text-muted-foreground" />
            Chart of Accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {flatAccounts.length} active account{flatAccounts.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Account
        </Button>
      </div>

      <Card>
        {/* Toolbar */}
        <CardHeader className="pb-3 border-b border-border">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code, name, USALI…"
                className="pl-9 pr-9"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Type filter */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["ALL", ...ACCOUNT_TYPES] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    filterType === t
                      ? "bg-primary text-white border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {t === "ALL" ? "All Types" : TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {/* Expand / Collapse all */}
            {!searchResults && (
              <div className="flex items-center gap-1.5 ml-auto">
                <Button variant="ghost" size="sm" className="text-xs h-8" onClick={expandAll}>
                  Expand all
                </Button>
                <Button variant="ghost" size="sm" className="text-xs h-8" onClick={collapseAll}>
                  Collapse all
                </Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {isLoading && (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading accounts…</div>
          )}

          {loadError && (
            <div className="py-16 text-center text-sm text-destructive">
              Failed to load accounts: {(loadError as Error).message}
            </div>
          )}

          {!isLoading && !loadError && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-3 text-left font-medium w-40">Code</th>
                    <th className="py-2.5 px-3 text-left font-medium">Name</th>
                    <th className="py-2.5 px-3 text-center font-medium w-28">Bal. Side</th>
                    <th className="py-2.5 px-3 text-center font-medium w-20">Posting</th>
                    <th className="py-2.5 px-3 text-left font-medium w-40">USALI Category</th>
                    <th className="py-2.5 px-3 text-right font-medium w-24">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Search mode — flat list */}
                  {searchResults !== null && (
                    <>
                      {searchResults.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="py-12 text-center text-sm text-muted-foreground"
                          >
                            No accounts match &ldquo;{search}&rdquo;
                          </td>
                        </tr>
                      ) : (
                        searchResults.map((node) => (
                          <tr
                            key={node.id}
                            className="group border-b border-border/50 hover:bg-muted/40 transition-colors"
                          >
                            <td className="py-2 px-3 text-sm font-mono text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <span className="w-5 inline-block" />
                                {node.code}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-sm">
                              <span className="flex items-center gap-1.5">
                                <Link
                                  href={`/gl/accounts/${node.id}`}
                                  className="hover:text-primary hover:underline transition-colors"
                                >
                                  {node.name}
                                </Link>
                                <Link
                                  href={`/gl/accounts/${node.id}`}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                                  title="View ledger"
                                >
                                  <BookOpen className="h-3.5 w-3.5" />
                                </Link>
                                <Badge
                                  variant={TYPE_BADGE_VARIANT[node.type]}
                                  className="text-[10px] px-1.5 py-0 ml-1"
                                >
                                  {TYPE_LABELS[node.type]}
                                </Badge>
                              </span>
                            </td>
                            <td className="py-2 px-3 text-sm text-center">
                              <span
                                className={`text-xs font-medium ${node.normalBalance === "DEBIT" ? "text-sky-700" : "text-violet-700"}`}
                              >
                                {NORMAL_BALANCE_LABELS[node.normalBalance as NormalBalance]}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-sm text-center">
                              {node.allowPosting ? (
                                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                              ) : (
                                <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/30" />
                              )}
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {node.usaliCategory ?? "—"}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0"
                                  onClick={() => openEdit(node)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                  onClick={() => {
                                    setDeleteError(null);
                                    setDeleteTarget(node);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </>
                  )}

                  {/* Tree mode — grouped by type */}
                  {searchResults === null &&
                    ACCOUNT_TYPES.map((type) => {
                      const roots = rootsByType[type];
                      if (roots.length === 0) return null;
                      return (
                        <TypeSection
                          key={type}
                          type={type}
                          roots={roots}
                          expanded={expanded}
                          sectionExpanded={sectionExpanded.has(type)}
                          onToggle={toggleRow}
                          onToggleSection={toggleSection}
                          onEdit={openEdit}
                          onDelete={(node) => {
                            setDeleteError(null);
                            setDeleteTarget(node);
                          }}
                        />
                      );
                    })}

                  {/* Empty state */}
                  {searchResults === null && flatAccounts.length === 0 && !isLoading && (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-sm text-muted-foreground">
                        No accounts found. Click <strong>New Account</strong> to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      {dialogMode && (
        <AccountFormDialog
          open={!!dialogMode}
          mode={dialogMode}
          initial={formInitial}
          flatAccounts={flatAccounts}
          onClose={() => {
            setDialogMode(null);
            setFormError(null);
          }}
          onSubmit={handleFormSubmit}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          error={formError}
        />
      )}

      {/* Delete dialog */}
      <DeleteDialog
        account={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        isDeleting={deleteMutation.isPending}
        error={deleteError}
      />
    </div>
  );
}
