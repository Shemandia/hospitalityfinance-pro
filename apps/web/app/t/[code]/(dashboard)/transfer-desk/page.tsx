"use client";

/**
 * Transfer Desk — Landing page (UI-URL-001 / UI-PAGE-001)
 *
 * Dashboard for the Transfer Desk subsystem. Provides:
 *   - Left sidebar navigation to all TD sections (Profiles, Automations, etc.)
 *   - Quick-actions toolbar (New profile, Run profile, Browse files)
 *   - Recent Executions widget
 *   - System Profiles cards (loaded from DB — isSystem=true profiles)
 *
 * RBAC: section visibility is gated by usePermissions's canTransferDesk* helpers.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { usePermissions } from "../../../../../components/use-permissions";
import { useApiContext } from "../../../../../components/use-api-context";
import { useTenantHref } from "../../../../../hooks/use-tenant-router";
import { listTransferProfiles, type TransferProfileSummary } from "../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import {
  LayoutDashboard,
  ListChecks,
  PlayCircle,
  CalendarClock,
  FileCog,
  Workflow,
  Database,
  FolderOpen,
  History,
  Settings,
  Plus,
  Building2,
  Hotel,
  Landmark,
  CreditCard,
  ArrowRight,
  Lock,
  Loader2
} from "lucide-react";

type NavSection = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Minimum role to see this section */
  minRole: "user" | "powerUser" | "designer" | "admin";
  /** Implementation status — "ready" links navigate, "stub" shows badge */
  status: "ready" | "stub";
};

const NAV_SECTIONS: NavSection[] = [
  {
    href: "/transfer-desk",
    label: "Dashboard",
    description: "Recent executions, system profiles, quick actions",
    icon: LayoutDashboard,
    minRole: "user",
    status: "ready"
  },
  {
    href: "/transfer-desk/profiles",
    label: "Profiles",
    description: "Import, export, process and transfer definitions",
    icon: ListChecks,
    minRole: "user",
    status: "ready"
  },
  {
    href: "/transfer-desk/automations",
    label: "Automations",
    description: "Scheduled multi-profile pipelines",
    icon: CalendarClock,
    minRole: "user",
    status: "ready"
  },
  {
    href: "/transfer-desk/formats",
    label: "Formats",
    description: "FSD file format definitions",
    icon: FileCog,
    minRole: "designer",
    status: "ready"
  },
  {
    href: "/transfer-desk/transformations",
    label: "Transformations",
    description: "TML mapping definitions and visual mapper",
    icon: Workflow,
    minRole: "designer",
    status: "ready"
  },
  {
    href: "/transfer-desk/lookups",
    label: "Lookup Tables",
    description: "Range-based value substitution tables",
    icon: Database,
    minRole: "designer",
    status: "ready"
  },
  {
    href: "/transfer-desk/files",
    label: "File Repository",
    description: "S3-backed file folder hierarchy",
    icon: FolderOpen,
    minRole: "user",
    status: "ready"
  },
  {
    href: "/transfer-desk/history",
    label: "Execution History",
    description: "Per-record logs of every profile run",
    icon: History,
    minRole: "user",
    status: "ready"
  },
  {
    href: "/transfer-desk/settings",
    label: "Settings",
    description: "Config export/import, cleardown, license",
    icon: Settings,
    minRole: "admin",
    status: "ready"
  }
];

/** Map sourceComponent values to icons and colors */
function getProfileIcon(sourceComponent: string | null): {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
} {
  switch (sourceComponent) {
    case "OPERA_CLOUD":
      return { icon: Hotel, iconColor: "text-blue-600 bg-blue-50" };
    case "SKY_JANA_MMS":
      return { icon: Building2, iconColor: "text-emerald-600 bg-emerald-50" };
    case "SIMPHONY_POS":
      return { icon: CreditCard, iconColor: "text-purple-600 bg-purple-50" };
    case "SWIFT_MT940":
      return { icon: Landmark, iconColor: "text-amber-600 bg-amber-50" };
    default:
      return { icon: Database, iconColor: "text-slate-600 bg-slate-50" };
  }
}

/** Map sourceComponent to vendor display name */
function getVendorName(sourceComponent: string | null): string {
  switch (sourceComponent) {
    case "OPERA_CLOUD":
      return "Oracle Hospitality";
    case "SKY_JANA_MMS":
      return "Sky Jana MMS";
    case "SIMPHONY_POS":
      return "Oracle Simphony";
    case "SWIFT_MT940":
      return "Generic SWIFT MT940";
    default:
      return "Custom";
  }
}

export default function TransferDeskLandingPage() {
  const tenantHref = useTenantHref();
  const role = usePermissions();
  const apiCtx = useApiContext();

  const { data: profileData, isLoading: profilesLoading } = useQuery({
    queryKey: ["transfer-profiles", "system"],
    queryFn: () => listTransferProfiles(apiCtx!, { isSystem: true, isActive: true })
  });

  const systemProfiles: TransferProfileSummary[] = profileData?.data ?? [];

  function canSee(min: NavSection["minRole"]): boolean {
    switch (min) {
      case "user":
        return role.canTransferDeskUser;
      case "powerUser":
        return role.canTransferDeskPowerUser;
      case "designer":
        return role.canTransferDeskDesigner;
      case "admin":
        return role.canTransferDeskAdmin;
    }
  }

  if (!role.canTransferDeskUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Transfer Desk access required</h2>
        <p className="text-sm text-slate-500 max-w-md">
          Your role does not include access to the Transfer Desk. Contact your administrator to be
          granted at least the <code className="font-mono">transfer:user</code> role.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-6 p-6">
      {/* ── Left sidebar nav ─────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 space-y-1">
        <div className="px-3 pb-3">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">
            Transfer Desk
          </h2>
        </div>
        {NAV_SECTIONS.filter((s) => canSee(s.minRole)).map(
          ({ href, label, icon: Icon, status }) => {
            const isActive = href === "/transfer-desk";
            return (
              <Link
                key={href}
                href={tenantHref(href)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                  isActive
                    ? "bg-emerald-600 text-white font-medium"
                    : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${isActive ? "text-white" : "text-slate-400"}`}
                />
                <span className="flex-1 truncate">{label}</span>
                {status === "stub" && (
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                    soon
                  </Badge>
                )}
              </Link>
            );
          }
        )}
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 space-y-6">
        {/* Page header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-(--color-primary)">Transfer Desk</h1>
            <p className="text-sm text-slate-500 mt-1">
              Define, schedule and run profiles that import or export financial data between HFP and
              external systems.
            </p>
          </div>
          {role.canTransferDeskDesigner && (
            <Button variant="teal" size="sm" disabled className="gap-1.5" title="Coming soon">
              <Plus className="h-3.5 w-3.5" /> New Profile
            </Button>
          )}
        </div>

        {/* Recent Executions widget */}
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-slate-400" />
              Recent Executions
            </CardTitle>
            <Link
              href={tenantHref("/transfer-desk/history")}
              className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
            >
              View all
              <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="pt-3">
            <div className="text-center py-8 text-sm text-slate-400">
              No recent executions to show.
              <br />
              <span className="text-xs">Execution history will appear here once profiles run.</span>
            </div>
          </CardContent>
        </Card>

        {/* System Profiles section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">System Profiles</h2>
            <span className="text-[11px] text-slate-400">Pre-built integrations · read-only</span>
          </div>
          {profilesLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading system profiles...
            </div>
          ) : systemProfiles.length === 0 ? (
            <div className="text-center py-8 text-sm text-slate-400">
              No system profiles found. Run the seed script to populate them.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {systemProfiles.map((p) => {
                const { icon: Icon, iconColor } = getProfileIcon(p.sourceComponent);
                const vendor = getVendorName(p.sourceComponent);
                return (
                  <Card key={p.id} className="hover:border-slate-300 transition-colors">
                    <CardContent className="p-4 flex gap-3">
                      <div
                        className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-semibold text-sm text-slate-800 truncate">
                            {p.name}
                          </h3>
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            system
                          </Badge>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">{vendor}</p>
                        <p className="text-xs text-slate-600 mt-1.5 line-clamp-2">
                          {p.description}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {p.sourceFormat && (
                            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                              {p.sourceFormat.name}
                            </span>
                          )}
                          <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-600">
                            → {p.targetComponent ?? "GL_JOURNAL"}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
