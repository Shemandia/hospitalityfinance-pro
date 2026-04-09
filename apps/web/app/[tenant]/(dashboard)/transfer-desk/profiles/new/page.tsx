"use client";

/**
 * Transfer Desk — Profile Creation Wizard (UI-URL-003 / UI-PAGE-004)
 *
 * Multi-step wizard for creating a new TransferProfile.
 *
 * Steps:
 *   1. Type & Basics  — profile type, name, description
 *   2. Source & Target — component/method selection
 *   3. Formats         — source/target format, transformation
 *   4. FSD Viewer      — read-only FSD summary + raw JSON
 *   5. Review & Submit — confirmation + POST /profiles
 */

import { useState, useCallback } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import { useUserRole } from "../../../../../../components/use-user-role";
import { useApiContext } from "../../../../../../components/use-api-context";
import { Card, CardContent } from "../../../../../../components/ui/card";
import { Button } from "../../../../../../components/ui/button";
import { Input } from "../../../../../../components/ui/input";
import { Label } from "../../../../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ListChecks,
  Lock,
  Download,
  Upload,
  Cog,
  ArrowLeftRight,
  Globe
} from "lucide-react";
import {
  TRANSFER_PROFILE_TYPES,
  listTransferFormats,
  getTransferFormat,
  type TransferProfileType,
  type TransferFormatSummary
} from "../../../../../../lib/gl-api";

// ── Wizard form state ─────────────────────────────────────────────────────

export type WizardFormState = {
  // Step 1
  profileType: TransferProfileType | null;
  name: string;
  description: string;
  // Step 2
  sourceComponent: string;
  targetComponent: string;
  // Step 3
  sourceFormatId: string;
  targetFormatId: string;
  transformationId: string;
};

const INITIAL_STATE: WizardFormState = {
  profileType: null,
  name: "",
  description: "",
  sourceComponent: "",
  targetComponent: "",
  sourceFormatId: "",
  targetFormatId: "",
  transformationId: ""
};

/** Components available as source/target in transfer profiles (matches backend GET /transfer-desk/components) */
const TRANSFER_COMPONENTS = [
  { value: "GL_JOURNAL", label: "General Ledger Journal" },
  { value: "AP_INVOICE", label: "AP Invoice" },
  { value: "AR_INVOICE", label: "AR Invoice" },
  { value: "AR_RECEIPT", label: "AR Receipt" },
  { value: "COA_ACCOUNT", label: "Chart of Accounts" },
  { value: "BUDGET", label: "Budget" },
  { value: "BANK_STATEMENT", label: "Bank Statement" }
] as const;

// ── Step definitions ──────────────────────────────────────────────────────

const STEPS = [
  { number: 1, label: "Type & Basics" },
  { number: 2, label: "Source & Target" },
  { number: 3, label: "Formats" },
  { number: 4, label: "FSD Viewer" },
  { number: 5, label: "Review & Submit" }
] as const;

// ── Step components ───────────────────────────────────────────────────────

const TYPE_ICONS: Record<TransferProfileType, React.ComponentType<{ className?: string }>> = {
  IMPORT: Download,
  EXPORT: Upload,
  PROCESS: Cog,
  INTERNAL_TRANSFER: ArrowLeftRight,
  EXTERNAL_TRANSFER: Globe
};

const TYPE_COLORS: Record<TransferProfileType, string> = {
  IMPORT: "border-blue-200 bg-blue-50 text-blue-700",
  EXPORT: "border-purple-200 bg-purple-50 text-purple-700",
  PROCESS: "border-slate-200 bg-slate-50 text-slate-700",
  INTERNAL_TRANSFER: "border-amber-200 bg-amber-50 text-amber-700",
  EXTERNAL_TRANSFER: "border-emerald-200 bg-emerald-50 text-emerald-700"
};

function Step1TypeAndBasics({
  form,
  updateForm
}: {
  form: WizardFormState;
  updateForm: (patch: Partial<WizardFormState>) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Profile type selector */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">Profile Type</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {TRANSFER_PROFILE_TYPES.map((pt) => {
            const Icon = TYPE_ICONS[pt.value];
            const isSelected = form.profileType === pt.value;
            return (
              <button
                key={pt.value}
                type="button"
                onClick={() => updateForm({ profileType: pt.value })}
                className={`
                  flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left
                  transition-all hover:shadow-sm
                  ${
                    isSelected
                      ? `${TYPE_COLORS[pt.value]} border-current shadow-sm`
                      : "border-slate-150 bg-white hover:border-slate-300"
                  }
                `}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-semibold">{pt.label}</span>
                </div>
                <p className="text-[11px] leading-snug opacity-75">{pt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="profile-name" className="text-sm font-medium text-slate-700">
          Profile Name <span className="text-red-400">*</span>
        </Label>
        <Input
          id="profile-name"
          value={form.name}
          onChange={(e) => updateForm({ name: e.target.value })}
          placeholder="e.g. Opera PMS Revenue Import"
          maxLength={100}
          className="max-w-md"
        />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <Label htmlFor="profile-desc" className="text-sm font-medium text-slate-700">
          Description
        </Label>
        <textarea
          id="profile-desc"
          value={form.description}
          onChange={(e) => updateForm({ description: e.target.value })}
          placeholder="Optional description of what this profile does…"
          rows={3}
          maxLength={500}
          className="w-full max-w-md rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
      </div>
    </div>
  );
}

/** Which component fields are required/shown per profile type */
function getComponentVisibility(profileType: TransferProfileType | null) {
  switch (profileType) {
    case "IMPORT":
      return { showSource: false, showTarget: true, targetRequired: true };
    case "EXPORT":
      return { showSource: true, showTarget: false, targetRequired: false };
    case "PROCESS":
      return { showSource: false, showTarget: true, targetRequired: true };
    case "INTERNAL_TRANSFER":
    case "EXTERNAL_TRANSFER":
      return { showSource: true, showTarget: true, targetRequired: true };
    default:
      return { showSource: true, showTarget: true, targetRequired: false };
  }
}

function Step2SourceTarget({
  form,
  updateForm
}: {
  form: WizardFormState;
  updateForm: (patch: Partial<WizardFormState>) => void;
}) {
  const vis = getComponentVisibility(form.profileType);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Configure the source and target components for this{" "}
        <span className="font-medium text-slate-700">
          {form.profileType?.replace(/_/g, " ").toLowerCase()}
        </span>{" "}
        profile.
      </p>

      {vis.showSource && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700">Source Component</Label>
          <Select
            value={form.sourceComponent || undefined}
            onValueChange={(v) => updateForm({ sourceComponent: v })}
          >
            <SelectTrigger className="w-full max-w-md text-sm">
              <SelectValue placeholder="Select source component…" />
            </SelectTrigger>
            <SelectContent>
              {TRANSFER_COMPONENTS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-slate-400">Where data is read from.</p>
        </div>
      )}

      {vis.showTarget && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium text-slate-700">
            Target Component{vis.targetRequired && <span className="text-red-400 ml-0.5">*</span>}
          </Label>
          <Select
            value={form.targetComponent || undefined}
            onValueChange={(v) => updateForm({ targetComponent: v })}
          >
            <SelectTrigger className="w-full max-w-md text-sm">
              <SelectValue placeholder="Select target component…" />
            </SelectTrigger>
            <SelectContent>
              {TRANSFER_COMPONENTS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-slate-400">Where data is written to.</p>
        </div>
      )}

      {!vis.showSource && !vis.showTarget && (
        <div className="rounded-md bg-slate-50 border border-slate-100 p-4 text-sm text-slate-500">
          No component selection needed for this profile type.
        </div>
      )}
    </div>
  );
}

function Step3Formats({
  form,
  updateForm,
  apiContext
}: {
  form: WizardFormState;
  updateForm: (patch: Partial<WizardFormState>) => void;
  apiContext: ReturnType<typeof useApiContext>;
}) {
  const formatsQ = useQuery({
    queryKey: ["td-formats", apiContext?.tenantSlug],
    queryFn: () => (apiContext ? listTransferFormats(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r) => ((r as any).data as TransferFormatSummary[]) ?? []
  });

  const formats = formatsQ.data ?? [];

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Select the data formats used by this profile. Formats define the file structure (delimited,
        fixed-width, XML) that the Transfer Desk reads or writes.
      </p>

      {formatsQ.isLoading && <p className="text-xs text-slate-400">Loading formats…</p>}

      {/* Source Format */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-slate-700">Source Format</Label>
        <Select
          value={form.sourceFormatId || undefined}
          onValueChange={(v) => updateForm({ sourceFormatId: v })}
        >
          <SelectTrigger className="w-full max-w-md text-sm">
            <SelectValue placeholder="Select source format…" />
          </SelectTrigger>
          <SelectContent>
            {formats.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                <span>{f.name}</span>
                <span className="ml-2 text-[10px] text-slate-400">{f.classification}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-slate-400">
          The FSD format definition for the inbound file/data.
        </p>
      </div>

      {/* Target Format */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-slate-700">Target Format</Label>
        <Select
          value={form.targetFormatId || undefined}
          onValueChange={(v) => updateForm({ targetFormatId: v })}
        >
          <SelectTrigger className="w-full max-w-md text-sm">
            <SelectValue placeholder="Select target format…" />
          </SelectTrigger>
          <SelectContent>
            {formats.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                <span>{f.name}</span>
                <span className="ml-2 text-[10px] text-slate-400">{f.classification}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-slate-400">
          The FSD format definition for the outbound data.
        </p>
      </div>

      {/* Transformation — placeholder selector (no backend list endpoint this sprint) */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-slate-700">Transformation (optional)</Label>
        <Input
          value={form.transformationId}
          onChange={(e) => updateForm({ transformationId: e.target.value })}
          placeholder="Transformation UUID (manual entry for now)"
          className="max-w-md font-mono text-xs"
        />
        <p className="text-[11px] text-slate-400">
          TML transformation to apply between source and target formats. The transformation browser
          is coming in a future sprint.
        </p>
      </div>

      {formats.length === 0 && !formatsQ.isLoading && (
        <div className="rounded-md bg-amber-50 border border-amber-100 p-3 text-xs text-amber-700">
          No formats have been created yet. You can still create the profile and assign formats
          later.
        </div>
      )}
    </div>
  );
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  DELIMITED: "Delimited (CSV / TSV / pipe)",
  SINGLE_FIXED: "Single fixed-width record",
  MULTIPLE_FIXED: "Multiple fixed-width records",
  OTHER_FLAT: "Other flat file",
  USER_XML: "User-defined XML",
  SIMPLE_XML: "Simple XML"
};

function FsdFormatCard({
  label,
  formatId,
  apiContext
}: {
  label: string;
  formatId: string;
  apiContext: ReturnType<typeof useApiContext>;
}) {
  const formatQ = useQuery({
    queryKey: ["td-format-detail", formatId],
    queryFn: () => (apiContext ? getTransferFormat(apiContext, formatId) : Promise.resolve(null)),
    enabled: Boolean(apiContext) && Boolean(formatId),
    select: (r) => (r as any)?.data ?? null
  });

  const format = formatQ.data;

  if (formatQ.isLoading) {
    return <p className="text-xs text-slate-400">Loading {label.toLowerCase()} format…</p>;
  }
  if (!format) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">{label}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <div>
          <span className="text-slate-400">Name</span>
          <p className="font-medium text-slate-700">{format.name}</p>
        </div>
        <div>
          <span className="text-slate-400">Classification</span>
          <p className="font-medium text-slate-700">
            {CLASSIFICATION_LABELS[format.classification] ?? format.classification}
          </p>
        </div>
        <div>
          <span className="text-slate-400">Valid</span>
          <p
            className={
              format.isValid ? "text-emerald-600 font-medium" : "text-amber-600 font-medium"
            }
          >
            {format.isValid ? "Yes" : "No"}
          </p>
        </div>
        <div>
          <span className="text-slate-400">System format</span>
          <p className="font-medium text-slate-700">{format.isSystem ? "Yes" : "No"}</p>
        </div>
      </div>

      {/* Raw FSD XML textarea */}
      <div className="space-y-1">
        <Label className="text-xs text-slate-500">Raw FSD Definition</Label>
        <textarea
          readOnly
          value={format.fsdXml ?? ""}
          rows={10}
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600 leading-relaxed resize-y focus:outline-none"
        />
      </div>
    </div>
  );
}

function Step4FsdViewer({
  form,
  apiContext
}: {
  form: WizardFormState;
  apiContext: ReturnType<typeof useApiContext>;
}) {
  const hasSource = Boolean(form.sourceFormatId);
  const hasTarget = Boolean(form.targetFormatId);

  if (!hasSource && !hasTarget) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
        No formats selected. Go back to Step 3 to select source or target formats, or skip this
        step.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">
        Read-only preview of the selected FSD format definitions. The full graphical FSD builder is
        planned for a future sprint.
      </p>

      {hasSource && (
        <FsdFormatCard
          label="Source Format"
          formatId={form.sourceFormatId}
          apiContext={apiContext}
        />
      )}

      {hasSource && hasTarget && <hr className="border-slate-100" />}

      {hasTarget && (
        <FsdFormatCard
          label="Target Format"
          formatId={form.targetFormatId}
          apiContext={apiContext}
        />
      )}
    </div>
  );
}

function StepPlaceholder({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
      Step {step} content — coming next
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────

export default function NewTransferProfilePage() {
  const tenantHref = useTenantHref();
  const role = useUserRole();
  const apiContext = useApiContext();

  const [currentStep, setCurrentStep] = useState(1);
  const [form, setForm] = useState<WizardFormState>(INITIAL_STATE);

  const updateForm = useCallback(
    (patch: Partial<WizardFormState>) => setForm((prev) => ({ ...prev, ...patch })),
    []
  );

  if (!role.canTransferDeskDesigner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Designer access required</h2>
        <p className="text-sm text-slate-500 max-w-md">
          You need at least the <code className="font-mono">transfer:designer</code> role to create
          profiles.
        </p>
      </div>
    );
  }

  const canGoNext = (() => {
    switch (currentStep) {
      case 1:
        return form.profileType !== null && form.name.trim().length > 0;
      case 2:
        return true; // source/target can be optional depending on type
      case 3:
        return true; // formats optional for PROCESS type
      case 4:
        return true; // viewer is informational
      default:
        return true;
    }
  })();

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      {/* Back link */}
      <Link
        href={tenantHref("/transfer-desk/profiles")}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Profiles
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-(--color-primary) flex items-center gap-2">
          <ListChecks className="h-5 w-5" /> New Profile
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Create a transfer profile in {STEPS.length} steps.
        </p>
      </div>

      {/* Step indicator */}
      <nav className="flex items-center gap-1">
        {STEPS.map((step, idx) => {
          const isActive = step.number === currentStep;
          const isCompleted = step.number < currentStep;
          return (
            <div key={step.number} className="flex items-center gap-1">
              {idx > 0 && (
                <div className={`h-px w-6 ${isCompleted ? "bg-emerald-400" : "bg-slate-200"}`} />
              )}
              <button
                type="button"
                onClick={() => step.number < currentStep && setCurrentStep(step.number)}
                disabled={step.number > currentStep}
                className={`
                  flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium
                  transition-colors
                  ${
                    isActive
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : isCompleted
                        ? "bg-emerald-50/50 text-emerald-600 cursor-pointer hover:bg-emerald-50"
                        : "bg-slate-50 text-slate-400 border border-slate-100 cursor-not-allowed"
                  }
                `}
              >
                {isCompleted ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-current/10 text-[10px] font-bold">
                    {step.number}
                  </span>
                )}
                {step.label}
              </button>
            </div>
          );
        })}
      </nav>

      {/* Step content */}
      <Card>
        <CardContent className="p-6">
          {currentStep === 1 && <Step1TypeAndBasics form={form} updateForm={updateForm} />}
          {currentStep === 2 && <Step2SourceTarget form={form} updateForm={updateForm} />}
          {currentStep === 3 && (
            <Step3Formats form={form} updateForm={updateForm} apiContext={apiContext} />
          )}
          {currentStep === 4 && <Step4FsdViewer form={form} apiContext={apiContext} />}
          {currentStep === 5 && <StepPlaceholder step={currentStep} />}
        </CardContent>
      </Card>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
          disabled={currentStep === 1}
          className="gap-1.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        {currentStep < STEPS.length ? (
          <Button
            variant="teal"
            size="sm"
            onClick={() => setCurrentStep((s) => Math.min(STEPS.length, s + 1))}
            disabled={!canGoNext}
            className="gap-1.5"
          >
            Next <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant="teal" size="sm" disabled className="gap-1.5">
            <Check className="h-3.5 w-3.5" /> Create Profile
          </Button>
        )}
      </div>
    </div>
  );
}
