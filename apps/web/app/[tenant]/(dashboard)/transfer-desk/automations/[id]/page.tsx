"use client";

/**
 * Transfer Desk — Automation detail page
 *
 * Shows the automation pipeline with:
 *   - Vertical step list with arrows and status badges
 *   - Inline step editor (add/remove steps, reorder, failOnError toggle)
 *   - Schedule section (add/edit/toggle cron schedules)
 *   - "Run Now" button for immediate execution
 *   - Recent execution history
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useUserRole } from "../../../../../../components/use-user-role";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  getTransferAutomation,
  updateTransferAutomation,
  runTransferAutomation,
  listTransferProfiles,
  type TransferAutomationDetail,
  type TransferProfileSummary
} from "../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
  PlayCircle,
  Save,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  GripVertical,
  CalendarClock,
  Power
} from "lucide-react";

const CRON_PRESETS = [
  { label: "Daily 02:00", cron: "0 2 * * *" },
  { label: "Daily 06:00", cron: "0 6 * * *" },
  { label: "Weekdays 07:00", cron: "0 7 * * 1-5" },
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Monthly 1st 03:00", cron: "0 3 1 * *" }
];

export default function AutomationDetailPage() {
  const params = useParams<{ id: string }>();
  const apiCtx = useApiContext();
  const { canTransferDeskDesigner } = useUserRole();
  const href = useTenantHref();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["transfer-automation", params.id],
    queryFn: () => getTransferAutomation(apiCtx, params.id!)
  });

  const { data: profilesData } = useQuery({
    queryKey: ["transfer-profiles"],
    queryFn: () => listTransferProfiles(apiCtx)
  });

  const automation: TransferAutomationDetail | null = data?.data ?? null;
  const profiles: TransferProfileSummary[] = profilesData?.data ?? [];

  // Editable state
  const [editName, setEditName] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState<string | null>(null);
  const [editSteps, setEditSteps] = useState<Array<{
    profileId: string;
    profileName: string;
    failOnError: boolean;
  }> | null>(null);
  const [editSchedules, setEditSchedules] = useState<Array<{
    cronExpression: string;
    timezone: string;
    isActive: boolean;
  }> | null>(null);
  const [addProfileId, setAddProfileId] = useState("");
  const [dirty, setDirty] = useState(false);

  // Initialize edit state from loaded data
  const startEditing = useCallback(() => {
    if (!automation) return;
    setEditName(automation.name);
    setEditDescription(automation.description ?? "");
    setEditSteps(
      automation.steps.map((s) => ({
        profileId: s.profileId,
        profileName: s.profile?.name ?? s.profileId,
        failOnError: s.failOnError
      }))
    );
    setEditSchedules(
      automation.schedules.map((s) => ({
        cronExpression: s.cronExpression,
        timezone: s.timezone,
        isActive: s.isActive
      }))
    );
    setDirty(false);
  }, [automation]);

  const isEditing = editSteps !== null;

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!automation) throw new Error("No automation");
      return updateTransferAutomation(apiCtx, automation.id, {
        name: editName ?? undefined,
        description: editDescription ?? undefined,
        steps: editSteps?.map((s, i) => ({
          profileId: s.profileId,
          stepOrder: i + 1,
          failOnError: s.failOnError
        })),
        schedules: editSchedules ?? undefined
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["transfer-automation", params.id]
      });
      setEditSteps(null);
      setEditSchedules(null);
      setEditName(null);
      setEditDescription(null);
      setDirty(false);
    }
  });

  // Run now mutation
  const runMutation = useMutation({
    mutationFn: () => runTransferAutomation(apiCtx, params.id!),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["transfer-automation", params.id]
      });
    }
  });

  // Toggle enabled
  const toggleEnabledMutation = useMutation({
    mutationFn: () =>
      updateTransferAutomation(apiCtx, params.id!, {
        isEnabled: !automation?.isEnabled
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["transfer-automation", params.id]
      });
    }
  });

  // Step editing helpers
  const handleAddStep = useCallback(() => {
    if (!addProfileId || !editSteps) return;
    const profile = profiles.find((p) => p.id === addProfileId);
    if (!profile) return;
    setEditSteps([
      ...editSteps,
      { profileId: profile.id, profileName: profile.name, failOnError: true }
    ]);
    setAddProfileId("");
    setDirty(true);
  }, [addProfileId, profiles, editSteps]);

  const handleRemoveStep = useCallback(
    (index: number) => {
      if (!editSteps) return;
      setEditSteps(editSteps.filter((_, i) => i !== index));
      setDirty(true);
    },
    [editSteps]
  );

  const handleMoveStep = useCallback(
    (index: number, direction: "up" | "down") => {
      if (!editSteps) return;
      const next = [...editSteps];
      const swapIdx = direction === "up" ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return;
      [next[index], next[swapIdx]] = [next[swapIdx]!, next[index]!];
      setEditSteps(next);
      setDirty(true);
    },
    [editSteps]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading automation...
      </div>
    );
  }

  if (error || !automation) {
    return (
      <div className="flex items-center justify-center py-20 text-red-600">
        Failed to load automation
      </div>
    );
  }

  const currentSteps = isEditing
    ? editSteps!
    : automation.steps.map((s) => ({
        profileId: s.profileId,
        profileName: s.profile?.name ?? s.profileId,
        failOnError: s.failOnError
      }));

  const currentSchedules = isEditing
    ? editSchedules!
    : automation.schedules.map((s) => ({
        cronExpression: s.cronExpression,
        timezone: s.timezone,
        isActive: s.isActive
      }));

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href={href("/transfer-desk/automations")}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            {isEditing ? (
              <input
                type="text"
                value={editName ?? ""}
                onChange={(e) => {
                  setEditName(e.target.value);
                  setDirty(true);
                }}
                className="text-2xl font-bold tracking-tight bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-emerald-500"
              />
            ) : (
              <h1 className="text-2xl font-bold tracking-tight">{automation.name}</h1>
            )}
            <p className="text-sm text-muted-foreground mt-0.5">
              {automation.description || "No description"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canTransferDeskDesigner && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleEnabledMutation.mutate()}
                disabled={toggleEnabledMutation.isPending}
              >
                <Power className="mr-1.5 h-3.5 w-3.5" />
                {automation.isEnabled ? "Disable" : "Enable"}
              </Button>
              {!isEditing ? (
                <Button variant="outline" size="sm" onClick={startEditing}>
                  Edit
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={!dirty || saveMutation.isPending}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
              )}
              <Button
                variant="teal"
                size="sm"
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || automation.steps.length === 0}
              >
                <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
                {runMutation.isPending ? "Running..." : "Run Now"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Status badges */}
      <div className="flex items-center gap-2">
        <Badge
          variant={automation.isEnabled ? "default" : "secondary"}
          className={
            automation.isEnabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
          }
        >
          {automation.isEnabled ? "Enabled" : "Disabled"}
        </Badge>
        <Badge variant="outline">{automation.steps.length} steps</Badge>
        {automation.schedules.length > 0 && (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            {automation.schedules.length} schedule
            {automation.schedules.length > 1 ? "s" : ""}
          </Badge>
        )}
      </div>

      {runMutation.isSuccess && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Automation started successfully! Check execution history below for progress.
        </div>
      )}
      {runMutation.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Failed to run: {(runMutation.error as Error).message}
        </div>
      )}

      {/* Pipeline visualization */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-slate-400" />
            Pipeline Steps
          </CardTitle>
        </CardHeader>
        <CardContent>
          {currentSteps.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No steps defined. Add profiles to build the pipeline.
            </p>
          ) : (
            <div className="space-y-1">
              {currentSteps.map((s, i) => (
                <div key={`${s.profileId}-${i}`}>
                  <div className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2.5">
                    {isEditing && <GripVertical className="h-4 w-4 text-slate-300 shrink-0" />}
                    <div
                      className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        i === 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{s.profileName}</p>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        s.failOnError
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                    >
                      {s.failOnError ? "Stop on fail" : "Continue"}
                    </span>
                    {isEditing && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() =>
                            setEditSteps(
                              editSteps!.map((st, idx) =>
                                idx === i ? { ...st, failOnError: !st.failOnError } : st
                              )
                            )
                          }
                        >
                          <AlertTriangle className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleMoveStep(i, "up")}
                          disabled={i === 0}
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleMoveStep(i, "down")}
                          disabled={i === currentSteps.length - 1}
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500"
                          onClick={() => handleRemoveStep(i)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </>
                    )}
                  </div>
                  {/* Arrow between steps */}
                  {i < currentSteps.length - 1 && (
                    <div className="flex justify-center py-0.5">
                      <ArrowDown className="h-4 w-4 text-slate-300" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add step (editing mode) */}
          {isEditing && (
            <div className="flex gap-2 mt-3">
              <Select value={addProfileId} onValueChange={setAddProfileId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Add a profile step..." />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={handleAddStep} disabled={!addProfileId}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedules */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            Schedules
          </CardTitle>
        </CardHeader>
        <CardContent>
          {currentSchedules.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No schedules. This automation can only be run manually.
            </p>
          ) : (
            <div className="space-y-2">
              {currentSchedules.map((sched, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5"
                >
                  <code className="text-sm font-mono bg-slate-100 px-2 py-0.5 rounded">
                    {sched.cronExpression}
                  </code>
                  <Badge variant="outline" className="text-xs">
                    {sched.timezone}
                  </Badge>
                  <span
                    className={`h-2 w-2 rounded-full ${sched.isActive ? "bg-emerald-500" : "bg-slate-300"}`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {sched.isActive ? "Active" : "Paused"}
                  </span>
                  {isEditing && (
                    <>
                      {/* Cron presets */}
                      <div className="flex-1 flex flex-wrap gap-1">
                        {CRON_PRESETS.map((p) => (
                          <button
                            key={p.cron}
                            onClick={() => {
                              setEditSchedules(
                                editSchedules!.map((s, idx) =>
                                  idx === i ? { ...s, cronExpression: p.cron } : s
                                )
                              );
                              setDirty(true);
                            }}
                            className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                              sched.cronExpression === p.cron
                                ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                                : "text-slate-400 border-slate-200"
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500"
                        onClick={() => {
                          setEditSchedules(editSchedules!.filter((_, idx) => idx !== i));
                          setDirty(true);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {isEditing && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                setEditSchedules([
                  ...(editSchedules ?? []),
                  {
                    cronExpression: "0 2 * * *",
                    timezone: "UTC",
                    isActive: true
                  }
                ]);
                setDirty(true);
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Schedule
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Execution History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <PlayCircle className="h-4 w-4 text-slate-400" />
            Recent Executions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!automation.executions || automation.executions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No executions yet. Run the automation to see results here.
            </p>
          ) : (
            <div className="space-y-2">
              {automation.executions.map((exec) => (
                <div
                  key={exec.id}
                  className="flex items-center gap-3 rounded-lg border bg-white px-3 py-2.5 text-sm"
                >
                  {exec.status === "COMPLETED" ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                  ) : exec.status === "FAILED" ? (
                    <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                  ) : (
                    <Clock className="h-4 w-4 text-amber-500 shrink-0 animate-spin" />
                  )}
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      exec.status === "COMPLETED"
                        ? "bg-green-50 text-green-700 border-green-200"
                        : exec.status === "FAILED"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {exec.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {exec.recordsSucceeded}/{exec.recordsTotal} records
                  </span>
                  {exec.errorMessage && (
                    <span className="text-xs text-red-500 truncate flex-1">
                      {exec.errorMessage}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto shrink-0">
                    {exec.startedAt ? new Date(exec.startedAt).toLocaleString() : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {saveMutation.error && (
        <p className="text-sm text-red-600">
          Failed to save: {(saveMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
