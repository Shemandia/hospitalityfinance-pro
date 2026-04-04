"use client";

import { Check } from "lucide-react";
import { cn } from "../lib/utils";

export type WizardStepDef = {
  id: number;
  name: string;
  description?: string;
};

type WizardLayoutProps = {
  title: string;
  steps: WizardStepDef[];
  currentStep: number;
  completedSteps: number[];
  onStepClick?: (step: number) => void;
  children: React.ReactNode;
};

export function WizardLayout({
  title,
  steps,
  currentStep,
  completedSteps,
  onStepClick,
  children
}: WizardLayoutProps) {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar stepper */}
      <aside className="w-64 flex-shrink-0 border-r bg-slate-900 text-slate-200">
        <div className="p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
        </div>
        <nav className="space-y-1 px-3">
          {steps.map((step) => {
            const isCompleted = completedSteps.includes(step.id);
            const isCurrent = step.id === currentStep;
            const isClickable =
              onStepClick && (isCompleted || step.id <= Math.max(...completedSteps, 0) + 1);

            return (
              <button
                key={step.id}
                onClick={() => isClickable && onStepClick?.(step.id)}
                disabled={!isClickable}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                  isCurrent && "bg-slate-800 text-white",
                  !isCurrent && !isCompleted && "text-slate-500",
                  isCompleted && !isCurrent && "text-slate-300",
                  isClickable && "cursor-pointer hover:bg-slate-800",
                  !isClickable && "cursor-default"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    isCurrent && "bg-blue-600 text-white",
                    isCompleted && !isCurrent && "bg-emerald-600 text-white",
                    !isCurrent && !isCompleted && "border border-slate-600 text-slate-500"
                  )}
                >
                  {isCompleted && !isCurrent ? <Check className="h-3.5 w-3.5" /> : step.id}
                </span>
                <span className="truncate">{step.name}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-white">
        <div className="mx-auto max-w-2xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}

type WizardStepContentProps = {
  stepNumber: number;
  totalSteps: number;
  title: string;
  description: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  onSave?: () => void;
  nextLabel?: string;
  isNextDisabled?: boolean;
  isLoading?: boolean;
  showSave?: boolean;
};

export function WizardStepContent({
  stepNumber,
  totalSteps,
  title,
  description,
  children,
  onBack,
  onNext,
  onSave,
  nextLabel = "Continue",
  isNextDisabled = false,
  isLoading = false,
  showSave = false
}: WizardStepContentProps) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
        Step {stepNumber} of {totalSteps}
      </p>
      <h3 className="mt-1 text-xl font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <div className="mt-6">{children}</div>
      <div className="mt-8 flex items-center justify-between border-t pt-6">
        <div>
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              ← Back
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {showSave && onSave && (
            <button
              onClick={onSave}
              disabled={isLoading}
              className="rounded-md border px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Save & Continue Later
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              disabled={isNextDisabled || isLoading}
              className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isLoading ? "Processing…" : nextLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
