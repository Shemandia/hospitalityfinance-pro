"use client";

import { useMemo, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTenantHref, useTenantRouter } from "../../../../../../hooks/use-tenant-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
  FileText,
  CreditCard,
  Landmark,
  Users,
  Printer,
  Trash2
} from "lucide-react";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useUserRole } from "../../../../../../components/use-user-role";
import {
  getAPPaymentRun,
  approveAPPaymentRun,
  confirmAPPaymentRun,
  deleteAPPaymentRun,
  getPaymentRunDownloadUrl,
  getPaymentVoucherUrl,
  getGLAccounts
} from "../../../../../../lib/gl-api";
import { fmtDecimal as fmt, fmtDate } from "../../../../../../lib/format";
import { ConfirmDialog } from "../../../../../../components/confirm-dialog";

type PaymentRunDetail = {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  bankFileFormat: "SWIFT_MT103" | "SEPA_PAIN001" | "CSV";
  createdAt: string;
  bankFilePath?: string | null;
  items: Array<{
    id: string;
    supplierId: string;
    currency: string;
    invoiceCount: number;
    payableAmount: string;
    supplier: { id: string; name: string; code: string };
  }>;
  invoices: Array<{
    id: string;
    allocatedAmount: string;
    isCreditNote: boolean;
    invoice: {
      id: string;
      invoiceNumber: string;
      currency: string;
      dueDate: string;
      supplier: { name: string; code: string };
    };
  }>;
};

type AccountNode = {
  id: string;
  code: string;
  name: string;
  type: string;
  allowPosting: boolean;
  children?: AccountNode[];
};
type FlatAccount = { id: string; label: string; type: string; allowPosting: boolean };

function flattenAccounts(nodes: AccountNode[], level = 0): FlatAccount[] {
  const out: FlatAccount[] = [];
  for (const n of nodes) {
    out.push({
      id: n.id,
      label: `${"  ".repeat(level)}${n.code} - ${n.name}`,
      type: n.type,
      allowPosting: n.allowPosting
    });
    if (n.children?.length) out.push(...flattenAccounts(n.children, level + 1));
  }
  return out;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  PROPOSED: { bg: "bg-amber-100", text: "text-amber-700", label: "Proposed" },
  APPROVED: { bg: "bg-blue-100", text: "text-blue-700", label: "Approved" },
  CONFIRMED: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Confirmed" },
  PROCESSED: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Processed" },
  FAILED: { bg: "bg-red-100", text: "text-red-700", label: "Failed" },
  CANCELLED: { bg: "bg-slate-100", text: "text-slate-500", label: "Cancelled" }
};

export default function PaymentRunDetailPage() {
  const params = useParams();
  const router = useTenantRouter();
  const tenantHref = useTenantHref();
  const ctx = useApiContext();
  const qc = useQueryClient();
  const { canWrite, canAdmin } = useUserRole();
  const runId = params.id as string;

  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"BANK_TRANSFER" | "CHEQUE" | "CARD" | "CASH">(
    "BANK_TRANSFER"
  );
  const [referencePrefix, setReferencePrefix] = useState("PAYRUN");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const { data: detailRes, isLoading } = useQuery({
    queryKey: ["ap-payment-run", ctx?.tenantSlug, ctx?.entityId, runId],
    queryFn: () => getAPPaymentRun(ctx!, runId).then((r) => r.data as PaymentRunDetail),
    enabled: !!ctx && !!runId
  });

  const accountsQ = useQuery({
    queryKey: ["gl-accounts", ctx?.tenantSlug, ctx?.entityId, "payrun-detail"],
    queryFn: () => getGLAccounts(ctx!).then((r) => (r.data as unknown as AccountNode[]) ?? []),
    enabled: !!ctx
  });

  const bankAccounts = useMemo(
    () => flattenAccounts(accountsQ.data ?? []).filter((a) => a.type === "ASSET" && a.allowPosting),
    [accountsQ.data]
  );

  // Auto-select the first available bank account once the list loads, so the
  // user doesn't have to remember to pick one before clicking Confirm.
  useEffect(() => {
    if (!bankAccountId && bankAccounts.length > 0) {
      setBankAccountId(bankAccounts[0].id);
    }
  }, [bankAccounts, bankAccountId]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ap-payment-run"] });
    qc.invalidateQueries({ queryKey: ["ap-payment-runs"] });
  };

  const approveMut = useMutation({
    mutationFn: () => approveAPPaymentRun(ctx!, runId),
    onSuccess: () => {
      invalidate();
      setFeedback({ type: "success", message: "Payment run approved." });
    },
    onError: (e: Error) => setFeedback({ type: "error", message: e.message })
  });

  const confirmMut = useMutation({
    mutationFn: (params: {
      bankAccountId: string;
      paymentMethod: typeof paymentMethod;
      referencePrefix: string;
    }) => confirmAPPaymentRun(ctx!, runId, params),
    onSuccess: () => {
      invalidate();
      setFeedback({
        type: "success",
        message: "Payment run processed. Bank file generated and journals posted."
      });
    },
    onError: (e: Error) => setFeedback({ type: "error", message: e.message })
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteAPPaymentRun(ctx!, runId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ap-payment-runs"] });
      router.push("/ap/payment-runs");
    },
    onError: (e: Error) => setFeedback({ type: "error", message: e.message })
  });

  const run = detailRes;

  async function downloadBankFile() {
    if (!ctx || !run) return;
    const url = getPaymentRunDownloadUrl(runId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, "X-Entity-ID": ctx.entityId }
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const ext =
      run.bankFileFormat === "CSV"
        ? "csv"
        : run.bankFileFormat === "SEPA_PAIN001"
          ? "xml"
          : "mt103";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `payment-run-${runId.slice(0, 8)}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function downloadVoucher(supplierId: string, supplierCode: string) {
    if (!ctx || !run) return;
    const url = getPaymentVoucherUrl(runId, supplierId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${ctx.accessToken}`, "X-Entity-ID": ctx.entityId }
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `voucher-${runId.slice(0, 8)}-${supplierCode}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Loading
  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6 p-6">
        <div className="h-8 w-48 bg-slate-100 rounded-xl animate-pulse" />
        <div className="h-48 bg-white rounded-3xl border border-slate-100 animate-pulse" />
        <div className="grid grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 bg-white rounded-2xl border border-slate-100 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Link
          href={tenantHref("/ap/payment-runs")}
          className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors mb-6"
        >
          <ArrowLeft size={18} /> <span className="font-medium">Back to Payment Runs</span>
        </Link>
        <div className="bg-white rounded-3xl p-12 border border-slate-100 text-center">
          <AlertTriangle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <p className="text-lg font-bold text-slate-800">Payment run not found</p>
        </div>
      </div>
    );
  }

  const st = STATUS_STYLES[run.status] ?? STATUS_STYLES.PROPOSED;
  const totalPayable = run.items.reduce((s, i) => s + Number(i.payableAmount || 0), 0);
  const totalInvoices = run.invoices.length;

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6 pb-20">
      {/* 1. NAVIGATION + ACTIONS */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <Link
          href={tenantHref("/ap/payment-runs")}
          className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors"
        >
          <ArrowLeft size={18} /> <span className="font-medium">Back to Payment Runs</span>
        </Link>
        <div className="flex flex-wrap gap-2">
          {run.bankFilePath && (
            <button
              type="button"
              onClick={downloadBankFile}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-600 hover:bg-slate-50 font-medium text-sm transition-colors"
            >
              <Download size={16} /> Bank File ({run.bankFileFormat})
            </button>
          )}
          {run.status === "PROPOSED" && canWrite && (
            <>
              <button
                type="button"
                onClick={() => setConfirmAction("delete")}
                disabled={deleteMut.isPending}
                className="flex items-center gap-2 px-4 py-2 border border-red-200 rounded-xl bg-white text-red-600 hover:bg-red-50 font-medium text-sm transition-colors disabled:opacity-50"
              >
                <Trash2 size={16} /> Delete Run
              </button>
              <button
                type="button"
                onClick={() => setConfirmAction("approve")}
                disabled={approveMut.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all text-sm disabled:opacity-50"
              >
                <CheckCircle2 size={16} /> Approve Run
              </button>
            </>
          )}
        </div>
      </div>

      {/* 2. HEADER CARD */}
      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-slate-900 font-mono">
              {run.id.slice(0, 12)}...
            </h1>
            <span
              className={`px-3 py-1 rounded-full ${st.bg} ${st.text} text-xs font-bold uppercase tracking-wider`}
            >
              {st.label}
            </span>
          </div>
          <p className="text-slate-500">
            {fmtDate(run.startDate)} — {fmtDate(run.endDate)}
          </p>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span>Format: {run.bankFileFormat}</span>
            <span>Created: {fmtDate(run.createdAt)}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-400 font-medium">Total Payable</p>
          <p className="text-3xl font-bold text-emerald-600 tabular-nums">{fmt(totalPayable)}</p>
        </div>
      </div>

      {/* 3. INFO GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
            <FileText size={14} /> Run Summary
          </p>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Suppliers</span>
              <span className="font-bold text-slate-800">{run.items.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Invoices</span>
              <span className="font-bold text-slate-800">{totalInvoices}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Format</span>
              <span className="font-bold text-slate-800">{run.bankFileFormat}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Bank File</span>
              <span className="font-bold text-slate-800">
                {run.bankFilePath ? "Generated" : "Pending"}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
            <CreditCard size={14} /> Amount Breakdown
          </p>
          <div className="space-y-3">
            {run.items.slice(0, 5).map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-slate-500 truncate max-w-[160px]">{item.supplier.name}</span>
                <span className="font-bold text-slate-800 tabular-nums">
                  {fmt(item.payableAmount)}
                </span>
              </div>
            ))}
            {run.items.length > 5 && (
              <p className="text-xs text-slate-400">+{run.items.length - 5} more suppliers</p>
            )}
          </div>
        </div>

        {/* Status card */}
        <div
          className={`p-6 rounded-2xl shadow-lg flex flex-col justify-between ${
            run.status === "PROCESSED" || run.status === "CONFIRMED"
              ? "bg-emerald-600 shadow-emerald-100 text-white"
              : run.status === "FAILED" || run.status === "CANCELLED"
                ? "bg-red-500 shadow-red-100 text-white"
                : "bg-blue-600 shadow-blue-100 text-white"
          }`}
        >
          <p className="text-[11px] font-bold opacity-80 uppercase tracking-[0.15em] flex items-center gap-2">
            <Clock size={14} /> Payment Status
          </p>
          <div className="flex items-center gap-3 mt-4">
            {run.status === "PROCESSED" ? <CheckCircle2 size={32} /> : <Clock size={32} />}
            <div>
              <p className="font-bold text-lg">{st.label}</p>
              <p className="text-sm opacity-80">
                {run.status === "PROPOSED" && "Awaiting approval to proceed."}
                {run.status === "APPROVED" && "Ready for confirmation and processing."}
                {run.status === "PROCESSED" && "Bank file generated and payments posted."}
                {run.status === "CONFIRMED" && "Payment confirmed, generating bank file."}
                {run.status === "FAILED" && "Processing failed. Check logs."}
                {run.status === "CANCELLED" && "Payment run was cancelled."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. CONFIRM & PROCESS (for APPROVED status) */}
      {run.status === "APPROVED" && (
        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm space-y-5">
          <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <Landmark size={18} /> Confirm & Process Payment
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="pr-bank"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Bank Account
              </label>
              <select
                id="pr-bank"
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              >
                <option value="">Select bank account...</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="pr-method"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Payment Method
              </label>
              <select
                id="pr-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              >
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CHEQUE">Cheque</option>
                <option value="CARD">Card</option>
                <option value="CASH">Cash</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="pr-ref"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Reference Prefix
              </label>
              <input
                id="pr-ref"
                value={referencePrefix}
                onChange={(e) => setReferencePrefix(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setFeedback(null);
                confirmMut.mutate({ bankAccountId, paymentMethod, referencePrefix });
              }}
              disabled={confirmMut.isPending || !bankAccountId || !canAdmin}
              className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {confirmMut.isPending ? "Processing..." : "Confirm & Process"}
            </button>
            {!bankAccountId && (
              <p className="text-xs text-red-500">Select a bank account to proceed.</p>
            )}
            {!canAdmin && <p className="text-xs text-red-500">ADMIN role required.</p>}
          </div>
          {feedback && (
            <div
              className={`rounded-xl px-4 py-3 text-sm font-medium border ${
                feedback.type === "success"
                  ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : "bg-red-50 border-red-200 text-red-800"
              }`}
            >
              {feedback.message}
            </div>
          )}
        </div>
      )}

      {/* 5. SUPPLIER ITEMS TABLE */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <Users size={18} /> Suppliers ({run.items.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50/50">
              <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                <th className="px-6 py-4">Supplier</th>
                <th className="px-6 py-4">Code</th>
                <th className="px-6 py-4">Currency</th>
                <th className="px-6 py-4 text-center">Invoices</th>
                <th className="px-6 py-4 text-right">Payable Amount</th>
                {run.status === "PROCESSED" && <th className="px-6 py-4 text-right">Voucher</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {run.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <Link
                      href={tenantHref(`/ap/suppliers/${item.supplierId}`)}
                      className="font-bold text-emerald-600 hover:underline text-sm"
                    >
                      {item.supplier.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-slate-500">
                    {item.supplier.code}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500">{item.currency}</td>
                  <td className="px-6 py-4 text-sm text-center text-slate-800">
                    {item.invoiceCount}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums">
                    <span className="font-bold text-slate-800">{fmt(item.payableAmount)}</span>
                  </td>
                  {run.status === "PROCESSED" && (
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => downloadVoucher(item.supplierId, item.supplier.code)}
                        className="flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 ml-auto"
                      >
                        <Printer size={14} /> Print
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr className="font-bold text-slate-800">
                <td
                  colSpan={run.status === "PROCESSED" ? 4 : 3}
                  className="px-6 py-4 text-right uppercase text-xs text-slate-400 tracking-[0.15em]"
                >
                  Total
                </td>
                <td className="px-6 py-4 text-center font-bold text-slate-800">{totalInvoices}</td>
                <td className="px-6 py-4 text-right tabular-nums border-t-2 border-emerald-500 text-emerald-600">
                  {fmt(totalPayable)}
                </td>
                {run.status === "PROCESSED" && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* 6. INVOICES TABLE */}
      {run.invoices.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
              <FileText size={18} /> Invoices ({run.invoices.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50">
                <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                  <th className="px-6 py-4">Invoice #</th>
                  <th className="px-6 py-4">Supplier</th>
                  <th className="px-6 py-4">Due Date</th>
                  <th className="px-6 py-4">Currency</th>
                  <th className="px-6 py-4 text-right">Allocated</th>
                  <th className="px-6 py-4">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {run.invoices.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-mono font-bold text-slate-800">
                      {row.invoice.invoiceNumber}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {row.invoice.supplier.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 tabular-nums">
                      {fmtDate(row.invoice.dueDate)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">{row.invoice.currency}</td>
                    <td className="px-6 py-4 text-right tabular-nums font-bold text-slate-800">
                      {fmt(row.allocatedAmount)}
                    </td>
                    <td className="px-6 py-4">
                      {row.isCreditNote ? (
                        <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold uppercase">
                          Credit Note
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold uppercase">
                          Invoice
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={confirmAction === "approve"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Approve Payment Run"
        description={`This will approve the payment run with ${run.items.length} suppliers and ${totalInvoices} invoices for a total of ${fmt(totalPayable)}.`}
        confirmLabel="Approve"
        onConfirm={() => approveMut.mutate()}
        loading={approveMut.isPending}
      />
      <ConfirmDialog
        open={confirmAction === "delete"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Delete Payment Run"
        description={`This will permanently delete this proposed payment run with ${run.items.length} suppliers and ${totalInvoices} invoices. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteMut.mutate()}
        loading={deleteMut.isPending}
      />
    </div>
  );
}
