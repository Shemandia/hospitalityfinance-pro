"use client";

/**
 * How a ledger import profile posts (import plan sections 4 and 5): the
 * source system it imports from, the ledger's journal source, review or
 * commit, per-document or whole-file posting, what happens to unmapped
 * codes, and the rate type for documents without a rate.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useApiContext } from "../use-api-context";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import {
  listSourceSystems,
  updateIntegrationProfile,
  type IntegrationImportSettings,
  type IntegrationProfileDetail
} from "../../lib/gl-api";

type Settings = IntegrationImportSettings & { journalSource: string };

const JOURNAL_SOURCES = ["IMPORT", "PMS", "POS", "PAYROLL"] as const;

const LABELS = {
  reviewMode: { HOLD: "Hold for review", AUTO_COMMIT: "Post at once" },
  atomicity: { PER_DOCUMENT: "Each document on its own", WHOLE_FILE: "The whole file or nothing" },
  unmappedPolicy: {
    REJECT: "Refuse the document",
    HOLD: "Hold the run for review",
    SUSPENSE: "Post to a suspense account"
  }
} as const;

export function settingsOf(profile: IntegrationProfileDetail): Settings {
  return {
    sourceSystemCode: profile.sourceSystemCode ?? null,
    reviewMode: profile.reviewMode ?? "HOLD",
    atomicity: profile.atomicity ?? "PER_DOCUMENT",
    unmappedPolicy: profile.unmappedPolicy ?? "REJECT",
    suspenseAccountCode: profile.suspenseAccountCode ?? null,
    fxRateType: profile.fxRateType ?? null,
    journalSource: String(profile.targetParams?.journalSource ?? "IMPORT")
  };
}

/** The update the API takes: the settings, and the journal source inside targetParams. */
export function settingsPayload(profile: IntegrationProfileDetail, s: Settings) {
  const { journalSource, ...settings } = s;
  return {
    ...settings,
    suspenseAccountCode: s.unmappedPolicy === "SUSPENSE" ? s.suspenseAccountCode : null,
    targetParams: { ...(profile.targetParams ?? {}), journalSource }
  };
}

export function ImportSettingsCard({
  profile,
  canEdit,
  onSaved
}: {
  profile: IntegrationProfileDetail;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const api = useApiContext();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Settings>(() => settingsOf(profile));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setForm(settingsOf(profile)), [profile]);

  const sources = useQuery({
    queryKey: ["integrations-source-systems", api?.tenantSlug],
    queryFn: async () => (await listSourceSystems(api!)).data ?? [],
    enabled: Boolean(api) && editing
  });

  const save = useMutation({
    mutationFn: () => updateIntegrationProfile(api!, profile.id, settingsPayload(profile, form)),
    onSuccess: () => {
      setEditing(false);
      setError(null);
      onSaved();
    },
    onError: (e: Error) => setError(e.message)
  });

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const current = settingsOf(profile);
  const suspenseMissing = form.unmappedPolicy === "SUSPENSE" && !form.suspenseAccountCode;

  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-4 py-1.5 border-b last:border-0 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 text-right">{value}</dd>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Posting to the ledger</CardTitle>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!editing ? (
          <dl>
            {row(
              "Source system",
              current.sourceSystemCode ?? "Not set: the profile cannot import yet"
            )}
            {row("Journal source", current.journalSource)}
            {row("Review", LABELS.reviewMode[current.reviewMode])}
            {row("Posting", LABELS.atomicity[current.atomicity])}
            {row(
              "Unmapped codes",
              LABELS.unmappedPolicy[current.unmappedPolicy] +
                (current.unmappedPolicy === "SUSPENSE" ? ` (${current.suspenseAccountCode})` : "")
            )}
            {row("Rate type", current.fxRateType ?? "SPOT (default)")}
          </dl>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!suspenseMissing) save.mutate();
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="font-medium text-slate-700">Source system</span>
              <select
                value={form.sourceSystemCode ?? ""}
                onChange={(e) => set("sourceSystemCode", e.target.value || null)}
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                <option value="">Not set</option>
                {(sources.data ?? [])
                  .filter((s) => s.isActive || s.code === form.sourceSystemCode)
                  .map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-slate-700">Journal source</span>
              <select
                value={form.journalSource}
                onChange={(e) => set("journalSource", e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                {JOURNAL_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-slate-700">Review</span>
              <select
                value={form.reviewMode}
                onChange={(e) => set("reviewMode", e.target.value as Settings["reviewMode"])}
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                {Object.entries(LABELS.reviewMode).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-slate-700">Posting</span>
              <select
                value={form.atomicity}
                onChange={(e) => set("atomicity", e.target.value as Settings["atomicity"])}
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                {Object.entries(LABELS.atomicity).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-slate-700">Unmapped codes</span>
              <select
                value={form.unmappedPolicy}
                onChange={(e) =>
                  set("unmappedPolicy", e.target.value as Settings["unmappedPolicy"])
                }
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                {Object.entries(LABELS.unmappedPolicy).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {form.unmappedPolicy === "SUSPENSE" && (
              <label className="flex flex-col gap-1">
                <span className="font-medium text-slate-700">Suspense account code</span>
                <input
                  value={form.suspenseAccountCode ?? ""}
                  onChange={(e) => set("suspenseAccountCode", e.target.value.trim() || null)}
                  aria-invalid={suspenseMissing}
                  className="rounded-lg border border-slate-200 px-3 py-2 font-mono"
                />
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="font-medium text-slate-700">
                Rate type (documents without a rate)
              </span>
              <select
                value={form.fxRateType ?? ""}
                onChange={(e) =>
                  set("fxRateType", (e.target.value || null) as Settings["fxRateType"])
                }
                className="rounded-lg border border-slate-200 px-3 py-2"
              >
                <option value="">SPOT (default)</option>
                {["SPOT", "AVERAGE", "BUDGET", "CLOSING"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <p role="alert" className="sm:col-span-2 text-red-600">
                {error}
              </p>
            )}
            <div className="sm:col-span-2 flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setForm(settingsOf(profile));
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={suspenseMissing || save.isPending}>
                Save
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
