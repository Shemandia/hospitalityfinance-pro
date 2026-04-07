"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApiContext } from "../../../../../components/use-api-context";
import { Button } from "../../../../../components/ui/button";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import { Badge } from "../../../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../components/ui/table";
import { Plus, Pencil, Trash2, X } from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

const SOURCES = ["MANUAL", "PMS", "POS", "PAYROLL", "FX_REVAL", "AP", "AR"] as const;
const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;

type JournalType = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  allowedSources: string[];
  allowedAccountTypes: string[];
  numberPrefix: string;
  autoReverse: boolean;
  requireBalance: boolean;
  isActive: boolean;
  nextNumber: number;
  _count?: { journals: number };
};

const formSchema = z.object({
  code: z.string().min(1, "Required").max(10),
  name: z.string().min(1, "Required").max(100),
  description: z.string().max(500).optional(),
  allowedSources: z.array(z.string()),
  allowedAccountTypes: z.array(z.string()),
  numberPrefix: z.string().min(1, "Required").max(10),
  autoReverse: z.boolean(),
  requireBalance: z.boolean(),
  isActive: z.boolean()
});

type FormValues = z.infer<typeof formSchema>;

// ── API helpers ─────────────────────────────────────────────────────────────

type ApiCtx = { accessToken: string; entityId: string };

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4500";

async function apiCall(ctx: ApiCtx, path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}/api/v1/gl${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.accessToken}`,
      "X-Entity-ID": ctx.entityId,
      ...(opts?.headers ?? {})
    }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.errors?.[0]?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Chip toggle component ───────────────────────────────────────────────────

function ChipToggle({
  options,
  value,
  onChange
}: {
  options: readonly string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(active ? value.filter((v) => v !== opt) : [...value, opt])}
            className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
              active
                ? "bg-primary text-white border-primary"
                : "bg-muted/50 text-muted-foreground border-border hover:border-primary/40"
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function JournalTypesPage() {
  const apiContext = useApiContext();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<JournalType | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      allowedSources: [],
      allowedAccountTypes: [],
      numberPrefix: "",
      autoReverse: false,
      requireBalance: true,
      isActive: true
    }
  });

  const typesQuery = useQuery({
    queryKey: ["journal-types", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const r = await apiCall(apiContext, "/journal-types");
      return (r.data ?? []) as JournalType[];
    },
    enabled: Boolean(apiContext)
  });

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!apiContext) throw new Error("No context");
      if (editing) {
        return apiCall(apiContext, `/journal-types/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(values)
        });
      }
      return apiCall(apiContext, "/journal-types", {
        method: "POST",
        body: JSON.stringify(values)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-types"] });
      closeForm();
    },
    onError: (e) => setError((e as Error).message)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!apiContext) throw new Error("No context");
      return apiCall(apiContext, `/journal-types/${id}`, { method: "DELETE" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["journal-types"] }),
    onError: (e) => setError((e as Error).message)
  });

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setError(null);
    form.reset({
      code: "",
      name: "",
      description: "",
      allowedSources: [],
      allowedAccountTypes: [],
      numberPrefix: "",
      autoReverse: false,
      requireBalance: true,
      isActive: true
    });
  }

  function openEdit(jt: JournalType) {
    setEditing(jt);
    setCreating(true);
    setError(null);
    form.reset({
      code: jt.code,
      name: jt.name,
      description: jt.description ?? "",
      allowedSources: jt.allowedSources,
      allowedAccountTypes: jt.allowedAccountTypes,
      numberPrefix: jt.numberPrefix,
      autoReverse: jt.autoReverse,
      requireBalance: jt.requireBalance,
      isActive: jt.isActive
    });
  }

  function closeForm() {
    setCreating(false);
    setEditing(null);
    setError(null);
    form.reset();
  }

  const types = typesQuery.data ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-(--color-primary)">Journal Types</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure journal types to control source restrictions, account type rules,
            auto-numbering, and auto-reversal behaviour.
          </p>
        </div>
        {!creating && (
          <Button size="sm" className="gap-1" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> New Type
          </Button>
        )}
      </div>

      {/* Form */}
      {creating && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {editing ? `Edit: ${editing.code}` : "New Journal Type"}
              </CardTitle>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeForm}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit((v: FormValues) => saveMutation.mutate(v))}
              className="space-y-4"
            >
              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-1">
                  <Label>Code</Label>
                  <Input
                    {...form.register("code")}
                    maxLength={10}
                    className="uppercase"
                    placeholder="RV"
                    disabled={!!editing}
                  />
                  {form.formState.errors.code && (
                    <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>
                  )}
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Name</Label>
                  <Input {...form.register("name")} placeholder="Revenue Journal" />
                </div>
                <div className="space-y-1">
                  <Label>Number Prefix</Label>
                  <Input
                    {...form.register("numberPrefix")}
                    maxLength={10}
                    className="uppercase"
                    placeholder="RV"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Description</Label>
                <Input {...form.register("description")} placeholder="Optional description" />
              </div>

              <div className="space-y-1.5">
                <Label>
                  Allowed Sources{" "}
                  <span className="text-muted-foreground font-normal">(empty = unrestricted)</span>
                </Label>
                <ChipToggle
                  options={SOURCES}
                  value={form.watch("allowedSources")}
                  onChange={(v) => form.setValue("allowedSources", v)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>
                  Allowed Account Types{" "}
                  <span className="text-muted-foreground font-normal">(empty = unrestricted)</span>
                </Label>
                <ChipToggle
                  options={ACCOUNT_TYPES}
                  value={form.watch("allowedAccountTypes")}
                  onChange={(v) => form.setValue("allowedAccountTypes", v)}
                />
              </div>

              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...form.register("autoReverse")} className="rounded" />
                  Auto-reverse next period
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...form.register("requireBalance")} className="rounded" />
                  Require balanced debits/credits
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" {...form.register("isActive")} className="rounded" />
                  Active
                </label>
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : editing ? "Update" : "Create"}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>
                  Cancel
                </Button>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Sources</TableHead>
                <TableHead>Account Types</TableHead>
                <TableHead className="text-center w-20">Auto-Rev</TableHead>
                <TableHead className="text-center w-20">Balanced</TableHead>
                <TableHead className="text-center w-16">Status</TableHead>
                <TableHead className="text-right w-20">Journals</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    No journal types configured. Click &quot;New Type&quot; to create one.
                  </TableCell>
                </TableRow>
              )}
              {types.map((jt) => (
                <TableRow key={jt.id}>
                  <TableCell className="font-mono font-medium">{jt.code}</TableCell>
                  <TableCell>{jt.name}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {jt.numberPrefix}
                  </TableCell>
                  <TableCell>
                    {jt.allowedSources.length === 0 ? (
                      <span className="text-muted-foreground text-xs">Any</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {jt.allowedSources.map((s) => (
                          <Badge key={s} variant="outline" className="text-[10px] px-1.5 py-0">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {jt.allowedAccountTypes.length === 0 ? (
                      <span className="text-muted-foreground text-xs">Any</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {jt.allowedAccountTypes.map((t) => (
                          <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{jt.autoReverse ? "Yes" : "-"}</TableCell>
                  <TableCell className="text-center">{jt.requireBalance ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant={jt.isActive ? "success" : "secondary"} className="text-[10px]">
                      {jt.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{jt._count?.journals ?? 0}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => openEdit(jt)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Delete journal type "${jt.code}"?`)) {
                            deleteMutation.mutate(jt.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
