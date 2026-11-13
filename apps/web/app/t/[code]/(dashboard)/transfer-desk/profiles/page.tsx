"use client";

/**
 * Transfer Desk — Profile list page (UI-URL-002 / UI-PAGE-002)
 *
 * DataTable with columns: name, type, status, last modified, actions.
 * Filters by type and status. "New Profile" button navigates to wizard.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApiContext } from "../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../components/use-permissions";
import { useTenantHref } from "../../../../../../hooks/use-tenant-router";
import { listProfiles } from "../../../../../../lib/transfer-desk/api";
import { PROFILE_TYPES, PROFILE_STATUSES } from "../../../../../../lib/transfer-desk/constants";
import type {
  ProfileType,
  ProfileStatus,
  Profile
} from "../../../../../../lib/transfer-desk/types";
import { Card, CardContent } from "../../../../../../components/ui/card";
import { Badge } from "../../../../../../components/ui/badge";
import { Button } from "../../../../../../components/ui/button";
import { Input } from "../../../../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../../components/ui/table";
import {
  ListChecks,
  ArrowLeft,
  Plus,
  Search,
  Eye,
  Pencil,
  Lock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

// ── Type badge styles ───────────────────────────────────────────────────────

const TYPE_BADGE: Record<ProfileType, { label: string; className: string }> = {
  IMPORT: { label: "Import", className: "bg-blue-50 text-blue-700 border-blue-200" },
  EXPORT: { label: "Export", className: "bg-purple-50 text-purple-700 border-purple-200" },
  PROCESS: { label: "Process", className: "bg-slate-50 text-slate-700 border-slate-200" },
  INTERNAL_TRANSFER: {
    label: "Internal",
    className: "bg-amber-50 text-amber-700 border-amber-200"
  },
  EXTERNAL_TRANSFER: {
    label: "External",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200"
  }
};

const STATUS_BADGE: Record<
  ProfileStatus,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }
> = {
  DRAFT: { label: "Draft", variant: "secondary" },
  ACTIVE: { label: "Active", variant: "success" },
  INACTIVE: { label: "Inactive", variant: "warning" },
  ARCHIVED: { label: "Archived", variant: "destructive" }
};

export default function TransferDeskProfileListPage() {
  const apiContext = useApiContext();
  const tenantHref = useTenantHref();
  const role = usePermissions();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ProfileType | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<ProfileStatus | "ALL">("ALL");

  // Sorting
  type SortKey = "name" | "profileType" | "status" | "updatedAt";
  type SortDir = "asc" | "desc";
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Pagination
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  const profilesQ = useQuery({
    queryKey: [
      "td-profiles",
      apiContext?.tenantSlug,
      apiContext?.entityId,
      typeFilter,
      statusFilter
    ],
    queryFn: async () => {
      if (!apiContext) return { data: [] as Profile[], meta: {} };
      return listProfiles(apiContext!, {
        profileType: typeFilter === "ALL" ? undefined : typeFilter,
        status: statusFilter === "ALL" ? undefined : statusFilter
      });
    },
    enabled: Boolean(apiContext) && role.canTransferDeskUser,
    select: (r: { data: Profile[] }) => (r.data ?? []) as Profile[]
  });

  const profiles = profilesQ.data ?? [];
  const filtered = useMemo(() => {
    let result = profiles;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          p.profileType.toLowerCase().includes(q)
      );
    }
    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "profileType":
          cmp = a.profileType.localeCompare(b.profileType);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "updatedAt":
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [profiles, search, sortKey, sortDir]);

  // Reset page when filters change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPage(0), [search, typeFilter, statusFilter, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = useMemo(
    () => filtered.slice(page * pageSize, (page + 1) * pageSize),
    [filtered, page, pageSize]
  );

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
          <Button asChild variant="teal" size="sm" className="gap-1.5">
            <Link href={tenantHref("/transfer-desk/profiles/new")}>
              <Plus className="h-3.5 w-3.5" /> New Profile
            </Link>
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
              placeholder="Search profiles by name, description, type..."
              className="pl-9 text-sm h-9"
            />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as ProfileType | "ALL")}>
            <SelectTrigger className="w-44 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {PROFILE_TYPES.map((pt) => (
                <SelectItem key={pt.value} value={pt.value}>
                  {pt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as ProfileStatus | "ALL")}
          >
            <SelectTrigger className="w-36 h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {PROFILE_STATUSES.map((ps) => (
                <SelectItem key={ps.value} value={ps.value}>
                  {ps.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-slate-400 ml-auto">
            {filtered.length} profile{filtered.length !== 1 ? "s" : ""}
          </span>
        </CardContent>
      </Card>

      {/* Table + Pagination */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-28">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-emerald-600"
                    onClick={() => toggleSort("profileType")}
                  >
                    Type{" "}
                    {sortKey === "profileType" ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-slate-300" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-xs">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-emerald-600"
                    onClick={() => toggleSort("name")}
                  >
                    Name{" "}
                    {sortKey === "name" ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-slate-300" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-xs w-24">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-emerald-600"
                    onClick={() => toggleSort("status")}
                  >
                    Status{" "}
                    {sortKey === "status" ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-slate-300" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-xs w-24">Version</TableHead>
                <TableHead className="text-xs w-36">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-emerald-600"
                    onClick={() => toggleSort("updatedAt")}
                  >
                    Last Modified{" "}
                    {sortKey === "updatedAt" ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-slate-300" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-xs w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profilesQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-slate-400">
                    Loading profiles...
                  </TableCell>
                </TableRow>
              ) : profilesQ.isError ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-red-500 text-sm">
                    {(profilesQ.error as Error).message}
                  </TableCell>
                </TableRow>
              ) : paged.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <div className="text-slate-400 text-sm">
                      {profiles.length === 0
                        ? "No profiles yet. Create your first one with the wizard."
                        : "No profiles match the current filters."}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paged.map((p) => {
                  const typeBadge = TYPE_BADGE[p.profileType];
                  const statusBadge = STATUS_BADGE[p.status];
                  return (
                    <TableRow key={p.id} className="hover:bg-slate-50/50">
                      <TableCell>
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold border ${typeBadge.className}`}
                        >
                          {typeBadge.label.toUpperCase()}
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
                      <TableCell>
                        <Badge variant={statusBadge.variant} className="text-[10px]">
                          {statusBadge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 tabular-nums">
                        v{p.version}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500">
                        {new Date(p.updatedAt).toLocaleDateString()}
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
                          {role.canTransferDeskDesigner && (
                            <Button
                              asChild
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-slate-500 hover:text-emerald-600"
                              title="Edit"
                            >
                              <Link href={tenantHref(`/transfer-desk/profiles/${p.id}/edit`)}>
                                <Pencil className="h-3.5 w-3.5" />
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

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Rows per page</span>
                <Select
                  value={String(pageSize)}
                  onValueChange={(v) => {
                    setPageSize(Number(v));
                    setPage(0);
                  }}
                >
                  <SelectTrigger className="w-16 h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-slate-400">
                  {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of{" "}
                  {filtered.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-slate-500 tabular-nums px-2">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
