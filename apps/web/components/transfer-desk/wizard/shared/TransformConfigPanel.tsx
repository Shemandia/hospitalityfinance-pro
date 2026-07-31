"use client";

/**
 * TransformConfigPanel — Slide-in panel for configuring a mapping's transform.
 *
 * Opens from the right when the user clicks a mapping line in the FieldMapper.
 * Shows a transform type dropdown (7 types), then dynamic fields per type.
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../use-api-context";
import { listLookupTables, listPrebuiltFunctions } from "../../../../lib/transfer-desk/api";
import { TRANSFORM_TYPES } from "../../../../lib/transfer-desk/constants";
import type {
  TmlTransform,
  TransformType,
  PrebuiltFunction,
  LookupTable
} from "../../../../lib/transfer-desk/types";
import { Input } from "../../../ui/input";
import { Button } from "../../../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/select";
import { X, Check } from "lucide-react";

// ── Props ───────────────────────────────────────────────────────────────────

type TransformConfigPanelProps = {
  /** The current transform (null = direct copy) */
  transform: TmlTransform | null;
  /** Source field name (for display context) */
  sourceField: string;
  /** Target field path (for display context) */
  targetField: string;
  /** Apply changes */
  onApply: (transform: TmlTransform | null) => void;
  /** Close without saving */
  onCancel: () => void;
};

// ── Default transform per type ──────────────────────────────────────────────

function defaultTransform(type: TransformType): TmlTransform {
  switch (type) {
    case "direct":
      return { type: "direct" };
    case "lookup":
      return { type: "lookup", lookupTableId: "", lookupSourceColumn: "", lookupTargetColumn: "" };
    case "expression":
      return { type: "expression", expression: "" };
    case "function":
      return { type: "function", functionId: "", functionParams: {} };
    case "concat":
      return { type: "concat", additionalSources: [], separator: "" };
    case "split":
      return { type: "split", splitDelimiter: ",", splitIndex: 0 };
    case "static":
      return { type: "static", staticValue: "" };
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export function TransformConfigPanel({
  transform,
  sourceField,
  targetField,
  onApply,
  onCancel
}: TransformConfigPanelProps) {
  const apiContext = useApiContext();

  const [draft, setDraft] = useState<TmlTransform>(transform ?? { type: "direct" });

  // Reset draft when transform prop changes
  useEffect(() => {
    setDraft(transform ?? { type: "direct" });
  }, [transform]);

  const updateDraft = useCallback((patch: Partial<TmlTransform>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleTypeChange = useCallback((type: TransformType) => {
    setDraft(defaultTransform(type));
  }, []);

  const handleApply = useCallback(() => {
    onApply(draft.type === "direct" ? null : draft);
  }, [draft, onApply]);

  // ── Lookup tables query ─────────────────────────────────────────────────

  const lookupTablesQ = useQuery({
    queryKey: ["td-lookup-tables", apiContext?.tenantSlug],
    queryFn: () =>
      apiContext ? listLookupTables(apiContext) : Promise.resolve({ data: [] as LookupTable[] }),
    enabled: draft.type === "lookup" && Boolean(apiContext),
    select: (r) => (r.data ?? []) as LookupTable[]
  });

  // ── Pre-built functions query ───────────────────────────────────────────

  const functionsQ = useQuery({
    queryKey: ["td-prebuilt-functions", apiContext?.tenantSlug],
    queryFn: () =>
      apiContext
        ? listPrebuiltFunctions(apiContext)
        : Promise.resolve({ data: [] as PrebuiltFunction[] }),
    enabled: draft.type === "function" && Boolean(apiContext),
    select: (r) => (r.data ?? []) as PrebuiltFunction[]
  });

  const selectedFunction = functionsQ.data?.find((f) => f.id === draft.functionId);

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-slate-200 shadow-xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">Configure Transform</h3>
          <p className="text-[11px] text-slate-400 truncate mt-0.5">
            {sourceField === "__static__" ? "(static)" : sourceField}
            <span className="mx-1.5 text-slate-300">&rarr;</span>
            {targetField}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-8 w-8 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Transform type */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-600">Transform Type</label>
          <Select value={draft.type} onValueChange={(v) => handleTypeChange(v as TransformType)}>
            <SelectTrigger className="text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRANSFORM_TYPES.map((tt) => (
                <SelectItem key={tt.value} value={tt.value} className="text-sm">
                  <div>
                    <span className="font-medium">{tt.label}</span>
                    <span className="text-[10px] text-slate-400 ml-2">{tt.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Dynamic fields per type */}
        {draft.type === "lookup" && (
          <LookupFields
            draft={draft}
            updateDraft={updateDraft}
            tables={lookupTablesQ.data ?? []}
            isLoading={lookupTablesQ.isLoading}
          />
        )}

        {draft.type === "expression" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">JavaScript Expression</label>
            <textarea
              value={draft.expression ?? ""}
              onChange={(e) => updateDraft({ expression: e.target.value })}
              placeholder={"value.trim().toUpperCase()"}
              rows={4}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            />
            <p className="text-[10px] text-slate-400">
              <code className="bg-slate-100 px-1 rounded">value</code> is the source field value.
            </p>
          </div>
        )}

        {draft.type === "function" && (
          <FunctionFields
            draft={draft}
            updateDraft={updateDraft}
            functions={functionsQ.data ?? []}
            selectedFunction={selectedFunction ?? null}
            isLoading={functionsQ.isLoading}
          />
        )}

        {draft.type === "concat" && <ConcatFields draft={draft} updateDraft={updateDraft} />}

        {draft.type === "split" && <SplitFields draft={draft} updateDraft={updateDraft} />}

        {draft.type === "static" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">Static Value</label>
            <Input
              value={draft.staticValue ?? ""}
              onChange={(e) => updateDraft({ staticValue: e.target.value })}
              placeholder="Enter constant value"
              className="text-sm"
            />
          </div>
        )}

        {draft.type === "direct" && (
          <p className="text-xs text-slate-400 py-2">
            Direct copy &mdash; the source field value is passed through as-is.
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="teal" size="sm" onClick={handleApply} className="gap-1.5">
          <Check className="h-3.5 w-3.5" /> Apply
        </Button>
      </div>
    </div>
  );
}

// ── Lookup Fields ───────────────────────────────────────────────────────────

function LookupFields({
  draft,
  updateDraft,
  tables,
  isLoading
}: {
  draft: TmlTransform;
  updateDraft: (patch: Partial<TmlTransform>) => void;
  tables: LookupTable[];
  isLoading: boolean;
}) {
  const selectedTable = tables.find((t) => t.id === draft.lookupTableId);
  const columns = selectedTable?.columns ?? [];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600">Lookup Table</label>
        {isLoading ? (
          <p className="text-xs text-slate-400">Loading tables...</p>
        ) : (
          <Select
            value={draft.lookupTableId ?? ""}
            onValueChange={(v) =>
              updateDraft({ lookupTableId: v, lookupSourceColumn: "", lookupTargetColumn: "" })
            }
          >
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Select table..." />
            </SelectTrigger>
            <SelectContent>
              {tables.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-sm">
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {columns.length > 0 && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">Source Column (match on)</label>
            <Select
              value={draft.lookupSourceColumn ?? ""}
              onValueChange={(v) => updateDraft({ lookupSourceColumn: v })}
            >
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select column..." />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c} value={c} className="text-sm">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">Target Column (return)</label>
            <Select
              value={draft.lookupTargetColumn ?? ""}
              onValueChange={(v) => updateDraft({ lookupTargetColumn: v })}
            >
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Select column..." />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c} value={c} className="text-sm">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">Default (if no match)</label>
            <Input
              value={draft.lookupDefaultValue ?? ""}
              onChange={(e) => updateDraft({ lookupDefaultValue: e.target.value })}
              placeholder="Fallback value"
              className="text-sm"
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Function Fields ─────────────────────────────────────────────────────────

function FunctionFields({
  draft,
  updateDraft,
  functions,
  selectedFunction,
  isLoading
}: {
  draft: TmlTransform;
  updateDraft: (patch: Partial<TmlTransform>) => void;
  functions: PrebuiltFunction[];
  selectedFunction: PrebuiltFunction | null;
  isLoading: boolean;
}) {
  const params = draft.functionParams ?? {};

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600">Pre-built Function</label>
        {isLoading ? (
          <p className="text-xs text-slate-400">Loading functions...</p>
        ) : (
          <Select
            value={draft.functionId ?? ""}
            onValueChange={(v) => updateDraft({ functionId: v, functionParams: {} })}
          >
            <SelectTrigger className="text-sm">
              <SelectValue placeholder="Select function..." />
            </SelectTrigger>
            <SelectContent>
              {functions.map((fn) => (
                <SelectItem key={fn.id} value={fn.id} className="text-sm">
                  <span>{fn.name}</span>
                  <span className="text-[10px] text-slate-400 ml-2">{fn.category}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {selectedFunction && (
        <div className="space-y-1 rounded-lg bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500 mb-2">{selectedFunction.description}</p>
          {selectedFunction.params.map((param) => (
            <div key={param.name} className="space-y-1">
              <label className="text-[11px] font-medium text-slate-600">
                {param.name}
                {param.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              <Input
                value={String(params[param.name] ?? param.defaultValue ?? "")}
                onChange={(e) => {
                  const val =
                    param.type === "number"
                      ? Number(e.target.value) || 0
                      : param.type === "boolean"
                        ? e.target.value === "true"
                        : e.target.value;
                  updateDraft({
                    functionParams: { ...params, [param.name]: val }
                  });
                }}
                placeholder={param.description}
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-slate-400">{param.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Concat Fields ───────────────────────────────────────────────────────────

function ConcatFields({
  draft,
  updateDraft
}: {
  draft: TmlTransform;
  updateDraft: (patch: Partial<TmlTransform>) => void;
}) {
  const sources = draft.additionalSources ?? [];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600">Additional Source Fields</label>
        {sources.map((s, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              value={s}
              onChange={(e) => {
                const next = [...sources];
                next[i] = e.target.value;
                updateDraft({ additionalSources: next });
              }}
              placeholder="field.name"
              className="h-8 text-xs font-mono flex-1"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateDraft({ additionalSources: sources.filter((_, j) => j !== i) })}
              className="h-8 w-8 p-0 text-slate-400 hover:text-red-500"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => updateDraft({ additionalSources: [...sources, ""] })}
          className="text-xs"
        >
          + Add field
        </Button>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600">Separator</label>
        <Input
          value={draft.separator ?? ""}
          onChange={(e) => updateDraft({ separator: e.target.value })}
          placeholder="e.g. - or (space)"
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}

// ── Split Fields ────────────────────────────────────────────────────────────

function SplitFields({
  draft,
  updateDraft
}: {
  draft: TmlTransform;
  updateDraft: (patch: Partial<TmlTransform>) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600">Split Delimiter</label>
        <Input
          value={draft.splitDelimiter ?? ""}
          onChange={(e) => updateDraft({ splitDelimiter: e.target.value })}
          placeholder=","
          className="h-8 text-xs font-mono"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-600">Part Index (0-based)</label>
        <Input
          type="number"
          value={draft.splitIndex ?? 0}
          onChange={(e) => updateDraft({ splitIndex: Number(e.target.value) || 0 })}
          min={0}
          className="h-8 text-xs w-24"
        />
      </div>
    </div>
  );
}
