"use client";

/**
 * Transfer Desk — Profile list page (UI-URL-002 / UI-PAGE-002)
 *
 * Searchable/filterable/sortable table of all profiles.
 * Each row shows: type badge, name, source→target, last execution, valid status.
 *
 * Actions per row:
 *   - View (any user with canTransferDeskUser)
 *   - Run (canTransferDeskPowerUser)
 *   - Edit (canTransferDeskDesigner)
 *
 * Backend: calls listTransferProfiles (TD-API-009).
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../components/use-api-context";
import { useUserRole } from "../../../../../components/use-user-role";
import { useTenantHref } from "../../../../../hooks/use-tenant-router";
import {
  listTransferProfiles,
  type TransferProfileSummary,
  type TransferProfileType
} from "../../../../../lib/gl-api";
import { Card, CardContent } from "../../../../../components/ui/card";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { Input } from "../../../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../components/ui/table";
import {
  ListChecks,
  ArrowLeft,
  Plus,
  Search,
  Eye,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  Lock
} from "lucide-react";

const TYPE_LABELS: Record<TransferProfileType, { label: string; badge: string }> = {
  IMPORT: { label: "Import", badge: "bg-blue-50 text-blue-700 border-blue-200" },
  EXPORT: { label: "Export", badge: "bg-purple-50 text-purple-700 border-purple-200" },
  PROCESS: { label: "Process", badge: "bg-slate-50 text-slate-700 border-slate-200" },
  INTERNAL_TRANSFER: {
    label: "Internal",
    badge: "bg-amber-50 text-amber-700 border-amber-200"
  },
  EXTERNAL_TRANSFER: {
    label: "External",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200"
  }
};

export default function TransferDeskProfileListPage() {
  const apiContext = useApiContext();
  const tenantHref = useTenantHref();
  const role = useUserRole();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TransferProfileType | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ACTIVE");

  const profilesQ = useQuery({
    queryKey: [
      "td-profiles",
      apiContext?.tenantSlug,
      apiContext?.entityId,
      typeFilter,
      statusFilter
    ],
    queryFn: () =>
      apiContext
        ? listTransferProfiles(apiContext, {
            profileType: typeFilter === "ALL" ? undefined : typeFilter,
            isActive: statusFilter === "ALL" ? undefined : statusFilter === "ACTIVE"
          })
        : Promise.resolve({ data: [] as TransferProfileSummary[] }),
    enabled: Boolean(apiContext) && role.canTransferDeskUser,
    select: (r) => (r.data as unknown as TransferProfileSummary[]) ?? []
  });

  const profiles = profilesQ.data ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return profiles;
    const q = search.toLowerCase();
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.sourceComponent ?? "").toLowerCase().includes(q) ||
        (p.targetComponent ?? "").toLowerCase().includes(q)
    );
  }, [profiles, search]);

  if (!role.canTransferDeskUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 p-6 text-center">
        <Lock className="h-10 w-10 text-slate-300" />
        <h2 className="text-lg font-semibold text-slate-700">Access required</h2>
        <p className="text-sm text-slate-500 max-w-md">
          You need at least the <code className="font-mono">transfer:user</code> role to view
          profiles.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <Link
        href={tenantHref("/transfer-desk")}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-emerald-600"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Transfer Desk
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-(--color-primary) flex items-center gap-2">
            <ListChecks className="h-5 w-5" /> Profiles
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Import, export, process, and transfer profile definitions.
          </p>
        </div>
        {role.canTransferDeskDesigner && (
          <Button
            variant="teal"
            size="sm"
            disabled
            className="gap-1.5"
            title="Creation wizard coming in sprint 4"
          >
            <Plus className="h-3.5 w-3.5" /> New Profile
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search profiles by name, description, component…"
              className="pl-9 text-sm h-9"
            />
          </div>
          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as TransferProfileType | "ALL")}
          >
            <SelectTrigger className="w-44 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              <SelectItem value="IMPORT">Import</SelectItem>
              <SelectItem value="EXPORT">Export</SelectItem>
              <SelectItem value="PROCESS">Process</SelectItem>
              <SelectItem value="INTERNAL_TRANSFER">Internal Transfer</SelectItem>
              <SelectItem value="EXTERNAL_TRANSFER">External Transfer</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as "ALL" | "ACTIVE" | "INACTIVE")}
          >
            <SelectTrigger className="w-36 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="INACTIVE">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-slate-400 ml-auto">
            {filtered.length} profile{filtered.length !== 1 ? "s" : ""}
          </span>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-28">Type</TableHead>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Source → Target</TableHead>
                <TableHead className="text-xs text-right w-20">Runs</TableHead>
                <TableHead className="text-xs w-24">Valid</TableHead>
                <TableHead className="text-xs w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profilesQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-400">
                    Loading profiles…
                  </TableCell>
                </TableRow>
              ) : profilesQ.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-red-500 text-sm">
                    {(profilesQ.error as Error).message}
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <div className="text-slate-400 text-sm">
                      {profiles.length === 0
                        ? "No profiles yet. Create your first one via the wizard (coming soon)."
                        : "No profiles match the current filters."}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => {
                  const type = TYPE_LABELS[p.profileType];
                  return (
                    <TableRow key={p.id} className="hover:bg-slate-50/50">
                      <TableCell>
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold border ${type.badge}`}
                        >
                          {type.label.toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={tenantHref(`/transfer-desk/profiles/${p.id}`)}
                          className="text-sm font-semibold text-slate-800 hover:text-emerald-600"
                        >
                          {p.name}
                        </Link>
                        {p.description && (
                          <p className="text-[11px] text-slate-400 truncate max-w-md mt-0.5">
                            {p.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        <span className="font-mono">{p.sourceComponent ?? "—"}</span>
                        <span className="text-slate-300 mx-1.5">→</span>
                        <span className="font-mono">{p.targetComponent ?? "—"}</span>
                      </TableCell>
                      <TableCell className="text-xs text-right tabular-nums text-slate-500">
                        {p._count?.executions ?? 0}
                      </TableCell>
                      <TableCell>
                        {p.isValid ? (
                          <Badge variant="success" className="text-[10px] gap-1">
                            <CheckCircle2 className="h-2.5 w-2.5" /> Valid
                          </Badge>
                        ) : (
                          <Badge variant="warning" className="text-[10px] gap-1">
                            <AlertTriangle className="h-2.5 w-2.5" /> Invalid
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            asChild
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            title="View"
                          >
                            <Link href={tenantHref(`/transfer-desk/profiles/${p.id}`)}>
                              <Eye className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                          {role.canTransferDeskPowerUser && p.isValid && p.isActive && (
                            <Button
                              asChild
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700"
                              title="Run"
                            >
                              <Link href={tenantHref(`/transfer-desk/profiles/${p.id}`)}>
                                <PlayCircle className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
