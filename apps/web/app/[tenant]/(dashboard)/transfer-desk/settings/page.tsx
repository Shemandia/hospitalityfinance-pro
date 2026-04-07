"use client";

/**
 * Transfer Desk — Settings (UI-URL-021 / UI-PAGE-016)
 *
 * Admin-only configuration management for the Transfer Desk subsystem.
 * Three tabs:
 *   1. Export    — serialize all profiles/automations/formats/transformations
 *                  /lookups/filters to a single JSON file in S3 (TD-API-031)
 *   2. Import    — upload a previously-exported config JSON, preview, resolve
 *                  conflicts, apply (TD-API-032)
 *   3. Cleardown — wipe ALL Transfer Desk config in this tenant. Two-step
 *                  confirmation with token (TD-API-033)
 *
 * STUB: backend endpoints are not yet implemented. Action buttons are
 * rendered but disabled. The page documents what each action will do once
 * the backend lands.
 */

import Link from "next/link";
import { useState } from "react";
import { useUserRole } from "../../../../../components/use-user-role";
import { useTenantHref } from "../../../../../hooks/use-tenant-router";
import { Card, CardContent } from "../../../../../components/ui/card";
import { Button } from "../../../../../components/ui/button";
import {
  Settings,
  Download,
  Upload,
  Trash2,
  Lock,
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert
} from "lucide-react";

type Tab = "export" | "import" | "cleardown";

export default function TransferDeskSettingsPage() {
  const tenantHref = useTenantHref();
  const role = useUserRole();
  const [activeTab, setActiveTab] = useState<Tab>("export");

  if (!role.canTransferDeskAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Admin access required</h2>
        <p className="text-sm text-slate-500 max-w-md">
          Transfer Desk settings can only be modified by users with the{" "}
          <code className="font-mono">transfer:admin</code> role (mapped to ADMIN/SUPERADMIN today).
        </p>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> =
    [
      { id: "export", label: "Export", icon: Download },
      { id: "import", label: "Import", icon: Upload },
      { id: "cleardown", label: "Cleardown", icon: Trash2 }
    ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      {/* Breadcrumb */}
      <Link
        href={tenantHref("/transfer-desk")}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Transfer Desk
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-(--color-primary) flex items-center gap-2">
          <Settings className="h-5 w-5" /> Transfer Desk Settings
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Export and import the entire Transfer Desk configuration, or wipe it cleanly between
          environments.
        </p>
      </div>

      {/* Stub notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div>
          <p className="font-semibold">Stub view — backend not yet implemented</p>
          <p className="mt-0.5">
            Endpoints TD-API-031 (export), TD-API-032 (import), TD-API-033 (cleardown) are scheduled
            for sprint 12. Action buttons are rendered but disabled until then.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === id
                ? "border-(--color-primary) text-(--color-primary)"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <Card>
        <CardContent className="p-6 space-y-4">
          {activeTab === "export" && (
            <>
              <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Download className="h-4 w-4 text-slate-400" /> Export Configuration
              </h2>
              <p className="text-sm text-slate-600">
                Serializes the entire Transfer Desk configuration in this tenant to a single JSON
                file:
              </p>
              <ul className="text-sm text-slate-600 list-disc ml-5 space-y-1">
                <li>All profiles (Import, Export, Process, Internal/External Transfer)</li>
                <li>All filters and journal-range control state</li>
                <li>All automations with their step definitions and cron schedules</li>
                <li>All format definitions (FSD XML)</li>
                <li>All transformation definitions (TML XML + custom JS functions)</li>
                <li>All lookup tables (with row data)</li>
              </ul>
              <p className="text-xs text-slate-500">
                The export does NOT include execution history, payloads, or files in the file
                repository — those are environment-specific.
              </p>
              <div className="pt-2">
                <Button variant="teal" disabled className="gap-1.5" title="Coming soon">
                  <Download className="h-3.5 w-3.5" /> Export to JSON
                </Button>
              </div>
            </>
          )}

          {activeTab === "import" && (
            <>
              <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Upload className="h-4 w-4 text-slate-400" /> Import Configuration
              </h2>
              <p className="text-sm text-slate-600">
                Upload a previously-exported configuration JSON file. The system will:
              </p>
              <ul className="text-sm text-slate-600 list-disc ml-5 space-y-1">
                <li>Parse and validate the JSON structure</li>
                <li>
                  Show a preview of what will be created, updated, or skipped (conflict resolution
                  per object: keep existing / overwrite / rename)
                </li>
                <li>Apply the import in a single transaction with rollback on error</li>
                <li>Generate an import log with per-object status</li>
              </ul>
              <p className="text-xs text-slate-500 flex items-start gap-1.5 pt-1">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600" />
                References between objects (profiles → formats, automations → profiles, etc.) are
                resolved by name within the imported set, then by name in the target tenant.
              </p>
              <div className="pt-2">
                <Button variant="teal" disabled className="gap-1.5" title="Coming soon">
                  <Upload className="h-3.5 w-3.5" /> Choose File…
                </Button>
              </div>
            </>
          )}

          {activeTab === "cleardown" && (
            <>
              <h2 className="text-base font-semibold text-red-700 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" /> Cleardown All Configuration
              </h2>
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 space-y-2">
                <p className="font-semibold">⚠️ Destructive action</p>
                <p>
                  This permanently deletes all Transfer Desk configuration in this tenant: profiles,
                  filters, automations, schedules, formats, transformations, lookup tables, folders,
                  and file metadata.
                </p>
                <p>
                  Execution history and audit logs are preserved. Files in S3 are NOT deleted (they
                  become orphaned and must be cleaned up separately).
                </p>
                <p>This cannot be undone.</p>
              </div>
              <p className="text-xs text-slate-500">
                Cleardown uses a two-step token confirmation per spec TD-BL-016: the first call
                returns a token valid for 60 seconds, the second call must include that token to
                actually execute the wipe.
              </p>
              <div className="pt-2">
                <Button
                  variant="outline"
                  disabled
                  className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                  title="Coming soon"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Request Cleardown Token…
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
