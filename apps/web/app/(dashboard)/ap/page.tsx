"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../components/use-api-context";
import {
  getAPInvoices,
  getAPInvoice,
  createAPInvoice,
  approveAPInvoice,
  postAPInvoice,
  getSuppliers,
  getPeriods,
  getGLAccountTree,
  type APInvoice,
  type APInvoiceStatus,
  type Supplier,
  type AccountNode
} from "../../../lib/gl-api";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Separator } from "../../../components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "../../../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../components/ui/table";
import {
  Plus,
  X,
  CheckCircle,
  Send,
  FileText,
  Download,
  Search,
  ChevronsUpDown
} from "lucide-react";

// ── Account picker (inline combobox for GL account allocation) ────────────────

type FlatAccount = { id: string; code: string; name: string };

function flattenPostable(nodes: AccountNode[], out: FlatAccount[] = []): FlatAccount[] {
  for (const n of nodes) {
    if (n.allowPosting) out.push({ id: n.id, code: n.code, name: n.name });
    if (n.children?.length) flattenPostable(n.children, out);
  }
  return out;
}

function AccountPicker({
  value,
  onChange,
  accounts,
  placeholder = "Expense account…"
}: {
  value: string;
  onChange: (id: string) => void;
  accounts: FlatAccount[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = accounts.find((a) => a.id === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return accounts.slice(0, 40);
    const q = query.toLowerCase();
    return accounts
      .filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [accounts, query]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="flex h-7 w-full items-center justify-between rounded border border-border bg-white px-2 text-xs focus:outline-none hover:bg-muted/30"
      >
        {selected ? (
          <span>
            <span className="font-mono text-muted-foreground">{selected.code}</span> {selected.name}
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0 ml-1" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-52 rounded-md border border-border bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3 w-3 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Code or name…"
              className="flex-1 text-xs outline-none bg-transparent"
            />
          </div>
          <ul className="max-h-44 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No accounts</li>
            ) : (
              filtered.map((a) => (
                <li
                  key={a.id}
                  onMouseDown={() => {
                    onChange(a.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-muted/50 ${value === a.id ? "bg-primary/10 font-medium" : ""}`}
                >
                  <span className="font-mono text-muted-foreground w-10 shrink-0">{a.code}</span>
                  <span className="truncate">{a.name}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<
  APInvoiceStatus,
  "default" | "secondary" | "warning" | "success" | "info" | "destructive"
> = {
  DRAFT: "secondary",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  POSTED: "success",
  PAID: "success",
  DISPUTED: "destructive",
  CANCELLED: "destructive"
};

const STATUSES: APInvoiceStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "POSTED",
  "PAID",
  "DISPUTED",
  "CANCELLED"
];

function fmt(v: string | number | null | undefined) {
  const n = Number(v ?? 0);
  if (!n && n !== 0) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

function fmtDate(d: string) {
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

function daysUntil(due: string) {
  const diff = Math.round((new Date(due).getTime() - Date.now()) / 86_400_000);
  return diff;
}

// ── Create invoice dialog ─────────────────────────────────────────────────────

type LineForm = {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  glAccountId: string;
};

function CreateInvoiceDialog({
  open,
  onClose,
  suppliers,
  periods,
  glAccounts,
  onSubmit,
  isPending,
  error
}: {
  open: boolean;
  onClose: () => void;
  suppliers: Supplier[];
  periods: Array<{ id: string; name: string; status: string }>;
  glAccounts: FlatAccount[];
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState({
    supplierId: "",
    periodId: "",
    invoiceNumber: "",
    invoiceDate: new Date().toISOString().split("T")[0],
    dueDate: "",
    currency: "USD",
    grossAmount: "",
    taxAmount: "0",
    netAmount: "",
    functionalAmount: "",
    fxRate: "1",
    paymentTerms: "NET30"
  });
  const [lines, setLines] = useState<LineForm[]>([
    { description: "", quantity: "1", unitPrice: "", amount: "", glAccountId: "" }
  ]);

  function setF(k: keyof typeof form, v: string) {
    setForm((p) => {
      const next = { ...p, [k]: v };
      // auto-calc netAmount from gross - tax
      if (k === "grossAmount" || k === "taxAmount") {
        const gross = Number(k === "grossAmount" ? v : p.grossAmount) || 0;
        const tax = Number(k === "taxAmount" ? v : p.taxAmount) || 0;
        next.netAmount = String(gross - tax);
        next.functionalAmount = String((gross - tax) * (Number(next.fxRate) || 1));
      }
      return next;
    });
  }

  function setLine(i: number, k: keyof LineForm, v: string) {
    setLines((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [k]: v };
      if (k === "quantity" || k === "unitPrice") {
        const qty = Number(k === "quantity" ? v : next[i].quantity) || 0;
        const up = Number(k === "unitPrice" ? v : next[i].unitPrice) || 0;
        next[i].amount = String(qty * up);
      }
      return next;
    });
  }

  function handleSubmit() {
    onSubmit({
      ...form,
      grossAmount: form.grossAmount,
      taxAmount: form.taxAmount || "0",
      netAmount: form.netAmount || form.grossAmount,
      functionalAmount: form.functionalAmount || form.grossAmount,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        amount: l.amount || String(Number(l.quantity) * Number(l.unitPrice)),
        ...(l.glAccountId ? { glAccountId: l.glAccountId } : {})
      }))
    });
  }

  const openPeriods = periods.filter((p) => p.status === "OPEN");

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New AP Invoice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>
                Supplier <span className="text-destructive">*</span>
              </Label>
              <Select value={form.supplierId} onValueChange={(v) => setF("supplierId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier…" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>
                Period <span className="text-destructive">*</span>
              </Label>
              <Select value={form.periodId} onValueChange={(v) => setF("periodId", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period…" />
                </SelectTrigger>
                <SelectContent>
                  {openPeriods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>
                Invoice # <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.invoiceNumber}
                onChange={(e) => setF("invoiceNumber", e.target.value)}
                placeholder="INV-001"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Invoice Date</Label>
              <Input
                type="date"
                value={form.invoiceDate}
                onChange={(e) => setF("invoiceDate", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Due Date <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setF("dueDate", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Input
                value={form.currency}
                onChange={(e) => setF("currency", e.target.value.toUpperCase())}
                maxLength={3}
                className="uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Gross Amount <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.grossAmount}
                onChange={(e) => setF("grossAmount", e.target.value)}
                placeholder="0.00"
                className="text-right font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tax Amount</Label>
              <Input
                value={form.taxAmount}
                onChange={(e) => setF("taxAmount", e.target.value)}
                placeholder="0.00"
                className="text-right font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>FX Rate</Label>
              <Input
                value={form.fxRate}
                onChange={(e) => setF("fxRate", e.target.value)}
                className="text-right font-mono"
              />
            </div>
          </div>

          <Separator />

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium">Invoice Lines</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs"
                onClick={() =>
                  setLines((l) => [
                    ...l,
                    { description: "", quantity: "1", unitPrice: "", amount: "", glAccountId: "" }
                  ])
                }
              >
                <Plus className="h-3 w-3" /> Add Line
              </Button>
            </div>
            <table className="w-full text-xs border border-border rounded-md overflow-hidden">
              <thead className="bg-muted/60">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Description</th>
                  <th className="px-2 py-1.5 text-left font-medium min-w-44">GL Account</th>
                  <th className="px-2 py-1.5 text-right font-medium w-16">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24">Unit Price</th>
                  <th className="px-2 py-1.5 text-right font-medium w-24">Amount</th>
                  <th className="w-8">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td className="px-1 py-1">
                      <Input
                        value={line.description}
                        onChange={(e) => setLine(i, "description", e.target.value)}
                        className="h-7 text-xs"
                        placeholder="Description"
                      />
                    </td>
                    <td className="px-1 py-1 min-w-44">
                      <AccountPicker
                        value={line.glAccountId}
                        onChange={(id) => setLine(i, "glAccountId", id)}
                        accounts={glAccounts}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        value={line.quantity}
                        onChange={(e) => setLine(i, "quantity", e.target.value)}
                        className="h-7 text-xs text-right font-mono w-16"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        value={line.unitPrice}
                        onChange={(e) => setLine(i, "unitPrice", e.target.value)}
                        className="h-7 text-xs text-right font-mono"
                      />
                    </td>
                    <td className="px-1 py-1 text-right font-mono tabular-nums pr-2">
                      {fmt(line.amount)}
                    </td>
                    <td className="px-1 py-1">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          aria-label="Remove line"
                          onClick={() => setLines((l) => l.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && (
            <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Creating…" : "Create Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detail panel ──────────��───────────────────────────────────────────────────

function InvoiceDetailPanel({
  invoiceId,
  onClose,
  onApprove,
  onPost,
  isApproving,
  isPosting
}: {
  invoiceId: string;
  onClose: () => void;
  onApprove: () => void;
  onPost: () => void;
  isApproving: boolean;
  isPosting: boolean;
}) {
  const apiContext = useApiContext();

  const { data: res, isLoading } = useQuery({
    queryKey: ["ap-invoice", apiContext?.entityId, invoiceId],
    queryFn: () => (apiContext ? getAPInvoice(apiContext, invoiceId) : Promise.resolve(null)),
    enabled: Boolean(apiContext && invoiceId)
  });

  const inv = res?.data as APInvoice | null | undefined;

  return (
    <Card className="sticky top-4 h-fit max-h-[calc(100vh-6rem)] flex flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-3 shrink-0">
        <div>
          <CardTitle className="text-base">Invoice Detail</CardTitle>
          {inv?.invoiceNumber && (
            <p className="text-xs font-mono text-muted-foreground mt-0.5">{inv.invoiceNumber}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <Separator className="shrink-0" />

      <div className="overflow-y-auto flex-1">
        <CardContent className="pt-4 space-y-3 text-sm">
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : inv ? (
            <>
              {/* Meta */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div className="text-muted-foreground">Status</div>
                <div>
                  <Badge variant={STATUS_VARIANT[inv.status]} className="text-xs">
                    {inv.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="text-muted-foreground">Supplier</div>
                <div className="font-medium truncate">{inv.supplier?.name ?? "—"}</div>
                <div className="text-muted-foreground">Invoice Date</div>
                <div>{fmtDate(inv.invoiceDate)}</div>
                <div className="text-muted-foreground">Due Date</div>
                <div
                  className={
                    daysUntil(inv.dueDate) < 0
                      ? "text-destructive font-medium"
                      : daysUntil(inv.dueDate) <= 7
                        ? "text-amber-700 font-medium"
                        : ""
                  }
                >
                  {fmtDate(inv.dueDate)}
                  {daysUntil(inv.dueDate) < 0 && (
                    <span className="ml-1 text-[10px]">(overdue)</span>
                  )}
                  {daysUntil(inv.dueDate) >= 0 && daysUntil(inv.dueDate) <= 7 && (
                    <span className="ml-1 text-[10px]">({daysUntil(inv.dueDate)}d)</span>
                  )}
                </div>
                <div className="text-muted-foreground">Currency</div>
                <div className="font-mono">{inv.currency}</div>
                <div className="text-muted-foreground">Gross</div>
                <div className="font-mono tabular-nums">{fmt(inv.grossAmount)}</div>
                <div className="text-muted-foreground">Tax</div>
                <div className="font-mono tabular-nums">{fmt(inv.taxAmount)}</div>
                <div className="text-muted-foreground">Net</div>
                <div className="font-mono tabular-nums font-semibold">{fmt(inv.netAmount)}</div>
                {inv.glJournalId && (
                  <>
                    <div className="text-muted-foreground">GL Journal</div>
                    <div className="font-mono text-[10px] text-muted-foreground truncate">
                      {inv.glJournalId}
                    </div>
                  </>
                )}
              </div>

              {/* Lines */}
              {(inv.lines ?? []).length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">
                      Lines
                    </p>
                    <table className="w-full text-xs">
                      <thead className="bg-muted/60">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                            Description
                          </th>
                          <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                            GL Account
                          </th>
                          <th className="px-2 py-1.5 text-right font-medium text-muted-foreground w-20">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(inv.lines ?? []).map((line) => (
                          <tr key={line.id} className="hover:bg-muted/30">
                            <td className="px-2 py-1.5">{line.description}</td>
                            <td className="px-2 py-1.5 text-muted-foreground font-mono text-[10px]">
                              {(line as Record<string, unknown>).glAccountId
                                ? String((line as Record<string, unknown>).glAccountId).slice(
                                    0,
                                    8
                                  ) + "…"
                                : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-mono">
                              {fmt(line.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Actions */}
              {(inv.status === "DRAFT" || inv.status === "PENDING_APPROVAL") && (
                <>
                  <Separator />
                  <div className="flex gap-2 flex-wrap">
                    {(inv.status === "DRAFT" || inv.status === "PENDING_APPROVAL") && (
                      <Button
                        size="sm"
                        className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1"
                        disabled={isApproving}
                        onClick={onApprove}
                      >
                        <CheckCircle className="h-3.5 w-3.5" /> Approve
                      </Button>
                    )}
                  </div>
                </>
              )}

              {inv.status === "APPROVED" && (
                <>
                  <Separator />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 text-blue-700 border-blue-300 hover:bg-blue-50"
                    disabled={isPosting}
                    onClick={onPost}
                  >
                    <Send className="h-3.5 w-3.5" /> Post to GL
                  </Button>
                </>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Invoice not found.</p>
          )}
        </CardContent>
      </div>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function APInvoicesPage() {
  const apiContext = useApiContext();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const invoicesQ = useQuery({
    queryKey: ["ap-invoices", apiContext?.entityId, statusFilter],
    queryFn: () =>
      apiContext
        ? getAPInvoices(apiContext, {
            status: statusFilter === "ALL" ? undefined : (statusFilter as APInvoiceStatus),
            limit: 200
          })
        : Promise.resolve(null),
    enabled: Boolean(apiContext)
  });

  const suppliersQ = useQuery({
    queryKey: ["ap-suppliers", apiContext?.entityId],
    queryFn: () => (apiContext ? getSuppliers(apiContext) : Promise.resolve(null)),
    enabled: Boolean(apiContext)
  });

  const periodsQ = useQuery({
    queryKey: ["periods", apiContext?.entityId],
    queryFn: () => (apiContext ? getPeriods(apiContext) : Promise.resolve(null)),
    enabled: Boolean(apiContext)
  });

  const accountTreeQ = useQuery({
    queryKey: ["gl-account-tree", apiContext?.entityId],
    queryFn: () => (apiContext ? getGLAccountTree(apiContext) : Promise.resolve(null)),
    enabled: Boolean(apiContext)
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createAPInvoice(apiContext!, data),
    onSuccess: () => {
      setShowCreate(false);
      setCreateError(null);
      queryClient.invalidateQueries({ queryKey: ["ap-invoices"] });
    },
    onError: (e: Error) => setCreateError(e.message)
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveAPInvoice(apiContext!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ap-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["ap-invoice"] });
    }
  });

  const postMutation = useMutation({
    mutationFn: (id: string) => postAPInvoice(apiContext!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ap-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["ap-invoice"] });
    }
  });

  // ── Data ─────────────────────────────────────────────────────────────────

  const invoices: APInvoice[] = (invoicesQ.data?.data as unknown as APInvoice[]) ?? [];
  const suppliers: Supplier[] = (suppliersQ.data?.data as unknown as Supplier[]) ?? [];
  const periods =
    (periodsQ.data?.data as unknown as Array<{ id: string; name: string; status: string }>) ?? [];
  const glAccounts: FlatAccount[] = useMemo(
    () => flattenPostable((accountTreeQ.data?.data as unknown as AccountNode[]) ?? []),
    [accountTreeQ.data]
  );

  const summary = useMemo(() => {
    const total = invoices.reduce((s, i) => s + Number(i.netAmount || 0), 0);
    const overdue = invoices.filter(
      (i) => !["PAID", "CANCELLED"].includes(i.status) && daysUntil(i.dueDate) < 0
    ).length;
    const dueWeek = invoices.filter(
      (i) =>
        !["PAID", "CANCELLED"].includes(i.status) &&
        daysUntil(i.dueDate) >= 0 &&
        daysUntil(i.dueDate) <= 7
    ).length;
    return { total, overdue, dueWeek, count: invoices.length };
  }, [invoices]);

  function exportCsv() {
    const headers = [
      "Invoice #",
      "Supplier",
      "Invoice Date",
      "Due Date",
      "Currency",
      "Gross",
      "Tax",
      "Net",
      "Status"
    ];
    const rows = invoices.map((i) =>
      [
        i.invoiceNumber,
        i.supplier?.name ?? "",
        fmtDate(i.invoiceDate),
        fmtDate(i.dueDate),
        i.currency,
        i.grossAmount,
        i.taxAmount,
        i.netAmount,
        i.status
      ]
        .map((f) => `"${String(f).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "ap-invoices.csv"
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`grid gap-4 ${selectedId ? "grid-cols-[1fr_380px]" : "grid-cols-1"}`}>
      <div className="space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Total Invoices", value: summary.count, sub: "in view" },
            { label: "Total Value", value: `${fmt(summary.total)}`, sub: "net amount", mono: true },
            {
              label: "Overdue",
              value: summary.overdue,
              sub: "past due date",
              color: summary.overdue > 0 ? "text-destructive" : ""
            },
            {
              label: "Due This Week",
              value: summary.dueWeek,
              sub: "≤ 7 days",
              color: summary.dueWeek > 0 ? "text-amber-700" : ""
            }
          ].map((c) => (
            <Card key={c.label} className="p-4">
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p
                className={`text-xl font-bold mt-0.5 ${c.color ?? ""} ${c.mono ? "font-mono" : ""}`}
              >
                {c.value}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>
            </Card>
          ))}
        </div>

        {/* Invoice list */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-[var(--color-primary)] flex items-center gap-2">
              <FileText className="h-5 w-5" /> AP Invoices
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Statuses</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={invoices.length === 0}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> Export
              </Button>
              <Button
                size="sm"
                className="gap-1"
                onClick={() => {
                  setShowCreate(true);
                  setCreateError(null);
                }}
              >
                <Plus className="h-3.5 w-3.5" /> New Invoice
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Invoice #</TableHead>
                  <TableHead className="text-xs">Supplier</TableHead>
                  <TableHead className="text-xs">Invoice Date</TableHead>
                  <TableHead className="text-xs">Due Date</TableHead>
                  <TableHead className="text-xs text-right">Net Amount</TableHead>
                  <TableHead className="text-xs w-24">Currency</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoicesQ.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading invoices…
                    </TableCell>
                  </TableRow>
                ) : invoicesQ.isError ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-destructive">
                      {(invoicesQ.error as Error).message}
                    </TableCell>
                  </TableRow>
                ) : invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      No invoices found. Click <strong>New Invoice</strong> to create one.
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((inv) => {
                    const days = daysUntil(inv.dueDate);
                    const isOverdue = !["PAID", "CANCELLED"].includes(inv.status) && days < 0;
                    const isDueSoon =
                      !["PAID", "CANCELLED"].includes(inv.status) && days >= 0 && days <= 7;
                    return (
                      <TableRow
                        key={inv.id}
                        className={`cursor-pointer ${selectedId === inv.id ? "bg-[var(--color-primary)]/5 border-l-2 border-l-[var(--color-primary)]" : "hover:bg-muted/40"}`}
                        onClick={() => setSelectedId(inv.id)}
                      >
                        <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                        <TableCell className="text-sm">{inv.supplier?.name ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtDate(inv.invoiceDate)}
                        </TableCell>
                        <TableCell
                          className={`text-xs ${isOverdue ? "text-destructive font-medium" : isDueSoon ? "text-amber-700 font-medium" : "text-muted-foreground"}`}
                        >
                          {fmtDate(inv.dueDate)}
                          {isOverdue && <span className="ml-1 text-[10px]">overdue</span>}
                          {isDueSoon && <span className="ml-1 text-[10px]">{days}d</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm tabular-nums">
                          {fmt(inv.netAmount)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {inv.currency}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[inv.status]} className="text-xs">
                            {inv.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Detail panel */}
      {selectedId && (
        <InvoiceDetailPanel
          invoiceId={selectedId}
          onClose={() => setSelectedId(null)}
          onApprove={() => approveMutation.mutate(selectedId)}
          onPost={() => postMutation.mutate(selectedId)}
          isApproving={approveMutation.isPending}
          isPosting={postMutation.isPending}
        />
      )}

      {/* Create dialog */}
      <CreateInvoiceDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        suppliers={suppliers}
        periods={periods}
        glAccounts={glAccounts}
        onSubmit={(d) => createMutation.mutate(d)}
        isPending={createMutation.isPending}
        error={createError}
      />
    </div>
  );
}
