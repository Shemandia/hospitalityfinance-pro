"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useTenantHref, useTenantRouter } from "../../../../../../hooks/use-tenant-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  Building2,
  CreditCard,
  FileText,
  History,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Landmark,
  ExternalLink
} from "lucide-react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getSupplier,
  getAPInvoices,
  type Supplier,
  type APInvoice,
  type APInvoiceStatus
} from "../../../../../../lib/gl-api";
import { fmtDecimal as fmt, fmtDate } from "../../../../../../lib/format";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: "bg-slate-100", text: "text-slate-600", label: "Draft" },
  PENDING_APPROVAL: { bg: "bg-amber-100", text: "text-amber-700", label: "Pending" },
  APPROVED: { bg: "bg-blue-100", text: "text-blue-700", label: "Approved" },
  POSTED: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Posted" },
  PAID: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Paid" },
  DISPUTED: { bg: "bg-red-100", text: "text-red-700", label: "Disputed" },
  CANCELLED: { bg: "bg-slate-100", text: "text-slate-500", label: "Cancelled" }
};

function daysUntil(due: string) {
  return Math.round((new Date(due).getTime() - Date.now()) / 86_400_000);
}

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useTenantRouter();
  const tenantHref = useTenantHref();
  const ctx = useApiContext();
  const supplierId = params.id as string;

  const { data: supplierRes, isLoading } = useQuery({
    queryKey: ["ap-supplier", ctx?.tenantSlug, ctx?.entityId, supplierId],
    queryFn: () => getSupplier(ctx!, supplierId),
    enabled: !!ctx && !!supplierId
  });

  const { data: invoicesRes } = useQuery({
    queryKey: ["ap-invoices-supplier", ctx?.tenantSlug, ctx?.entityId, supplierId],
    queryFn: () => getAPInvoices(ctx!, { supplierId, limit: 100 }),
    enabled: !!ctx && !!supplierId
  });

  const supplier = supplierRes?.data as Supplier | null | undefined;
  const invoices: APInvoice[] = (invoicesRes?.data as unknown as APInvoice[]) ?? [];
  const bank = (supplier?.bankDetails ?? {}) as Record<string, string>;

  const openInvoices = invoices.filter((i) => !["PAID", "CANCELLED"].includes(i.status));
  const totalOwed = openInvoices.reduce((s, i) => s + Number(i.netAmount || 0), 0);
  const overdueInvoices = openInvoices.filter((i) => daysUntil(i.dueDate) < 0);
  const overdueAmount = overdueInvoices.reduce((s, i) => s + Number(i.netAmount || 0), 0);
  const paidInvoices = invoices.filter((i) => i.status === "PAID");
  const totalPaid = paidInvoices.reduce((s, i) => s + Number(i.netAmount || 0), 0);

  // Loading skeleton
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
        <div className="h-64 bg-white rounded-3xl border border-slate-100 animate-pulse" />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Link
          href={tenantHref("/ap/suppliers")}
          className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors mb-6"
        >
          <ArrowLeft size={18} />
          <span className="font-medium">Back to Suppliers</span>
        </Link>
        <div className="bg-white rounded-3xl p-12 border border-slate-100 text-center">
          <AlertTriangle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <p className="text-lg font-bold text-slate-800">Supplier not found</p>
          <p className="text-sm text-slate-500 mt-1">The supplier could not be loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6 pb-20">
      {/* 1. TOP NAVIGATION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <Link
          href={tenantHref("/ap/suppliers")}
          className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors"
        >
          <ArrowLeft size={18} />
          <span className="font-medium">Back to Suppliers</span>
        </Link>
        <button
          type="button"
          onClick={() => router.push(`/ap/suppliers?edit=${supplier.id}`)}
          className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-600 hover:bg-slate-50 font-medium text-sm transition-colors"
        >
          <Pencil size={16} /> Edit Supplier
        </button>
      </div>

      {/* 2. HEADER CARD */}
      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-slate-900">{supplier.name}</h1>
            <span
              className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                supplier.isActive
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {supplier.isActive ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="text-slate-500 font-mono">{supplier.code}</p>
          <div className="flex items-center gap-4 text-sm text-slate-400">
            <span>{supplier.currency}</span>
            <span>{supplier.paymentTermsDays ?? 30} day terms</span>
            {supplier.taxId && <span>Tax ID: {supplier.taxId}</span>}
          </div>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-400 font-medium">Outstanding</p>
          <p className="text-3xl font-bold text-emerald-600 tabular-nums">
            {supplier.currency} {fmt(totalOwed)}
          </p>
        </div>
      </div>

      {/* 3. INFORMATION GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Payment Summary */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
            <CreditCard size={14} /> Payment Summary
          </p>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Open Invoices</span>
              <span className="font-bold text-slate-800">{openInvoices.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Total Owed</span>
              <span className="font-bold text-emerald-600 tabular-nums">{fmt(totalOwed)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Total Paid</span>
              <span className="font-bold text-slate-800 tabular-nums">{fmt(totalPaid)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">All Invoices</span>
              <span className="font-bold text-slate-800">{invoices.length}</span>
            </div>
          </div>
        </div>

        {/* Bank Details */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
            <Landmark size={14} /> Bank Details
          </p>
          {Object.keys(bank).length > 0 ? (
            <div className="space-y-3">
              {bank.bankName && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Bank</span>
                  <span className="font-bold text-slate-800">{bank.bankName}</span>
                </div>
              )}
              {bank.accountNumber && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Account</span>
                  <span className="font-bold text-slate-800 font-mono">{bank.accountNumber}</span>
                </div>
              )}
              {bank.swift && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">SWIFT</span>
                  <span className="font-bold text-slate-800 font-mono">{bank.swift}</span>
                </div>
              )}
              {bank.iban && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">IBAN</span>
                  <span className="font-bold text-slate-800 font-mono text-xs">{bank.iban}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400 italic">No bank details on file.</p>
          )}
        </div>

        {/* Overdue Status Card */}
        <div
          className={`p-6 rounded-2xl shadow-lg flex flex-col justify-between ${
            overdueInvoices.length === 0
              ? "bg-emerald-600 shadow-emerald-100 text-white"
              : "bg-red-500 shadow-red-100 text-white"
          }`}
        >
          <p className="text-[11px] font-bold opacity-80 uppercase tracking-[0.15em] flex items-center gap-2">
            <Clock size={14} /> Overdue Status
          </p>
          <div className="flex items-center gap-3 mt-4">
            {overdueInvoices.length === 0 ? (
              <CheckCircle2 size={32} />
            ) : (
              <AlertTriangle size={32} />
            )}
            <div>
              <p className="font-bold text-lg">
                {overdueInvoices.length === 0 ? "All Current" : `${overdueInvoices.length} Overdue`}
              </p>
              <p className="text-sm opacity-80">
                {overdueInvoices.length === 0
                  ? "No overdue invoices for this supplier."
                  : `${supplier.currency} ${fmt(overdueAmount)} past due`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. INVOICES TABLE */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-slate-800 text-lg">Invoices</h3>
          <span className="text-xs text-slate-400 font-medium">
            {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} total
          </span>
        </div>

        {invoices.length === 0 ? (
          <div className="py-16 text-center">
            <FileText className="h-10 w-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 font-medium">No invoices for this supplier.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/50">
                <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                  <th className="px-6 py-4">Invoice #</th>
                  <th className="px-6 py-4">Date</th>
                  <th className="px-6 py-4">Due Date</th>
                  <th className="px-6 py-4">Description</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Net Amount</th>
                  <th className="px-6 py-4 text-right">Tax</th>
                  <th className="px-6 py-4 text-right">Gross</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoices.map((inv) => {
                  const st = STATUS_STYLES[inv.status] ?? STATUS_STYLES.DRAFT;
                  const days = daysUntil(inv.dueDate);
                  const isOverdue = !["PAID", "CANCELLED"].includes(inv.status) && days < 0;
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <Link
                          href={tenantHref(`/ap?invoice=${inv.id}`)}
                          className="font-bold text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1 text-sm"
                        >
                          {inv.invoiceNumber}
                          <ExternalLink size={12} />
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 tabular-nums whitespace-nowrap">
                        {fmtDate(inv.invoiceDate)}
                      </td>
                      <td className="px-6 py-4 text-sm tabular-nums whitespace-nowrap">
                        <span className={isOverdue ? "text-red-600 font-bold" : "text-slate-600"}>
                          {fmtDate(inv.dueDate)}
                        </span>
                        {isOverdue && (
                          <span className="text-[10px] text-red-500 ml-1">
                            ({Math.abs(days)}d late)
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500 italic max-w-xs truncate">
                        {(inv as any).description || "\u2014"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-0.5 rounded-full ${st.bg} ${st.text} text-[10px] font-bold uppercase tracking-wider`}
                        >
                          {st.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right tabular-nums">
                        <span className="font-bold text-slate-800">{fmt(inv.netAmount)}</span>
                      </td>
                      <td className="px-6 py-4 text-right tabular-nums text-slate-500">
                        {fmt(inv.taxAmount)}
                      </td>
                      <td className="px-6 py-4 text-right tabular-nums">
                        <span className="font-bold text-emerald-600">{fmt(inv.grossAmount)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50">
                <tr className="font-bold text-slate-800">
                  <td
                    colSpan={5}
                    className="px-6 py-4 text-right uppercase text-xs text-slate-400 tracking-[0.15em]"
                  >
                    Totals
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums border-t-2 border-emerald-500 text-slate-800">
                    {fmt(invoices.reduce((s, i) => s + Number(i.netAmount || 0), 0))}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums border-t-2 border-emerald-500 text-slate-500">
                    {fmt(invoices.reduce((s, i) => s + Number(i.taxAmount || 0), 0))}
                  </td>
                  <td className="px-6 py-4 text-right tabular-nums border-t-2 border-emerald-500 text-emerald-600">
                    {fmt(invoices.reduce((s, i) => s + Number(i.grossAmount || 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
