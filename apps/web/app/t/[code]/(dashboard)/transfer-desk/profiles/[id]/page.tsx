"use client";

/**
 * Transfer Desk — Profile detail page (UI-URL-004 / UI-PAGE-003)
 *
 * Read-only view with:
 *   - Summary card (type, description, source→target, version, valid status)
 *   - Runtime parameters snapshot
 *   - Version history (last 10)
 *   - Run Now button that calls POST /profiles/:id/execute (TD-API-001)
 *     and navigates to the new execution detail page on success
 *
 * Edit functionality is deferred to the full profile wizard (sprint 4+).
 */

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../../components/use-permissions";
import { useTenantHref, useTenantRouter } from "../../../../../../../hooks/use-tenant-router";
import {
  getTransferProfile,
  executeTransferProfile,
  type TransferProfileDetail,
  type TransferProfileType
} from "../../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../../components/ui/card";
import { Badge } from "../../../../../../../components/ui/badge";
import { Button } from "../../../../../../../components/ui/button";
import {
  ArrowLeft,
  ListChecks,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  Lock,
  History,
  FileCog,
  Workflow
} from "lucide-react";

const TYPE_LABELS: Record<TransferProfileType, { label: string; badge: string }> = {
  IMPORT: { label: "Import", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  EXPORT: { label: "Export", badge: "bg-purple-50 text-purple-700 border-purple-200" },
  PROCESS: { label: "Process", badge: "bg-slate-50 text-slate-700 border-slate-200" },
  INTERNAL_TRANSFER: {
    label: "Internal Transfer",
    badge: "bg-amber-50 text-amber-700 border-amber-200"
  },
  EXTERNAL_TRANSFER: {
    label: "External Transfer",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200"
  }
};

export default function TransferProfileDetailPage() {
  const params = useParams();
  const profileId = params.id as string;
  const apiContext = useApiContext();
  const tenantHref = useTenantHref();
  const router = useTenantRouter();
  const role = usePermissions();
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const profileQ = useQuery<TransferProfileDetail | null>({
    queryKey: ["td-profile", apiContext?.tenantSlug, apiContext?.entityId, profileId],
    queryFn: async () => {
      if (!apiContext || !profileId) return null;
      const res = await getTransferProfile(apiContext, profileId);
      return (res.data as unknown as TransferProfileDetail) ?? null;
    },
    enabled: Boolean(apiContext && profileId) && role.canTransferDeskUser
  });

  const executeMut = useMutation({
    mutationFn: () => {
      if (!apiContext) throw new Error("No API context");
      return executeTransferProfile(apiContext, profileId);
    },
    onSuccess: (res) => {
      const data = res.data as { executionId: string; jobId: string; status: string };
      setFeedback({
        type: "success",
        message: `Queued (execution ${data.executionId.slice(0, 8)}). Redirecting…`
      });
      qc.invalidateQueries({ queryKey: ["td-executions"] });
      setTimeout(() => {
        router.push(`/transfer-desk/history/${data.executionId}`);
      }, 600);
    },
    onError: (e: Error) => setFeedback({ type: "error", message: e.message })
  });

  if (!role.canTransferDeskUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Access required</h2>
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

  const profile = profileQ.data;

  if (!profile) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4">
        <Link
          href={tenantHref("/transfer-desk/profiles")}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Profiles
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-slate-400 text-sm">
            Profile not found.
          </CardContent>
        </Card>
      </div>
    );
  }

  const type = TYPE_LABELS[profile.profileType];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {/* Breadcrumb */}
      <Link
        href={tenantHref("/transfer-desk/profiles")}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Profiles
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold border ${type.badge}`}
            >
              {type.label.toUpperCase()}
            </span>
            {profile.isValid ? (
              <Badge variant="success" className="text-[10px] gap-1">
                <CheckCircle2 className="h-2.5 w-2.5" /> Valid
              </Badge>
            ) : (
              <Badge variant="warning" className="text-[10px] gap-1">
                <AlertTriangle className="h-2.5 w-2.5" /> Invalid
              </Badge>
            )}
            {!profile.isActive && (
              <Badge variant="destructive" className="text-[10px]">
                Inactive
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px]">
              v{profile.version}
            </Badge>
          </div>
          <h1 className="text-2xl font-semibold text-(--color-primary) flex items-center gap-2 truncate">
            <ListChecks className="h-5 w-5 shrink-0" /> {profile.name}
          </h1>
          {profile.description && (
            <p className="text-sm text-slate-500 mt-1">{profile.description}</p>
          )}
        </div>
        {role.canTransferDeskPowerUser && (
          <Button
            variant="teal"
            size="sm"
            onClick={() => {
              setFeedback(null);
              executeMut.mutate();
            }}
            disabled={executeMut.isPending || !profile.isValid || !profile.isActive}
            className="gap-1.5 shrink-0"
            title={
              !profile.isValid
                ? "Profile is not valid"
                : !profile.isActive
                  ? "Profile is inactive"
                  : undefined
            }
          >
            <PlayCircle className="h-3.5 w-3.5" />
            {executeMut.isPending ? "Queuing…" : "Run Now"}
          </Button>
        )}
      </div>

      {/* Feedback banner */}
      {feedback && (
        <div
          className={`rounded-xl px-4 py-3 text-sm font-medium border ${
            feedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Summary card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileCog className="h-3.5 w-3.5 text-slate-400" /> Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1.5">
            <Row label="Source component" value={profile.sourceComponent ?? "—"} mono />
            <Row label="Target component" value={profile.targetComponent ?? "—"} mono />
            <Row label="Source format" value={profile.sourceFormat?.name ?? "—"} />
            <Row label="Target format" value={profile.targetFormat?.name ?? "—"} />
            <Row
              label="Transformation"
              value={profile.transformation?.name ?? "—"}
              icon={<Workflow className="h-3 w-3 text-slate-400" />}
            />
            <Row label="Save payload" value={profile.savePayload} mono />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <History className="h-3.5 w-3.5 text-slate-400" /> Version history
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {profile.versions && profile.versions.length > 0 ? (
              <ul className="text-xs divide-y divide-slate-100">
                {profile.versions.map((v) => (
                  <li key={v.id} className="px-4 py-2 flex items-center gap-3">
                    <Badge variant="secondary" className="text-[10px]">
                      v{v.version}
                    </Badge>
                    <span className="text-slate-500 flex-1 truncate">{v.changeNote ?? "—"}</span>
                    <span className="text-slate-400 text-[10px]">
                      {new Date(v.changedAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-xs text-slate-400">No versions yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Runtime parameters snapshot */}
      {(profile.sourceParams || profile.targetParams) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Runtime parameters</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {profile.sourceParams && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Source</p>
                <pre className="bg-slate-50 rounded-lg p-3 overflow-auto max-h-48 font-mono text-[11px]">
                  {JSON.stringify(profile.sourceParams, null, 2)}
                </pre>
              </div>
            )}
            {profile.targetParams && (
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Target</p>
                <pre className="bg-slate-50 rounded-lg p-3 overflow-auto max-h-48 font-mono text-[11px]">
                  {JSON.stringify(profile.targetParams, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Editor notice */}
      {role.canTransferDeskDesigner && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <p className="font-semibold mb-0.5">Editing</p>
          <p>
            The profile creation/edit wizard is scheduled for sprint 4. Until then you can still run
            this profile via the button above and view its execution history in{" "}
            <Link href={tenantHref("/transfer-desk/history")} className="underline font-semibold">
              Execution History
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  icon
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold text-slate-400 uppercase w-32 shrink-0">
        {label}
      </span>
      <span
        className={`text-slate-700 flex items-center gap-1.5 ${mono ? "font-mono text-xs" : "text-sm"}`}
      >
        {icon}
        {value}
      </span>
    </div>
  );
}
