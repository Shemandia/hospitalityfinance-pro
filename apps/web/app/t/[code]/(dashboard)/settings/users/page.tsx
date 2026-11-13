"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../components/use-permissions";
import {
  getAdminEntityUsers,
  inviteEntityUser,
  removeEntityUser,
  getAdminRoles,
  getEntities,
  type EntitySummaryItem
} from "../../../../../../lib/gl-api";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
import { Input } from "../../../../../../components/ui/input";
import { Label } from "../../../../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../../../../components/ui/dialog";
import { Plus, Trash2, Shield, UserCog, Building2 } from "lucide-react";
import { ConfirmDialog } from "../../../../../../components/confirm-dialog";

const DEFAULT_ROLE_COLORS: Record<string, string> = {
  VIEWER: "bg-slate-100 text-slate-700",
  CONTROLLER: "bg-blue-100 text-blue-800",
  ADMIN: "bg-emerald-100 text-emerald-800",
  TENANT_ADMIN: "bg-purple-100 text-purple-800"
};

function getRoleColor(code: string): string {
  return DEFAULT_ROLE_COLORS[code] ?? "bg-indigo-100 text-indigo-800";
}

type RoleSummary = { id: string; code: string; name: string; description?: string | null };

type EntityUserRow = {
  entityId: string;
  userId: string;
  role?: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

export default function UsersPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canManageUsers = can("ADMIN_USERS");
  const [showCreate, setShowCreate] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createRoleId, setCreateRoleId] = useState("");
  const [createEntityIds, setCreateEntityIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [removeTarget, setRemoveTarget] = useState<EntityUserRow | null>(null);

  // Fetch available roles dynamically from API
  const rolesQ = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => (apiContext ? getAdminRoles(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: { data: unknown }) => (r.data as RoleSummary[]) ?? []
  });
  const availableRoles = rolesQ.data ?? [];

  // Fetch entities for property assignment
  const entitiesQ = useQuery({
    queryKey: ["entities", apiContext?.tenantSlug],
    queryFn: () => (apiContext ? getEntities(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: { data: unknown }) => (r.data as EntitySummaryItem[]) ?? []
  });
  const allEntities = entitiesQ.data ?? [];

  const usersQ = useQuery({
    queryKey: ["admin-users", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => (apiContext ? getAdminEntityUsers(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: { data: unknown }) => (r.data as EntityUserRow[]) ?? []
  });

  const createMut = useMutation({
    mutationFn: () =>
      inviteEntityUser(apiContext!, {
        email: createEmail,
        name: createName,
        roleId: createRoleId || undefined,
        entityIds: createEntityIds.length > 0 ? createEntityIds : undefined
      }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setShowCreate(false);
      setCreateEmail("");
      setCreateName("");
      setCreateRoleId("");
      setCreateEntityIds([]);
      const tempPw = data?.data?.tempPassword;
      setFeedback(
        tempPw ? `User created. Temporary password: ${tempPw}` : "User created successfully."
      );
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const removeMut = useMutation({
    mutationFn: (userId: string) => removeEntityUser(apiContext!, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setFeedback("User removed from entity.");
    }
  });

  const users = usersQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">User Management</h1>
          <p className="text-sm text-muted-foreground">
            Manage users and their roles for this property
          </p>
        </div>
        {canManageUsers && (
          <Button variant="teal" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 h-3 w-3" /> Create User
          </Button>
        )}
      </div>

      {feedback && (
        <p
          className={`text-sm ${feedback.includes("error") || feedback.includes("Error") ? "text-destructive" : "text-emerald-700"}`}
        >
          {feedback}
        </p>
      )}

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <UserCog className="h-4 w-4" /> Entity Users
          </CardTitle>
          <Badge variant="outline">{users.length} users</Badge>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Since</TableHead>
                {canManageUsers && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canManageUsers ? 4 : 3}
                    className="text-center py-6 text-muted-foreground"
                  >
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((eu) => (
                  <TableRow key={eu.userId}>
                    <TableCell className="font-medium">{eu.user.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{eu.user.email}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(eu.createdAt).toLocaleDateString()}
                    </TableCell>
                    {canManageUsers && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRemoveTarget(eu)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Available Roles Legend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Available Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {availableRoles.map((role) => (
              <div key={role.id} className="border rounded-lg p-3">
                <Badge className={`${getRoleColor(role.code)} text-[10px] mb-1`}>{role.code}</Badge>
                <p className="text-xs text-muted-foreground">{role.description ?? role.name}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="user@hotel.com"
              />
            </div>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Full Name"
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <select
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                value={createRoleId}
                onChange={(e) => setCreateRoleId(e.target.value)}
              >
                <option value="">No role</option>
                {availableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" /> Property Assignment
              </Label>
              <div className="border rounded-lg p-2 max-h-40 overflow-y-auto space-y-1">
                {allEntities.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1 px-1">No properties available</p>
                ) : (
                  allEntities.map((entity) => (
                    <label
                      key={entity.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-slate-300"
                        checked={createEntityIds.includes(entity.id)}
                        onChange={(e) => {
                          setCreateEntityIds((prev) =>
                            e.target.checked
                              ? [...prev, entity.id]
                              : prev.filter((id) => id !== entity.id)
                          );
                        }}
                      />
                      <span className="flex-1 truncate">{entity.name}</span>
                      <span className="text-[10px] text-muted-foreground">{entity.type}</span>
                    </label>
                  ))
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Select which properties this user can access. Leave empty to use current entity.
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
              A temporary password will be generated. The user must change it on first login.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!createEmail || !createName || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove User"
        description={
          removeTarget
            ? `Remove ${removeTarget.user.name} from this entity? They will lose access to all data in this property.`
            : ""
        }
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => {
          if (removeTarget) removeMut.mutate(removeTarget.userId);
        }}
        loading={removeMut.isPending}
      />
    </div>
  );
}
