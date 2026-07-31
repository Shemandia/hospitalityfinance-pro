"use client";

/**
 * Step 4 — Validation Rules & Options
 *
 * Collapsible sections:
 * 1. Validation Rules — editable table with field, type, config, severity
 * 2. Error Handling — radio buttons (REJECT_ROW / REJECT_FILE / QUARANTINE)
 * 3. Duplicate Detection — enabled toggle, key fields, action
 * 4. Posting Options (IMPORT only) — auto-post, require approval, batch grouping
 *
 * React Hook Form + Zod (step4Schema).
 */

import { useCallback, useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { step4Schema, type Step4FormData } from "../../../../lib/transfer-desk/validation";
import type { ProfileType } from "../../../../lib/transfer-desk/types";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
  FormDescription
} from "../../../ui/form";
import { Input } from "../../../ui/input";
import { Button } from "../../../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../ui/table";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Settings2
} from "lucide-react";

// ── Props ───────────────────────────────────────────────────────────────────

type ValidationStepProps = {
  data: Step4FormData | null;
  profileType: ProfileType | null;
  onSubmit: (data: Step4FormData) => void;
  onValidChange: (valid: boolean) => void;
};

// ── Default values ──────────────────────────────────────────────────────────

const DEFAULTS: Step4FormData = {
  validationRules: [],
  errorHandling: {
    strategy: "REJECT_ROW",
    maxErrors: undefined
  },
  duplicateDetection: {
    enabled: false,
    keyFields: [],
    action: "SKIP"
  },
  postingOptions: {
    autoPost: false,
    requireApproval: true,
    batchGrouping: "PER_FILE",
    batchSize: undefined
  }
};

const RULE_TYPES = [
  { value: "REQUIRED", label: "Required" },
  { value: "CROSS_FIELD", label: "Cross-Field" },
  { value: "RANGE", label: "Range Check" },
  { value: "PATTERN", label: "Pattern Match" },
  { value: "CUSTOM_EXPRESSION", label: "Custom Expression" }
] as const;

const SEVERITY_OPTIONS = [
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" }
] as const;

// ── Component ───────────────────────────────────────────────────────────────

export function ValidationStep({
  data,
  profileType,
  onSubmit,
  onValidChange
}: ValidationStepProps) {
  const form = useForm<Step4FormData>({
    resolver: zodResolver(step4Schema),
    defaultValues: data ?? DEFAULTS,
    mode: "onChange"
  });

  const {
    fields: ruleFields,
    append: appendRule,
    remove: removeRule
  } = useFieldArray({
    control: form.control,
    name: "validationRules"
  });

  const { isValid, isDirty } = form.formState;
  const watchedValues = form.watch();

  // Sections collapse state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    rules: true,
    errorHandling: true,
    duplicateDetection: true,
    postingOptions: true
  });

  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Report validation to parent
  useEffect(() => {
    // Step 4 is always valid (all fields have defaults/are optional)
    onValidChange(true);
  }, [onValidChange]);

  // Propagate changes
  useEffect(() => {
    if (isDirty) {
      onSubmit(watchedValues);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, JSON.stringify(watchedValues)]);

  const isImport = profileType === "IMPORT";

  // ── Key fields for duplicate detection ──────────────────────────────────

  const keyFields = form.watch("duplicateDetection.keyFields") ?? [];

  function addKeyField(value: string) {
    const trimmed = value.trim();
    if (!trimmed || keyFields.includes(trimmed)) return;
    form.setValue("duplicateDetection.keyFields", [...keyFields, trimmed], {
      shouldDirty: true
    });
  }

  function removeKeyField(index: number) {
    form.setValue(
      "duplicateDetection.keyFields",
      keyFields.filter((_, i) => i !== index),
      { shouldDirty: true }
    );
  }

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
        {/* ── Section: Validation Rules ─────────────────────────────────── */}
        <CollapsibleSection
          title="Validation Rules"
          icon={<ShieldCheck className="h-4 w-4" />}
          isOpen={openSections.rules}
          onToggle={() => toggleSection("rules")}
          count={ruleFields.length}
        >
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] w-32">Type</TableHead>
                    <TableHead className="text-[10px] min-w-[120px]">Field</TableHead>
                    <TableHead className="text-[10px] min-w-[160px]">Description</TableHead>
                    <TableHead className="text-[10px] w-24">Severity</TableHead>
                    <TableHead className="text-[10px] w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ruleFields.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-6 text-xs text-slate-400">
                        No validation rules. Add rules to validate incoming data.
                      </TableCell>
                    </TableRow>
                  ) : (
                    ruleFields.map((field, index) => (
                      <TableRow key={field.id}>
                        <TableCell className="py-1 px-1">
                          <FormField
                            control={form.control}
                            name={`validationRules.${index}.type`}
                            render={({ field: f }) => (
                              <Select value={f.value} onValueChange={f.onChange}>
                                <SelectTrigger className="h-7 text-[11px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {RULE_TYPES.map((rt) => (
                                    <SelectItem key={rt.value} value={rt.value} className="text-xs">
                                      {rt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <FormField
                            control={form.control}
                            name={`validationRules.${index}.field`}
                            render={({ field: f }) => (
                              <Input
                                {...f}
                                placeholder="field.name"
                                className="h-7 text-xs font-mono"
                              />
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <FormField
                            control={form.control}
                            name={`validationRules.${index}.description`}
                            render={({ field: f }) => (
                              <Input
                                {...f}
                                placeholder="Rule description"
                                className="h-7 text-xs"
                              />
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <FormField
                            control={form.control}
                            name={`validationRules.${index}.severity`}
                            render={({ field: f }) => (
                              <Select value={f.value} onValueChange={f.onChange}>
                                <SelectTrigger className="h-7 text-[11px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {SEVERITY_OPTIONS.map((s) => (
                                    <SelectItem key={s.value} value={s.value} className="text-xs">
                                      {s.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-1 px-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeRule(index)}
                            className="h-7 w-7 p-0 text-slate-400 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                appendRule({
                  id: `rule_${Date.now()}`,
                  type: "REQUIRED",
                  field: "",
                  description: "",
                  config: {},
                  severity: "error"
                })
              }
              className="gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" /> Add Rule
            </Button>
          </div>
        </CollapsibleSection>

        {/* ── Section: Error Handling ───────────────────────────────────── */}
        <CollapsibleSection
          title="Error Handling"
          icon={<AlertTriangle className="h-4 w-4" />}
          isOpen={openSections.errorHandling}
          onToggle={() => toggleSection("errorHandling")}
        >
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="errorHandling.strategy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Strategy</FormLabel>
                  <div className="space-y-2">
                    {(
                      [
                        {
                          value: "REJECT_ROW",
                          label: "Reject Row",
                          desc: "Skip invalid rows, continue processing the rest"
                        },
                        {
                          value: "REJECT_FILE",
                          label: "Reject File",
                          desc: "Abort the entire file on the first error"
                        },
                        {
                          value: "QUARANTINE",
                          label: "Quarantine",
                          desc: "Move invalid rows to quarantine for manual review"
                        }
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.value}
                        className={`
                          flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors
                          ${
                            field.value === opt.value
                              ? "border-emerald-300 bg-emerald-50/50"
                              : "border-slate-200 hover:border-slate-300"
                          }
                        `}
                      >
                        <input
                          type="radio"
                          name="errorHandling.strategy"
                          value={opt.value}
                          checked={field.value === opt.value}
                          onChange={() => field.onChange(opt.value)}
                          className="mt-0.5 accent-emerald-600"
                        />
                        <div>
                          <span className="text-sm font-medium text-slate-700">{opt.label}</span>
                          <p className="text-[11px] text-slate-500 mt-0.5">{opt.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch("errorHandling.strategy") === "REJECT_ROW" && (
              <FormField
                control={form.control}
                name="errorHandling.maxErrors"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Max Errors Before Abort</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value ? Number(e.target.value) : undefined)
                        }
                        placeholder="Unlimited"
                        className="w-32 text-sm"
                        min={1}
                      />
                    </FormControl>
                    <FormDescription>Leave blank for no limit.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>
        </CollapsibleSection>

        {/* ── Section: Duplicate Detection ──────────────────────────────── */}
        <CollapsibleSection
          title="Duplicate Detection"
          icon={<Copy className="h-4 w-4" />}
          isOpen={openSections.duplicateDetection}
          onToggle={() => toggleSection("duplicateDetection")}
        >
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="duplicateDetection.enabled"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={field.value}
                      onChange={(e) => field.onChange(e.target.checked)}
                      className="rounded border-slate-300 accent-emerald-600"
                    />
                    <span className="text-sm font-medium text-slate-700">
                      Enable duplicate detection
                    </span>
                  </label>
                </FormItem>
              )}
            />

            {form.watch("duplicateDetection.enabled") && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-600">Key Fields</label>
                  <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                    {keyFields.map((kf, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600 font-mono"
                      >
                        {kf}
                        <button
                          type="button"
                          onClick={() => removeKeyField(i)}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <Input
                    placeholder="Type field name and press Enter"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addKeyField(e.currentTarget.value);
                        e.currentTarget.value = "";
                      }
                    }}
                    className="text-xs font-mono max-w-xs"
                  />
                </div>

                <FormField
                  control={form.control}
                  name="duplicateDetection.action"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Action on Duplicate</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-40 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="SKIP">Skip</SelectItem>
                          <SelectItem value="OVERWRITE">Overwrite</SelectItem>
                          <SelectItem value="ERROR">Error</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}
          </div>
        </CollapsibleSection>

        {/* ── Section: Posting Options (IMPORT only) ───────────────────── */}
        {isImport && (
          <CollapsibleSection
            title="Posting Options"
            icon={<Settings2 className="h-4 w-4" />}
            isOpen={openSections.postingOptions}
            onToggle={() => toggleSection("postingOptions")}
          >
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="postingOptions.autoPost"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="rounded border-slate-300 accent-emerald-600"
                      />
                      <span className="text-sm text-slate-700">
                        Auto-post journals after import
                      </span>
                    </label>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="postingOptions.requireApproval"
                render={({ field }) => (
                  <FormItem>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        className="rounded border-slate-300 accent-emerald-600"
                      />
                      <span className="text-sm text-slate-700">
                        Require approval before posting
                      </span>
                    </label>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="postingOptions.batchGrouping"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Journal Batch Grouping</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-48 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="PER_FILE">Per File</SelectItem>
                        <SelectItem value="PER_ROW">Per Row</SelectItem>
                        <SelectItem value="PER_N_ROWS">Per N Rows</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {form.watch("postingOptions.batchGrouping") === "PER_N_ROWS" && (
                <FormField
                  control={form.control}
                  name="postingOptions.batchSize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Batch Size (rows per journal)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value ? Number(e.target.value) : undefined)
                          }
                          placeholder="100"
                          className="w-32 text-sm"
                          min={1}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          </CollapsibleSection>
        )}
      </form>
    </Form>
  );
}

// ── Collapsible Section ─────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  icon,
  isOpen,
  onToggle,
  count,
  children
}: {
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-50/50 transition-colors"
      >
        <span className="text-slate-400">{icon}</span>
        <span className="text-sm font-semibold text-slate-700 flex-1">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
            {count}
          </span>
        )}
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {isOpen && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}
