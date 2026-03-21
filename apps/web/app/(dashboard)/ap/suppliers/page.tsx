"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../components/use-api-context";
import {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  getAPInvoices,
  type Supplier,
  type APInvoice,
  type APInvoiceStatus
} from "../../../../lib/gl-api";
import { Button } from "../../../../components/ui/button";
import { Badge } from "../../../../components/ui/badge";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Separator } from "../../../../components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "../../../../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../components/ui/table";
import { Plus, Pencil, X, Users, CreditCard, FileText, CheckCircle } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: string | number | null | undefined) {
  const n = Number(v ?? 0);
  if (!n && n !== 0) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return d;
  }
}

function daysUntil(due: string) {
  return Math.round((new Date(due).getTime() - Date.now()) / 86_400_000);
}

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

// ── Supplier form ─────────────────────────────────────────────────────────────

type SupplierFormData = {
  name: string;
  code: string;
  taxId: string;
  currency: string;
  paymentTermsDays: string;
  isActive: boolean;
  bankName: string;
  bankAccount: string;
  bankSwift: string;
  bankIban: string;
};

const EMPTY_FORM: SupplierFormData = {
  name: "",
  code: "",
  taxId: "",
  currency: "USD",
  paymentTermsDays: "30",
  isActive: true,
  bankName: "",
  bankAccount: "",
  bankSwift: "",
  bankIban: ""
};

function supplierToForm(s: Supplier): SupplierFormData {
  const bank = (s.bankDetails ?? {}) as Record<string, string>;
  return {
    name: s.name,
    code: s.code,
    taxId: s.taxId ?? "",
    currency: s.currency,
    paymentTermsDays: String(s.paymentTermsDays ?? 30),
    isActive: s.isActive ?? true,
    bankName: bank.bankName ?? "",
    bankAccount: bank.accountNumber ?? "",
    bankSwift: bank.swift ?? "",
    bankIban: bank.iban ?? ""
  };
}

function formToPayload(f: SupplierFormData) {
  const payload: Record<string, unknown> = {
    name: f.name,
    code: f.code,
    currency: f.currency,
    paymentTermsDays: Number(f.paymentTermsDays) || 30,
    isActive: f.isActive
  };
  if (f.taxId) payload.taxId = f.taxId;
  const bank: Record<string, string> = {};
  if (f.bankName) bank.bankName = f.bankName;
  if (f.bankAccount) bank.accountNumber = f.bankAccount;
  if (f.bankSwift) bank.swift = f.bankSwift;
  if (f.bankIban) bank.iban = f.bankIban;
  if (Object.keys(bank).length) payload.bankDetails = bank;
  return payload;
}

function SupplierFormDialog({
  open,
  onClose,
  supplier,
  onSubmit,
  isPending,
  error
}: {
  open: boolean;
  onClose: () => void;
  supplier: Supplier | null;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [form, setForm] = useState<SupplierFormData>(() =>
    supplier ? supplierToForm(supplier) : EMPTY_FORM
  );

  // Reset when supplier prop changes
  const prevSupplierRef = useRef(supplier);
  if (prevSupplierRef.current !== supplier) {
    prevSupplierRef.current = supplier;
    setForm(supplier ? supplierToForm(supplier) : EMPTY_FORM);
  }

  function setF<K extends keyof SupplierFormData>(k: K, v: SupplierFormData[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplier ? "Edit Supplier" : "New Supplier"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Core info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => setF("name", e.target.value)}
                placeholder="Acme Supplies Ltd."
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Code <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.code}
                onChange={(e) => setF("code", e.target.value.toUpperCase())}
                placeholder="ACME-001"
                className="uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tax ID / VAT</Label>
              <Input
                value={form.taxId}
                onChange={(e) => setF("taxId", e.target.value)}
                placeholder="AE123456789"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Currency <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.currency}
                onChange={(e) => setF("currency", e.target.value.toUpperCase())}
                maxLength={3}
                className="uppercase"
                placeholder="USD"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Terms (days)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={form.paymentTermsDays}
                onChange={(e) => setF("paymentTermsDays", e.target.value)}
                className="font-mono"
              />
            </div>
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={form.isActive}
              onChange={(e) => setF("isActive", e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <Label htmlFor="isActive" className="cursor-pointer">
              Active supplier
            </Label>
          </div>

          <Separator />

          {/* Bank details */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Bank Details
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Bank Name</Label>
                <Input
                  value={form.bankName}
                  onChange={(e) => setF("bankName", e.target.value)}
                  placeholder="First National Bank"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Account Number</Label>
                <Input
                  value={form.bankAccount}
                  onChange={(e) => setF("bankAccount", e.target.value)}
                  placeholder="123456789"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>SWIFT / BIC</Label>
                <Input
                  value={form.bankSwift}
                  onChange={(e) => setF("bankSwift", e.target.value.toUpperCase())}
                  placeholder="FNBKUS33"
                  className="uppercase font-mono"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>IBAN</Label>
                <Input
                  value={form.bankIban}
                  onChange={(e) => setF("bankIban", e.target.value.toUpperCase())}
                  placeholder="GB29 NWBK 6016 1331 9268 19"
                  className="uppercase font-mono"
                />
              </div>
            </div>
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
          <Button
            onClick={() => onSubmit(formToPayload(form))}
            disabled={isPending || !form.name || !form.code || !form.currency}
          >
            {isPending
              ? supplier
                ? "Saving…"
                : "Creating…"
              : supplier
                ? "Save Changes"
                : "Create Supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Supplier detail panel ─────────────────────────────────────────────────────

function SupplierDetailPanel({
  supplierId,
  onClose,
  onEdit
}: {
  supplierId: string;
  onClose: () => void;
  onEdit: (s: Supplier) => void;
}) {
  const apiContext = useApiContext();

  const { data: supplierRes } = useQuery({
    queryKey: ["ap-supplier", apiContext?.entityId, supplierId],
    queryFn: () => (apiContext ? getSupplier(apiContext, supplierId) : Promise.resolve(null)),
    enabled: Boolean(apiContext && supplierId)
  });

  const { data: invoicesRes } = useQuery({
    queryKey: ["ap-invoices-supplier", apiContext?.entityId, supplierId],
    queryFn: () =>
      apiContext ? getAPInvoices(apiContext, { supplierId, limit: 50 }) : Promise.resolve(null),
    enabled: Boolean(apiContext && supplierId)
  });

  const supplier = supplierRes?.data as Supplier | null | undefined;
  const invoices: APInvoice[] = (invoicesRes?.data as unknown as APInvoice[]) ?? [];
  const bank = (supplier?.bankDetails ?? {}) as Record<string, string>;

  // Payment allocation summary
  const totalOwed = invoices
    .filter((i) => !["PAID", "CANCELLED"].includes(i.status))
    .reduce((s, i) => s + Number(i.netAmount || 0), 0);
  const overdue = invoices.filter(
    (i) => !["PAID", "CANCELLED"].includes(i.status) && daysUntil(i.dueDate) < 0
  );

  return (
    <Card className="sticky top-4 h-fit max-h-[calc(100vh-6rem)] flex flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-3 shrink-0">
        <div>
          <CardTitle className="text-base">{supplier?.name ?? "Loading…"}</CardTitle>
          {supplier?.code && (
            <p className="text-xs font-mono text-muted-foreground mt-0.5">{supplier.code}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {supplier && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEdit(supplier)}
              title="Edit supplier"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <Separator className="shrink-0" />

      <div className="overflow-y-auto flex-1">
        <CardContent className="pt-4 space-y-4 text-sm">
          {supplier && (
            <>
              {/* Supplier info */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div className="text-muted-foreground">Status</div>
                <div>
                  <Badge variant={supplier.isActive ? "success" : "secondary"} className="text-xs">
                    {supplier.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                <div className="text-muted-foreground">Currency</div>
                <div className="font-mono">{supplier.currency}</div>
                <div className="text-muted-foreground">Payment Terms</div>
                <div>{supplier.paymentTermsDays ?? 30} days</div>
                {supplier.taxId && (
                  <>
                    <div className="text-muted-foreground">Tax ID</div>
                    <div className="font-mono">{supplier.taxId}</div>
                  </>
                )}
              </div>

              {/* Bank details */}
              {Object.keys(bank).length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-2">
                      Bank Details
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      {bank.bankName && (
                        <>
                          <div className="text-muted-foreground">Bank</div>
                          <div>{bank.bankName}</div>
                        </>
                      )}
                      {bank.accountNumber && (
                        <>
                          <div className="text-muted-foreground">Account</div>
                          <div className="font-mono">{bank.accountNumber}</div>
                        </>
                      )}
                      {bank.swift && (
                        <>
                          <div className="text-muted-foreground">SWIFT</div>
                          <div className="font-mono">{bank.swift}</div>
                        </>
                      )}
                      {bank.iban && (
                        <>
                          <div className="text-muted-foreground">IBAN</div>
                          <div className="font-mono break-all">{bank.iban}</div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Payment allocation summary */}
              <Separator />
              <div>
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-3">
                  Payment Allocation
                </p>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-center">
                    <p className="text-xs text-muted-foreground">Outstanding</p>
                    <p className="text-sm font-bold font-mono tabular-nums mt-0.5">
                      {fmt(totalOwed)}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{supplier.currency}</p>
                  </div>
                  <div
                    className={`rounded-md px-3 py-2 text-center ${overdue.length > 0 ? "bg-destructive/10" : "bg-muted/50"}`}
                  >
                    <p className="text-xs text-muted-foreground">Overdue</p>
                    <p
                      className={`text-sm font-bold mt-0.5 ${overdue.length > 0 ? "text-destructive" : ""}`}
                    >
                      {overdue.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      invoice{overdue.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>

                {/* Open invoices with allocation status */}
                {invoices.filter((i) => !["CANCELLED"].includes(i.status)).length > 0 && (
                  <div>
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1.5">
                      Open Invoices
                    </p>
                    <div className="space-y-1">
                      {invoices
                        .filter((i) => i.status !== "CANCELLED")
                        .map((inv) => {
                          const days = daysUntil(inv.dueDate);
                          const isPaid = inv.status === "PAID";
                          const isOverdue = !isPaid && days < 0;
                          return (
                            <div
                              key={inv.id}
                              className={`flex items-center justify-between rounded px-2 py-1.5 text-xs ${
                                isPaid
                                  ? "bg-emerald-50"
                                  : isOverdue
                                    ? "bg-destructive/5"
                                    : "bg-muted/30"
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {isPaid ? (
                                  <CheckCircle className="h-3 w-3 text-emerald-600 shrink-0" />
                                ) : (
                                  <CreditCard className="h-3 w-3 text-muted-foreground shrink-0" />
                                )}
                                <span className="font-mono truncate">{inv.invoiceNumber}</span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className={`font-mono tabular-nums ${isOverdue ? "text-destructive" : ""}`}
                                >
                                  {fmt(inv.netAmount)}
                                </span>
                                <Badge
                                  variant={STATUS_VARIANT[inv.status]}
                                  className="text-[10px] px-1 py-0"
                                >
                                  {inv.status === "PENDING_APPROVAL" ? "PENDING" : inv.status}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                )}

                {invoices.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No invoices for this supplier.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </div>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SuppliersPage() {
  const apiContext = useApiContext();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────

  const suppliersQ = useQuery({
    queryKey: ["ap-suppliers", apiContext?.entityId],
    queryFn: () => (apiContext ? getSuppliers(apiContext) : Promise.resolve(null)),
    enabled: Boolean(apiContext)
  });

  // ── Mutations ────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => createSupplier(apiContext!, data),
    onSuccess: () => {
      setShowForm(false);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["ap-suppliers"] });
    },
    onError: (e: Error) => setFormError(e.message)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      updateSupplier(apiContext!, id, data),
    onSuccess: () => {
      setShowForm(false);
      setFormError(null);
      setEditingSupplier(null);
      queryClient.invalidateQueries({ queryKey: ["ap-suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["ap-supplier"] });
    },
    onError: (e: Error) => setFormError(e.message)
  });

  // ── Data ─────────────────────────────────────────────────────────────────

  const allSuppliers: Supplier[] = (suppliersQ.data?.data as unknown as Supplier[]) ?? [];

  const suppliers = allSuppliers
    .filter((s) => showInactive || s.isActive)
    .filter(
      (s) =>
        !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.code.toLowerCase().includes(search.toLowerCase())
    );

  function openCreate() {
    setEditingSupplier(null);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(s: Supplier) {
    setEditingSupplier(s);
    setFormError(null);
    setShowForm(true);
  }

  function handleSubmit(data: Record<string, unknown>) {
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className={`grid gap-4 ${selectedId ? "grid-cols-[1fr_380px]" : "grid-cols-1"}`}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-(--color-primary) flex items-center gap-2">
              <Users className="h-5 w-5" /> Suppliers
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {allSuppliers.length} supplier{allSuppliers.length !== 1 ? "s" : ""} registered
            </p>
          </div>
          <Button size="sm" className="gap-1" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> New Supplier
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code…"
            className="max-w-xs"
          />
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Show inactive
          </label>
        </div>

        {/* Supplier list */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Code</TableHead>
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Currency</TableHead>
                  <TableHead className="text-xs">Payment Terms</TableHead>
                  <TableHead className="text-xs">Tax ID</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs w-16">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliersQ.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      Loading suppliers…
                    </TableCell>
                  </TableRow>
                ) : suppliersQ.isError ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-destructive">
                      {(suppliersQ.error as Error).message}
                    </TableCell>
                  </TableRow>
                ) : suppliers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      {allSuppliers.length === 0 ? (
                        <>
                          No suppliers yet. Click <strong>New Supplier</strong> to add one.
                        </>
                      ) : (
                        "No suppliers match your search."
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  suppliers.map((s) => (
                    <TableRow
                      key={s.id}
                      className={`cursor-pointer ${selectedId === s.id ? "bg-(--color-primary)/5 border-l-2 border-l-(--color-primary)" : "hover:bg-muted/40"}`}
                      onClick={() => setSelectedId(s.id)}
                    >
                      <TableCell className="font-mono text-xs">{s.code}</TableCell>
                      <TableCell className="text-sm font-medium">{s.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.currency}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.paymentTermsDays ?? 30} days
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {s.taxId ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.isActive ? "success" : "secondary"} className="text-xs">
                          {s.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(s);
                          }}
                          title="Edit supplier"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Detail panel */}
      {selectedId && (
        <SupplierDetailPanel
          supplierId={selectedId}
          onClose={() => setSelectedId(null)}
          onEdit={openEdit}
        />
      )}

      {/* Create / Edit dialog */}
      <SupplierFormDialog
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingSupplier(null);
        }}
        supplier={editingSupplier}
        onSubmit={handleSubmit}
        isPending={isPending}
        error={formError}
      />
    </div>
  );
}
