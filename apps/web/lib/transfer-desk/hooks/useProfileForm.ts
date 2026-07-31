"use client";

/**
 * useProfileForm — Combines all wizard step data into a final profile payload.
 *
 * Handles create vs edit mode, assembles ProfileUpdateInput from the
 * individual step form data, and provides save/activate mutations.
 */

import { useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApiContext } from "../../../components/use-api-context";
import { useTenantRouter } from "../../../hooks/use-tenant-router";
import { createProfile, updateProfile, changeProfileStatus } from "../api";
import type { WizardFormData } from "./useWizardState";
import type { ProfileType, ProfileCreateInput, ProfileUpdateInput, ProfileStatus } from "../types";

export type UseProfileFormOptions = {
  mode: "create" | "edit";
  profileId?: string;
  profileType: ProfileType | null;
};

export type UseProfileFormReturn = {
  saveDraft: (formData: WizardFormData) => void;
  activate: (formData: WizardFormData) => void;
  isSaving: boolean;
  isActivating: boolean;
  saveError: string | null;
};

export function useProfileForm({
  mode,
  profileId,
  profileType
}: UseProfileFormOptions): UseProfileFormReturn {
  const apiContext = useApiContext();
  const router = useTenantRouter();

  /** Build the create input from step 1 data */
  const buildCreateInput = useCallback((formData: WizardFormData): ProfileCreateInput => {
    const step1 = formData.step1;
    if (!step1) throw new Error("Profile basics are required");
    return {
      name: step1.name,
      profileType: step1.profileType,
      description: step1.description || undefined,
      entityId: step1.entityId,
      journalSourceCode: step1.journalSourceCode || undefined,
      targetLedgerId: step1.targetLedgerId || undefined,
      tags: step1.tags
    };
  }, []);

  /** Build the update input from all step data */
  const buildUpdateInput = useCallback(
    (formData: WizardFormData): ProfileUpdateInput => {
      const base = buildCreateInput(formData);
      const update: ProfileUpdateInput = { ...base };

      if (formData.step2) {
        update.fsdSchema = {
          version: "1.0",
          format: formData.step2.format,
          fields: formData.step2.fields,
          options: formData.step2.options
        };
      }

      if (formData.step3) {
        update.tmlMappings = formData.step3.mappings;
      }

      if (formData.step4) {
        update.validationRules = formData.step4.validationRules;
        update.errorHandling = formData.step4.errorHandling;
        update.duplicateDetection = formData.step4.duplicateDetection;
        update.postingOptions = formData.step4.postingOptions;
      }

      return update;
    },
    [buildCreateInput]
  );

  /** Full save flow: create or update, then optionally change status */
  const saveAndRoute = useCallback(
    async (formData: WizardFormData, targetStatus: ProfileStatus) => {
      if (!apiContext) throw new Error("No API context");

      let id = profileId;

      if (mode === "create") {
        const result = await createProfile(apiContext, buildCreateInput(formData));
        id = result.data?.id;
        if (!id) throw new Error("Create failed — no profile ID returned");
      }

      if (id) {
        // Always send full update
        await updateProfile(apiContext, id, buildUpdateInput(formData));

        // Change status if needed
        if (targetStatus !== "DRAFT") {
          await changeProfileStatus(apiContext, id, { status: targetStatus });
        }
      }

      return id;
    },
    [apiContext, mode, profileId, buildCreateInput, buildUpdateInput]
  );

  // Save as draft
  const saveDraftMutation = useMutation({
    mutationFn: (formData: WizardFormData) => saveAndRoute(formData, "DRAFT"),
    onSuccess: (id) => {
      toast.success("Profile saved as draft");
      if (id) {
        router.push(`/transfer-desk/profiles/${id}`);
      } else {
        router.push("/transfer-desk/profiles");
      }
    },
    onError: (err: Error) => {
      toast.error("Failed to save draft", { description: err.message });
    }
  });

  // Activate
  const activateMutation = useMutation({
    mutationFn: (formData: WizardFormData) => saveAndRoute(formData, "ACTIVE"),
    onSuccess: (id) => {
      toast.success("Profile activated");
      if (id) {
        router.push(`/transfer-desk/profiles/${id}`);
      } else {
        router.push("/transfer-desk/profiles");
      }
    },
    onError: (err: Error) => {
      toast.error("Failed to activate profile", { description: err.message });
    }
  });

  const saveError = saveDraftMutation.error?.message ?? activateMutation.error?.message ?? null;

  /** Whether the profile type needs FSD (Step 2) */
  const _needsFsd = useMemo(
    () => profileType === "IMPORT" || profileType === "EXPORT",
    [profileType]
  );

  return {
    saveDraft: (formData: WizardFormData) => saveDraftMutation.mutate(formData),
    activate: (formData: WizardFormData) => activateMutation.mutate(formData),
    isSaving: saveDraftMutation.isPending,
    isActivating: activateMutation.isPending,
    saveError
  };
}
