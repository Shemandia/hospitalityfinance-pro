"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Plus, Trash2, Users, Layers, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "../../../../../../components/ui/card";
import { Button } from "../../../../../../components/ui/button";
import { Badge } from "../../../../../../components/ui/badge";
import { Input } from "../../../../../../components/ui/input";
import { Label } from "../../../../../../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "../../../../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  listStages,
  createStage,
  updateStage,
  deleteStage,
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  listDelegations,
  createDelegation,
  revokeDelegation,
  listRejectionCodes,
  createRejectionCode,
  type AuthorizationStage,
  type AuthorizationTeam,
  type AuthorizationDelegation,
  type RejectionCode
} from "../../../../../../lib/authorization-api";

export default function AuthorizationSettingsPage() {
  const ctx = useApiContext();
  const queryClient = useQueryClient();

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-muted-foreground" />
          Authorization Settings
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure authorization stages, teams, delegations, and rejection codes.
        </p>
      </div>

      <Tabs defaultValue="stages">
        <TabsList>
          <TabsTrigger value="stages" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Stages
          </TabsTrigger>
          <TabsTrigger value="teams" className="gap-1.5">
            <Users className="h-3.5 w-3.5" /> Teams
          </TabsTrigger>
          <TabsTrigger value="delegations" className="gap-1.5">
            <Users className="h-3.5 w-3.5" /> Delegations
          </TabsTrigger>
          <TabsTrigger value="rejection-codes" className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Rejection Codes
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stages">
          <StagesTab ctx={ctx} queryClient={queryClient} />
        </TabsContent>
        <TabsContent value="teams">
          <TeamsTab ctx={ctx} queryClient={queryClient} />
        </TabsContent>
        <TabsContent value="delegations">
          <DelegationsTab ctx={ctx} queryClient={queryClient} />
        </TabsContent>
        <TabsContent value="rejection-codes">
          <RejectionCodesTab ctx={ctx} queryClient={queryClient} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Stages Tab ──────────────────────────────────────────────────────────────

function StagesTab({ ctx, queryClient }: { ctx: any; queryClient: any }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [stageCode, setStageCode] = useState("");
  const [stageName, setStageName] = useState("");
  const [stageOrder, setStageOrder] = useState("1");
  const [requiredApprovers, setRequiredApprovers] = useState("1");
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [rejectionReturnsTo, setRejectionReturnsTo] = useState("ORIGINATOR");
  const [userTeamId, setUserTeamId] = useState("");

  const { data: stagesRes, isLoading } = useQuery({
    queryKey: ["auth-stages", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listStages(ctx!),
    enabled: !!ctx
  });
  const stages = stagesRes?.data ?? [];

  const { data: teamsRes } = useQuery({
    queryKey: ["auth-teams", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listTeams(ctx!),
    enabled: !!ctx
  });
  const teams = teamsRes?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createStage(ctx!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-stages"] });
      setCreateOpen(false);
      resetForm();
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStage(ctx!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth-stages"] }),
    onError: (err: Error) => setFormError(err.message)
  });

  function resetForm() {
    setStageCode("");
    setStageName("");
    setStageOrder("1");
    setRequiredApprovers("1");
    setAutoAdvance(true);
    setRejectionReturnsTo("ORIGINATOR");
    setUserTeamId("");
    setFormError("");
  }

  function handleCreate() {
    setFormError("");
    if (!stageCode.trim() || !stageName.trim()) {
      setFormError("Stage code and name are required.");
      return;
    }
    if (!userTeamId) {
      setFormError("Select an authorization team.");
      return;
    }
    createMutation.mutate({
      stageCode: stageCode.trim(),
      stageName: stageName.trim(),
      stageOrder: Number(stageOrder),
      requiredApprovers: Number(requiredApprovers),
      autoAdvance,
      rejectionReturnsTo,
      userTeamId
    });
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {stages.length} stage{stages.length !== 1 ? "s" : ""} configured
        </p>
        <Button
          size="sm"
          onClick={() => {
            resetForm();
            setCreateOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" /> Add Stage
        </Button>
      </div>

      {formError && !createOpen && (
        <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
          {formError}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-4 text-center font-medium">Order</th>
                    <th className="py-2.5 px-4 text-left font-medium">Code</th>
                    <th className="py-2.5 px-4 text-left font-medium">Name</th>
                    <th className="py-2.5 px-4 text-center font-medium">Approvers</th>
                    <th className="py-2.5 px-4 text-left font-medium">Team</th>
                    <th className="py-2.5 px-4 text-left font-medium">On Reject</th>
                    <th className="py-2.5 px-4 text-center font-medium">Active</th>
                    <th className="py-2.5 px-4 text-center font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {stages.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                        No authorization stages configured yet.
                      </td>
                    </tr>
                  ) : (
                    stages.map((stage) => (
                      <tr
                        key={stage.id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-3 px-4 text-center font-mono text-xs font-medium">
                          {stage.stageOrder}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs">{stage.stageCode}</td>
                        <td className="py-3 px-4 font-medium">{stage.stageName}</td>
                        <td className="py-3 px-4 text-center">{stage.requiredApprovers}</td>
                        <td className="py-3 px-4 text-xs">
                          {stage.userTeam?.name ?? stage.userTeamId.slice(0, 8)}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="text-xs">
                            {stage.rejectionReturnsTo.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            variant="default"
                            className={`text-xs ${stage.isActive ? "bg-emerald-600" : "bg-slate-400"}`}
                          >
                            {stage.isActive ? "Yes" : "No"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Delete stage "${stage.stageName}"?`)) {
                                deleteMutation.mutate(stage.id);
                              }
                            }}
                            className="h-7 w-7 p-0"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Stage Dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Authorization Stage</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {formError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {formError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Stage Code</Label>
                <Input
                  value={stageCode}
                  onChange={(e) => setStageCode(e.target.value)}
                  placeholder="e.g. STAGE1"
                  maxLength={20}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Order</Label>
                <Input
                  type="number"
                  value={stageOrder}
                  onChange={(e) => setStageOrder(e.target.value)}
                  min={1}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Stage Name</Label>
              <Input
                value={stageName}
                onChange={(e) => setStageName(e.target.value)}
                placeholder="e.g. Department Head Approval"
                maxLength={100}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Required Approvers</Label>
                <Input
                  type="number"
                  value={requiredApprovers}
                  onChange={(e) => setRequiredApprovers(e.target.value)}
                  min={1}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>On Rejection</Label>
                <Select value={rejectionReturnsTo} onValueChange={setRejectionReturnsTo}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ORIGINATOR">Return to Originator</SelectItem>
                    <SelectItem value="PREVIOUS_STAGE">Previous Stage</SelectItem>
                    <SelectItem value="SPECIFIC_STAGE">Specific Stage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Authorization Team</Label>
              <Select value={userTeamId} onValueChange={setUserTeamId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.code} — {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoAdvance"
                checked={autoAdvance}
                onChange={(e) => setAutoAdvance(e.target.checked)}
                className="rounded border-gray-300"
              />
              <Label htmlFor="autoAdvance" className="text-sm font-normal">
                Auto-advance to next stage on approval
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Stage"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Teams Tab ───────────────────────────────────────────────────────────────

function TeamsTab({ ctx, queryClient }: { ctx: any; queryClient: any }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [teamCode, setTeamCode] = useState("");
  const [teamName, setTeamName] = useState("");

  const { data: teamsRes, isLoading } = useQuery({
    queryKey: ["auth-teams", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listTeams(ctx!),
    enabled: !!ctx
  });
  const teams = teamsRes?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createTeam(ctx!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-teams"] });
      setCreateOpen(false);
      setTeamCode("");
      setTeamName("");
      setFormError("");
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteTeam(ctx!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth-teams"] }),
    onError: (err: Error) => setFormError(err.message)
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {teams.length} team{teams.length !== 1 ? "s" : ""} configured
        </p>
        <Button
          size="sm"
          onClick={() => {
            setTeamCode("");
            setTeamName("");
            setFormError("");
            setCreateOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" /> Add Team
        </Button>
      </div>

      {formError && !createOpen && (
        <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
          {formError}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-4 text-left font-medium">Code</th>
                    <th className="py-2.5 px-4 text-left font-medium">Name</th>
                    <th className="py-2.5 px-4 text-center font-medium">Members</th>
                    <th className="py-2.5 px-4 text-center font-medium">Active</th>
                    <th className="py-2.5 px-4 text-center font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {teams.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-16 text-center text-sm text-muted-foreground">
                        No authorization teams. Create one to get started.
                      </td>
                    </tr>
                  ) : (
                    teams.map((team) => (
                      <tr
                        key={team.id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono text-xs font-medium">{team.code}</td>
                        <td className="py-3 px-4 font-medium">{team.name}</td>
                        <td className="py-3 px-4 text-center">
                          <Badge variant="outline" className="text-xs">
                            {team.members.length} member{team.members.length !== 1 ? "s" : ""}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            variant="default"
                            className={`text-xs ${team.isActive ? "bg-emerald-600" : "bg-slate-400"}`}
                          >
                            {team.isActive ? "Yes" : "No"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Delete team "${team.name}"?`)) {
                                deleteMutation.mutate(team.id);
                              }
                            }}
                            className="h-7 w-7 p-0"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Authorization Team</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {formError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {formError}
              </p>
            )}
            <div className="grid gap-1.5">
              <Label>Team Code</Label>
              <Input
                value={teamCode}
                onChange={(e) => setTeamCode(e.target.value)}
                placeholder="e.g. FINANCE"
                maxLength={20}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Team Name</Label>
              <Input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Finance Department"
                maxLength={100}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setFormError("");
                if (!teamCode.trim() || !teamName.trim()) {
                  setFormError("Code and name are required.");
                  return;
                }
                createMutation.mutate({ code: teamCode.trim(), name: teamName.trim() });
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Delegations Tab ─────────────────────────────────────────────────────────

function DelegationsTab({ ctx, queryClient }: { ctx: any; queryClient: any }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [delegatorId, setDelegatorId] = useState("");
  const [delegateId, setDelegateId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  const { data: delegationsRes, isLoading } = useQuery({
    queryKey: ["auth-delegations", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listDelegations(ctx!),
    enabled: !!ctx
  });
  const delegations = delegationsRes?.data ?? [];

  const { data: teamsRes } = useQuery({
    queryKey: ["auth-teams", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listTeams(ctx!),
    enabled: !!ctx
  });
  const teams = teamsRes?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createDelegation(ctx!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth-delegations"] });
      setCreateOpen(false);
      setFormError("");
    },
    onError: (err: Error) => setFormError(err.message)
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeDelegation(ctx!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth-delegations"] }),
    onError: (err: Error) => setFormError(err.message)
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {delegations.length} delegation{delegations.length !== 1 ? "s" : ""}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setDelegatorId("");
            setDelegateId("");
            setTeamId("");
            setValidFrom("");
            setValidTo("");
            setFormError("");
            setCreateOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" /> Add Delegation
        </Button>
      </div>

      {formError && !createOpen && (
        <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
          {formError}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-4 text-left font-medium">Delegator</th>
                    <th className="py-2.5 px-4 text-left font-medium">Delegate</th>
                    <th className="py-2.5 px-4 text-left font-medium">Team</th>
                    <th className="py-2.5 px-4 text-left font-medium">Valid From</th>
                    <th className="py-2.5 px-4 text-left font-medium">Valid To</th>
                    <th className="py-2.5 px-4 text-center font-medium">Active</th>
                    <th className="py-2.5 px-4 text-center font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {delegations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-sm text-muted-foreground">
                        No delegations configured.
                      </td>
                    </tr>
                  ) : (
                    delegations.map((d) => (
                      <tr
                        key={d.id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-3 px-4 text-sm">{d.delegator.name}</td>
                        <td className="py-3 px-4 text-sm">{d.delegate.name}</td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="text-xs">
                            {d.team.code}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {d.validFrom.slice(0, 10)}
                        </td>
                        <td className="py-3 px-4 text-xs text-muted-foreground">
                          {d.validTo.slice(0, 10)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            variant="default"
                            className={`text-xs ${d.isActive ? "bg-emerald-600" : "bg-slate-400"}`}
                          >
                            {d.isActive ? "Yes" : "No"}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (confirm("Revoke this delegation?")) {
                                revokeMutation.mutate(d.id);
                              }
                            }}
                            className="h-7 w-7 p-0"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Delegation</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {formError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {formError}
              </p>
            )}
            <div className="grid gap-1.5">
              <Label>Delegator User ID</Label>
              <Input
                value={delegatorId}
                onChange={(e) => setDelegatorId(e.target.value)}
                placeholder="UUID of the user delegating"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Delegate User ID</Label>
              <Input
                value={delegateId}
                onChange={(e) => setDelegateId(e.target.value)}
                placeholder="UUID of the user receiving authority"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Team</Label>
              <Select value={teamId} onValueChange={setTeamId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select team..." />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.code} — {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Valid From</Label>
                <Input
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Valid To</Label>
                <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setFormError("");
                if (
                  !delegatorId.trim() ||
                  !delegateId.trim() ||
                  !teamId ||
                  !validFrom ||
                  !validTo
                ) {
                  setFormError("All fields are required.");
                  return;
                }
                createMutation.mutate({
                  delegatorId: delegatorId.trim(),
                  delegateId: delegateId.trim(),
                  teamId,
                  validFrom,
                  validTo
                });
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Delegation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Rejection Codes Tab ─────────────────────────────────────────────────────

function RejectionCodesTab({ ctx, queryClient }: { ctx: any; queryClient: any }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");

  const { data: codesRes, isLoading } = useQuery({
    queryKey: ["rejection-codes", ctx?.tenantSlug, ctx?.entityId],
    queryFn: () => listRejectionCodes(ctx!),
    enabled: !!ctx
  });
  const codes = codesRes?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createRejectionCode(ctx!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rejection-codes"] });
      setCreateOpen(false);
      setCode("");
      setDescription("");
      setFormError("");
    },
    onError: (err: Error) => setFormError(err.message)
  });

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {codes.length} rejection code{codes.length !== 1 ? "s" : ""}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setCode("");
            setDescription("");
            setFormError("");
            setCreateOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" /> Add Code
        </Button>
      </div>

      {formError && !createOpen && (
        <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
          {formError}
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="py-2.5 px-4 text-left font-medium">Code</th>
                    <th className="py-2.5 px-4 text-left font-medium">Description</th>
                    <th className="py-2.5 px-4 text-center font-medium">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-16 text-center text-sm text-muted-foreground">
                        No rejection codes. Create one to get started.
                      </td>
                    </tr>
                  ) : (
                    codes.map((rc) => (
                      <tr
                        key={rc.id}
                        className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono text-xs font-medium">{rc.code}</td>
                        <td className="py-3 px-4">{rc.description}</td>
                        <td className="py-3 px-4 text-center">
                          <Badge
                            variant="default"
                            className={`text-xs ${rc.isActive ? "bg-emerald-600" : "bg-slate-400"}`}
                          >
                            {rc.isActive ? "Yes" : "No"}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={(v) => !v && setCreateOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Rejection Code</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {formError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {formError}
              </p>
            )}
            <div className="grid gap-1.5">
              <Label>Code</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. INCOMPLETE"
                maxLength={20}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Supporting documentation incomplete"
                maxLength={255}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setFormError("");
                if (!code.trim() || !description.trim()) {
                  setFormError("Code and description are required.");
                  return;
                }
                createMutation.mutate({ code: code.trim(), description: description.trim() });
              }}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create Code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
