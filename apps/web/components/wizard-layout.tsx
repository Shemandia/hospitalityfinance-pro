"use client";

import { Check, Home } from "lucide-react";
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
  /** Optional footer card at the bottom of the sidebar (e.g. tenant info) */
  sidebarFooter?: React.ReactNode;
};

export function WizardLayout({
  title,
  steps,
  currentStep,
  completedSteps,
  onStepClick,
  children,
  sidebarFooter
}: WizardLayoutProps) {
  return (
    <div className="flex min-h-screen bg-[#f8fafc]">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="w-[280px] flex-shrink-0 bg-white border-r border-slate-200 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
        {/* Brand */}
        <div className="px-6 py-8 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-[34px] h-[34px] bg-emerald-500 rounded-[10px] flex items-center justify-center text-white shadow-[0_4px_10px_rgba(16,185,129,0.2)]">
              <Home className="h-[18px] w-[18px]" />
            </div>
            <div>
              <h2 className="text-[16px] font-extrabold text-slate-900 leading-none">
                Hospitality
              </h2>
              <span className="text-[10px] font-extrabold text-emerald-500 uppercase tracking-[0.1em]">
                Finance Pro
              </span>
            </div>
          </div>
        </div>

        {/* Step navigation */}
        <nav className="flex-1 px-3 py-6 space-y-1">
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
                  "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-200",
                  isCurrent && "bg-emerald-50",
                  !isCurrent && !isCompleted && "opacity-50",
                  isClickable && "cursor-pointer hover:bg-slate-50",
                  !isClickable && "cursor-default"
                )}
              >
                {/* Step indicator circle */}
                <span
                  className={cn(
                    "flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold transition-all",
                    isCompleted && "bg-emerald-100 text-emerald-500",
                    isCurrent &&
                      !isCompleted &&
                      "bg-emerald-500 text-white shadow-[0_2px_8px_rgba(16,185,129,0.3)]",
                    !isCurrent && !isCompleted && "border-2 border-slate-200 text-slate-400"
                  )}
                >
                  {isCompleted ? <Check className="h-3 w-3" strokeWidth={3} /> : step.id}
                </span>
                {/* Step label */}
                <span
                  className={cn(
                    "text-[13px] truncate",
                    isCurrent && "font-bold text-emerald-900",
                    isCompleted && !isCurrent && "font-semibold text-slate-500",
                    !isCurrent && !isCompleted && "font-medium text-slate-400"
                  )}
                >
                  {step.name}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar footer */}
        {sidebarFooter && <div className="mx-4 mb-4">{sidebarFooter}</div>}
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[800px] px-16 py-16">{children}</div>
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
      {/* Header */}
      <div className="mb-12">
        <p className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-2">
          Step {stepNumber} of {totalSteps}
        </p>
        <h1 className="text-[32px] font-extrabold text-slate-900 tracking-[-0.02em] leading-tight">
          {title}
        </h1>
        <p className="mt-2 text-base text-slate-500">{description}</p>
      </div>

      {/* Content */}
      <div>{children}</div>

      {/* Footer actions */}
      <div className="mt-12 flex items-center justify-between border-t border-slate-100 pt-8">
        <div>
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-xl px-5 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-all"
            >
              Back
            </button>
          )}
        </div>
        <div className="flex gap-3">
          {showSave && onSave && (
            <button
              onClick={onSave}
              disabled={isLoading}
              className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-50"
            >
              Save & Continue Later
            </button>
          )}
          {onNext && (
            <button
              onClick={onNext}
              disabled={isNextDisabled || isLoading}
              className="rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(15,23,42,0.2)] hover:bg-slate-800 transition-all disabled:opacity-50"
            >
              {isLoading ? "Processing..." : nextLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
