"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import {
  approveAPPaymentRun,
  confirmAPPaymentRun,
  createAPPaymentRunProposal,
  getAPPaymentRun,
  getAPPaymentRuns,
  getGLAccounts,
  getPaymentRunDownloadUrl,
  getSuppliers,
} from "../../../../lib/gl-api";

type PaymentRunSummary = {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  bankFileFormat: "SWIFT_MT103" | "SEPA_PAIN001" | "CSV";
  createdAt: string;
  items?: Array<{ id: string }>;
  payments?: Array<{ id: string }>;
};

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
    supplier: {
      id: string;
      name: string;
      code: string;
    };
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
  payments?: Array<{ id: string }>;
};

type AccountNode = {
  id: string;
  code: string;
  name: string;
  type: string;
  allowPosting: boolean;
  children?: AccountNode[];
};

type FlatAccount = {
  id: string;
  label: string;
  type: string;
  allowPosting: boolean;
};

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function flattenAccounts(nodes: AccountNode[], level = 0): FlatAccount[] {
  const output: FlatAccount[] = [];
  for (const node of nodes) {
    output.push({
      id: node.id,
      label: `${" ".repeat(level * 2)}${node.code} - ${node.name}`,
      type: node.type,
      allowPosting: node.allowPosting
    });
    if (node.children?.length) {
      output.push(...flattenAccounts(node.children, level + 1));
    }
  }
  return output;
}

export default function APPaymentRunsPage() {
  const apiContext = useApiContext();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return toDateInputValue(d);
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return toDateInputValue(d);
  });
  const [bankFileFormat, setBankFileFormat] = useState<"SWIFT_MT103" | "SEPA_PAIN001" | "CSV">(
    "CSV"
  );
  const [includeApproved, setIncludeApproved] = useState(true);
  const [includePosted, setIncludePosted] = useState(true);
  const [bankAccountId, setBankAccountId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"BANK_TRANSFER" | "CHEQUE" | "CARD" | "CASH">(
    "BANK_TRANSFER"
  );
  const [referencePrefix, setReferencePrefix] = useState("PAYRUN");
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const [feedback, setFeedback] = useState<string>("");

  const runsQuery = useQuery({
    queryKey: ["ap-payment-runs", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) {
        return [];
      }
      const response = await getAPPaymentRuns(apiContext, { limit: 100 });
      return (response.data as unknown as PaymentRunSummary[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const detailQuery = useQuery({
    queryKey: ["ap-payment-run", apiContext?.entityId, selectedRunId],
    queryFn: async () => {
      if (!apiContext || !selectedRunId) {
        return null;
      }
      const response = await getAPPaymentRun(apiContext, selectedRunId);
      return response.data as PaymentRunDetail;
    },
    enabled: Boolean(apiContext && selectedRunId)
  });

  const accountsQuery = useQuery({
    queryKey: ["gl-accounts", apiContext?.entityId, "ap-payment-runs"],
    queryFn: async () => {
      if (!apiContext) {
        return [];
      }
      const response = await getGLAccounts(apiContext);
      return (response.data as unknown as AccountNode[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const suppliersQuery = useQuery({
    queryKey: ["ap-suppliers", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const response = await getSuppliers(apiContext);
      return (response.data as unknown as Array<{ id: string; code: string; name: string; isActive: boolean }>) ?? [];
    },
    enabled: Boolean(apiContext),
  });

  const activeSuppliers = useMemo(
    () => (suppliersQuery.data ?? []).filter((s) => s.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [suppliersQuery.data]
  );

  const bankAccounts = useMemo(
    () =>
      flattenAccounts(accountsQuery.data ?? []).filter(
        (account) => account.type === "ASSET" && account.allowPosting
      ),
    [accountsQuery.data]
  );

  const proposeMutation = useMutation({
    mutationFn: async () => {
      if (!apiContext) {
        throw new Error("Missing API context.");
      }
      const response = await createAPPaymentRunProposal(apiContext, {
        startDate,
        endDate,
        bankFileFormat,
        includeApproved,
        includePosted,
        ...(selectedSupplierIds.length > 0 ? { supplierIds: selectedSupplierIds } : {}),
      });
      return response.data as PaymentRunDetail;
    },
    onSuccess: async (run) => {
      setFeedback(`Payment run ${run.id} proposed.`);
      setSelectedRunId(run.id);
      await queryClient.invalidateQueries({ queryKey: ["ap-payment-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["ap-payment-run"] });
    },
    onError: (error) => {
      setFeedback((error as Error).message);
    }
  });

  const approveMutation = useMutation({
    mutationFn: async (runId: string) => {
      if (!apiContext) {
        throw new Error("Missing API context.");
      }
      const response = await approveAPPaymentRun(apiContext, runId);
      return response.data as PaymentRunDetail;
    },
    onSuccess: async (run) => {
      setFeedback(`Payment run ${run.id} approved.`);
      setSelectedRunId(run.id);
      await queryClient.invalidateQueries({ queryKey: ["ap-payment-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["ap-payment-run"] });
    },
    onError: (error) => {
      setFeedback((error as Error).message);
    }
  });

  const confirmMutation = useMutation({
    mutationFn: async (runId: string) => {
      if (!apiContext) {
        throw new Error("Missing API context.");
      }
      const response = await confirmAPPaymentRun(apiContext, runId, {
        bankAccountId,
        paymentMethod,
        referencePrefix
      });
      return response.data as PaymentRunDetail;
    },
    onSuccess: async (run) => {
      setFeedback(`Payment run ${run.id} processed.`);
      setSelectedRunId(run.id);
      await queryClient.invalidateQueries({ queryKey: ["ap-payment-runs"] });
      await queryClient.invalidateQueries({ queryKey: ["ap-payment-run"] });
    },
    onError: (error) => {
      setFeedback((error as Error).message);
    }
  });

  const selectedRun = detailQuery.data as PaymentRunDetail | null;

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: selectedRunId ? "1fr 420px" : "1fr",
        gap: "1rem"
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "1rem",
          boxShadow: "0 10px 24px rgba(15,45,94,.07)"
        }}
      >
        <header style={{ marginBottom: "0.85rem" }}>
          <h2 style={{ margin: 0, color: "#0f2d5e" }}>AP Payment Runs</h2>
          <p style={{ marginTop: "0.3rem", marginBottom: 0, color: "#475569" }}>
            Propose, approve, and confirm supplier disbursement batches.
          </p>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,minmax(160px,1fr))",
            gap: "0.65rem",
            marginBottom: "0.75rem"
          }}
        >
          <label>
            <span>Start Date</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              style={{ width: "100%", marginTop: "0.2rem" }}
            />
          </label>
          <label>
            <span>End Date</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              style={{ width: "100%", marginTop: "0.2rem" }}
            />
          </label>
          <label>
            <span>Bank File Format</span>
            <select
              value={bankFileFormat}
              onChange={(event) =>
                setBankFileFormat(
                  event.target.value as "SWIFT_MT103" | "SEPA_PAIN001" | "CSV"
                )
              }
              style={{ width: "100%", marginTop: "0.2rem" }}
            >
              <option value="CSV">CSV</option>
              <option value="SWIFT_MT103">SWIFT MT103</option>
              <option value="SEPA_PAIN001">SEPA pain.001</option>
            </select>
          </label>
        </div>

        <div style={{ marginBottom: "0.75rem" }}>
          <label style={{ display: "block", marginBottom: "0.3rem" }}>
            <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>Pay Supplier</span>
          </label>

          {/* Selected suppliers as removable tags */}
          {selectedSupplierIds.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: "0.4rem" }}>
              {selectedSupplierIds.map((id) => {
                const s = activeSuppliers.find((sup) => sup.id === id);
                return (
                  <span
                    key={id}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.3rem",
                      padding: "0.2rem 0.5rem",
                      backgroundColor: "#ecfdf5",
                      border: "1px solid #0e7c7b",
                      borderRadius: "6px",
                      fontSize: "0.8rem",
                      fontWeight: 600,
                      color: "#065f46",
                    }}
                  >
                    {s ? `${s.code} — ${s.name}` : id.slice(0, 8)}
                    <button
                      type="button"
                      onClick={() => setSelectedSupplierIds((prev) => prev.filter((x) => x !== id))}
                      style={{
                        border: 0,
                        background: "none",
                        cursor: "pointer",
                        color: "#065f46",
                        fontWeight: 700,
                        fontSize: "0.9rem",
                        lineHeight: 1,
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedSupplierIds([])}
                style={{
                  border: 0,
                  background: "none",
                  color: "#6b7280",
                  fontSize: "0.78rem",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Clear all
              </button>
            </div>
          )}

          {/* Search input with dropdown */}
          <div style={{ position: "relative" }}>
            <input
              type="text"
              placeholder={selectedSupplierIds.length > 0 ? "Add another supplier..." : "Search supplier by name or code..."}
              value={supplierSearch}
              onChange={(e) => {
                setSupplierSearch(e.target.value);
                setSupplierDropdownOpen(true);
              }}
              onFocus={() => setSupplierDropdownOpen(true)}
              style={{
                width: "100%",
                padding: "0.45rem 0.65rem",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                fontSize: "0.85rem",
              }}
            />
            {supplierDropdownOpen && supplierSearch.length > 0 && (() => {
              const q = supplierSearch.toLowerCase();
              const matches = activeSuppliers.filter(
                (s) =>
                  !selectedSupplierIds.includes(s.id) &&
                  (s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
              );
              if (matches.length === 0) return null;
              return (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    zIndex: 50,
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    boxShadow: "0 8px 20px rgba(0,0,0,.12)",
                    maxHeight: "200px",
                    overflowY: "auto",
                    marginTop: "2px",
                  }}
                >
                  {matches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSelectedSupplierIds((prev) => [...prev, s.id]);
                        setSupplierSearch("");
                        setSupplierDropdownOpen(false);
                      }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "0.45rem 0.65rem",
                        border: 0,
                        background: "none",
                        fontSize: "0.85rem",
                        cursor: "pointer",
                        borderBottom: "1px solid #f1f5f9",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f0fdf4"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "transparent"; }}
                    >
                      <span style={{ fontWeight: 600, color: "#0f2d5e" }}>{s.code}</span>
                      <span style={{ color: "#475569" }}> — {s.name}</span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
          {selectedSupplierIds.length === 0 && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "#94a3b8" }}>
              Leave empty to include all suppliers
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: "1rem", alignItems: "center", marginBottom: "0.8rem" }}>
          <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={includeApproved}
              onChange={(event) => setIncludeApproved(event.target.checked)}
            />
            Include APPROVED
          </label>
          <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={includePosted}
              onChange={(event) => setIncludePosted(event.target.checked)}
            />
            Include POSTED
          </label>
          <button
            onClick={() => proposeMutation.mutate()}
            disabled={proposeMutation.isPending}
            style={{
              border: 0,
              borderRadius: "8px",
              backgroundColor: "#0e7c7b",
              color: "#fff",
              padding: "0.45rem 0.8rem",
              cursor: "pointer"
            }}
          >
            {proposeMutation.isPending ? "Proposing..." : "Propose Run"}
          </button>
        </div>

        {feedback ? (
          <p style={{ color: feedback.includes("processed") || feedback.includes("approved") || feedback.includes("proposed") ? "#047857" : "#b91c1c" }}>
            {feedback}
          </p>
        ) : null}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "0.5rem" }}>
                  Run
                </th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "0.5rem" }}>
                  Date Window
                </th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "0.5rem" }}>
                  Status
                </th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "0.5rem" }}>
                  Items
                </th>
              </tr>
            </thead>
            <tbody>
              {(runsQuery.data ?? []).map((run) => (
                <tr
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  style={{
                    cursor: "pointer",
                    backgroundColor: selectedRunId === run.id ? "#ecfeff" : "transparent"
                  }}
                >
                  <td style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem", fontFamily: "monospace" }}>
                    {run.id.slice(0, 12)}
                  </td>
                  <td style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem" }}>
                    {new Date(run.startDate).toLocaleDateString()} -{" "}
                    {new Date(run.endDate).toLocaleDateString()}
                  </td>
                  <td style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem" }}>{run.status}</td>
                  <td style={{ borderBottom: "1px solid #f1f5f9", padding: "0.5rem" }}>
                    {run.items?.length ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {runsQuery.isLoading ? <p>Loading payment runs...</p> : null}
          {runsQuery.isError ? <p style={{ color: "#b91c1c" }}>{(runsQuery.error as Error).message}</p> : null}
        </div>
      </div>

      {selectedRunId ? (
        <aside
          style={{
            background: "#fff",
            borderRadius: "12px",
            padding: "1rem",
            boxShadow: "0 10px 24px rgba(15,45,94,.07)",
            height: "fit-content",
            position: "sticky",
            top: "1rem"
          }}
        >
          <h3 style={{ marginTop: 0 }}>Run Detail</h3>
          {detailQuery.isLoading ? <p>Loading detail...</p> : null}
          {detailQuery.isError ? <p style={{ color: "#b91c1c" }}>{(detailQuery.error as Error).message}</p> : null}

          {selectedRun ? (
            <div style={{ fontSize: "0.92rem" }}>
              <p>
                <strong>Status:</strong> {selectedRun.status}
              </p>
              <p>
                <strong>Format:</strong> {selectedRun.bankFileFormat}
              </p>
              <p>
                <strong>Items:</strong> {selectedRun.items.length}
              </p>
              <p>
                <strong>Invoices:</strong> {selectedRun.invoices.length}
              </p>
              {selectedRun.bankFilePath ? (
                <div className="my-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0f2d5e] text-white rounded-lg text-sm font-semibold hover:bg-[#1a3f7a] transition-colors"
                    onClick={async () => {
                      if (!apiContext) return;
                      const url = getPaymentRunDownloadUrl(selectedRunId!);
                      const res = await fetch(url, {
                        headers: {
                          Authorization: `Bearer ${apiContext.accessToken}`,
                          "X-Entity-ID": apiContext.entityId,
                        },
                      });
                      if (!res.ok) return;
                      const blob = await res.blob();
                      const ext = selectedRun.bankFileFormat === "CSV" ? "csv" : selectedRun.bankFileFormat === "SEPA_PAIN001" ? "xml" : "mt103";
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `payment-run-${selectedRunId!.slice(0, 8)}.${ext}`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                  >
                    Download Bank File ({selectedRun.bankFileFormat})
                  </button>
                </div>
              ) : (
                <p><strong>Bank File:</strong> -</p>
              )}

              <details>
                <summary>Suppliers</summary>
                <ul style={{ paddingLeft: "1rem" }}>
                  {selectedRun.items.map((item) => (
                    <li key={item.id}>
                      {item.supplier.name} ({item.currency}) - payable {item.payableAmount}
                    </li>
                  ))}
                </ul>
              </details>

              <details>
                <summary>Invoices</summary>
                <ul style={{ paddingLeft: "1rem" }}>
                  {selectedRun.invoices.map((row) => (
                    <li key={row.id}>
                      {row.invoice.supplier.code} / {row.invoice.invoiceNumber} /{" "}
                      {row.allocatedAmount}
                      {row.isCreditNote ? " (credit)" : ""}
                    </li>
                  ))}
                </ul>
              </details>

              {selectedRun.status === "PROPOSED" ? (
                <button
                  onClick={() => approveMutation.mutate(selectedRun.id)}
                  disabled={approveMutation.isPending}
                  style={{
                    marginTop: "0.7rem",
                    border: 0,
                    borderRadius: "8px",
                    backgroundColor: "#0369a1",
                    color: "#fff",
                    padding: "0.45rem 0.8rem",
                    cursor: "pointer"
                  }}
                >
                  {approveMutation.isPending ? "Approving..." : "Approve Run"}
                </button>
              ) : null}

              {selectedRun.status === "APPROVED" ? (
                <div style={{ marginTop: "0.8rem", borderTop: "1px solid #e2e8f0", paddingTop: "0.75rem" }}>
                  <h4 style={{ marginTop: 0, marginBottom: "0.45rem" }}>Confirm & Process</h4>
                  <label style={{ display: "block", marginBottom: "0.45rem" }}>
                    <span>Bank Account</span>
                    <select
                      value={bankAccountId}
                      onChange={(event) => setBankAccountId(event.target.value)}
                      style={{ width: "100%", marginTop: "0.2rem" }}
                    >
                      <option value="">Select bank account</option>
                      {bankAccounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.45rem" }}>
                    <span>Payment Method</span>
                    <select
                      value={paymentMethod}
                      onChange={(event) =>
                        setPaymentMethod(
                          event.target.value as "BANK_TRANSFER" | "CHEQUE" | "CARD" | "CASH"
                        )
                      }
                      style={{ width: "100%", marginTop: "0.2rem" }}
                    >
                      <option value="BANK_TRANSFER">Bank Transfer</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="CARD">Card</option>
                      <option value="CASH">Cash</option>
                    </select>
                  </label>
                  <label style={{ display: "block", marginBottom: "0.6rem" }}>
                    <span>Reference Prefix</span>
                    <input
                      value={referencePrefix}
                      onChange={(event) => setReferencePrefix(event.target.value)}
                      style={{ width: "100%", marginTop: "0.2rem" }}
                    />
                  </label>
                  <button
                    onClick={() => confirmMutation.mutate(selectedRun.id)}
                    disabled={confirmMutation.isPending || !bankAccountId}
                    style={{
                      border: 0,
                      borderRadius: "8px",
                      backgroundColor: "#15803d",
                      color: "#fff",
                      padding: "0.45rem 0.8rem",
                      cursor: "pointer"
                    }}
                  >
                    {confirmMutation.isPending ? "Processing..." : "Confirm & Process"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>
      ) : null}
    </section>
  );
}
