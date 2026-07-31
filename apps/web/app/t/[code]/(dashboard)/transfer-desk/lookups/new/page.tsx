"use client";

/**
 * Transfer Desk — Lookup Table creation wizard
 *
 * 2-step wizard: Name/description → Define columns → Save.
 * After save, redirects to the detail page where the spreadsheet editor lives.
 */

import Link from "next/link";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../../components/use-api-context";
import { useTenantHref } from "../../../../../../../hooks/use-tenant-router";
import {
  createTransferLookupTable,
  type LookupTableCreateInput
} from "../../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../../components/ui/card";
import { Button } from "../../../../../../../components/ui/button";
import { ArrowLeft, ArrowRight, Check, Database, Plus, Trash2 } from "lucide-react";

type ColumnDraft = { name: string };

type WizardStep = 1 | 2;

export default function NewLookupTablePage() {
  const apiCtx = useApiContext();
  const router = useRouter();
  const href = useTenantHref();

  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([{ name: "Output" }]);
  const [newColName, setNewColName] = useState("");

  const saveMutation = useMutation({
    mutationFn: (input: LookupTableCreateInput) => createTransferLookupTable(apiCtx!, input),
    onSuccess: (result) => {
      const id = result?.data?.id;
      if (id) {
        router.push(href(`/transfer-desk/lookups/${id}`));
      } else {
        router.push(href("/transfer-desk/lookups"));
      }
    }
  });

  const handleAddColumn = useCallback(() => {
    if (!newColName.trim()) return;
    setColumns((prev) => [...prev, { name: newColName.trim() }]);
    setNewColName("");
  }, [newColName]);

  const handleRemoveColumn = useCallback((index: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(() => {
    saveMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      columns: columns.map((c, i) => ({ name: c.name, columnOrder: i }))
    });
  }, [saveMutation, name, description, columns]);

  const canAdvanceStep1 = name.trim().length > 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={href("/transfer-desk/lookups")}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Lookup Table</h1>
          <p className="text-sm text-muted-foreground">Step {step} of 2</p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2">
        {[1, 2].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-emerald-500" : "bg-slate-200"}`}
          />
        ))}
      </div>

      {/* Step 1: Name & Description */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Table Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Department Code Mapping"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this lookup table map?"
                rows={3}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)} disabled={!canAdvanceStep1}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Define Columns + Save */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Define Output Columns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Each lookup table has built-in metadata columns (Business Unit, Range From, Range To).
              Add output columns below for the values the lookup produces.
            </p>

            {/* Built-in columns (read-only) */}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Built-in columns
              </p>
              {["Business Unit", "Range From", "Range To"].map((c) => (
                <div
                  key={c}
                  className="flex items-center gap-2 rounded border bg-slate-50 px-3 py-1.5 text-sm text-slate-500"
                >
                  <span className="flex-1">{c}</span>
                  <span className="text-[10px] text-slate-400">metadata</span>
                </div>
              ))}
            </div>

            {/* User-defined output columns */}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Output columns
              </p>
              {columns.map((col, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded border bg-white px-3 py-1.5"
                >
                  <input
                    type="text"
                    value={col.name}
                    onChange={(e) =>
                      setColumns((prev) =>
                        prev.map((c, idx) => (idx === i ? { name: e.target.value } : c))
                      )
                    }
                    className="flex-1 text-sm bg-transparent focus:outline-none"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-500"
                    onClick={() => handleRemoveColumn(i)}
                    disabled={columns.length <= 1}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}

              {/* Add column */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddColumn()}
                  placeholder="Column name..."
                  className="flex-1 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddColumn}
                  disabled={!newColName.trim()}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
            </div>

            {saveMutation.error && (
              <p className="text-sm text-red-600">
                Failed to create: {(saveMutation.error as Error).message}
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button
                onClick={handleSave}
                disabled={saveMutation.isPending || columns.length === 0}
              >
                <Check className="mr-2 h-4 w-4" />
                {saveMutation.isPending ? "Creating..." : "Create Lookup Table"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
