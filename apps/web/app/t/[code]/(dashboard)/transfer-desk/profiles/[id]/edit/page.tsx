"use client";

/**
 * Transfer Desk — Edit Profile Wizard Page
 *
 * Fetches profile by ID, hydrates WizardContainer with existing data.
 * RBAC: requires transfer:designer role.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../../../components/use-permissions";
import { useTenantHref } from "../../../../../../../../hooks/use-tenant-router";
import { getProfile } from "../../../../../../../../lib/transfer-desk/api";
import { WizardContainer } from "../../../../../../../../components/transfer-desk/wizard/WizardContainer";
import type { WizardFormData } from "../../../../../../../../lib/transfer-desk/hooks/useWizardState";
import type { Profile } from "../../../../../../../../lib/transfer-desk/types";
import { ArrowLeft, Lock, ListChecks } from "lucide-react";

export default function EditTransferProfilePage() {
  const params = useParams();
  const profileId = params.id as string;
  const apiContext = useApiContext();
  const tenantHref = useTenantHref();
  const role = usePermissions();

  const profileQ = useQuery({
    queryKey: ["td-profile-edit", apiContext?.tenantSlug, apiContext?.entityId, profileId],
    queryFn: async () => {
      const res = await getProfile(apiContext!, profileId);
      return res.data as Profile;
    },
    enabled: Boolean(apiContext && profileId) && role.canTransferDeskDesigner
  });

  const initialFormData = useMemo<Partial<WizardFormData> | undefined>(() => {
    const profile = profileQ.data;
    if (!profile) return undefined;

    const config = profile.config as Record<string, unknown> | null;

    return {
      step1: {
        name: profile.name,
        profileType: profile.profileType,
        description: profile.description ?? "",
        entityId: profile.entityId,
        journalSourceCode: profile.journalSourceCode ?? "",
        targetLedgerId: profile.targetLedgerId ?? "",
        tags: profile.tags ?? []
      },
      step2: config?.fsdSchema
        ? {
            format: (config.fsdSchema as Record<string, unknown>)
              .format as WizardFormData["step2"] extends infer T
              ? T extends { format: infer F }
                ? F
                : never
              : never,
            fields: (config.fsdSchema as Record<string, unknown>)
              .fields as WizardFormData["step2"] extends infer T
              ? T extends { fields: infer F }
                ? F
                : never
              : never,
            options: (config.fsdSchema as Record<string, unknown>)
              .options as WizardFormData["step2"] extends infer T
              ? T extends { options?: infer O }
                ? O
                : never
              : never
          }
        : null,
      step3: config?.tmlMappings
        ? {
            mappings: config.tmlMappings as WizardFormData["step3"] extends infer T
              ? T extends { mappings: infer M }
                ? M
                : never
              : never
          }
        : null,
      step4: config?.validationRules
        ? {
            validationRules: (config.validationRules ??
              []) as WizardFormData["step4"] extends infer T
              ? T extends { validationRules: infer R }
                ? R
                : never
              : never,
            errorHandling: (config.errorHandling ?? {
              strategy: "REJECT_ROW" as const
            }) as WizardFormData["step4"] extends infer T
              ? T extends { errorHandling: infer E }
                ? E
                : never
              : never,
            duplicateDetection: (config.duplicateDetection ?? {
              enabled: false,
              keyFields: [],
              action: "SKIP" as const
            }) as WizardFormData["step4"] extends infer T
              ? T extends { duplicateDetection: infer D }
                ? D
                : never
              : never,
            postingOptions: (config.postingOptions ?? {
              autoPost: false,
              requireApproval: false,
              batchGrouping: "PER_FILE" as const
            }) as WizardFormData["step4"] extends infer T
              ? T extends { postingOptions: infer P }
                ? P
                : never
              : never
          }
        : null
    };
  }, [profileQ.data]);

  if (!role.canTransferDeskDesigner) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Designer access required</h2>
        <p className="text-sm text-slate-500 max-w-md">
          You need at least the <code className="font-mono">transfer:designer</code> role to edit
          profiles.
        </p>
      </div>
    );
  }

  if (profileQ.isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <div className="h-6 w-48 bg-slate-100 rounded animate-pulse" />
        <div className="h-32 bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (profileQ.isError || !profileQ.data) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Link
          href={tenantHref("/transfer-desk/profiles")}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Profiles
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {profileQ.isError ? (profileQ.error as Error).message : "Profile not found."}
        </div>
      </div>
    );
  }

  return (
    <WizardContainer
      mode="edit"
      profileId={profileId}
      options={{
        initialProfileType: profileQ.data.profileType,
        initialFormData
      }}
    />
  );
}
