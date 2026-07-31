"use client";

/**
 * WizardContainer — Main wizard shell for Transfer Desk profile creation/editing.
 *
 * Renders the step indicator, current step content, and action toolbar
 * (Back, Next, Save Draft) following the HFP §9 pattern: action buttons
 * in the top-right toolbar on the same line as the page title.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTenantHref, useTenantRouter } from "../../../hooks/use-tenant-router";
import { useApiContext } from "../../use-api-context";
import { createProfile, updateProfile } from "../../../lib/transfer-desk/api";
import {
  useWizardState,
  type UseWizardStateOptions
} from "../../../lib/transfer-desk/hooks/useWizardState";
import { WizardStepper } from "./WizardStepper";
import { ProfileBasicsStep } from "./steps/ProfileBasicsStep";
import { FileFormatStep } from "./steps/FileFormatStep";
import { FieldMappingStep } from "./steps/FieldMappingStep";
import { ValidationStep } from "./steps/ValidationStep";
import { TestPreviewStep } from "./steps/TestPreviewStep";
import { ReviewActivateStep } from "./steps/ReviewActivateStep";
import { Card, CardContent } from "../../ui/card";
import { Button } from "../../ui/button";
import { ArrowLeft, ArrowRight, Save, ListChecks, Loader2 } from "lucide-react";

type WizardContainerProps = {
  mode?: "create" | "edit";
  profileId?: string;
  options?: UseWizardStateOptions;
};

export function WizardContainer({ mode = "create", profileId, options }: WizardContainerProps) {
  const tenantHref = useTenantHref();
  const router = useTenantRouter();
  const apiContext = useApiContext();
  const wizard = useWizardState({ ...options, mode });
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Save Draft mutation ─────────────────────────────────────────────────

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("No API context");
      const step1 = wizard.formData.step1;
      if (!step1) throw new Error("Profile basics are required");

      const payload = {
        name: step1.name,
        profileType: step1.profileType,
        description: step1.description || undefined,
        entityId: step1.entityId,
        journalSourceCode: step1.journalSourceCode || undefined,
        targetLedgerId: step1.targetLedgerId || undefined,
        tags: step1.tags
      };

      if (mode === "edit" && profileId) {
        return updateProfile(apiContext, profileId, payload);
      }
      return createProfile(apiContext, payload);
    },
    onSuccess: (result) => {
      toast.success("Draft saved");
      const id = result.data?.id ?? profileId;
      if (id) {
        router.push(`/transfer-desk/profiles/${id}`);
      } else {
        router.push("/transfer-desk/profiles");
      }
    },
    onError: (err: Error) => {
      setSaveError(err.message);
      toast.error("Failed to save draft", { description: err.message });
    }
  });

  const handleSaveDraft = useCallback(() => {
    setSaveError(null);
    saveDraftMutation.mutate();
  }, [saveDraftMutation]);

  // ── Stable per-step onValidChange callbacks ─────────────────────────────

  const onValidChange1 = useCallback(
    (v: boolean) => wizard.setStepValid(1, v),
    [wizard.setStepValid]
  );
  const onValidChange2 = useCallback(
    (v: boolean) => wizard.setStepValid(2, v),
    [wizard.setStepValid]
  );
  const onValidChange3 = useCallback(
    (v: boolean) => wizard.setStepValid(3, v),
    [wizard.setStepValid]
  );
  const onValidChange4 = useCallback(
    (v: boolean) => wizard.setStepValid(4, v),
    [wizard.setStepValid]
  );
  const onValidChange5 = useCallback(
    (v: boolean) => wizard.setStepValid(5, v),
    [wizard.setStepValid]
  );
  const onValidChange6 = useCallback(
    (v: boolean) => wizard.setStepValid(6, v),
    [wizard.setStepValid]
  );

  // ── Step rendering ──────────────────────────────────────────────────────

  function renderStep() {
    switch (wizard.currentStep) {
      case 1:
        return (
          <ProfileBasicsStep
            data={wizard.formData.step1}
            onSubmit={wizard.updateStep1}
            onValidChange={onValidChange1}
          />
        );
      case 2:
        return (
          <FileFormatStep
            data={wizard.formData.step2}
            onSubmit={wizard.updateStep2}
            onValidChange={onValidChange2}
          />
        );
      case 3:
        return (
          <FieldMappingStep
            data={wizard.formData.step3}
            sourceFields={wizard.formData.step2?.fields ?? []}
            onSubmit={wizard.updateStep3}
            onValidChange={onValidChange3}
          />
        );
      case 4:
        return (
          <ValidationStep
            data={wizard.formData.step4}
            profileType={wizard.profileType}
            onSubmit={wizard.updateStep4}
            onValidChange={onValidChange4}
          />
        );
      case 5:
        return <TestPreviewStep profileId={profileId} onValidChange={onValidChange5} />;
      case 6:
        return (
          <ReviewActivateStep
            formData={wizard.formData}
            profileType={wizard.profileType}
            profileId={profileId}
            mode={mode}
            validation={wizard.validation}
            onValidChange={onValidChange6}
          />
        );
      default:
        return null;
    }
  }

  // ── Title ───────────────────────────────────────────────────────────────

  const typeLabel = wizard.profileType
    ? wizard.profileType
        .replace(/_/g, " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : "";
  const title =
    mode === "edit" ? `Edit Profile` : typeLabel ? `New ${typeLabel} Profile` : "New Profile";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {/* Back link */}
      <Link
        href={tenantHref("/transfer-desk/profiles")}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Profiles
      </Link>

      {/* Header with action buttons (§9: top-right toolbar) */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-(--color-primary) flex items-center gap-2">
            <ListChecks className="h-5 w-5" /> {title}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Transfer Desk <span className="text-slate-300 mx-1">/</span>{" "}
            {mode === "edit" ? "Edit" : "Create"} Profile
          </p>
        </div>

        {/* Action buttons: Save Draft, Back, Next */}
        <div className="flex items-center gap-2 shrink-0">
          {wizard.formData.step1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
              disabled={saveDraftMutation.isPending}
              className="gap-1.5"
            >
              {saveDraftMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save Draft
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={wizard.goBack}
            disabled={!wizard.canGoBack}
            className="gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <Button
            variant="teal"
            size="sm"
            onClick={wizard.goNext}
            disabled={!wizard.canGoForward}
            className="gap-1.5"
          >
            Next <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Step indicator */}
      <WizardStepper
        steps={wizard.stepsInfo}
        currentStep={wizard.currentStep}
        validation={wizard.validation}
        onStepClick={wizard.goToStep}
      />

      {/* Error banner */}
      {saveError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      {/* Step content */}
      <Card>
        <CardContent className="p-6">{renderStep()}</CardContent>
      </Card>
    </div>
  );
}
