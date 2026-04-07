"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../components/use-api-context";
import { useUserRole } from "../../../../../components/use-user-role";
import {
  getAdminRoles,
  getAdminRole,
  getAdminPermissions,
  createAdminRole,
  updateAdminRole,
  deleteAdminRole,
  addRolePermission,
  removeRolePermission
} from "../../../../../lib/gl-api";
import { Shield, Check, X, Plus, Pencil, Trash2, Users, Lock, ChevronRight } from "lucide-react";

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

const ROLE_BADGE: Record<string, { bg: string; text: string }> = {
  VIEWER: { bg: "bg-slate-100", text: "text-slate-700" },
  CONTROLLER: { bg: "bg-blue-100", text: "text-blue-700" },
  ADMIN: { bg: "bg-emerald-100", text: "text-emerald-700" },
  SUPERADMIN: { bg: "bg-purple-100", text: "text-purple-700" }
};

const SYSTEM_ROLES = new Set(["VIEWER", "CONTROLLER", "ADMIN", "SUPERADMIN"]);

export default function RolesPage() {
  const ctx = useApiContext();
  const qc = useQueryClient();
  const { canAdmin } = useUserRole();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [rolePermissions, setRolePermissions] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleSummary | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const rolesQ = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => (ctx ? getAdminRoles(ctx) : Promise.resolve({ data: [] })),
    enabled: !!ctx,
    select: (r: { data: unknown }) => (r.data as RoleSummary[]) ?? []
  });

  const permissionsQ = useQuery({
    queryKey: ["admin-permissions"],
    queryFn: () => (ctx ? getAdminPermissions(ctx) : Promise.resolve({ data: [] })),
    enabled: !!ctx,
    select: (r: { data: unknown }) => (r.data as PermissionSummary[]) ?? []
  });

  const selectedRoleQ = useQuery({
    queryKey: ["admin-role-detail", selectedRoleId],
    queryFn: async () => {
      if (!ctx || !selectedRoleId) return null;
      const res = await getAdminRole(ctx, selectedRoleId);
      const role = res.data as unknown as {
        permissions: Array<{ permissionId: string; permission: { id: string; code: string } }>;
      };
      setRolePermissions(new Set(role.permissions.map((p) => p.permission.id)));
      return role;
    },
    enabled: !!(ctx && selectedRoleId)
  });

  const addPermMut = useMutation({
    mutationFn: (permissionId: string) => addRolePermission(ctx!, selectedRoleId!, permissionId),
    onSuccess: (_, permissionId) => {
      setRolePermissions((prev) => new Set([...prev, permissionId]));
      qc.invalidateQueries({ queryKey: ["admin-role-detail", selectedRoleId] });
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
    }
  });

  const removePermMut = useMutation({
    mutationFn: (permissionId: string) => removeRolePermission(ctx!, selectedRoleId!, permissionId),
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

  const createMut = useMutation({
    mutationFn: () =>
      createAdminRole(ctx!, {
        code: formCode.toUpperCase().trim(),
        name: formName.trim(),
        description: formDesc.trim() || null
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
      closeForm();
    },
    onError: (e: Error) => setFormError(e.message)
  });

  const updateMut = useMutation({
    mutationFn: () =>
      updateAdminRole(ctx!, editingRole!.id, {
        name: formName.trim(),
        description: formDesc.trim() || null
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
      closeForm();
    },
    onError: (e: Error) => setFormError(e.message)
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAdminRole(ctx!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-roles"] });
      if (selectedRoleId === deleteTarget?.id) setSelectedRoleId(null);
      setDeleteTarget(null);
    },
    onError: (e: Error) => setDeleteError(e.message)
  });

  function openCreate() {
    setEditingRole(null);
    setFormCode("");
    setFormName("");
    setFormDesc("");
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(role: RoleSummary) {
    setEditingRole(role);
    setFormCode(role.code);
    setFormName(role.name);
    setFormDesc(role.description ?? "");
    setFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingRole(null);
    setFormError(null);
  }

  function handleSubmit() {
    if (!formName.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!editingRole && !formCode.trim()) {
      setFormError("Code is required.");
      return;
    }
    if (editingRole) updateMut.mutate();
    else createMut.mutate();
  }

  const roles = rolesQ.data ?? [];
  const permissions = permissionsQ.data ?? [];
  const permGroups = new Map<string, PermissionSummary[]>();
  for (const p of permissions) {
    const g = p.code.split("_")[0];
    permGroups.set(g, [...(permGroups.get(g) ?? []), p]);
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const isSubmitting = createMut.isPending || updateMut.isPending;

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6 pb-20">
      {/* Header */}
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Shield className="h-7 w-7 text-slate-400" />
            Roles & Permissions
          </h2>
          <p className="text-slate-500 mt-1">
            Create custom roles and manage permission assignments.
          </p>
        </div>
        {canAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-bold shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all flex items-center gap-2"
          >
            <Plus className="h-5 w-5" /> New Role
          </button>
        )}
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-800">
              {editingRole ? `Edit — ${editingRole.code}` : "New Role"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="text-slate-400 hover:text-slate-600 p-1"
              aria-label="Close form"
              title="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="role-code"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Code
              </label>
              <input
                id="role-code"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                disabled={!!editingRole}
                placeholder="e.g. NIGHT_AUDIT"
                maxLength={30}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
            <div>
              <label
                htmlFor="role-name"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Name
              </label>
              <input
                id="role-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Night Auditor"
                maxLength={100}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              />
            </div>
            <div>
              <label
                htmlFor="role-desc"
                className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider"
              >
                Description
              </label>
              <input
                id="role-desc"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Optional description"
                maxLength={500}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500"
              />
            </div>
          </div>
          {formError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2">{formError}</p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeForm}
              className="px-6 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-6 py-2.5 text-sm font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 shadow-lg shadow-emerald-100"
            >
              {isSubmitting ? "Saving..." : editingRole ? "Save Changes" : "Create Role"}
            </button>
          </div>
        </div>
      )}

      {/* Roles list */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-lg">{roles.length} Roles</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {roles.map((role) => {
            const badge = ROLE_BADGE[role.code] ?? { bg: "bg-indigo-100", text: "text-indigo-700" };
            const isSystem = SYSTEM_ROLES.has(role.code);
            const isSelected = selectedRoleId === role.id;
            return (
              <div
                key={role.id}
                onClick={() => setSelectedRoleId(role.id)}
                className={`p-5 flex items-center gap-4 cursor-pointer transition-colors group/row ${
                  isSelected
                    ? "bg-emerald-50/50 border-l-4 border-l-emerald-500"
                    : "hover:bg-slate-50/50 border-l-4 border-l-transparent"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${badge.bg} ${badge.text}`}
                    >
                      {role.code}
                    </span>
                    {isSystem && <Lock className="h-3 w-3 text-slate-300" />}
                  </div>
                  <p className="font-semibold text-slate-800">{role.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{role.description}</p>
                </div>
                <div className="flex items-center gap-4 text-right shrink-0">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{role._count.permissions}</p>
                    <p className="text-[10px] text-slate-400">permissions</p>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">{role._count.users}</p>
                    <p className="text-[10px] text-slate-400">users</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                    {canAdmin && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(role);
                        }}
                        className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                        title="Edit role"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {canAdmin && !isSystem && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(role);
                          setDeleteError(null);
                        }}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                        title="Delete role"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <ChevronRight
                    className={`h-4 w-4 transition-colors ${isSelected ? "text-emerald-500" : "text-slate-200"}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Permission matrix for selected role */}
      {selectedRoleId && (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 text-lg">
              Permissions for{" "}
              <span className="text-emerald-600">{selectedRole?.name ?? "Role"}</span>
            </h3>
            <span className="text-xs text-slate-400">
              {rolePermissions.size} of {permissions.length} granted
            </span>
          </div>
          <div className="overflow-x-auto">
            {Array.from(permGroups.entries()).map(([group, perms]) => (
              <div key={group}>
                <div className="px-6 py-3 bg-slate-50/50 border-b border-slate-100">
                  <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em]">
                    {group}
                  </h4>
                </div>
                <table className="w-full">
                  <tbody className="divide-y divide-slate-100">
                    {perms.map((perm) => {
                      const hasIt = rolePermissions.has(perm.id);
                      return (
                        <tr
                          key={perm.id}
                          className={`transition-colors ${hasIt ? "bg-emerald-50/30" : "hover:bg-slate-50/30"}`}
                        >
                          <td className="px-6 py-3.5 w-8">
                            {hasIt ? (
                              <div className="h-5 w-5 rounded-full bg-emerald-100 flex items-center justify-center">
                                <Check className="h-3 w-3 text-emerald-600" />
                              </div>
                            ) : (
                              <div className="h-5 w-5 rounded-full bg-slate-100 flex items-center justify-center">
                                <X className="h-3 w-3 text-slate-300" />
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-3.5 font-mono text-xs font-bold text-slate-700 w-48">
                            {perm.code}
                          </td>
                          <td className="px-6 py-3.5 text-sm text-slate-500">{perm.description}</td>
                          <td className="px-6 py-3.5 text-right w-24">
                            {canAdmin && (
                              <button
                                type="button"
                                onClick={() =>
                                  hasIt ? removePermMut.mutate(perm.id) : addPermMut.mutate(perm.id)
                                }
                                disabled={addPermMut.isPending || removePermMut.isPending}
                                className={`text-xs font-bold px-3 py-1 rounded-lg transition-colors ${
                                  hasIt
                                    ? "text-red-600 hover:bg-red-50"
                                    : "text-emerald-600 hover:bg-emerald-50"
                                }`}
                              >
                                {hasIt ? "Revoke" : "Grant"}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {!selectedRoleId && (
        <div className="bg-white rounded-3xl border border-slate-100 p-12 text-center">
          <Shield className="h-10 w-10 text-slate-200 mx-auto mb-3" />
          <p className="text-slate-400 font-medium">
            Select a role above to view and manage its permissions.
          </p>
        </div>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-xl mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Role</h3>
            <p className="text-sm text-slate-500 mb-4">
              Delete{" "}
              <span className="font-bold text-slate-800">
                {deleteTarget.code} — {deleteTarget.name}
              </span>
              ?
              {deleteTarget._count.users > 0 && (
                <span className="block text-red-500 mt-1">
                  Warning: {deleteTarget._count.users} user(s) are assigned to this role.
                </span>
              )}
            </p>
            {deleteError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2 mb-3">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => deleteMut.mutate(deleteTarget.id)}
                disabled={deleteMut.isPending}
                className="px-4 py-2 text-sm font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMut.isPending ? "Deleting..." : "Delete Role"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
