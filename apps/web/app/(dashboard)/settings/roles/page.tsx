"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../components/use-api-context";
import { useUserRole } from "../../../../components/use-user-role";
import {
  getAdminRoles,
  getAdminPermissions,
  addRolePermission,
  removeRolePermission
} from "../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Badge } from "../../../../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../components/ui/table";
import { Shield, Check, X, Lock } from "lucide-react";

type RoleSummary = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  _count: { permissions: number; users: number };
};

type PermissionSummary = {
  id: string;
  code: string;
  description: string | null;
  _count: { roles: number };
};

const ROLE_COLORS: Record<string, string> = {
  VIEWER: "bg-slate-100 text-slate-700",
  CONTROLLER: "bg-blue-100 text-blue-800",
  ADMIN: "bg-emerald-100 text-emerald-800",
  SUPERADMIN: "bg-purple-100 text-purple-800"
};

export default function RolesPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const { canAdmin } = useUserRole();
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [rolePermissions, setRolePermissions] = useState<Set<string>>(new Set());

  const rolesQ = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => (apiContext ? getAdminRoles(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: { data: unknown }) => (r.data as RoleSummary[]) ?? []
  });

  const permissionsQ = useQuery({
    queryKey: ["admin-permissions"],
    queryFn: () => (apiContext ? getAdminPermissions(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: { data: unknown }) => (r.data as PermissionSummary[]) ?? []
  });

  // Load role's permissions when selected
  const selectedRoleQ = useQuery({
    queryKey: ["admin-role-detail", selectedRoleId],
    queryFn: async () => {
      if (!apiContext || !selectedRoleId) return null;
      const { getAdminRole } = await import("../../../../lib/gl-api");
      const res = await getAdminRole(apiContext, selectedRoleId);
      const role = res.data as unknown as {
        permissions: Array<{ permissionId: string; permission: { id: string; code: string } }>;
      };
      setRolePermissions(new Set(role.permissions.map((p) => p.permission.id)));
      return role;
    },
    enabled: Boolean(apiContext && selectedRoleId)
  });

  const addPermMut = useMutation({
    mutationFn: (permissionId: string) =>
      addRolePermission(apiContext!, selectedRoleId!, permissionId),
    onSuccess: (_, permissionId) => {
      setRolePermissions((prev) => new Set([...prev, permissionId]));
      qc.invalidateQueries({ queryKey: ["admin-role-detail", selectedRoleId] });
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
    }
  });

  const removePermMut = useMutation({
    mutationFn: (permissionId: string) =>
      removeRolePermission(apiContext!, selectedRoleId!, permissionId),
    onSuccess: (_, permissionId) => {
      setRolePermissions((prev) => {
        const s = new Set(prev);
        s.delete(permissionId);
        return s;
      });
      qc.invalidateQueries({ queryKey: ["admin-role-detail", selectedRoleId] });
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
    }
  });

  const roles = rolesQ.data ?? [];
  const permissions = permissionsQ.data ?? [];

  // Group permissions by module prefix
  const permissionGroups = new Map<string, PermissionSummary[]>();
  for (const perm of permissions) {
    const group = perm.code.split("_")[0];
    const existing = permissionGroups.get(group) ?? [];
    existing.push(perm);
    permissionGroups.set(group, existing);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-primary">Roles & Permissions</h1>
        <p className="text-sm text-muted-foreground">
          View role hierarchy and manage permission assignments
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Roles list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" /> System Roles
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {roles.map((role) => (
              <button
                key={role.id}
                onClick={() => setSelectedRoleId(role.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedRoleId === role.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <Badge className={`${ROLE_COLORS[role.code] ?? "bg-gray-100"} text-[10px]`}>
                    {role.code}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {role._count.permissions} perms
                  </span>
                </div>
                <p className="text-sm font-medium">{role.name}</p>
                <p className="text-xs text-muted-foreground">{role.description}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {role._count.users} user(s) assigned
                </p>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Permission matrix */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {selectedRoleId
                  ? `Permissions for ${roles.find((r) => r.id === selectedRoleId)?.name ?? "Role"}`
                  : "Select a role to view permissions"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedRoleId ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Click a role on the left to view and manage its permissions.
                </p>
              ) : (
                <div className="space-y-4">
                  {Array.from(permissionGroups.entries()).map(([group, perms]) => (
                    <div key={group}>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        {group}
                      </h4>
                      <Table>
                        <TableBody>
                          {perms.map((perm) => {
                            const hasIt = rolePermissions.has(perm.id);
                            return (
                              <TableRow key={perm.id} className={hasIt ? "bg-emerald-50/50" : ""}>
                                <TableCell className="w-8">
                                  {hasIt ? (
                                    <Check className="h-4 w-4 text-emerald-600" />
                                  ) : (
                                    <X className="h-4 w-4 text-slate-300" />
                                  )}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{perm.code}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">
                                  {perm.description}
                                </TableCell>
                                <TableCell className="text-right w-20">
                                  {canAdmin && (
                                    <button
                                      onClick={() =>
                                        hasIt
                                          ? removePermMut.mutate(perm.id)
                                          : addPermMut.mutate(perm.id)
                                      }
                                      disabled={addPermMut.isPending || removePermMut.isPending}
                                      className={`text-xs px-2 py-0.5 rounded ${
                                        hasIt
                                          ? "text-red-600 hover:bg-red-50"
                                          : "text-emerald-600 hover:bg-emerald-50"
                                      }`}
                                    >
                                      {hasIt ? "Revoke" : "Grant"}
                                    </button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
