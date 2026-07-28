"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useRef, useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApiContext } from "../../../../../components/use-api-context";
import { createGLJournal, getGLAccountTree, getPeriods } from "../../../../../lib/gl-api";
import { Button } from "../../../../../components/ui/button";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import { Badge } from "../../../../../components/ui/badge";
import { Trash2, Plus, Search, ChevronsUpDown } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type AccountNode = {
  id: string;
  code: string;
  name: string;
  allowPosting: boolean;
  children?: AccountNode[];
};
type FlatAccount = { id: string; code: string; name: string; label: string };

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
  placeholder = "Search account…"
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

  const selected = useMemo(() => accounts.find((a) => a.id === value), [accounts, value]);

  const filtered = useMemo(() => {
    if (!query.trim()) return accounts.slice(0, 40);
    const q = query.toLowerCase();
    return accounts
      .filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [accounts, query]);

  // Close on outside click
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

  function select(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className="flex h-8 w-full items-center justify-between rounded border border-border bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring hover:bg-muted/30 transition-colors"
      >
        {selected ? (
          <span>
            <span className="font-mono text-muted-foreground">{selected.code}</span>{" "}
            <span>{selected.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder}</span>
        )}
        <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0 ml-1" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-70 rounded-md border border-border bg-white shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type code or name…"
              className="flex-1 text-xs outline-none bg-transparent"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No accounts found</li>
            ) : (
              filtered.map((a) => (
                <li
                  key={a.id}
                  onMouseDown={() => select(a.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs hover:bg-muted/50 ${value === a.id ? "bg-primary/10 font-medium" : ""}`}
                >
                  <span className="font-mono text-muted-foreground w-12 shrink-0">{a.code}</span>
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
  reference: z.string().optional(),
  description: z.string().optional(),
  source: z.string().min(1),
  functionalCurrency: z.string().length(3),
  lines: z.array(lineSchema).min(2, "At least 2 lines required")
});

type FormValues = z.infer<typeof formSchema>;

// ── Page ───────────────────────────────────────────────────────────────────────

export default function NewJournalPage() {
  const apiContext = useApiContext();
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      source: "MANUAL",
      functionalCurrency: "USD",
      lines: [
        { accountId: "", debit: "0", credit: "0", currency: "USD", fxRate: "1", description: "" },
        { accountId: "", debit: "0", credit: "0", currency: "USD", fxRate: "1", description: "" }
      ]
    }
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "lines" });
  const linesWatch = form.watch("lines");

  const totals = useMemo(() => {
    const debit = linesWatch.reduce((s: number, l) => s + Number(l.debit || 0), 0);
    const credit = linesWatch.reduce((s: number, l) => s + Number(l.credit || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.0001 };
  }, [linesWatch]);

  const accountsQuery = useQuery({
    queryKey: ["accounts-tree", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const r = await getGLAccountTree(apiContext);
      return (r.data as unknown as AccountNode[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const periodsQuery = useQuery({
    queryKey: ["periods", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const r = await getPeriods(apiContext);
      return (r.data as unknown as Array<{ id: string; name: string; status: string }>) ?? [];
    },
    enabled: Boolean(apiContext)
  });

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
      return createGLJournal(apiContext, {
        ...values,
        lines: values.lines.map((l: z.infer<typeof lineSchema>, i: number) => ({
          ...l,
          lineNumber: i + 1
        }))
      });
    },
    onSuccess: (r) => {
      const status = (r.data as { status?: string }).status;
      setSuccessMsg(`Journal created with status ${status ?? "DRAFT"}.`);
      setErrorMsg(null);
      form.reset();
    },
    onError: (e) => {
      setErrorMsg((e as Error).message);
      setSuccessMsg(null);
    }
  });

  return (
    <Card className="max-w-5xl">
      <CardHeader>
        <CardTitle className="text-[var(--color-primary)]">New Journal Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-6">
          {/* Header */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="periodId">
                Period <span className="text-destructive">*</span>
              </Label>
              <select
                id="periodId"
                {...form.register("periodId")}
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select period…</option>
                {openPeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status})
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
              {form.formState.errors.periodId && (
                <p className="text-xs text-destructive">{form.formState.errors.periodId.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reference">Reference</Label>
              <Input
                id="reference"
                {...form.register("reference")}
                placeholder="e.g. JV-2026-001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source">Source</Label>
              <Select
                value={form.watch("source")}
                onValueChange={(v) => form.setValue("source", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["MANUAL", "PMS", "POS", "PAYROLL", "FX_REVAL", "AP", "AR"].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                {...form.register("description")}
                placeholder="Journal description"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="functionalCurrency">Functional Currency</Label>
              <Input
                id="functionalCurrency"
                {...form.register("functionalCurrency")}
                maxLength={3}
                className="w-28 uppercase"
                onChange={(e) => form.setValue("functionalCurrency", e.target.value.toUpperCase())}
              />
            </div>
          </div>

          {/* Lines */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-[var(--color-primary)]">Journal Lines</h3>
              <Badge
                variant={totals.balanced ? "success" : "destructive"}
                className="font-mono text-xs"
              >
                Dr {totals.debit.toLocaleString("en-US", { minimumFractionDigits: 2 })}{" "}
                &nbsp;|&nbsp; Cr{" "}
                {totals.credit.toLocaleString("en-US", { minimumFractionDigits: 2 })} &nbsp;·&nbsp;{" "}
                {totals.balanced ? "Balanced ✓" : "Unbalanced ✗"}
              </Badge>
            </div>

            <div className="border border-border rounded-md overflow-visible">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium w-[32%]">Account</th>
                    <th className="px-3 py-2 text-left font-medium w-[13%]">Debit</th>
                    <th className="px-3 py-2 text-left font-medium w-[13%]">Credit</th>
                    <th className="px-3 py-2 text-left font-medium w-[8%]">CCY</th>
                    <th className="px-3 py-2 text-left font-medium w-[9%]">FX Rate</th>
                    <th className="px-3 py-2 text-left font-medium">Description</th>
                    <th className="px-3 py-2 w-10">
                      <span className="sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {fields.map((field, index) => {
                    const debitVal = Number(linesWatch[index]?.debit || 0);
                    const creditVal = Number(linesWatch[index]?.credit || 0);
                    const hasValue = debitVal > 0 || creditVal > 0;
                    return (
                      <tr
                        key={field.id}
                        className={`bg-white hover:bg-muted/20 ${hasValue ? "" : "opacity-80"}`}
                      >
                        <td className="px-2 py-1.5">
                          <AccountPicker
                            value={linesWatch[index]?.accountId ?? ""}
                            onChange={(id) => form.setValue(`lines.${index}.accountId`, id)}
                            accounts={flatAccounts}
                          />
                          {form.formState.errors.lines?.[index]?.accountId && (
                            <p className="text-[10px] text-destructive mt-0.5">
                              {form.formState.errors.lines[index]?.accountId?.message}
                            </p>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            {...form.register(`lines.${index}.debit`)}
                            className={`h-8 text-right font-mono text-xs ${debitVal > 0 ? "text-emerald-700 border-emerald-200 bg-emerald-50/50" : ""}`}
                            onFocus={(e) => {
                              if (e.target.value === "0") e.target.select();
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            {...form.register(`lines.${index}.credit`)}
                            className={`h-8 text-right font-mono text-xs ${creditVal > 0 ? "text-violet-700 border-violet-200 bg-violet-50/50" : ""}`}
                            onFocus={(e) => {
                              if (e.target.value === "0") e.target.select();
                            }}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            {...form.register(`lines.${index}.currency`)}
                            maxLength={3}
                            className="h-8 uppercase text-xs w-16"
                            onChange={(e) =>
                              form.setValue(`lines.${index}.currency`, e.target.value.toUpperCase())
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            {...form.register(`lines.${index}.fxRate`)}
                            className="h-8 text-right font-mono text-xs w-20"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            {...form.register(`lines.${index}.description`)}
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {fields.length > 2 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              type="button"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => remove(index)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 gap-1"
              onClick={() =>
                append({
                  accountId: "",
                  debit: "0",
                  credit: "0",
                  currency: "USD",
                  fxRate: "1",
                  description: ""
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add Line
            </Button>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={createMutation.isPending || !totals.balanced}>
              {createMutation.isPending ? "Creating…" : "Create Journal"}
            </Button>
            {!totals.balanced && (
              <p className="text-xs text-muted-foreground">
                Journal must be balanced before posting.
              </p>
            )}
            {successMsg && <p className="text-sm text-emerald-700 font-medium">{successMsg}</p>}
            {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
