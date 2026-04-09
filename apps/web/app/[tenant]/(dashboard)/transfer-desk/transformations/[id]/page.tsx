"use client";

/**
 * Transfer Desk — Transformation detail/edit page with Visual Mapper
 *
 * Dual-tab editor:
 *   GUI tab  — Visual Mapper (source fields left, target fields right, SVG lines)
 *   Code tab — Raw TML JSON editor
 *
 * Click source field → click target field → map rule created with blue line.
 * Side panel to add set/transform/lookup/conditional rules.
 * Pre-built function picker for transform rules.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  getTransferTransformation,
  updateTransferTransformation,
  type TransferTransformationDetail
} from "../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { ArrowLeft, Save, Workflow, CheckCircle2, XCircle, Plus, Trash2, Lock } from "lucide-react";

// ── Types for TML rules (matching @hfp/tml-engine) ────────────────────────

type TmlRule = MapRule | SetRule | TransformRule | LookupRule | ConditionalRule;

type MapRule = {
  type: "map";
  target: string;
  sources: { path: string; separator?: string }[];
};
type SetRule = { type: "set"; target: string; value: string | number | boolean };
type TransformRule = {
  type: "transform";
  target: string;
  function: {
    name: string;
    params: { value: string | number; fromSource?: boolean; type?: "string" | "number" }[];
  };
};
type LookupRule = {
  type: "lookup";
  table: string;
  target: string;
  source?: string;
  unknown?: "fail" | "copy";
};
type ConditionalRule = {
  type: "conditional";
  condition: { field: string; operator: string; value: string | number | boolean };
  then: TmlRule[];
  else?: TmlRule[];
};

type FieldInfo = { name: string; type: string };

// ── Built-in functions (matching @hfp/tml-engine BUILTIN_FUNCTIONS_META) ───

const BUILTIN_FUNCTIONS = [
  { name: "formatDate", params: ["value", "fromFormat", "toFormat"] },
  { name: "padLeft", params: ["value", "length", "fillChar"] },
  { name: "padRight", params: ["value", "length", "fillChar"] },
  { name: "toUpperCase", params: ["value"] },
  { name: "toLowerCase", params: ["value"] },
  { name: "currencyConvert", params: ["amount", "rate"] },
  { name: "divideBy1000", params: ["value"] },
  { name: "multiplyBy1000", params: ["value"] }
];

// ── Line color map ─────────────────────────────────────────────────────────

const RULE_COLORS: Record<string, string> = {
  map: "#3b82f6",
  set: "#f97316",
  transform: "#a855f7",
  lookup: "#22c55e",
  conditional: "#eab308"
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractFieldsFromFsd(fsdXml: string | null | undefined): FieldInfo[] {
  if (!fsdXml) return [];
  try {
    const schema = JSON.parse(fsdXml);
    const fields = schema?.record?.fields ?? [];
    return fields.map((f: any) => ({
      name: String(f.name ?? ""),
      type: String(f.type ?? "string")
    }));
  } catch {
    return [];
  }
}

function getComponentFields(component: string | null | undefined): FieldInfo[] {
  if (component === "GL_JOURNAL") {
    return [
      { name: "reference", type: "string" },
      { name: "periodId", type: "string" },
      { name: "description", type: "string" },
      { name: "accountId", type: "string" },
      { name: "debit", type: "number" },
      { name: "credit", type: "number" },
      { name: "currency", type: "string" },
      { name: "fxRate", type: "number" }
    ];
  }
  if (component === "AP_INVOICE") {
    return [
      { name: "vendorId", type: "string" },
      { name: "invoiceNumber", type: "string" },
      { name: "invoiceDate", type: "date" },
      { name: "dueDate", type: "date" },
      { name: "amount", type: "number" },
      { name: "currency", type: "string" },
      { name: "description", type: "string" }
    ];
  }
  if (component === "AR_INVOICE") {
    return [
      { name: "customerId", type: "string" },
      { name: "invoiceNumber", type: "string" },
      { name: "invoiceDate", type: "date" },
      { name: "dueDate", type: "date" },
      { name: "amount", type: "number" },
      { name: "currency", type: "string" },
      { name: "description", type: "string" }
    ];
  }
  return [];
}

function getRuleTarget(rule: TmlRule): string {
  if (rule.type === "conditional") return `[if ${rule.condition.field}]`;
  return rule.target;
}

// ── Main page component ────────────────────────────────────────────────────

export default function TransformationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const apiCtx = useApiContext();
  const href = useTenantHref();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"gui" | "code">("gui");
  const [rules, setRules] = useState<TmlRule[]>([]);
  const [codeText, setCodeText] = useState("");
  const [codeValid, setCodeValid] = useState(true);
  const [isDirty, setIsDirty] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [editingRuleIdx, setEditingRuleIdx] = useState<number | null>(null);
  const [addingRuleType, setAddingRuleType] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sourceRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const targetRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // ── New rule form state ────────────────────────────────────────────────
  const [newRuleTarget, setNewRuleTarget] = useState("");
  const [newSetValue, setNewSetValue] = useState("");
  const [newTransformFn, setNewTransformFn] = useState("");
  const [newTransformParam, setNewTransformParam] = useState("");
  const [newLookupTable, setNewLookupTable] = useState("");
  const [newLookupSource, setNewLookupSource] = useState("");
  const [newCondField, setNewCondField] = useState("");
  const [newCondOp, setNewCondOp] = useState("==");
  const [newCondValue, setNewCondValue] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["transfer-transformation", id],
    queryFn: () => getTransferTransformation(apiCtx, id)
  });

  const transformation: TransferTransformationDetail | null = data?.data ?? null;
  const isSystem = transformation?.isSystem ?? false;

  // Initialize rules from server data
  useEffect(() => {
    if (transformation && !isDirty) {
      const serverRules = Array.isArray(transformation.rulesJson)
        ? (transformation.rulesJson as TmlRule[])
        : ((transformation.rulesJson as any)?.rules ?? []);
      setRules(serverRules);
      setCodeText(JSON.stringify(serverRules, null, 2));
    }
  }, [transformation, isDirty]);

  // Derive source and target fields
  const sourceFields = useMemo(() => {
    if (transformation?.sourceFormat?.fsdXml) {
      return extractFieldsFromFsd(transformation.sourceFormat.fsdXml);
    }
    return getComponentFields(transformation?.sourceComponent);
  }, [transformation]);

  const targetFields = useMemo(() => {
    if (transformation?.targetFormat?.fsdXml) {
      return extractFieldsFromFsd(transformation.targetFormat.fsdXml);
    }
    return getComponentFields(transformation?.targetComponent);
  }, [transformation]);

  // Track which target fields are mapped
  const mappedTargets = useMemo(() => {
    const set = new Set<string>();
    for (const rule of rules) {
      if (rule.type !== "conditional") {
        set.add(rule.target);
      }
    }
    return set;
  }, [rules]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () =>
      updateTransferTransformation(apiCtx, id, {
        rulesJson: rules
      }),
    onSuccess: () => {
      setIsDirty(false);
      queryClient.invalidateQueries({ queryKey: ["transfer-transformation", id] });
    }
  });

  // ── Rule management ──────────────────────────────────────────────────

  const addRule = useCallback(
    (rule: TmlRule) => {
      setRules((prev) => [...prev, rule]);
      setIsDirty(true);
      setCodeText(JSON.stringify([...rules, rule], null, 2));
      setAddingRuleType(null);
      resetNewRuleForm();
    },
    [rules]
  );

  const removeRule = useCallback((idx: number) => {
    setRules((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      setCodeText(JSON.stringify(next, null, 2));
      return next;
    });
    setIsDirty(true);
    setEditingRuleIdx(null);
  }, []);

  const resetNewRuleForm = () => {
    setNewRuleTarget("");
    setNewSetValue("");
    setNewTransformFn("");
    setNewTransformParam("");
    setNewLookupTable("");
    setNewLookupSource("");
    setNewCondField("");
    setNewCondOp("==");
    setNewCondValue("");
  };

  // ── Click-to-connect: source → target ──────────────────────────────

  const handleSourceClick = useCallback(
    (fieldName: string) => {
      if (isSystem) return;
      setSelectedSource(fieldName);
    },
    [isSystem]
  );

  const handleTargetClick = useCallback(
    (fieldName: string) => {
      if (isSystem || !selectedSource) return;
      const newRule: MapRule = {
        type: "map",
        target: fieldName,
        sources: [{ path: selectedSource }]
      };
      addRule(newRule);
      setSelectedSource(null);
    },
    [selectedSource, addRule, isSystem]
  );

  // ── Code tab sync ──────────────────────────────────────────────────

  const handleCodeChange = useCallback((newCode: string) => {
    setCodeText(newCode);
    setIsDirty(true);
    try {
      const parsed = JSON.parse(newCode);
      if (Array.isArray(parsed)) {
        setRules(parsed);
        setCodeValid(true);
      } else {
        setCodeValid(false);
      }
    } catch {
      setCodeValid(false);
    }
  }, []);

  // Switch to Code tab → sync from rules
  const switchToCode = useCallback(() => {
    setCodeText(JSON.stringify(rules, null, 2));
    setCodeValid(true);
    setActiveTab("code");
  }, [rules]);

  // ── SVG line rendering ─────────────────────────────────────────────

  const [lineCoords, setLineCoords] = useState<
    { x1: number; y1: number; x2: number; y2: number; color: string; label: string }[]
  >([]);

  const updateLines = useCallback(() => {
    if (!containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newLines: typeof lineCoords = [];

    for (const rule of rules) {
      if (rule.type === "map") {
        for (const src of rule.sources) {
          const srcEl = sourceRefs.current.get(src.path);
          const tgtEl = targetRefs.current.get(rule.target);
          if (srcEl && tgtEl) {
            const srcRect = srcEl.getBoundingClientRect();
            const tgtRect = tgtEl.getBoundingClientRect();
            newLines.push({
              x1: srcRect.right - containerRect.left,
              y1: srcRect.top + srcRect.height / 2 - containerRect.top,
              x2: tgtRect.left - containerRect.left,
              y2: tgtRect.top + tgtRect.height / 2 - containerRect.top,
              color: RULE_COLORS.map!,
              label: "map"
            });
          }
        }
      } else if (rule.type === "transform") {
        // Find if any param has fromSource — draw line from that source to target
        const sourceParam = rule.function.params.find((p) => p.fromSource);
        if (sourceParam) {
          const srcEl = sourceRefs.current.get(String(sourceParam.value));
          const tgtEl = targetRefs.current.get(rule.target);
          if (srcEl && tgtEl) {
            const srcRect = srcEl.getBoundingClientRect();
            const tgtRect = tgtEl.getBoundingClientRect();
            newLines.push({
              x1: srcRect.right - containerRect.left,
              y1: srcRect.top + srcRect.height / 2 - containerRect.top,
              x2: tgtRect.left - containerRect.left,
              y2: tgtRect.top + tgtRect.height / 2 - containerRect.top,
              color: RULE_COLORS.transform!,
              label: rule.function.name
            });
          }
        }
      } else if (rule.type === "lookup") {
        const srcField = rule.source ?? rule.target;
        const srcEl = sourceRefs.current.get(srcField);
        const tgtEl = targetRefs.current.get(rule.target);
        if (srcEl && tgtEl) {
          const srcRect = srcEl.getBoundingClientRect();
          const tgtRect = tgtEl.getBoundingClientRect();
          newLines.push({
            x1: srcRect.right - containerRect.left,
            y1: srcRect.top + srcRect.height / 2 - containerRect.top,
            x2: tgtRect.left - containerRect.left,
            y2: tgtRect.top + tgtRect.height / 2 - containerRect.top,
            color: RULE_COLORS.lookup!,
            label: `lookup:${rule.table}`
          });
        }
      }
    }

    setLineCoords(newLines);
  }, [rules]);

  useEffect(() => {
    updateLines();
    window.addEventListener("resize", updateLines);
    return () => window.removeEventListener("resize", updateLines);
  }, [updateLines]);

  // Re-render lines after DOM settles
  useEffect(() => {
    const timer = setTimeout(updateLines, 100);
    return () => clearTimeout(timer);
  }, [rules, activeTab, updateLines]);

  // ── Add rule handlers ──────────────────────────────────────────────

  const handleAddSet = () => {
    if (!newRuleTarget) return;
    addRule({ type: "set", target: newRuleTarget, value: newSetValue });
  };

  const handleAddTransform = () => {
    if (!newRuleTarget || !newTransformFn) return;
    const fn = BUILTIN_FUNCTIONS.find((f) => f.name === newTransformFn);
    const params = fn
      ? fn.params.map((p, i) =>
          i === 0
            ? {
                value: newTransformParam || newRuleTarget,
                fromSource: true,
                type: "number" as const
              }
            : { value: 0 }
        )
      : [{ value: newTransformParam || newRuleTarget, fromSource: true }];
    addRule({
      type: "transform",
      target: newRuleTarget,
      function: { name: newTransformFn, params }
    });
  };

  const handleAddLookup = () => {
    if (!newRuleTarget || !newLookupTable) return;
    addRule({
      type: "lookup",
      table: newLookupTable,
      target: newRuleTarget,
      source: newLookupSource || undefined,
      unknown: "copy"
    });
  };

  const handleAddConditional = () => {
    if (!newCondField || !newCondValue) return;
    addRule({
      type: "conditional",
      condition: { field: newCondField, operator: newCondOp, value: newCondValue },
      then: [],
      else: []
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading transformation...
      </div>
    );
  }

  if (!transformation) {
    return (
      <div className="flex items-center justify-center py-20 text-red-600">
        Transformation not found
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={href("/transfer-desk/transformations")}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              {transformation.name}
              {isSystem && (
                <Badge variant="secondary" className="text-xs">
                  <Lock className="mr-1 h-3 w-3" /> System
                </Badge>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {transformation.sourceFormat?.name ?? transformation.sourceComponent ?? "—"} →{" "}
              {transformation.targetFormat?.name ?? transformation.targetComponent ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
              Unsaved changes
            </Badge>
          )}
          {!isSystem && (
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={!isDirty || saveMutation.isPending}
            >
              <Save className="mr-2 h-3.5 w-3.5" />
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </div>
      </div>

      {isSystem && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          This is a system transformation and cannot be modified.
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "gui"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setActiveTab("gui")}
        >
          Visual Mapper
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "code"
              ? "border-emerald-600 text-emerald-700"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={switchToCode}
        >
          Code
          {!codeValid && activeTab === "code" && (
            <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">
              Invalid
            </Badge>
          )}
        </button>
      </div>

      {/* GUI Tab — Visual Mapper */}
      {activeTab === "gui" && (
        <div className="flex gap-4">
          {/* Three-column mapper */}
          <div ref={containerRef} className="flex-1 relative flex gap-0 min-h-[400px]">
            {/* Source fields (left) */}
            <div className="w-[240px] shrink-0 border rounded-l-lg bg-blue-50/30 p-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-3">
                Source Fields
              </h3>
              <div className="space-y-1">
                {sourceFields.map((f) => (
                  <div
                    key={f.name}
                    ref={(el) => {
                      if (el) sourceRefs.current.set(f.name, el);
                    }}
                    onClick={() => handleSourceClick(f.name)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded text-sm cursor-pointer transition-colors ${
                      selectedSource === f.name
                        ? "bg-blue-200 text-blue-900 ring-2 ring-blue-400"
                        : "hover:bg-blue-100 text-slate-700"
                    }`}
                  >
                    <span className="font-mono text-xs">{f.name}</span>
                    <span className="text-[10px] text-slate-400">{f.type}</span>
                  </div>
                ))}
                {sourceFields.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No source fields</p>
                )}
              </div>
              {selectedSource && (
                <p className="mt-3 text-[10px] text-blue-600">
                  Click a target field to create a map rule
                </p>
              )}
            </div>

            {/* Center — SVG lines */}
            <div className="flex-1 min-w-[80px] relative">
              <svg
                ref={svgRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ overflow: "visible" }}
              >
                {lineCoords.map((line, i) => {
                  const midX = (line.x1 + line.x2) / 2;
                  const midY = (line.y1 + line.y2) / 2;
                  return (
                    <g key={i}>
                      <path
                        d={`M ${line.x1} ${line.y1} C ${line.x1 + 40} ${line.y1}, ${line.x2 - 40} ${line.y2}, ${line.x2} ${line.y2}`}
                        stroke={line.color}
                        strokeWidth={2}
                        fill="none"
                        opacity={0.7}
                      />
                      <rect
                        x={midX - 24}
                        y={midY - 8}
                        width={48}
                        height={16}
                        rx={4}
                        fill={line.color}
                        opacity={0.9}
                      />
                      <text
                        x={midX}
                        y={midY + 4}
                        textAnchor="middle"
                        className="text-[8px] fill-white font-medium"
                      >
                        {line.label.length > 8 ? line.label.slice(0, 8) + "…" : line.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Target fields (right) */}
            <div className="w-[240px] shrink-0 border rounded-r-lg bg-green-50/30 p-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-green-600 mb-3">
                Target Fields
              </h3>
              <div className="space-y-1">
                {targetFields.map((f) => (
                  <div
                    key={f.name}
                    ref={(el) => {
                      if (el) targetRefs.current.set(f.name, el);
                    }}
                    onClick={() => handleTargetClick(f.name)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded text-sm transition-colors ${
                      selectedSource
                        ? "cursor-pointer hover:bg-green-200 hover:ring-2 hover:ring-green-400"
                        : "cursor-default"
                    } ${
                      mappedTargets.has(f.name) ? "bg-green-100 text-green-800" : "text-slate-700"
                    }`}
                  >
                    <span className="font-mono text-xs">{f.name}</span>
                    <span className="flex items-center gap-1">
                      <span className="text-[10px] text-slate-400">{f.type}</span>
                      {mappedTargets.has(f.name) && (
                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                      )}
                    </span>
                  </div>
                ))}
                {targetFields.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No target fields</p>
                )}
              </div>
            </div>
          </div>

          {/* Side panel — rules list + add rule */}
          <div className="w-[300px] shrink-0 space-y-3">
            {/* Rules list */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider">
                  Rules ({rules.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[300px] overflow-y-auto">
                {rules.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-2">
                    No rules yet. Click source → target to create map rules, or add rules below.
                  </p>
                )}
                {rules.map((rule, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-between px-2 py-1.5 rounded text-xs group ${
                      editingRuleIdx === idx ? "bg-slate-100" : "hover:bg-slate-50"
                    }`}
                    onClick={() => setEditingRuleIdx(idx === editingRuleIdx ? null : idx)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: RULE_COLORS[rule.type] ?? "#94a3b8" }}
                      />
                      <span className="font-mono truncate">
                        {rule.type}: {getRuleTarget(rule)}
                      </span>
                    </div>
                    {!isSystem && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRule(idx);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Add rule panel */}
            {!isSystem && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold uppercase tracking-wider">
                    Add Rule
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {["set", "transform", "lookup", "conditional"].map((t) => (
                      <Button
                        key={t}
                        variant={addingRuleType === t ? "default" : "outline"}
                        size="sm"
                        className="text-xs px-2 py-1 h-7"
                        onClick={() => {
                          setAddingRuleType(addingRuleType === t ? null : t);
                          resetNewRuleForm();
                        }}
                      >
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-1"
                          style={{ backgroundColor: RULE_COLORS[t] }}
                        />
                        {t}
                      </Button>
                    ))}
                  </div>

                  {/* SET form */}
                  {addingRuleType === "set" && (
                    <div className="space-y-2 pt-2 border-t">
                      <Select value={newRuleTarget} onValueChange={setNewRuleTarget}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Target field" />
                        </SelectTrigger>
                        <SelectContent>
                          {targetFields.map((f) => (
                            <SelectItem key={f.name} value={f.name}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <input
                        type="text"
                        value={newSetValue}
                        onChange={(e) => setNewSetValue(e.target.value)}
                        placeholder="Constant value"
                        className="w-full rounded border px-2 py-1 text-xs"
                      />
                      <Button size="sm" className="w-full h-7 text-xs" onClick={handleAddSet}>
                        <Plus className="mr-1 h-3 w-3" /> Add Set Rule
                      </Button>
                    </div>
                  )}

                  {/* TRANSFORM form */}
                  {addingRuleType === "transform" && (
                    <div className="space-y-2 pt-2 border-t">
                      <Select value={newRuleTarget} onValueChange={setNewRuleTarget}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Target field" />
                        </SelectTrigger>
                        <SelectContent>
                          {targetFields.map((f) => (
                            <SelectItem key={f.name} value={f.name}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={newTransformFn} onValueChange={setNewTransformFn}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Function" />
                        </SelectTrigger>
                        <SelectContent>
                          {BUILTIN_FUNCTIONS.map((f) => (
                            <SelectItem key={f.name} value={f.name}>
                              {f.name}({f.params.join(", ")})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={newTransformParam} onValueChange={setNewTransformParam}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Source field for first param" />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceFields.map((f) => (
                            <SelectItem key={f.name} value={f.name}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="w-full h-7 text-xs" onClick={handleAddTransform}>
                        <Plus className="mr-1 h-3 w-3" /> Add Transform Rule
                      </Button>
                    </div>
                  )}

                  {/* LOOKUP form */}
                  {addingRuleType === "lookup" && (
                    <div className="space-y-2 pt-2 border-t">
                      <Select value={newRuleTarget} onValueChange={setNewRuleTarget}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Target field" />
                        </SelectTrigger>
                        <SelectContent>
                          {targetFields.map((f) => (
                            <SelectItem key={f.name} value={f.name}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <input
                        type="text"
                        value={newLookupTable}
                        onChange={(e) => setNewLookupTable(e.target.value)}
                        placeholder="Lookup table name"
                        className="w-full rounded border px-2 py-1 text-xs"
                      />
                      <Select value={newLookupSource} onValueChange={setNewLookupSource}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Source field to look up" />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceFields.map((f) => (
                            <SelectItem key={f.name} value={f.name}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="w-full h-7 text-xs" onClick={handleAddLookup}>
                        <Plus className="mr-1 h-3 w-3" /> Add Lookup Rule
                      </Button>
                    </div>
                  )}

                  {/* CONDITIONAL form */}
                  {addingRuleType === "conditional" && (
                    <div className="space-y-2 pt-2 border-t">
                      <Select value={newCondField} onValueChange={setNewCondField}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Condition field" />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceFields.map((f) => (
                            <SelectItem key={f.name} value={f.name}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex gap-1">
                        <Select value={newCondOp} onValueChange={setNewCondOp}>
                          <SelectTrigger className="h-8 text-xs w-[80px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["==", "!=", ">", "<", ">=", "<=", "contains", "startsWith"].map(
                              (op) => (
                                <SelectItem key={op} value={op}>
                                  {op}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                        <input
                          type="text"
                          value={newCondValue}
                          onChange={(e) => setNewCondValue(e.target.value)}
                          placeholder="Value"
                          className="flex-1 rounded border px-2 py-1 text-xs"
                        />
                      </div>
                      <Button
                        size="sm"
                        className="w-full h-7 text-xs"
                        onClick={handleAddConditional}
                      >
                        <Plus className="mr-1 h-3 w-3" /> Add Conditional Rule
                      </Button>
                      <p className="text-[10px] text-muted-foreground">
                        Then/else branches can be edited in the Code tab.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Legend */}
            <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground px-1">
              {Object.entries(RULE_COLORS).map(([type, color]) => (
                <span key={type} className="flex items-center gap-1">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {type}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Code Tab */}
      {activeTab === "code" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">TML Rules JSON</span>
            <Badge variant={codeValid ? "secondary" : "destructive"}>
              {codeValid ? (
                <>
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Valid JSON
                </>
              ) : (
                <>
                  <XCircle className="mr-1 h-3 w-3" /> Invalid JSON
                </>
              )}
            </Badge>
          </div>
          <textarea
            value={codeText}
            onChange={(e) => handleCodeChange(e.target.value)}
            readOnly={isSystem}
            className="w-full min-h-[500px] rounded-lg border bg-slate-950 text-green-400 font-mono text-xs p-4 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}
