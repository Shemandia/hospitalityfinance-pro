"use client";

/**
 * Wizard state management hook for Transfer Desk profile creation/editing.
 *
 * Manages: current step, form data per step, step validation status,
 * navigation logic with conditional steps (IMPORT/EXPORT show Step 2,
 * other types skip it).
 */

import { useCallback, useMemo, useState } from "react";
import type { ProfileType, WizardStep } from "../types";
import type { Step1FormData, Step2FormData, Step3FormData, Step4FormData } from "../validation";
import { getApplicableSteps, getWizardSteps } from "../constants";

// ── Wizard form data per step ───────────────────────────────────────────────

export type WizardFormData = {
  step1: Step1FormData | null;
  step2: Step2FormData | null;
  step3: Step3FormData | null;
  step4: Step4FormData | null;
};

const INITIAL_FORM_DATA: WizardFormData = {
  step1: null,
  step2: null,
  step3: null,
  step4: null
};

// ── Step validation tracking ────────────────────────────────────────────────

export type StepValidation = Record<WizardStep, boolean>;

const INITIAL_VALIDATION: StepValidation = {
  1: false,
  2: false,
  3: false,
  4: false,
  5: false,
  6: false
};

// ── Hook ────────────────────────────────────────────────────────────────────

export type UseWizardStateOptions = {
  /** Profile type if editing an existing profile */
  initialProfileType?: ProfileType;
  /** Initial form data when editing */
  initialFormData?: Partial<WizardFormData>;
  /** Mode */
  mode?: "create" | "edit";
};

export function useWizardState(options: UseWizardStateOptions = {}) {
  const { mode = "create", initialFormData } = options;

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [formData, setFormData] = useState<WizardFormData>({
    ...INITIAL_FORM_DATA,
    ...initialFormData
  });
  const [validation, setValidation] = useState<StepValidation>(INITIAL_VALIDATION);
  const [isDirty, setIsDirty] = useState(false);

  // Derive profile type from Step 1 form data
  const profileType: ProfileType | null = formData.step1?.profileType ?? null;

  // Steps config based on current profile type
  const stepsInfo = useMemo(
    () => (profileType ? getWizardSteps(profileType) : getWizardSteps("IMPORT")),
    [profileType]
  );

  const applicableSteps = useMemo(
    () => (profileType ? getApplicableSteps(profileType) : ([1, 2, 3, 4, 5, 6] as WizardStep[])),
    [profileType]
  );

  // Find current position in applicable steps array
  const currentIndex = applicableSteps.indexOf(currentStep);

  const canGoBack = currentIndex > 0;
  const canGoForward = currentIndex < applicableSteps.length - 1 && validation[currentStep];
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === applicableSteps.length - 1;

  // ── Navigation ──────────────────────────────────────────────────────────

  const goNext = useCallback(() => {
    if (!canGoForward) return;
    const nextStep = applicableSteps[currentIndex + 1];
    if (nextStep) setCurrentStep(nextStep);
  }, [canGoForward, applicableSteps, currentIndex]);

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    const prevStep = applicableSteps[currentIndex - 1];
    if (prevStep) setCurrentStep(prevStep);
  }, [canGoBack, applicableSteps, currentIndex]);

  const goToStep = useCallback(
    (step: WizardStep) => {
      // Can only navigate to completed steps or current step
      const targetIndex = applicableSteps.indexOf(step);
      if (targetIndex < 0) return; // step not applicable
      if (targetIndex > currentIndex) return; // can't skip forward
      setCurrentStep(step);
    },
    [applicableSteps, currentIndex]
  );

  // ── Data updates ────────────────────────────────────────────────────────

  const setStepData = useCallback(
    <K extends keyof WizardFormData>(step: K, data: WizardFormData[K]) => {
      setFormData((prev) => ({ ...prev, [step]: data }));
      setIsDirty(true);
    },
    []
  );

  const setStepValid = useCallback((step: WizardStep, valid: boolean) => {
    setValidation((prev) => {
      if (prev[step] === valid) return prev;
      return { ...prev, [step]: valid };
    });
  }, []);

  // When profile type changes in step 1, reset step 2 if it was
  // previously applicable but no longer is (or vice versa)
  const updateStep1 = useCallback(
    (data: Step1FormData) => {
      const oldType = formData.step1?.profileType;
      setFormData((prev) => {
        const next = { ...prev, step1: data };
        // If switching from FSD type to non-FSD type, clear step 2
        if (oldType !== data.profileType) {
          const oldApplicable = oldType ? getApplicableSteps(oldType) : [];
          const newApplicable = getApplicableSteps(data.profileType);
          if (oldApplicable.includes(2) && !newApplicable.includes(2)) {
            next.step2 = null;
          }
        }
        return next;
      });
      setValidation((prev) => ({ ...prev, 1: true }));
      setIsDirty(true);
    },
    [formData.step1?.profileType]
  );

  const updateStep2 = useCallback((data: Step2FormData) => {
    setFormData((prev) => ({ ...prev, step2: data }));
    setValidation((prev) => ({ ...prev, 2: true }));
    setIsDirty(true);
  }, []);

  const updateStep3 = useCallback((data: Step3FormData) => {
    setFormData((prev) => ({ ...prev, step3: data }));
    setValidation((prev) => ({ ...prev, 3: true }));
    setIsDirty(true);
  }, []);

  const updateStep4 = useCallback((data: Step4FormData) => {
    setFormData((prev) => ({ ...prev, step4: data }));
    setValidation((prev) => ({ ...prev, 4: true }));
    setIsDirty(true);
  }, []);

  // ── Computed helpers ────────────────────────────────────────────────────

  /** Check if a step has been completed (valid + data set) */
  const isStepComplete = useCallback((step: WizardStep) => validation[step], [validation]);

  /** Get the highest completed step index */
  const highestCompletedIndex = useMemo(() => {
    let highest = -1;
    for (let i = 0; i < applicableSteps.length; i++) {
      if (validation[applicableSteps[i]]) {
        highest = i;
      } else {
        break;
      }
    }
    return highest;
  }, [applicableSteps, validation]);

  return {
    // State
    currentStep,
    formData,
    profileType,
    mode,
    isDirty,

    // Step info
    stepsInfo,
    applicableSteps,
    isFirstStep,
    isLastStep,

    // Navigation
    canGoBack,
    canGoForward,
    goNext,
    goBack,
    goToStep,

    // Data
    setStepData,
    setStepValid,
    updateStep1,
    updateStep2,
    updateStep3,
    updateStep4,

    // Helpers
    isStepComplete,
    highestCompletedIndex,
    validation
  };
}

export type WizardState = ReturnType<typeof useWizardState>;
