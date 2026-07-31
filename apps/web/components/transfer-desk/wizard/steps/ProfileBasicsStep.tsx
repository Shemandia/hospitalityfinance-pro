"use client";

/**
 * Step 1 — Profile Basics
 *
 * Card-based profile type selector with icon + description for each of the 5 types.
 * Fields: name, description, journal source code, target entity, target ledger, tags.
 * Uses React Hook Form + Zod (step1Schema).
 */

import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { step1Schema, type Step1FormData } from "../../../../lib/transfer-desk/validation";
import { PROFILE_TYPES } from "../../../../lib/transfer-desk/constants";
import type { ProfileType } from "../../../../lib/transfer-desk/types";
import { useEntity } from "../../../entity-provider";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/select";
import { Download, Upload, Cog, ArrowLeftRight, Globe, X } from "lucide-react";

// ── Type icons & colors ─────────────────────────────────────────────────────

const TYPE_ICONS: Record<ProfileType, React.ComponentType<{ className?: string }>> = {
  IMPORT: Download,
  EXPORT: Upload,
  INTERNAL_TRANSFER: ArrowLeftRight,
  EXTERNAL_TRANSFER: Globe,
  PROCESS: Cog
};

const TYPE_COLORS: Record<ProfileType, { selected: string; idle: string }> = {
  IMPORT: {
    selected: "border-blue-400 bg-blue-50 text-blue-700 shadow-sm shadow-blue-100",
    idle: "border-slate-200 hover:border-blue-200 hover:bg-blue-50/30"
  },
  EXPORT: {
    selected: "border-purple-400 bg-purple-50 text-purple-700 shadow-sm shadow-purple-100",
    idle: "border-slate-200 hover:border-purple-200 hover:bg-purple-50/30"
  },
  INTERNAL_TRANSFER: {
    selected: "border-amber-400 bg-amber-50 text-amber-700 shadow-sm shadow-amber-100",
    idle: "border-slate-200 hover:border-amber-200 hover:bg-amber-50/30"
  },
  EXTERNAL_TRANSFER: {
    selected: "border-emerald-400 bg-emerald-50 text-emerald-700 shadow-sm shadow-emerald-100",
    idle: "border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/30"
  },
  PROCESS: {
    selected: "border-slate-400 bg-slate-50 text-slate-700 shadow-sm shadow-slate-100",
    idle: "border-slate-200 hover:border-slate-300 hover:bg-slate-50/30"
  }
};

// ── Props ───────────────────────────────────────────────────────────────────

type ProfileBasicsStepProps = {
  data: Step1FormData | null;
  onSubmit: (data: Step1FormData) => void;
  onValidChange: (valid: boolean) => void;
};

export function ProfileBasicsStep({ data, onSubmit, onValidChange }: ProfileBasicsStepProps) {
  const { entities, currentEntity, isLoading: entitiesLoading } = useEntity();
  const properties = useMemo(
    () => entities.filter((e) => e.type === "PROPERTY" && e.isActive !== false),
    [entities]
  );

  const form = useForm<Step1FormData>({
    resolver: zodResolver(step1Schema),
    defaultValues: data ?? {
      name: "",
      profileType: "IMPORT",
      description: "",
      entityId: currentEntity?.type === "PROPERTY" ? currentEntity.id : "",
      journalSourceCode: "",
      targetLedgerId: "",
      tags: []
    },
    mode: "onChange"
  });

  // Auto-fill entityId from sidebar entity when it becomes available
  useEffect(() => {
    const current = form.getValues("entityId");
    if (current) return; // already set (from data or user)
    if (currentEntity && currentEntity.type === "PROPERTY") {
      form.setValue("entityId", currentEntity.id, { shouldValidate: true, shouldDirty: true });
    }
  }, [currentEntity, form]);

  const { isValid, isDirty } = form.formState;
  const watchedValues = form.watch();

  // Report validation state to parent
  useEffect(() => {
    onValidChange(isValid);
  }, [isValid, onValidChange]);

  // Auto-submit on valid changes (debounced via form state)
  useEffect(() => {
    if (isValid && isDirty) {
      onSubmit(watchedValues);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid, isDirty, JSON.stringify(watchedValues)]);

  // ── Tag management ──────────────────────────────────────────────────────

  const tags = form.watch("tags") ?? [];

  function addTag(value: string) {
    const trimmed = value.trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= 20) return;
    form.setValue("tags", [...tags, trimmed], { shouldValidate: true, shouldDirty: true });
  }

  function removeTag(index: number) {
    form.setValue(
      "tags",
      tags.filter((_, i) => i !== index),
      { shouldValidate: true, shouldDirty: true }
    );
  }

  return (
    <Form {...form}>
      <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
        {/* Profile Type Selector */}
        <FormField
          control={form.control}
          name="profileType"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium text-slate-700">
                Profile Type <span className="text-red-400">*</span>
              </FormLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {PROFILE_TYPES.map((pt) => {
                  const Icon = TYPE_ICONS[pt.value];
                  const isSelected = field.value === pt.value;
                  const colors = TYPE_COLORS[pt.value];
                  return (
                    <button
                      key={pt.value}
                      type="button"
                      onClick={() => {
                        field.onChange(pt.value);
                      }}
                      className={`
                        flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left
                        transition-all
                        ${isSelected ? colors.selected : colors.idle}
                      `}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`
                            h-8 w-8 rounded-lg flex items-center justify-center
                            ${isSelected ? "bg-current/10" : "bg-slate-100"}
                          `}
                        >
                          <Icon className={`h-4 w-4 ${isSelected ? "" : "text-slate-400"}`} />
                        </div>
                        <div>
                          <span className="text-sm font-semibold">{pt.label}</span>
                          <span className="ml-2 text-[10px] font-medium opacity-60 uppercase">
                            {pt.direction}
                          </span>
                        </div>
                      </div>
                      <p className="text-[11px] leading-snug opacity-70">{pt.description}</p>
                    </button>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Profile Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Profile Name <span className="text-red-400">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="e.g. Opera PMS Revenue Import"
                  maxLength={100}
                  className="max-w-md"
                />
              </FormControl>
              <FormDescription>
                Must start with a letter or number. Letters, numbers, spaces, hyphens, underscores
                allowed.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <textarea
                  {...field}
                  placeholder="Optional description of what this profile does..."
                  rows={3}
                  maxLength={500}
                  className="w-full max-w-md rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Target Entity */}
        <FormField
          control={form.control}
          name="entityId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Target Entity <span className="text-red-400">*</span>
              </FormLabel>
              {entitiesLoading ? (
                <div className="h-9 w-full max-w-md rounded-md bg-muted animate-pulse" />
              ) : properties.length === 0 ? (
                <p className="text-sm text-destructive">
                  No properties available. Contact your administrator.
                </p>
              ) : (
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="max-w-md">
                      <SelectValue placeholder="Select a property…" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {properties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground ml-2 text-[10px]">
                          {p.functionalCurrency}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <FormDescription>
                The property this profile targets. Auto-filled from your current entity.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
          {/* Journal Source Code */}
          <FormField
            control={form.control}
            name="journalSourceCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Journal Source Code</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="e.g. JANAP, OPERA"
                    maxLength={10}
                    className="font-mono uppercase"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Target Ledger */}
          <FormField
            control={form.control}
            name="targetLedgerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Target Ledger</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Ledger ID" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Tags */}
        <div className="space-y-2 max-w-md">
          <label className="text-sm font-medium">Tags</label>
          <div className="flex flex-wrap gap-1.5 min-h-[32px]">
            {tags.map((tag, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(i)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <Input
            placeholder="Type and press Enter to add a tag"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(e.currentTarget.value);
                e.currentTarget.value = "";
              }
            }}
          />
          <p className="text-[0.8rem] text-muted-foreground">
            Up to 20 tags for filtering and grouping.
          </p>
        </div>
      </form>
    </Form>
  );
}
