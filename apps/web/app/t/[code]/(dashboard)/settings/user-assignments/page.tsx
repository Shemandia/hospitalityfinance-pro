"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useUserRole } from "../../../../../../components/use-user-role";
import {
  getEntityTree,
  getAdminEntityUsers,
  assignUserScope,
  revokeUserScope,
  getUserEntityAssignments
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
  Users,
  Shield,
  ChevronRight,
  Plus,
  Trash2,
  Network,
  Hotel,
  Landmark
} from "lucide-react";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  CORPORATE: <Landmark className="h-4 w-4 text-purple-600" />,
  GROUP: <Landmark className="h-4 w-4 text-purple-600" />,
  CLUSTER: <Network className="h-4 w-4 text-blue-600" />,
  PROPERTY: <Hotel className="h-4 w-4 text-emerald-600" />
};

const TYPE_LABELS: Record<string, string> = {
  CORPORATE: "Corporate",
  GROUP: "Corporate",
  CLUSTER: "Cluster",
  PROPERTY: "Property"
};

type EntityFlat = {
  id: string;
  name: string;
  code: string | null;
  type: string;
  parentId: string | null;
  isActive: boolean;
  _count: { children: number; users: number };
};

type UserAssignment = {
  entityId: string;
  userId: string;
  role?: string;
  entity: {
    id: string;
    name: string;
    code: string | null;
    type: string;
    parentId: string | null;
  };
};

type EntityUser = {
  entityId: string;
  userId: string;
  role?: string;
  user: { id: string; name: string; email: string };
};

export default function UserAssignmentsPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const { isSuperAdmin } = useUserRole();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [assignEntityId, setAssignEntityId] = useState("");
  const [assignCascade, setAssignCascade] = useState(true);
  const [feedback, setFeedback] = useState("");

  // Fetch entity hierarchy
  const treeQ = useQuery({
    queryKey: ["entity-tree"],
    queryFn: () =>
      apiContext
        ? getEntityTree(apiContext)
        : Promise.resolve({
            data: { flat: [] as EntityFlat[], tree: [] }
          }),
    enabled: Boolean(apiContext),
    select: (r: { data: { flat: EntityFlat[]; tree: unknown[] } }) => r.data?.flat ?? []
  });

  // Fetch entity users for current entity
  const usersQ = useQuery({
    queryKey: ["admin-users", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: () => (apiContext ? getAdminEntityUsers(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r: { data: unknown }) => (r.data as EntityUser[]) ?? []
  });

  // Fetch selected user's entity assignments
  const assignmentsQ = useQuery({
    queryKey: ["user-assignments", selectedUserId],
    queryFn: () =>
      apiContext && selectedUserId
        ? getUserEntityAssignments(apiContext, selectedUserId)
        : Promise.resolve({ data: [] as UserAssignment[] }),
    enabled: Boolean(apiContext && selectedUserId),
    select: (r: { data: UserAssignment[] }) => r.data ?? []
  });

  const assignMut = useMutation({
    mutationFn: () =>
      assignUserScope(apiContext!, {
        userId: selectedUserId!,
        entityId: assignEntityId,
        cascade: assignCascade
      }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["user-assignments"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setShowAssign(false);
      const data = (result as any).data;
      setFeedback(
        `Assigned to ${data?.assignedEntities ?? 1} entities (${data?.scope}, cascade: ${data?.cascade}).`
      );
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const revokeMut = useMutation({
    mutationFn: (params: { entityId: string; cascade: boolean }) =>
      revokeUserScope(apiContext!, {
        userId: selectedUserId!,
        entityId: params.entityId,
        cascade: params.cascade
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-assignments"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setFeedback("Access revoked.");
    }
  });

  const entities = treeQ.data ?? [];
  const users = usersQ.data ?? [];
  const assignments = assignmentsQ.data ?? [];
  const selectedUser = users.find((u) => u.userId === selectedUserId);

  // Group entities by level for the hierarchy display
  const corporates = entities.filter((e) => e.type === "CORPORATE" || e.type === "GROUP");
  const clusters = entities.filter((e) => e.type === "CLUSTER");
  const properties = entities.filter((e) => e.type === "PROPERTY");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-primary">User & Property Assignments</h1>
        <p className="text-sm text-muted-foreground">
          Assign users to properties, clusters, or corporate level. Cascade assignments flow down
          the hierarchy.
        </p>
      </div>

      {feedback && (
        <p
          className={`text-sm ${feedback.includes("error") || feedback.includes("Error") ? "text-destructive" : "text-emerald-700"}`}
        >
          {feedback}
        </p>
      )}

      {/* Scope Level Legend */}
      <div className="flex gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <Landmark className="h-3.5 w-3.5 text-purple-600" />
          <span className="text-muted-foreground">
            Corporate — access to all clusters & properties
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Network className="h-3.5 w-3.5 text-blue-600" />
          <span className="text-muted-foreground">
            Cluster — access to all properties in region
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Hotel className="h-3.5 w-3.5 text-emerald-600" />
          <span className="text-muted-foreground">Property — access to single hotel</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: User List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4" /> Entity Users
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No users in this entity.
              </p>
            ) : (
              users.map((eu) => (
                <button
                  key={eu.userId}
                  onClick={() => setSelectedUserId(eu.userId)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                    selectedUserId === eu.userId
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{eu.user.name}</p>
                    <p className="text-xs text-muted-foreground">{eu.user.email}</p>
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* Right: Entity Assignments */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedUserId ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Select a user to view their entity assignments</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* User Header */}
              <Card>
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{selectedUser?.user.name}</p>
                    <p className="text-sm text-muted-foreground">{selectedUser?.user.email}</p>
                  </div>
                  {isSuperAdmin && (
                    <Button
                      size="sm"
                      variant="teal"
                      onClick={() => {
                        setShowAssign(true);
                        setAssignEntityId("");
                        setAssignCascade(true);
                      }}
                    >
                      <Plus className="mr-1 h-3 w-3" /> Assign to Entity
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Assignments Table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="h-4 w-4" /> Entity Assignments ({assignments.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {assignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      User has no entity assignments.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Entity</TableHead>
                          <TableHead>Scope Level</TableHead>
                          {isSuperAdmin && <TableHead className="text-right">Actions</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignments.map((a) => (
                          <TableRow key={a.entityId}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {TYPE_ICONS[a.entity.type] ?? <Building2 className="h-4 w-4" />}
                                <div>
                                  <p className="text-sm font-medium">{a.entity.name}</p>
                                  {a.entity.code && (
                                    <p className="text-[10px] text-muted-foreground font-mono">
                                      {a.entity.code}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px]">
                                {TYPE_LABELS[a.entity.type] ?? a.entity.type}
                              </Badge>
                            </TableCell>
                            {isSuperAdmin && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive text-xs"
                                    onClick={() =>
                                      revokeMut.mutate({
                                        entityId: a.entityId,
                                        cascade: false
                                      })
                                    }
                                    title="Remove from this entity only"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                  {(a.entity.type === "CORPORATE" ||
                                    a.entity.type === "GROUP" ||
                                    a.entity.type === "CLUSTER") && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive hover:text-destructive text-xs"
                                      onClick={() => {
                                        if (
                                          confirm(
                                            `Remove ${selectedUser?.user.name} from ${a.entity.name} and ALL its child entities?`
                                          )
                                        ) {
                                          revokeMut.mutate({
                                            entityId: a.entityId,
                                            cascade: true
                                          });
                                        }
                                      }}
                                      title="Remove from this entity and all children"
                                    >
                                      <Trash2 className="h-3 w-3 mr-0.5" />
                                      <ChevronRight className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Entity Hierarchy Overview */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Entity Hierarchy</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {corporates.map((corp) => {
                      const assignedHere = assignments.some((a) => a.entityId === corp.id);
                      const corpClusters = clusters.filter((c) => c.parentId === corp.id);
                      const corpProperties = properties.filter((p) => p.parentId === corp.id);
                      return (
                        <div key={corp.id}>
                          <div
                            className={`flex items-center gap-2 p-2 rounded ${assignedHere ? "bg-purple-50 border border-purple-200" : ""}`}
                          >
                            <Landmark className="h-4 w-4 text-purple-600" />
                            <span className="text-sm font-semibold">{corp.name}</span>
                            {assignedHere && (
                              <Badge className="bg-purple-100 text-purple-800 text-[10px]">
                                Assigned
                              </Badge>
                            )}
                          </div>
                          {corpClusters.map((cluster) => {
                            const clusterAssigned = assignments.some(
                              (a) => a.entityId === cluster.id
                            );
                            const clusterProps = properties.filter(
                              (p) => p.parentId === cluster.id
                            );
                            return (
                              <div key={cluster.id} className="ml-6">
                                <div
                                  className={`flex items-center gap-2 p-1.5 rounded ${clusterAssigned ? "bg-blue-50 border border-blue-200" : ""}`}
                                >
                                  <Network className="h-3.5 w-3.5 text-blue-600" />
                                  <span className="text-sm">{cluster.name}</span>
                                  {clusterAssigned && (
                                    <Badge className="bg-blue-100 text-blue-800 text-[10px]">
                                      Assigned
                                    </Badge>
                                  )}
                                </div>
                                {clusterProps.map((prop) => {
                                  const propAssigned = assignments.some(
                                    (a) => a.entityId === prop.id
                                  );
                                  return (
                                    <div
                                      key={prop.id}
                                      className={`ml-6 flex items-center gap-2 p-1 rounded ${propAssigned ? "bg-emerald-50 border border-emerald-200" : ""}`}
                                    >
                                      <Hotel className="h-3 w-3 text-emerald-600" />
                                      <span className="text-xs">{prop.name}</span>
                                      {propAssigned && (
                                        <Badge className="bg-emerald-100 text-emerald-800 text-[9px]">
                                          Assigned
                                        </Badge>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                          {corpProperties.map((prop) => {
                            const propAssigned = assignments.some((a) => a.entityId === prop.id);
                            return (
                              <div
                                key={prop.id}
                                className={`ml-6 flex items-center gap-2 p-1 rounded ${propAssigned ? "bg-emerald-50 border border-emerald-200" : ""}`}
                              >
                                <Hotel className="h-3 w-3 text-emerald-600" />
                                <span className="text-xs">{prop.name}</span>
                                {propAssigned && (
                                  <Badge className="bg-emerald-100 text-emerald-800 text-[9px]">
                                    Assigned
                                  </Badge>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Assign Dialog */}
      <Dialog open={showAssign} onOpenChange={setShowAssign}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign {selectedUser?.user.name} to Entity</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Target Entity</Label>
              <select
                className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                value={assignEntityId}
                onChange={(e) => setAssignEntityId(e.target.value)}
              >
                <option value="">Select entity...</option>
                {corporates.map((e) => (
                  <option key={e.id} value={e.id}>
                    {TYPE_LABELS[e.type]} — {e.name}
                  </option>
                ))}
                {clusters.map((e) => (
                  <option key={e.id} value={e.id}>
                    {"  "}Cluster — {e.name}
                  </option>
                ))}
                {properties.map((e) => (
                  <option key={e.id} value={e.id}>
                    {"    "}Property — {e.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={assignCascade}
                onChange={(e) => setAssignCascade(e.target.checked)}
                className="rounded border-border"
              />
              <span>
                Cascade to all child entities
                <span className="text-xs text-muted-foreground ml-1">
                  (assign to clusters & properties underneath)
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssign(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!assignEntityId || assignMut.isPending}
              onClick={() => assignMut.mutate()}
            >
              {assignMut.isPending ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
