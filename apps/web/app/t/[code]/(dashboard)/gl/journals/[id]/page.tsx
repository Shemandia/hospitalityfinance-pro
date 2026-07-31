"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useTenantHref } from "../../../../../../../hooks/use-tenant-router";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Printer,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Send,
  Clock,
  FileText,
  History,
  AlertTriangle
} from "lucide-react";
import { useApiContext } from "../../../../../../../components/use-api-context";
import {
  getGLJournal,
  postGLJournal,
  approveGLJournal,
  rejectGLJournal,
  reverseGLJournal,
  type JournalDetail
} from "../../../../../../../lib/gl-api";
import { fmtDecimal, fmtDate, fmtDateTime } from "../../../../../../../lib/format";
import { ConfirmDialog } from "../../../../../../../components/confirm-dialog";

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: "bg-slate-100", text: "text-slate-600", label: "Draft" },
  PENDING_APPROVAL: { bg: "bg-amber-100", text: "text-amber-700", label: "Pending Approval" },
  POSTED: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Posted" },
  REJECTED: { bg: "bg-red-100", text: "text-red-700", label: "Rejected" },
  REVERSED: { bg: "bg-purple-100", text: "text-purple-700", label: "Reversed" }
};

export default function JournalDetailPage() {
  const params = useParams();
  const tenantHref = useTenantHref();
  const apiContext = useApiContext();
  const queryClient = useQueryClient();
  const journalId = params.id as string;
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  const journalQ = useQuery({
    queryKey: ["journal", journalId, apiContext?.entityId],
    queryFn: () =>
      apiContext ? getGLJournal(apiContext, journalId) : Promise.reject("No context"),
    enabled: Boolean(apiContext && journalId),
    select: (r) => r.data as unknown as JournalDetail
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["journal", journalId] });
    queryClient.invalidateQueries({ queryKey: ["journals"] });
  };

  const postMut = useMutation({
    mutationFn: () => postGLJournal(apiContext!, journalId),
    onSuccess: invalidate
  });
  const approveMut = useMutation({
    mutationFn: () => approveGLJournal(apiContext!, journalId),
    onSuccess: invalidate
  });
  const rejectMut = useMutation({
    mutationFn: () => rejectGLJournal(apiContext!, journalId),
    onSuccess: invalidate
  });
  const reverseMut = useMutation({
    mutationFn: () => reverseGLJournal(apiContext!, journalId),
    onSuccess: invalidate
  });

  const isLoading =
    postMut.isPending || approveMut.isPending || rejectMut.isPending || reverseMut.isPending;

  if (journalQ.isLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="h-8 w-48 bg-slate-100 rounded-xl animate-pulse" />
        <div className="h-48 bg-white rounded-3xl border border-slate-100 animate-pulse" />
        <div className="grid grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 bg-white rounded-2xl border border-slate-100 animate-pulse"
            />
          ))}
        </div>
        <div className="h-64 bg-white rounded-3xl border border-slate-100 animate-pulse" />
      </div>
    );
  }

  if (journalQ.isError || !journalQ.data) {
    return (
      <div className="max-w-5xl mx-auto">
        <Link
          href={tenantHref("/gl/journals")}
          className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors mb-6"
        >
          <ArrowLeft size={18} />
          <span className="font-medium">Back to Journals</span>
        </Link>
        <div className="bg-white rounded-3xl p-12 border border-slate-100 text-center">
          <AlertTriangle className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <p className="text-lg font-bold text-slate-800">Journal not found</p>
          <p className="text-sm text-slate-500 mt-1">The journal entry could not be loaded.</p>
        </div>
      </div>
    );
  }

  const journal = journalQ.data;
  const status = STATUS_STYLES[journal.status] ?? STATUS_STYLES.DRAFT;

  // Compute totals
  const totalDebit = journal.lines.reduce((s, l) => s + parseFloat(l.debitFunctional || "0"), 0);
  const totalCredit = journal.lines.reduce((s, l) => s + parseFloat(l.creditFunctional || "0"), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const canPost = journal.status === "DRAFT";
  const canApprove = journal.status === "PENDING_APPROVAL";
  const canReject = journal.status === "PENDING_APPROVAL";
  const canReverse = journal.status === "POSTED";

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      {/* 1. TOP NAVIGATION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <Link
          href={tenantHref("/gl/journals")}
          className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors"
        >
          <ArrowLeft size={18} />
          <span className="font-medium">Back to Journals</span>
        </Link>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-600 hover:bg-slate-50 font-medium text-sm transition-colors"
          >
            <Printer size={16} /> Print
          </button>
          {canPost && (
            <button
              onClick={() => setConfirmAction("post")}
              disabled={isLoading}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all text-sm disabled:opacity-50"
            >
              <Send size={16} /> Submit for Approval
            </button>
          )}
          {canApprove && (
            <>
              <button
                onClick={() => setConfirmAction("reject")}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 border border-red-200 rounded-xl bg-white text-red-600 hover:bg-red-50 font-medium text-sm transition-colors disabled:opacity-50"
              >
                <XCircle size={16} /> Reject
              </button>
              <button
                onClick={() => setConfirmAction("approve")}
                disabled={isLoading}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all text-sm disabled:opacity-50"
              >
                <CheckCircle2 size={16} /> Approve Journal
              </button>
            </>
          )}
          {canReverse && (
            <button
              onClick={() => setConfirmAction("reverse")}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 border border-purple-200 rounded-xl bg-white text-purple-600 hover:bg-purple-50 font-medium text-sm transition-colors disabled:opacity-50"
            >
              <RotateCcw size={16} /> Reverse
            </button>
          )}
        </div>
      </div>

      {/* 2. HEADER CARD */}
      <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 border border-slate-100 shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-slate-900">
              {journal.reference || `Journal ${journalId.slice(0, 8)}`}
            </h1>
            <span
              className={`px-3 py-1 rounded-full ${status.bg} ${status.text} text-xs font-bold uppercase tracking-wider`}
            >
              {status.label}
            </span>
          </div>
          <p className="text-slate-500">{journal.description || "No description"}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-slate-400 font-medium">Total Amount</p>
          <p className="text-3xl font-bold text-emerald-600 tabular-nums">
            {journal.functionalCurrency} {fmtDecimal(totalDebit)}
          </p>
        </div>
      </div>

      {/* 3. INFORMATION GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Metadata */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
            <FileText size={14} /> Metadata
          </p>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Period</span>
              <span className="font-bold text-slate-800">{journal.period?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Source</span>
              <span className="font-bold text-slate-800">{journal.source}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Currency</span>
              <span className="font-bold text-slate-800">{journal.functionalCurrency}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Lines</span>
              <span className="font-bold text-slate-800">{journal.lines.length}</span>
            </div>
          </div>
        </div>

        {/* Audit Trail */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
            <History size={14} /> Audit Trail
          </p>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Created</span>
              <span className="font-bold text-slate-800">{fmtDate(journal.createdAt)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Posted</span>
              <span className="font-bold text-slate-800">
                {journal.postedAt ? fmtDateTime(journal.postedAt) : "—"}
              </span>
            </div>
            {journal.approvals.length > 0 &&
              journal.approvals.map((a) => (
                <div key={a.id} className="flex justify-between text-sm">
                  <span className="text-slate-500">
                    {a.status === "APPROVED" ? "Approved by" : "Reviewed by"}
                  </span>
                  <span
                    className={`font-bold ${a.status === "APPROVED" ? "text-emerald-600" : "text-slate-800"}`}
                  >
                    {a.approver.name}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {/* Status Card */}
        <div
          className={`p-6 rounded-2xl shadow-lg flex flex-col justify-between ${
            isBalanced
              ? "bg-emerald-600 shadow-emerald-100 text-white"
              : "bg-red-500 shadow-red-100 text-white"
          }`}
        >
          <p className="text-[11px] font-bold opacity-80 uppercase tracking-[0.15em] flex items-center gap-2">
            <Clock size={14} /> Balance Check
          </p>
          <div className="flex items-center gap-3 mt-4">
            {isBalanced ? <CheckCircle2 size={32} /> : <AlertTriangle size={32} />}
            <div>
              <p className="font-bold text-lg">{isBalanced ? "Balanced" : "Not Balanced"}</p>
              <p className="text-sm opacity-80">
                {isBalanced
                  ? "Debits and credits match perfectly."
                  : `Difference: ${fmtDecimal(Math.abs(totalDebit - totalCredit))}`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 4. JOURNAL LINES TABLE */}
      <div className="bg-white rounded-2xl sm:rounded-3xl border border-slate-100 shadow-sm overflow-x-auto">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-slate-800 text-lg">Journal Lines</h3>
          <span className="text-xs text-slate-400 font-medium">
            {journal.lines.length} line{journal.lines.length !== 1 ? "s" : ""} total
          </span>
        </div>
        <table className="w-full text-left">
          <thead className="bg-slate-50/50">
            <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em]">
              <th className="px-8 py-4">#</th>
              <th className="px-8 py-4">Account</th>
              <th className="px-8 py-4">Description</th>
              <th className="px-8 py-4">Currency</th>
              <th className="px-8 py-4 text-right">Debit</th>
              <th className="px-8 py-4 text-right">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {journal.lines
              .sort((a, b) => a.lineNumber - b.lineNumber)
              .map((line) => {
                const debit = parseFloat(line.debitFunctional || "0");
                const credit = parseFloat(line.creditFunctional || "0");
                return (
                  <tr key={line.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-8 py-5 text-sm text-slate-400 tabular-nums">
                      {line.lineNumber}
                    </td>
                    <td className="px-8 py-5">
                      <p className="font-bold text-slate-800">{line.account.code}</p>
                      <p className="text-xs text-slate-500">{line.account.name}</p>
                    </td>
                    <td className="px-8 py-5 text-sm text-slate-500 italic">
                      {line.description || "—"}
                    </td>
                    <td className="px-8 py-5 text-sm text-slate-500 font-mono">
                      {line.currency}
                      {line.fxRate !== "1" && (
                        <span className="text-xs text-slate-400 ml-1">@{line.fxRate}</span>
                      )}
                    </td>
                    <td className="px-8 py-5 text-right tabular-nums">
                      {debit > 0 ? (
                        <span className="font-bold text-emerald-600">{fmtDecimal(debit)}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-8 py-5 text-right tabular-nums">
                      {credit > 0 ? (
                        <span className="font-bold text-slate-800">{fmtDecimal(credit)}</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
          <tfoot className="bg-slate-50">
            <tr className="font-bold text-slate-800">
              <td
                colSpan={4}
                className="px-8 py-4 text-right uppercase text-xs text-slate-400 tracking-[0.15em]"
              >
                Balance Check
              </td>
              <td
                className={`px-8 py-4 text-right tabular-nums border-t-2 ${isBalanced ? "border-emerald-500 text-emerald-600" : "border-red-400 text-red-600"}`}
              >
                {fmtDecimal(totalDebit)}
              </td>
              <td
                className={`px-8 py-4 text-right tabular-nums border-t-2 ${isBalanced ? "border-emerald-500 text-emerald-600" : "border-red-400 text-red-600"}`}
              >
                {fmtDecimal(totalCredit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Approval History */}
      {journal.approvals.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] mb-4">
            Approval History
          </p>
          <div className="space-y-3">
            {journal.approvals.map((a) => (
              <div key={a.id} className="flex items-center gap-4 text-sm">
                <span
                  className={`h-2 w-2 rounded-full ${a.status === "APPROVED" ? "bg-emerald-500" : a.status === "REJECTED" ? "bg-red-500" : "bg-amber-500"}`}
                />
                <span className="font-medium text-slate-800">{a.approver.name}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${
                    a.status === "APPROVED"
                      ? "bg-emerald-100 text-emerald-700"
                      : a.status === "REJECTED"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {a.status}
                </span>
                {a.reason && <span className="text-slate-500 italic">"{a.reason}"</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={confirmAction === "post"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Submit for Approval"
        description={`This will submit journal "${journal.reference}" for approval. It will no longer be editable.`}
        confirmLabel="Submit"
        onConfirm={() => postMut.mutate()}
        loading={postMut.isPending}
      />
      <ConfirmDialog
        open={confirmAction === "approve"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Approve Journal"
        description={`This will approve and post journal "${journal.reference}" to the general ledger. This action cannot be undone.`}
        confirmLabel="Approve & Post"
        onConfirm={() => approveMut.mutate()}
        loading={approveMut.isPending}
      />
      <ConfirmDialog
        open={confirmAction === "reject"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Reject Journal"
        description={`This will reject journal "${journal.reference}". The submitter will be notified.`}
        confirmLabel="Reject"
        variant="destructive"
        onConfirm={() => rejectMut.mutate()}
        loading={rejectMut.isPending}
      />
      <ConfirmDialog
        open={confirmAction === "reverse"}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Reverse Journal"
        description={`This will create a reversal entry for journal "${journal.reference}". The original journal will be marked as reversed.`}
        confirmLabel="Reverse"
        variant="destructive"
        onConfirm={() => reverseMut.mutate()}
        loading={reverseMut.isPending}
      />
    </div>
  );
}
