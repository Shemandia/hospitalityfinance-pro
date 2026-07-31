"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useTenantHref, useTenantRouter } from "../../../../../../../hooks/use-tenant-router";
import { useApiContext } from "../../../../../../../components/use-api-context";
import { createGLJournal, getGLAccountTree, getPeriods } from "../../../../../../../lib/gl-api";
import { apiFetch } from "../../../../../../../lib/api-client";
import {
  Trash2,
  Plus,
  Search,
  ChevronsUpDown,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Save,
  Send
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type AccountNode = {
  id: string;
  code: string;
  name: string;
  allowPosting: boolean;
  children?: AccountNode[];
};
type FlatAccount = { id: string; code: string; name: string; label: string };
type JournalTypeOption = {
  id: string;
  code: string;
  name: string;
  allowedSources: string[];
  requireBalance: boolean;
};

function flattenPostableAccounts(nodes: AccountNode[], depth = 0): FlatAccount[] {
  const result: FlatAccount[] = [];
  for (const node of nodes) {
    if (node.allowPosting) {
      result.push({
        id: node.id,
        code: node.code,
        name: node.name,
        label: `${node.code} – ${node.name}`
      });
    }
    if (node.children?.length) result.push(...flattenPostableAccounts(node.children, depth + 1));
  }
  return result;
}

// ── Account search combobox ────────────────────────────────────────────────────

function AccountPicker({
  value,
  onChange,
  accounts,
  placeholder = "Search account by code or name..."
}: {
  value: string;
  onChange: (id: string) => void;
  accounts: FlatAccount[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selected = useMemo(() => accounts.find((a) => a.id === value), [accounts, value]);

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
        // Also check if click is inside the fixed dropdown
        const dropdown = document.getElementById("account-dropdown-portal");
        if (dropdown && dropdown.contains(e.target as Node)) return;
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function openDropdown() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 360)
      });
    }
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        className="flex w-full items-center gap-2 bg-transparent text-sm outline-none border-b border-transparent focus:border-emerald-500 transition-colors py-1"
      >
        <Search size={14} className="text-slate-300 shrink-0" />
        {selected ? (
          <span className="truncate">
            <span className="font-mono text-slate-400">{selected.code}</span>{" "}
            <span className="text-slate-700">{selected.name}</span>
          </span>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
      </button>

      {open && (
        <div
          id="account-dropdown-portal"
          className="fixed z-[9999] rounded-xl border border-slate-200 bg-white shadow-2xl"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
        >
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type code or name..."
              className="flex-1 text-sm outline-none bg-transparent"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-slate-400">No accounts found</li>
            ) : (
              filtered.map((a) => (
                <li
                  key={a.id}
                  onMouseDown={() => select(a.id)}
                  className={`flex items-center gap-3 px-4 py-2 cursor-pointer text-sm hover:bg-emerald-50 transition-colors ${value === a.id ? "bg-emerald-50 font-medium" : ""}`}
                >
                  <span className="font-mono text-slate-400 w-14 shrink-0">{a.code}</span>
                  <span className="truncate text-slate-700">{a.name}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Helper: Form Group ──────────────────────────────────────────────────────────

function FormGroup({
  label,
  required,
  children,
  error
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] ml-1">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-500 ml-1">{error}</p>}
    </div>
  );
}

// ── Zod schema ─────────────────────────────────────────────────────────────────

const lineSchema = z.object({
  accountId: z.string().min(1, "Account required"),
  debit: z.string(),
  credit: z.string(),
  currency: z.string().length(3),
  fxRate: z.string(),
  description: z.string()
});

const formSchema = z.object({
  periodId: z.string().min(1, "Period required"),
  journalTypeId: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().optional(),
  source: z.string().min(1),
  functionalCurrency: z.string().length(3),
  lines: z.array(lineSchema).min(1, "At least 1 line required"),
  sourceOverrideReason: z.string().optional()
});

type FormValues = z.infer<typeof formSchema>;

const INPUT_CLASS =
  "w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none transition-all focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500";
const SELECT_CLASS = `${INPUT_CLASS} cursor-pointer`;

// ── Page ───────────────────────────────────────────────────────────────────────

export default function NewJournalPage() {
  const apiContext = useApiContext();
  const router = useTenantRouter();
  const tenantHref = useTenantHref();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      source: "MANUAL",
      journalTypeId: "",
      functionalCurrency: "USD",
      sourceOverrideReason: "",
      lines: [
        { accountId: "", debit: "0", credit: "0", currency: "USD", fxRate: "1", description: "" },
        { accountId: "", debit: "0", credit: "0", currency: "USD", fxRate: "1", description: "" }
      ]
    }
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const linesWatch = form.watch("lines");

  const totals = useMemo(() => {
    const toInt = (s: string) => Math.round(parseFloat(s || "0") * 100);
    const debitCents = linesWatch.reduce((s: number, l) => s + toInt(l.debit), 0);
    const creditCents = linesWatch.reduce((s: number, l) => s + toInt(l.credit), 0);
    return {
      debit: debitCents / 100,
      credit: creditCents / 100,
      balanced: debitCents === creditCents
    };
  }, [linesWatch]);

  const accountsQuery = useQuery({
    queryKey: ["accounts-tree", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const r = await getGLAccountTree(apiContext);
      return (r.data as unknown as AccountNode[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const periodsQuery = useQuery({
    queryKey: ["periods", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const r = await getPeriods(apiContext);
      return (r.data as unknown as Array<{ id: string; name: string; status: string }>) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const journalTypesQuery = useQuery({
    queryKey: ["journal-types", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await apiFetch("/api/v1/gl/journal-types", apiContext);
      if (!res.ok) return [];
      const r = await res.json();
      return (r.data ?? []) as JournalTypeOption[];
    },
    enabled: Boolean(apiContext)
  });

  const journalTypes = journalTypesQuery.data ?? [];
  const flatAccounts = useMemo(
    () => flattenPostableAccounts(accountsQuery.data ?? []),
    [accountsQuery.data]
  );
  const openPeriods = useMemo(
    () => (periodsQuery.data ?? []).filter((p) => p.status === "OPEN"),
    [periodsQuery.data]
  );

  const createMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!apiContext) throw new Error("Missing API context.");
      const payload: Record<string, unknown> = {
        ...values,
        lines: values.lines.map((l: z.infer<typeof lineSchema>, i: number) => ({
          ...l,
          lineNumber: i + 1
        }))
      };
      if (!values.sourceOverrideReason?.trim()) delete payload.sourceOverrideReason;
      if (!values.journalTypeId) delete payload.journalTypeId;
      return createGLJournal(apiContext, payload);
    },
    onSuccess: (r) => {
      const id = (r.data as { id?: string }).id;
      const status = (r.data as { status?: string }).status;
      setSuccessMsg(`Journal created with status ${status ?? "DRAFT"}.`);
      setErrorMsg(null);
      if (id) {
        setTimeout(() => router.push(`/gl/journals/${id}`), 800);
      }
    },
    onError: (e) => {
      setErrorMsg((e as Error).message);
      setSuccessMsg(null);
    }
  });

  const fmtAmount = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="max-w-6xl mx-auto pb-20 px-0 sm:px-0">
      {/* 1. TOP NAV & TITLE */}
      <div className="flex justify-between items-end mb-8">
        <div className="space-y-2">
          <Link
            href={tenantHref("/gl/journals")}
            className="group flex items-center gap-2 text-slate-400 hover:text-emerald-600 transition-colors text-sm font-medium"
          >
            <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
            Back to Journal List
          </Link>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">New Journal Entry</h1>
          <p className="text-slate-500">
            Record financial adjustments for the current reporting period.
          </p>
        </div>

        <div className="hidden md:flex flex-col items-end gap-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] leading-none">
            Journal Status
          </span>
          <div
            className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold border ${
              totals.balanced
                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                : "bg-red-50 text-red-600 border-red-100"
            }`}
          >
            {totals.balanced ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {totals.balanced ? "Balanced" : "Unbalanced"}
          </div>
        </div>
      </div>

      {/* 2. FORM CONTAINER */}
      <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))}>
        <div className="bg-white rounded-2xl sm:rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
          {/* Header Metadata Section */}
          <div className="p-8 lg:p-10 border-b border-slate-100">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <FormGroup label="Period" required error={form.formState.errors.periodId?.message}>
                <select
                  {...form.register("periodId")}
                  className={`${SELECT_CLASS} bg-slate-50 font-semibold text-slate-700`}
                >
                  <option value="">Select period...</option>
                  {openPeriods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (Open)
                    </option>
                  ))}
                  {(periodsQuery.data ?? [])
                    .filter((p) => p.status !== "OPEN")
                    .map((p) => (
                      <option key={p.id} value={p.id} disabled>
                        {p.name} ({p.status})
                      </option>
                    ))}
                </select>
              </FormGroup>

              <FormGroup label="Journal Type">
                <select
                  value={form.watch("journalTypeId") ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || undefined;
                    form.setValue("journalTypeId", id);
                    if (id) {
                      const jt = journalTypes.find((t) => t.id === id);
                      if (jt?.allowedSources?.length === 1)
                        form.setValue("source", jt.allowedSources[0]);
                    }
                  }}
                  className={SELECT_CLASS}
                >
                  <option value="">General Journal</option>
                  {journalTypes
                    .filter((t) => t.id)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.code} - {t.name}
                      </option>
                    ))}
                </select>
              </FormGroup>

              <FormGroup label="Reference">
                <input
                  {...form.register("reference")}
                  placeholder={
                    form.watch("journalTypeId") ? "(auto-generated)" : "e.g. JV-2026-001"
                  }
                  disabled={!!form.watch("journalTypeId")}
                  className={`${INPUT_CLASS} ${form.watch("journalTypeId") ? "bg-slate-50 text-slate-400" : ""}`}
                />
              </FormGroup>

              <FormGroup label="Source">
                <select
                  value={form.watch("source")}
                  onChange={(e) => form.setValue("source", e.target.value)}
                  className={SELECT_CLASS}
                >
                  {["MANUAL", "PMS", "POS", "PAYROLL", "FX_REVAL", "AP", "AR"].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </FormGroup>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2">
                <FormGroup label="Description">
                  <input
                    {...form.register("description")}
                    placeholder="What is this journal for?"
                    className={INPUT_CLASS}
                  />
                </FormGroup>
              </div>
              <FormGroup label="Functional Currency">
                <div
                  className={`${INPUT_CLASS} bg-slate-50 flex items-center font-bold text-slate-500`}
                >
                  <input
                    {...form.register("functionalCurrency")}
                    maxLength={3}
                    className="bg-transparent outline-none uppercase w-12 font-bold"
                    onChange={(e) =>
                      form.setValue("functionalCurrency", e.target.value.toUpperCase())
                    }
                  />
                  <span className="ml-2 text-[10px] font-normal opacity-60">(Entity Base)</span>
                </div>
              </FormGroup>
            </div>
          </div>

          {/* 3. REVENUE WARNING */}
          {form.watch("source") === "MANUAL" && (
            <div className="mx-8 lg:mx-10 mt-8">
              <div className="bg-amber-50/50 border border-amber-100 rounded-2xl p-5 flex gap-4 items-start">
                <div className="p-2 bg-amber-100 rounded-lg text-amber-600 shrink-0">
                  <AlertTriangle size={20} />
                </div>
                <div className="space-y-1 flex-1">
                  <h4 className="text-sm font-bold text-amber-900">Revenue Account Restriction</h4>
                  <p className="text-sm text-amber-800/80 leading-relaxed">
                    Manual journals touching revenue accounts require an override reason. This will
                    trigger an automatic approval request to the{" "}
                    <span className="font-bold underline decoration-amber-300">
                      Financial Controller
                    </span>
                    .
                  </p>
                  <input
                    {...form.register("sourceOverrideReason")}
                    className="mt-3 w-full bg-white border border-amber-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 ring-amber-300 placeholder:text-amber-300"
                    placeholder="Enter override reason..."
                  />
                </div>
              </div>
            </div>
          )}

          {/* 4. JOURNAL LINES TABLE */}
          <div className="p-8 lg:p-10 pt-10">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-800">Journal Lines</h3>
              <div className="flex gap-6">
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                    Debit Total
                  </p>
                  <p
                    className={`text-lg font-bold tabular-nums ${totals.debit > 0 ? "text-emerald-600" : "text-slate-900"}`}
                  >
                    {fmtAmount(totals.debit)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                    Credit Total
                  </p>
                  <p
                    className={`text-lg font-bold tabular-nums ${totals.credit > 0 ? "text-slate-900" : "text-slate-900"}`}
                  >
                    {fmtAmount(totals.credit)}
                  </p>
                </div>
              </div>
            </div>

            <div className="border border-slate-100 rounded-xl sm:rounded-[1.5rem] bg-slate-50/30 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50/80 text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                    <th className="pl-6 py-4 w-[30%]">Account Selection</th>
                    <th className="px-4 py-4 w-[14%]">Debit</th>
                    <th className="px-4 py-4 w-[14%]">Credit</th>
                    <th className="px-4 py-4 w-[8%]">Currency</th>
                    <th className="px-4 py-4 w-[8%]">Exchange Rate</th>
                    <th className="px-4 py-4">Line Description</th>
                    <th className="pr-6 py-4 text-center w-12">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {fields.map((field, index) => {
                    const debitVal = Number(linesWatch[index]?.debit || 0);
                    const creditVal = Number(linesWatch[index]?.credit || 0);
                    return (
                      <tr key={field.id} className="group hover:bg-slate-50/50 transition-colors">
                        <td className="pl-6 py-3">
                          <AccountPicker
                            value={linesWatch[index]?.accountId ?? ""}
                            onChange={(id) => form.setValue(`lines.${index}.accountId`, id)}
                            accounts={flatAccounts}
                          />
                          {form.formState.errors.lines?.[index]?.accountId && (
                            <p className="text-[10px] text-red-500 mt-0.5">
                              {form.formState.errors.lines[index]?.accountId?.message}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <input
                            {...form.register(`lines.${index}.debit`)}
                            className={`w-full bg-transparent py-2 text-sm font-semibold outline-none tabular-nums text-right ${
                              debitVal > 0 ? "text-emerald-700" : "text-slate-700"
                            }`}
                            onFocus={(e) => {
                              if (e.target.value === "0") e.target.select();
                            }}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            {...form.register(`lines.${index}.credit`)}
                            className={`w-full bg-transparent py-2 text-sm font-semibold outline-none tabular-nums text-right ${
                              creditVal > 0 ? "text-slate-800" : "text-slate-700"
                            }`}
                            onFocus={(e) => {
                              if (e.target.value === "0") e.target.select();
                            }}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            {...form.register(`lines.${index}.currency`)}
                            maxLength={3}
                            className="w-16 bg-transparent py-2 text-sm uppercase outline-none font-mono text-slate-500"
                            onChange={(e) =>
                              form.setValue(`lines.${index}.currency`, e.target.value.toUpperCase())
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            {...form.register(`lines.${index}.fxRate`)}
                            className="w-16 bg-transparent py-2 text-sm font-mono text-right outline-none text-slate-500 tabular-nums"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            {...form.register(`lines.${index}.description`)}
                            className="w-full bg-transparent py-2 text-sm text-slate-500 outline-none italic"
                            placeholder="Add optional memo..."
                          />
                        </td>
                        <td className="pr-6 py-3 text-center">
                          {fields.length > 2 && (
                            <button
                              type="button"
                              onClick={() => remove(index)}
                              className="p-2 text-slate-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              onClick={() =>
                append({
                  accountId: "",
                  debit: "0",
                  credit: "0",
                  currency: form.watch("functionalCurrency") || "USD",
                  fxRate: "1",
                  description: ""
                })
              }
              className="mt-6 flex items-center gap-2 text-emerald-600 font-bold text-sm hover:translate-x-1 transition-all"
            >
              <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center">
                <Plus size={14} />
              </div>
              Add New Row
            </button>
          </div>

          {/* 5. FOOTER ACTIONS */}
          <div className="bg-slate-50/80 p-8 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <p className="text-xs text-slate-400 font-medium italic">
                All entries are recorded in your user audit trail.
              </p>
              {successMsg && (
                <p className="text-sm text-emerald-700 font-medium mt-1 flex items-center gap-1">
                  <CheckCircle2 size={14} /> {successMsg}
                </p>
              )}
              {errorMsg && (
                <p className="text-sm text-red-600 font-medium mt-1 flex items-center gap-1">
                  <AlertTriangle size={14} /> {errorMsg}
                </p>
              )}
            </div>
            <div className="flex gap-3 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => {
                  form.reset();
                  setSuccessMsg(null);
                  setErrorMsg(null);
                }}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-bold text-slate-600 hover:bg-white border border-transparent hover:border-slate-200 transition-all"
              >
                <Save size={18} /> Reset
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || !totals.balanced}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-8 py-3 rounded-2xl font-bold bg-emerald-600 text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={18} /> {createMutation.isPending ? "Creating..." : "Create Journal"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
