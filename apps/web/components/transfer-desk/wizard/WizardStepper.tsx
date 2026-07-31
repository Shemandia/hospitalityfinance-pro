"use client";

/**
 * WizardStepper — Horizontal step indicator for the Transfer Desk wizard.
 *
 * Shows all applicable steps with:
 * - Current step highlighted (emerald)
 * - Completed steps with checkmarks, clickable to go back
 * - Future steps greyed out, not clickable
 */

import { Check } from "lucide-react";
import type { WizardStep, WizardStepInfo } from "../../../lib/transfer-desk/types";

type WizardStepperProps = {
  steps: WizardStepInfo[];
  currentStep: WizardStep;
  validation: Record<WizardStep, boolean>;
  onStepClick: (step: WizardStep) => void;
};

export function WizardStepper({ steps, currentStep, validation, onStepClick }: WizardStepperProps) {
  // Only show applicable steps
  const applicableSteps = steps.filter((s) => s.applicable);

  return (
    <nav className="flex items-center gap-1 overflow-x-auto pb-1">
      {applicableSteps.map((stepInfo, idx) => {
        const isActive = stepInfo.step === currentStep;
        const isCompleted = validation[stepInfo.step] && stepInfo.step !== currentStep;
        const isFuture = !isActive && !isCompleted;
        const canClick = isCompleted; // can only click back to completed

        return (
          <div key={stepInfo.step} className="flex items-center gap-1">
            {idx > 0 && (
              <div
                className={`h-px w-6 shrink-0 ${
                  isCompleted || isActive ? "bg-emerald-300" : "bg-slate-200"
                }`}
              />
            )}
            <button
              type="button"
              onClick={() => canClick && onStepClick(stepInfo.step)}
              disabled={!canClick}
              title={stepInfo.description}
              className={`
                flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium
                transition-colors whitespace-nowrap
                ${
                  isActive
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm"
                    : isCompleted
                      ? "bg-emerald-50/50 text-emerald-600 cursor-pointer hover:bg-emerald-100"
                      : "bg-slate-50 text-slate-400 border border-slate-100 cursor-not-allowed"
                }
              `}
            >
              {isCompleted ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <span
                  className={`
                    inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold
                    ${
                      isActive
                        ? "bg-emerald-600 text-white"
                        : isFuture
                          ? "bg-slate-200 text-slate-400"
                          : "bg-emerald-100 text-emerald-600"
                    }
                  `}
                >
                  {stepInfo.step}
                </span>
              )}
              <span className="hidden sm:inline">{stepInfo.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
