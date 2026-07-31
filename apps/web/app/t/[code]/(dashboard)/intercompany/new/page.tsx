"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import { useTenantRouter } from "../../../../../../hooks/use-tenant-router";
import {
  getEntities,
  getPeriods,
  getICEntityPairs,
  getICAccountMappings,
  createICTransaction,
  type ICEntityPairSummary2,
  type ICAccountMappingSummary2
} from "../../../../../../lib/gl-api";
import { Button } from "../../../../../../components/ui/button";
import { Input } from "../../../../../../components/ui/input";
import { Label } from "../../../../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import { Separator } from "../../../../../../components/ui/separator";
import { ArrowRight } from "lucide-react";

type EntityItem = { id: string; name: string; code?: string; functionalCurrency?: string };
type PeriodItem = { id: string; name?: string; year: number; month: number; status: string };

export default function NewICTransactionPage() {
  const ctx = useApiContext()!;
  const router = useTenantRouter();
  const qc = useQueryClient();

  const [selectedPairId, setSelectedPairId] = useState("");
  const [selectedMappingId, setSelectedMappingId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [fxRateInitiator, setFxRateInitiator] = useState("");
  const [fxRateCounterparty, setFxRateCounterparty] = useState("");
  const [error, setError] = useState("");

  const { data: entities = [] } = useQuery({
    queryKey: ["entities"],
    queryFn: () => getEntities(ctx),
    select: (r) => (r.data ?? []) as EntityItem[]
  });

  const { data: pairs = [] } = useQuery({
    queryKey: ["ic-entity-pairs"],
    queryFn: () => getICEntityPairs(ctx),
    select: (r) => r.data ?? []
  });

  const { data: periods = [] } = useQuery({
    queryKey: ["periods"],
    queryFn: () => getPeriods(ctx),
    select: (r) => ((r.data ?? []) as PeriodItem[]).filter((p) => p.status === "OPEN")
  });

  const selectedPair = pairs.find((p) => p.id === selectedPairId);

  const { data: mappings = [] } = useQuery({
    queryKey: ["ic-mappings", selectedPairId],
    queryFn: () => getICAccountMappings(ctx, selectedPairId),
    select: (r) => r.data ?? [],
    enabled: !!selectedPairId
  });

  const selectedMapping = mappings.find((m) => m.id === selectedMappingId);

  // Figure out counterparty based on current entity
  const currentEntityId = ctx.entityId;
  const counterpartyEntityId = selectedPair
    ? selectedPair.entityAId === currentEntityId
      ? selectedPair.entityBId
      : selectedPair.entityAId
    : "";

  const entityMap = new Map(entities.map((e) => [e.id, e]));

  const createMutation = useMutation({
    mutationFn: () =>
      createICTransaction(ctx, {
        pairId: selectedPairId,
        mappingId: selectedMappingId || undefined,
        counterpartyEntityId,
        amount,
        currency,
        reference,
        description: description || undefined,
        periodId,
        fxRateInitiator: fxRateInitiator || undefined,
        fxRateCounterparty: fxRateCounterparty || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ic-transactions"] });
      router.push("/intercompany");
    },
    onError: (err: any) => {
      setError(err?.message ?? "Failed to create transaction");
    }
  });

  const canSubmit =
    selectedPairId && selectedMappingId && amount && currency && reference && periodId;

  return (
    <div className="space-y-6 p-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">New Intercompany Transaction</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a new intercompany transaction between two entities. Both journals will be posted
          atomically.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 border border-red-200 rounded-md p-3 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Entity Pair</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Select Intercompany Entity Pair</Label>
            <Select
              value={selectedPairId}
              onValueChange={(v) => {
                setSelectedPairId(v);
                setSelectedMappingId("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a configured entity pair..." />
              </SelectTrigger>
              <SelectContent>
                {pairs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.entityAName ?? p.entityAId} <ArrowRight className="inline h-3 w-3 mx-1" />{" "}
                    {p.entityBName ?? p.entityBId}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedPair && (
            <div className="flex items-center gap-4 p-3 bg-muted rounded-md text-sm">
              <div>
                <span className="font-medium">Initiator:</span>{" "}
                {entityMap.get(currentEntityId ?? "")?.name ?? currentEntityId}
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <div>
                <span className="font-medium">Counterparty:</span>{" "}
                {entityMap.get(counterpartyEntityId)?.name ?? counterpartyEntityId}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedPairId && (
        <Card>
          <CardHeader>
            <CardTitle>Account Mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Select Mapping Template</Label>
              <Select value={selectedMappingId} onValueChange={setSelectedMappingId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an account mapping..." />
                </SelectTrigger>
                <SelectContent>
                  {mappings.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedMapping && (
              <div className="grid grid-cols-2 gap-4 p-3 bg-muted rounded-md text-sm">
                <div>
                  <p className="font-medium mb-1">Initiator Entity</p>
                  <p>
                    DR:{" "}
                    {selectedPair?.entityAId === currentEntityId
                      ? selectedMapping.entityADebitCode
                      : selectedMapping.entityBDebitCode}
                  </p>
                  <p>
                    CR:{" "}
                    {selectedPair?.entityAId === currentEntityId
                      ? selectedMapping.entityACreditCode
                      : selectedMapping.entityBCreditCode}
                  </p>
                </div>
                <div>
                  <p className="font-medium mb-1">Counterparty Entity</p>
                  <p>
                    DR:{" "}
                    {selectedPair?.entityAId === currentEntityId
                      ? selectedMapping.entityBDebitCode
                      : selectedMapping.entityADebitCode}
                  </p>
                  <p>
                    CR:{" "}
                    {selectedPair?.entityAId === currentEntityId
                      ? selectedMapping.entityBCreditCode
                      : selectedMapping.entityACreditCode}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Transaction Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Currency</Label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                maxLength={3}
              />
            </div>
          </div>

          <div>
            <Label>Reference</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={60}
              placeholder="e.g. IC-2026-001"
            />
          </div>

          <div>
            <Label>Description (optional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>

          <div>
            <Label>Period</Label>
            <Select value={periodId} onValueChange={setPeriodId}>
              <SelectTrigger>
                <SelectValue placeholder="Select open period..." />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name ?? `${p.year}-${String(p.month).padStart(2, "0")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <p className="text-sm text-muted-foreground">
            Exchange Rates (leave blank for same-currency or auto-lookup)
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Exchange Rate (Initiator)</Label>
              <Input
                type="number"
                step="0.00000001"
                value={fxRateInitiator}
                onChange={(e) => setFxRateInitiator(e.target.value)}
                placeholder="1.00000000"
              />
            </div>
            <div>
              <Label>Exchange Rate (Counterparty)</Label>
              <Input
                type="number"
                step="0.00000001"
                value={fxRateCounterparty}
                onChange={(e) => setFxRateCounterparty(e.target.value)}
                placeholder="1.00000000"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => router.push("/intercompany")}>
          Cancel
        </Button>
        <Button
          disabled={!canSubmit || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? "Posting..." : "Post Transaction"}
        </Button>
      </div>
    </div>
  );
}
