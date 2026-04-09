"use client";

/**
 * Transfer Desk — Automation creation wizard
 *
 * 3-step wizard: Name/description → Add steps (select profiles, order, failOnError)
 * → Schedule (optional cron) + Review & Save.
 */

import Link from "next/link";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import {
  createTransferAutomation,
  listTransferProfiles,
  type AutomationCreateInput,
  type TransferProfileSummary
} from "../../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CalendarClock,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  GripVertical
} from "lucide-react";

type StepDraft = {
  profileId: string;
  profileName: string;
  failOnError: boolean;
};

type ScheduleDraft = {
  cronExpression: string;
  timezone: string;
  isActive: boolean;
};

type WizardStep = 1 | 2 | 3;

/** Common cron presets for hospitality operations */
const CRON_PRESETS = [
  { label: "Every day at 02:00", cron: "0 2 * * *" },
  { label: "Every day at 06:00", cron: "0 6 * * *" },
  { label: "Every weekday at 07:00", cron: "0 7 * * 1-5" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 15 minutes", cron: "*/15 * * * *" },
  { label: "First of month at 03:00", cron: "0 3 1 * *" }
];

export default function NewAutomationPage() {
  const apiCtx = useApiContext();
  const router = useRouter();
  const href = useTenantHref();

  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [schedules, setSchedules] = useState<ScheduleDraft[]>([]);

  // For adding a new step
  const [addProfileId, setAddProfileId] = useState("");

  const { data: profilesData } = useQuery({
    queryKey: ["transfer-profiles"],
    queryFn: () => listTransferProfiles(apiCtx)
  });
  const profiles: TransferProfileSummary[] = profilesData?.data ?? [];

  const saveMutation = useMutation({
    mutationFn: (input: AutomationCreateInput) => createTransferAutomation(apiCtx, input),
    onSuccess: (result) => {
      const id = result?.data?.id;
      if (id) {
        router.push(href(`/transfer-desk/automations/${id}`));
      } else {
        router.push(href("/transfer-desk/automations"));
      }
    }
  });

  const handleAddStep = useCallback(() => {
    if (!addProfileId) return;
    const profile = profiles.find((p) => p.id === addProfileId);
    if (!profile) return;
    setSteps((prev) => [
      ...prev,
      {
        profileId: profile.id,
        profileName: profile.name,
        failOnError: true
      }
    ]);
    setAddProfileId("");
  }, [addProfileId, profiles]);

  const handleRemoveStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleMoveStep = useCallback((index: number, direction: "up" | "down") => {
    setSteps((prev) => {
      const next = [...prev];
      const swapIdx = direction === "up" ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[index], next[swapIdx]] = [next[swapIdx]!, next[index]!];
      return next;
    });
  }, []);

  const handleToggleFailOnError = useCallback((index: number) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, failOnError: !s.failOnError } : s))
    );
  }, []);

  const handleAddSchedule = useCallback(() => {
    setSchedules((prev) => [
      ...prev,
      { cronExpression: "0 2 * * *", timezone: "UTC", isActive: true }
    ]);
  }, []);

  const handleRemoveSchedule = useCallback((index: number) => {
    setSchedules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(() => {
    saveMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      steps: steps.map((s, i) => ({
        profileId: s.profileId,
        stepOrder: i + 1,
        failOnError: s.failOnError
      })),
      schedules: schedules.length > 0 ? schedules : undefined
    });
  }, [saveMutation, name, description, steps, schedules]);

  const canAdvanceStep1 = name.trim().length > 0;
  const canAdvanceStep2 = steps.length > 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={href("/transfer-desk/automations")}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Automation</h1>
          <p className="text-sm text-muted-foreground">Step {step} of 3</p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-emerald-500" : "bg-slate-200"}`}
          />
        ))}
      </div>

      {/* Step 1: Name & Description */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4" />
              Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Automation Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Daily Night Audit Pipeline"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this automation do?"
                rows={3}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)} disabled={!canAdvanceStep1}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Pipeline Steps */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline Steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add profiles to this automation. They will execute sequentially in the order shown.
            </p>

            {/* Existing steps */}
            {steps.length > 0 && (
              <div className="space-y-2">
                {steps.map((s, i) => (
                  <div
                    key={`${s.profileId}-${i}`}
                    className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2"
                  >
                    <GripVertical className="h-4 w-4 text-slate-300 shrink-0" />
                    <Badge variant="outline" className="shrink-0 font-mono text-xs">
                      {i + 1}
                    </Badge>
                    <span className="flex-1 text-sm font-medium truncate">{s.profileName}</span>
                    <button
                      onClick={() => handleToggleFailOnError(i)}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        s.failOnError
                          ? "bg-red-50 text-red-700 border-red-200"
                          : "bg-amber-50 text-amber-700 border-amber-200"
                      }`}
                      title={
                        s.failOnError ? "Stops automation on failure" : "Continues past failure"
                      }
                    >
                      {s.failOnError ? "Stop on fail" : "Continue"}
                    </button>
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
                      disabled={i === steps.length - 1}
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
                  </div>
                ))}
              </div>
            )}

            {/* Add step */}
            <div className="flex gap-2">
              <Select value={addProfileId} onValueChange={setAddProfileId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a profile to add..." />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} <span className="text-muted-foreground">({p.profileType})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={handleAddStep} disabled={!addProfileId}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(3)} disabled={!canAdvanceStep2}>
                Next <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Schedule + Review & Save */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule & Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Schedules */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">
                Cron Schedules <span className="font-normal text-slate-400">(optional)</span>
              </h3>

              {schedules.map((sched, i) => (
                <div key={i} className="rounded-lg border bg-slate-50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={sched.cronExpression}
                      onChange={(e) =>
                        setSchedules((prev) =>
                          prev.map((s, idx) =>
                            idx === i ? { ...s, cronExpression: e.target.value } : s
                          )
                        )
                      }
                      placeholder="0 2 * * *"
                      className="flex-1 rounded-md border px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <select
                      value={sched.timezone}
                      onChange={(e) =>
                        setSchedules((prev) =>
                          prev.map((s, idx) => (idx === i ? { ...s, timezone: e.target.value } : s))
                        )
                      }
                      className="rounded-md border px-2 py-1.5 text-sm"
                    >
                      <option value="UTC">UTC</option>
                      <option value="Africa/Dar_es_Salaam">Africa/Dar_es_Salaam</option>
                      <option value="Africa/Nairobi">Africa/Nairobi</option>
                      <option value="Europe/London">Europe/London</option>
                      <option value="America/New_York">America/New_York</option>
                      <option value="Asia/Dubai">Asia/Dubai</option>
                    </select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-red-500"
                      onClick={() => handleRemoveSchedule(i)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  {/* Presets */}
                  <div className="flex flex-wrap gap-1">
                    {CRON_PRESETS.map((p) => (
                      <button
                        key={p.cron}
                        onClick={() =>
                          setSchedules((prev) =>
                            prev.map((s, idx) => (idx === i ? { ...s, cronExpression: p.cron } : s))
                          )
                        }
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          sched.cronExpression === p.cron
                            ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                            : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <Button variant="outline" size="sm" onClick={handleAddSchedule}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add Schedule
              </Button>
            </div>

            {/* Review summary */}
            <div className="rounded-lg border bg-slate-50 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Name</span>
                <span className="font-medium">{name}</span>
              </div>
              {description && (
                <div className="flex justify-between">
                  <span className="text-slate-500">Description</span>
                  <span className="text-right max-w-[60%]">{description}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Steps</span>
                <span className="font-medium">{steps.length}</span>
              </div>
              {steps.map((s, i) => (
                <div key={i} className="flex justify-between text-xs pl-4">
                  <span className="text-slate-400">Step {i + 1}</span>
                  <span>{s.profileName}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-slate-500">Schedules</span>
                <span className="font-medium">{schedules.length || "Manual only"}</span>
              </div>
            </div>

            {saveMutation.error && (
              <p className="text-sm text-red-600">
                Failed to create: {(saveMutation.error as Error).message}
              </p>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                <Check className="mr-2 h-4 w-4" />
                {saveMutation.isPending ? "Creating..." : "Create Automation"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
