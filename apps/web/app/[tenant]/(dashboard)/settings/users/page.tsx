"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../components/use-api-context";
import { useUserRole } from "../../../../../components/use-user-role";
import {
  getAdminEntityUsers,
  inviteEntityUser,
  updateEntityUserRole,
  removeEntityUser,
  setUserActiveStatus
} from "../../../../../lib/gl-api";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../../../components/ui/dialog";
import {
  Select as UISelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import { Plus, Trash2, Shield, UserCog } from "lucide-react";
import { ConfirmDialog } from "../../../../../components/confirm-dialog";

const ROLES = ["VIEWER", "CONTROLLER", "ADMIN", "SUPERADMIN"] as const;
const ROLE_COLORS: Record<string, string> = {
  VIEWER: "bg-slate-100 text-slate-700",
  CONTROLLER: "bg-blue-100 text-blue-800",
  ADMIN: "bg-emerald-100 text-emerald-800",
  SUPERADMIN: "bg-purple-100 text-purple-800"
};

type EntityUserRow = {
  entityId: string;
  userId: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
};

export default function UsersPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const { canAdmin } = useUserRole();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("VIEWER");
  const [feedback, setFeedback] = useState("");
  const [removeTarget, setRemoveTarget] = useState<EntityUserRow | null>(null);

  const usersQ = useQuery({
    queryKey: ["admin-users", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => (apiContext ? getAdminEntityUsers(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: { data: unknown }) => (r.data as EntityUserRow[]) ?? []
  });

  const inviteMut = useMutation({
    mutationFn: () =>
      inviteEntityUser(apiContext!, { email: inviteEmail, name: inviteName, role: inviteRole }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setShowInvite(false);
      setInviteEmail("");
      setInviteName("");
      setFeedback("User invited successfully.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const updateRoleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      updateEntityUserRole(apiContext!, userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setFeedback("Role updated.");
    }
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
        {canAdmin && (
          <Button variant="teal" size="sm" onClick={() => setShowInvite(true)}>
            <Plus className="mr-1 h-3 w-3" /> Invite User
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
                <TableHead>Role</TableHead>
                <TableHead>Since</TableHead>
                {canAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canAdmin ? 5 : 4}
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
                    <TableCell>
                      {canAdmin ? (
                        <UISelect
                          value={eu.role}
                          onValueChange={(value) =>
                            updateRoleMut.mutate({ userId: eu.userId, role: value })
                          }
                        >
                          <SelectTrigger className="h-7 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {r}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </UISelect>
                      ) : (
                        <Badge className={`${ROLE_COLORS[eu.role] ?? ""} text-[10px]`}>
                          <Shield className="mr-1 h-2.5 w-2.5" />
                          {eu.role}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(eu.createdAt).toLocaleDateString()}
                    </TableCell>
                    {canAdmin && (
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

      {/* Role Legend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Role Permissions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { role: "VIEWER", desc: "Read-only: dashboards, reports, trial balance" },
              { role: "CONTROLLER", desc: "Post journals, approve invoices, close periods" },
              { role: "ADMIN", desc: "Full access: imports, payments, user management" },
              { role: "SUPERADMIN", desc: "System-wide: cross-entity, period reopen" }
            ].map(({ role, desc }) => (
              <div key={role} className="border rounded-lg p-3">
                <Badge className={`${ROLE_COLORS[role]} text-[10px] mb-1`}>{role}</Badge>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Invite User</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@hotel.com"
              />
            </div>
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Full Name"
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <select
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!inviteEmail || !inviteName || inviteMut.isPending}
              onClick={() => inviteMut.mutate()}
            >
              {inviteMut.isPending ? "Inviting..." : "Invite"}
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
