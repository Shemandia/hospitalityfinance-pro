"use client";

/**
 * Roles & access (WP-A step 10).
 *
 * Who holds which role where. A role is granted to a user tenant-wide, or at a
 * group, cluster or property, from where it reaches everything below. The
 * effective permissions per property come from the server's access resolver,
 * so they are exactly what the API allows that user.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../components/use-permissions";
import {
  assignUserRole,
  getAdminEntityUsers,
  getAdminRoles,
  getEntityTree,
  getUserAccess,
  revokeUserRole,
  type EntityUserRow,
  type UserAccessView
} from "../../../../../../lib/gl-api";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
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
import {
  Building2,
  Globe2,
  Hotel,
  Landmark,
  Network,
  Plus,
  Shield,
  Trash2,
  Users
} from "lucide-react";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  CORPORATE: <Landmark className="h-4 w-4 text-purple-600" />,
  GROUP: <Landmark className="h-4 w-4 text-purple-600" />,
  CLUSTER: <Network className="h-4 w-4 text-blue-600" />,
  PROPERTY: <Hotel className="h-4 w-4 text-emerald-600" />
};

const TYPE_LABELS: Record<string, string> = {
  CORPORATE: "Corporate",
  GROUP: "Group",
  CLUSTER: "Cluster",
  PROPERTY: "Property"
};

const TENANT = "__tenant__";

type TreeEntity = {
  id: string;
  name: string;
  code: string | null;
  type: string;
  parentId: string | null;
  isActive: boolean;
};

type RoleSummary = { id: string; code: string; name: string };

/** Entities in tree order (each parent before its children), with their depth. */
function inTreeOrder(entities: TreeEntity[]): Array<TreeEntity & { depth: number }> {
  const ids = new Set(entities.map((e) => e.id));
  const children = new Map<string | null, TreeEntity[]>();
  for (const entity of entities) {
    // A parent outside the caller's reach is shown as a root.
    const parent = entity.parentId && ids.has(entity.parentId) ? entity.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), entity]);
  }
  const out: Array<TreeEntity & { depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const entity of (children.get(parent) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      out.push({ ...entity, depth });
      walk(entity.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The change could not be made.";
}

export default function RolesAndAccessPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canManage = can("ADMIN_USERS", "any-entity");
  const canGrantTenantWide = can("ADMIN_USERS", "tenant");

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showGrant, setShowGrant] = useState(false);
  const [grantRoleId, setGrantRoleId] = useState("");
  const [grantWhere, setGrantWhere] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const treeQ = useQuery({
    queryKey: ["entity-tree", apiContext?.tenantSlug],
    queryFn: () => getEntityTree(apiContext!),
    enabled: Boolean(apiContext),
    select: (r) => r.data?.flat ?? []
  });

  const usersQ = useQuery({
    queryKey: ["admin-users", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => getAdminEntityUsers(apiContext!),
    enabled: Boolean(apiContext),
    select: (r) => r.data ?? ([] as EntityUserRow[])
  });

  const rolesQ = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => getAdminRoles(apiContext!),
    enabled: Boolean(apiContext),
    select: (r) => (r.data as RoleSummary[] | undefined) ?? []
  });

  const accessQ = useQuery({
    queryKey: ["user-access", apiContext?.tenantSlug, selectedUserId],
    queryFn: () => getUserAccess(apiContext!, selectedUserId!),
    enabled: Boolean(apiContext && selectedUserId),
    select: (r) => r.data as UserAccessView
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["user-access"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["entity-tree"] });
  };

  const grantMut = useMutation({
    mutationFn: () =>
      assignUserRole(
        apiContext!,
        selectedUserId!,
        grantWhere === TENANT
          ? { roleId: grantRoleId, scope: "TENANT" }
          : { roleId: grantRoleId, entityId: grantWhere }
      ),
    onSuccess: () => {
      refresh();
      setShowGrant(false);
      setFeedback({ ok: true, text: "Role granted. It applies from the user's next request." });
    },
    onError: (e) => setFeedback({ ok: false, text: errorText(e) })
  });

  const revokeMut = useMutation({
    mutationFn: (grant: { roleId: string; entityId: string | null }) =>
      revokeUserRole(apiContext!, selectedUserId!, grant.roleId, grant.entityId),
    onSuccess: () => {
      refresh();
      setFeedback({
        ok: true,
        text: "Role revoked. It stops applying on the user's next request."
      });
    },
    onError: (e) => setFeedback({ ok: false, text: errorText(e) })
  });

  const entities = useMemo(() => inTreeOrder(treeQ.data ?? []), [treeQ.data]);
  const users = usersQ.data ?? [];
  const roles = rolesQ.data ?? [];
  const access = accessQ.data;
  const selected = users.find((u) => u.userId === selectedUserId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-primary">Roles &amp; Access</h1>
        <p className="text-sm text-muted-foreground">
          Grant a role for the whole tenant, or at a group, cluster or property. A role on a group
          applies to every property under it.
        </p>
      </div>

      {feedback && (
        <p className={`text-sm ${feedback.ok ? "text-emerald-700" : "text-destructive"}`}>
          {feedback.text}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4" /> Users with access here
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {users.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No user can open this property.
              </p>
            ) : (
              users.map((row) => (
                <button
                  key={row.userId}
                  type="button"
                  onClick={() => {
                    setSelectedUserId(row.userId);
                    setFeedback(null);
                  }}
                  className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
                    selectedUserId === row.userId
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <p className="text-sm font-medium">
                    {row.user.name ?? row.user.email}
                    {!row.user.isActive && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        Inactive
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{row.user.email}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {row.roles.map((r) => r.name).join(", ")}
                  </p>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {!selectedUserId ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Users className="mx-auto mb-2 h-8 w-8 opacity-30" />
                <p className="text-sm">Select a user to see their roles and what they can do.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="flex items-center justify-between pt-4">
                  <div>
                    <p className="font-semibold">{selected?.user.name ?? selected?.user.email}</p>
                    <p className="text-sm text-muted-foreground">{selected?.user.email}</p>
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="teal"
                      onClick={() => {
                        setGrantRoleId("");
                        setGrantWhere("");
                        setShowGrant(true);
                      }}
                    >
                      <Plus className="mr-1 h-3 w-3" /> Grant role
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Shield className="h-4 w-4" /> Roles ({access?.assignments.length ?? 0})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {accessQ.isError ? (
                    <p className="py-4 text-center text-sm text-destructive">
                      {errorText(accessQ.error)}
                    </p>
                  ) : !access || access.assignments.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No roles you can manage.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Role</TableHead>
                          <TableHead>Where</TableHead>
                          {canManage && <TableHead className="text-right">Revoke</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {access.assignments.map((grant) => (
                          <TableRow key={`${grant.roleId}@${grant.entity?.id ?? TENANT}`}>
                            <TableCell>
                              <p className="text-sm font-medium">{grant.roleName}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">
                                {grant.roleCode}
                              </p>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {grant.entity ? (
                                  (TYPE_ICONS[grant.entity.type] ?? (
                                    <Building2 className="h-4 w-4" />
                                  ))
                                ) : (
                                  <Globe2 className="h-4 w-4 text-slate-600" />
                                )}
                                <span className="text-sm">
                                  {grant.entity ? grant.entity.name : "Whole tenant"}
                                </span>
                                {grant.entity && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {TYPE_LABELS[grant.entity.type] ?? grant.entity.type}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            {canManage && (
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  disabled={revokeMut.isPending}
                                  aria-label={`Revoke ${grant.roleName}`}
                                  onClick={() => {
                                    const where = grant.entity
                                      ? grant.entity.name
                                      : "the whole tenant";
                                    if (confirm(`Revoke ${grant.roleName} at ${where}?`)) {
                                      revokeMut.mutate({
                                        roleId: grant.roleId,
                                        entityId: grant.entity?.id ?? null
                                      });
                                    }
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Effective permissions per property</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    What this user can do at each entity you manage, from every role that reaches
                    it.
                  </p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {access && access.tenantPermissions.length > 0 && (
                    <details className="rounded-lg border p-2">
                      <summary className="cursor-pointer text-sm">
                        <Globe2 className="mr-1 inline h-4 w-4 text-slate-600" /> Tenant-wide:{" "}
                        {access.tenantPermissions.length} permissions
                      </summary>
                      <PermissionList codes={access.tenantPermissions} />
                    </details>
                  )}
                  {!access || access.effective.length === 0 ? (
                    <p className="py-2 text-center text-sm text-muted-foreground">
                      This user can open none of the entities you manage.
                    </p>
                  ) : (
                    access.effective.map(({ entity, permissions }) => (
                      <details key={entity.id} className="rounded-lg border p-2">
                        <summary className="flex cursor-pointer items-center gap-2 text-sm">
                          {TYPE_ICONS[entity.type] ?? <Building2 className="h-4 w-4" />}
                          <span className="font-medium">{entity.name}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {TYPE_LABELS[entity.type] ?? entity.type}
                          </Badge>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {permissions.length} permissions
                          </span>
                        </summary>
                        <PermissionList codes={permissions} />
                      </details>
                    ))
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      <Dialog open={showGrant} onOpenChange={setShowGrant}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Grant a role to {selected?.user.name ?? selected?.user.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="grant-role">Role</Label>
              <select
                id="grant-role"
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                value={grantRoleId}
                onChange={(e) => setGrantRoleId(e.target.value)}
              >
                <option value="">Select a role…</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name} ({role.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="grant-where">Where</Label>
              <select
                id="grant-where"
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                value={grantWhere}
                onChange={(e) => setGrantWhere(e.target.value)}
              >
                <option value="">Select where it applies…</option>
                {canGrantTenantWide && <option value={TENANT}>Whole tenant</option>}
                {entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {"  ".repeat(entity.depth)}
                    {TYPE_LABELS[entity.type] ?? entity.type} — {entity.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">
                A role on a group or cluster applies to every property under it. You can only grant
                a role whose permissions you hold there yourself.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGrant(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!grantRoleId || !grantWhere || grantMut.isPending}
              onClick={() => grantMut.mutate()}
            >
              {grantMut.isPending ? "Granting…" : "Grant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PermissionList({ codes }: { codes: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {codes.map((code) => (
        <Badge key={code} variant="outline" className="font-mono text-[10px]">
          {code}
        </Badge>
      ))}
    </div>
  );
}
