"use client";

/**
 * Step 6 — Review & Activate
 *
 * Read-only summary of all settings from Steps 1-4, with
 * Save as Draft and Activate actions.
 */

import { useEffect, useMemo } from "react";
import type { WizardFormData } from "../../../../lib/transfer-desk/hooks/useWizardState";
import type { StepValidation } from "../../../../lib/transfer-desk/hooks/useWizardState";
import type { ProfileType, WizardStep } from "../../../../lib/transfer-desk/types";
import { PROFILE_TYPES, FSD_PROFILE_TYPES } from "../../../../lib/transfer-desk/constants";
import { useProfileForm } from "../../../../lib/transfer-desk/hooks/useProfileForm";
import { Card, CardContent } from "../../../ui/card";
import { Button } from "../../../ui/button";
import { Badge } from "../../../ui/badge";
import {
  Save,
  Zap,
  CheckCircle2,
  AlertTriangle,
  User,
  FileText,
  ArrowRightLeft,
  ShieldCheck,
  Loader2
} from "lucide-react";

type ReviewActivateStepProps = {
  formData: WizardFormData;
  profileType: ProfileType | null;
  profileId?: string;
  mode: "create" | "edit";
  validation: StepValidation;
  onValidChange: (valid: boolean) => void;
};

export function ReviewActivateStep({
  formData,
  profileType,
  profileId,
  mode,
  validation,
  onValidChange
}: ReviewActivateStepProps) {
  const profileForm = useProfileForm({ mode, profileId, profileType });
  const step1 = formData.step1;
  const step2 = formData.step2;
  const step3 = formData.step3;
  const step4 = formData.step4;
  const needsFsd = profileType ? FSD_PROFILE_TYPES.has(profileType) : false;

  // Step 6 is always valid (it's read-only)
  useEffect(() => {
    onValidChange(true);
  }, [onValidChange]);

  const typeLabel = useMemo(
    () => PROFILE_TYPES.find((p) => p.value === profileType)?.label ?? profileType ?? "—",
    [profileType]
  );

  // Check if test was run (step 5 valid)
  const testRun = validation[5 as WizardStep];

  return (
    <div className="space-y-6">
      {/* Warning if test not run */}
      {!testRun && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Test not run</p>
            <p className="text-xs mt-0.5">
              Consider running a test in Step 5 before activating this profile.
            </p>
          </div>
        </div>
      )}

      {/* Step 1: Profile Basics */}
      <SummarySection
        icon={<User className="h-4 w-4" />}
        title="Profile Basics"
        valid={validation[1]}
      >
        {step1 ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Field label="Name" value={step1.name} />
            <Field label="Type" value={typeLabel} />
            <Field label="Entity" value={step1.entityId} />
            <Field label="Journal Source" value={step1.journalSourceCode || "—"} />
            <Field label="Target Ledger" value={step1.targetLedgerId || "—"} />
            <Field label="Description" value={step1.description || "—"} />
            {step1.tags && step1.tags.length > 0 && (
              <div className="col-span-2">
                <span className="text-xs text-slate-500">Tags:</span>{" "}
                {step1.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px] mr-1">
                    {t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Not configured</p>
        )}
      </SummarySection>

      {/* Step 2: File Format (conditional) */}
      {needsFsd && (
        <SummarySection
          icon={<FileText className="h-4 w-4" />}
          title="File Format (FSD)"
          valid={validation[2]}
        >
          {step2 ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Field label="Format" value={step2.format.type.toUpperCase()} />
              <Field
                label="Fields"
                value={`${step2.fields.length} field${step2.fields.length !== 1 ? "s" : ""}`}
              />
              {step2.format.delimiter && (
                <Field label="Delimiter" value={JSON.stringify(step2.format.delimiter)} />
              )}
              {step2.format.encoding && <Field label="Encoding" value={step2.format.encoding} />}
              <Field label="Header Row" value={step2.format.hasHeaderRow ? "Yes" : "No"} />
            </div>
          ) : (
            <p className="text-xs text-slate-400">Not configured</p>
          )}
        </SummarySection>
      )}

      {/* Step 3: Field Mapping */}
      <SummarySection
        icon={<ArrowRightLeft className="h-4 w-4" />}
        title="Field Mapping"
        valid={validation[3]}
      >
        {step3 ? (
          <div className="text-sm">
            <Field
              label="Mappings"
              value={`${step3.mappings.length} mapping${step3.mappings.length !== 1 ? "s" : ""}`}
            />
            {step3.mappings.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {step3.mappings.slice(0, 8).map((m) => (
                  <Badge key={m.id} variant="outline" className="text-[10px] font-mono">
                    {m.sourceField} → {m.targetField}
                  </Badge>
                ))}
                {step3.mappings.length > 8 && (
                  <Badge variant="outline" className="text-[10px]">
                    +{step3.mappings.length - 8} more
                  </Badge>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Not configured</p>
        )}
      </SummarySection>

      {/* Step 4: Validation Rules */}
      <SummarySection
        icon={<ShieldCheck className="h-4 w-4" />}
        title="Validation & Posting"
        valid={validation[4]}
      >
        {step4 ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Field
              label="Validation Rules"
              value={`${step4.validationRules.length} rule${step4.validationRules.length !== 1 ? "s" : ""}`}
            />
            <Field label="Error Handling" value={step4.errorHandling.strategy.replace(/_/g, " ")} />
            <Field
              label="Duplicate Detection"
              value={step4.duplicateDetection.enabled ? "Enabled" : "Disabled"}
            />
            <Field label="Auto Post" value={step4.postingOptions.autoPost ? "Yes" : "No"} />
            <Field
              label="Batch Grouping"
              value={step4.postingOptions.batchGrouping.replace(/_/g, " ")}
            />
            {step4.postingOptions.requireApproval && (
              <Field label="Approval Required" value="Yes" />
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Not configured</p>
        )}
      </SummarySection>

      {/* Error banner */}
      {profileForm.saveError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {profileForm.saveError}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
        <Button
          variant="outline"
          size="sm"
          onClick={() => profileForm.saveDraft(formData)}
          disabled={profileForm.isSaving || profileForm.isActivating}
          className="gap-1.5"
        >
          {profileForm.isSaving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save as Draft
        </Button>
        <Button
          variant="teal"
          size="sm"
          onClick={() => profileForm.activate(formData)}
          disabled={profileForm.isSaving || profileForm.isActivating}
          className="gap-1.5"
        >
          {profileForm.isActivating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          Activate Profile
        </Button>
      </div>
    </div>
  );
}

// ── Helper Components ──────────────────────────────────────────────────────────

function SummarySection({
  icon,
  title,
  valid,
  children
}: {
  icon: React.ReactNode;
  title: string;
  valid: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-slate-500">{icon}</span>
          <h4 className="text-sm font-semibold text-slate-700 flex-1">{title}</h4>
          {valid ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-slate-500">{label}:</span>{" "}
      <span className="text-xs font-medium text-slate-800">{value}</span>
    </div>
  );
}
