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
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import { useUserRole } from "../../../../../../components/use-user-role";
import { Card, CardContent } from "../../../../../../components/ui/card";
import { Button } from "../../../../../../components/ui/button";
import { ArrowLeft, ArrowRight, Check, ListChecks, Lock } from "lucide-react";
import type { TransferProfileType } from "../../../../../../lib/gl-api";

// ── Wizard form state ─────────────────────────────────────────────────────

export type WizardFormState = {
  // Step 1
  profileType: TransferProfileType | null;
  name: string;
  description: string;
  // Step 2
  sourceComponent: string;
  sourceMethod: string;
  targetComponent: string;
  targetMethod: string;
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
  sourceMethod: "",
  targetComponent: "",
  targetMethod: "",
  sourceFormatId: "",
  targetFormatId: "",
  transformationId: ""
};

// ── Step definitions ──────────────────────────────────────────────────────

const STEPS = [
  { number: 1, label: "Type & Basics" },
  { number: 2, label: "Source & Target" },
  { number: 3, label: "Formats" },
  { number: 4, label: "FSD Viewer" },
  { number: 5, label: "Review & Submit" }
] as const;

// ── Step placeholder components (replaced in commits 4-8) ─────────────────

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
          <StepPlaceholder step={currentStep} />
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
