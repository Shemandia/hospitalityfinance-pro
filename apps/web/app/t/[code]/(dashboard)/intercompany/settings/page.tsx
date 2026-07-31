"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getEntities,
  getICEntityPairs,
  createICEntityPair,
  deleteICEntityPair,
  getICAccountMappings,
  createICAccountMapping,
  deleteICAccountMapping,
  type ICEntityPairSummary2,
  type ICAccountMappingSummary2
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../../components/ui/tabs";
import { Plus, Trash2, Settings, Link2 } from "lucide-react";

type EntityItem = { id: string; name: string; code?: string };

export default function ICConfigurationPage() {
  const ctx = useApiContext()!;
  const qc = useQueryClient();

  // Pair creation form
  const [showNewPair, setShowNewPair] = useState(false);
  const [entityAId, setEntityAId] = useState("");
  const [entityBId, setEntityBId] = useState("");
  const [pairDescription, setPairDescription] = useState("");

  // Mapping form
  const [selectedPairId, setSelectedPairId] = useState<string | null>(null);
  const [showNewMapping, setShowNewMapping] = useState(false);
  const [mappingName, setMappingName] = useState("");
  const [entityADebitCode, setEntityADebitCode] = useState("");
  const [entityACreditCode, setEntityACreditCode] = useState("");
  const [entityBDebitCode, setEntityBDebitCode] = useState("");
  const [entityBCreditCode, setEntityBCreditCode] = useState("");

  const { data: entities = [] } = useQuery({
    queryKey: ["entities"],
    queryFn: () => getEntities(ctx),
    select: (r) => (r.data ?? []) as EntityItem[]
  });

  const { data: pairs = [], isLoading: pairsLoading } = useQuery({
    queryKey: ["ic-entity-pairs"],
    queryFn: () => getICEntityPairs(ctx),
    select: (r) => r.data ?? []
  });

  const { data: mappings = [] } = useQuery({
    queryKey: ["ic-mappings", selectedPairId],
    queryFn: () => getICAccountMappings(ctx, selectedPairId!),
    select: (r) => r.data ?? [],
    enabled: !!selectedPairId
  });

  const createPairMutation = useMutation({
    mutationFn: () =>
      createICEntityPair(ctx, {
        entityAId,
        entityBId,
        description: pairDescription || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-entity-pairs"] });
      setShowNewPair(false);
      setEntityAId("");
      setEntityBId("");
      setPairDescription("");
    }
  });

  const deletePairMutation = useMutation({
    mutationFn: (id: string) => deleteICEntityPair(ctx, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ic-entity-pairs"] })
  });

  const createMappingMutation = useMutation({
    mutationFn: () =>
      createICAccountMapping(ctx, {
        pairId: selectedPairId!,
        name: mappingName,
        entityADebitCode,
        entityACreditCode,
        entityBDebitCode,
        entityBCreditCode
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-mappings", selectedPairId] });
      setShowNewMapping(false);
      setMappingName("");
      setEntityADebitCode("");
      setEntityACreditCode("");
      setEntityBDebitCode("");
      setEntityBCreditCode("");
    }
  });

  const deleteMappingMutation = useMutation({
    mutationFn: (id: string) => deleteICAccountMapping(ctx, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ic-mappings", selectedPairId] })
  });

  const selectedPair = pairs.find((p) => p.id === selectedPairId);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Intercompany Configuration</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage intercompany entity pairs and account mappings
        </p>
      </div>

      <Tabs defaultValue="pairs">
        <TabsList>
          <TabsTrigger value="pairs">Entity Pairs</TabsTrigger>
          <TabsTrigger value="mappings">Account Mappings</TabsTrigger>
        </TabsList>

        {/* ── Entity Pairs Tab ──────────────────────────────────────────── */}
        <TabsContent value="pairs">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Entity Pairs</CardTitle>
              <Button size="sm" onClick={() => setShowNewPair(true)}>
                <Plus className="mr-1 h-4 w-4" /> New Pair
              </Button>
            </CardHeader>
            <CardContent>
              {pairsLoading ? (
                <p className="text-muted-foreground py-4 text-center">Loading...</p>
              ) : pairs.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center">
                  No entity pairs configured yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Entity A</TableHead>
                      <TableHead>Entity B</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Mappings</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pairs.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">
                          {p.entityAName ?? p.entityAId}
                        </TableCell>
                        <TableCell className="font-medium">
                          {p.entityBName ?? p.entityBId}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.description ?? "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{p.mappingCount}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              p.isActive
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-800"
                            }
                          >
                            {p.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="sm" onClick={() => setSelectedPairId(p.id)}>
                            <Link2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600"
                            onClick={() => deletePairMutation.mutate(p.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Account Mappings Tab ──────────────────────────────────────── */}
        <TabsContent value="mappings">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Account Mappings</CardTitle>
                {selectedPair && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {selectedPair.entityAName} / {selectedPair.entityBName}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Select value={selectedPairId ?? ""} onValueChange={setSelectedPairId}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Select a pair..." />
                  </SelectTrigger>
                  <SelectContent>
                    {pairs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.entityAName ?? p.entityAId} / {p.entityBName ?? p.entityBId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPairId && (
                  <Button size="sm" onClick={() => setShowNewMapping(true)}>
                    <Plus className="mr-1 h-4 w-4" /> New Mapping
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedPairId ? (
                <p className="text-muted-foreground py-4 text-center">
                  Select an entity pair above.
                </p>
              ) : mappings.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center">No mappings for this pair.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>A Debit</TableHead>
                      <TableHead>A Credit</TableHead>
                      <TableHead>B Debit</TableHead>
                      <TableHead>B Credit</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mappings.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.name}</TableCell>
                        <TableCell className="font-mono text-sm">{m.entityADebitCode}</TableCell>
                        <TableCell className="font-mono text-sm">{m.entityACreditCode}</TableCell>
                        <TableCell className="font-mono text-sm">{m.entityBDebitCode}</TableCell>
                        <TableCell className="font-mono text-sm">{m.entityBCreditCode}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600"
                            onClick={() => deleteMappingMutation.mutate(m.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── New Pair Dialog ──────────────────────────────────────────────── */}
      <Dialog open={showNewPair} onOpenChange={setShowNewPair}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Entity Pair</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Entity A</Label>
              <Select value={entityAId} onValueChange={setEntityAId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity..." />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Entity B</Label>
              <Select value={entityBId} onValueChange={setEntityBId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity..." />
                </SelectTrigger>
                <SelectContent>
                  {entities
                    .filter((e) => e.id !== entityAId)
                    .map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input value={pairDescription} onChange={(e) => setPairDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewPair(false)}>
              Cancel
            </Button>
            <Button
              disabled={!entityAId || !entityBId || createPairMutation.isPending}
              onClick={() => createPairMutation.mutate()}
            >
              {createPairMutation.isPending ? "Creating..." : "Create Pair"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New Mapping Dialog ───────────────────────────────────────────── */}
      <Dialog open={showNewMapping} onOpenChange={setShowNewMapping}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Account Mapping</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Mapping Name</Label>
              <Input
                value={mappingName}
                onChange={(e) => setMappingName(e.target.value)}
                placeholder="e.g. Intercompany Receivable/Payable"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-2">Entity A ({selectedPair?.entityAName})</p>
                <div className="space-y-2">
                  <div>
                    <Label>Debit Account Code</Label>
                    <Input
                      value={entityADebitCode}
                      onChange={(e) => setEntityADebitCode(e.target.value)}
                      maxLength={15}
                    />
                  </div>
                  <div>
                    <Label>Credit Account Code</Label>
                    <Input
                      value={entityACreditCode}
                      onChange={(e) => setEntityACreditCode(e.target.value)}
                      maxLength={15}
                    />
                  </div>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Entity B ({selectedPair?.entityBName})</p>
                <div className="space-y-2">
                  <div>
                    <Label>Debit Account Code</Label>
                    <Input
                      value={entityBDebitCode}
                      onChange={(e) => setEntityBDebitCode(e.target.value)}
                      maxLength={15}
                    />
                  </div>
                  <div>
                    <Label>Credit Account Code</Label>
                    <Input
                      value={entityBCreditCode}
                      onChange={(e) => setEntityBCreditCode(e.target.value)}
                      maxLength={15}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewMapping(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !mappingName ||
                !entityADebitCode ||
                !entityACreditCode ||
                !entityBDebitCode ||
                !entityBCreditCode ||
                createMappingMutation.isPending
              }
              onClick={() => createMappingMutation.mutate()}
            >
              {createMappingMutation.isPending ? "Creating..." : "Create Mapping"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
