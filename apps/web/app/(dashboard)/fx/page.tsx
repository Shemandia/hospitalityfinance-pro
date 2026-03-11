"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApiContext } from "../../../components/use-api-context";
import {
  deleteFXRate,
  getFXCurrencies,
  getFXRates,
  importECBRates,
  upsertFXRate
} from "../../../lib/gl-api";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../components/ui/dialog";
import { RefreshCw, Pencil, Trash2 } from "lucide-react";

type Currency = { code: string; name: string; symbol?: string; isActive: boolean };
type FXRate = {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  rateType: string;
  effectiveDate: string;
  source?: string;
};

const ALLOWED_CURRENCIES = ["USD", "EUR", "GBP", "TZS"] as const;
const BASE_CURRENCY = "USD";

const rateTypeVariant: Record<string, "info" | "warning" | "success" | "secondary"> = {
  SPOT: "info",
  AVERAGE: "warning",
  CLOSING: "success",
  BUDGET: "secondary"
};

const rateSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  rate: z.string().min(1, "Required"),
  rateType: z.string().min(1),
  effectiveDate: z.string().min(1)
});

export default function FXPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [showRateDialog, setShowRateDialog] = useState(false);
  const [editingRate, setEditingRate] = useState<FXRate | null>(null);
  const [feedback, setFeedback] = useState("");

  const form = useForm<z.infer<typeof rateSchema>>({
    resolver: zodResolver(rateSchema),
    defaultValues: {
      fromCurrency: "USD",
      toCurrency: "EUR",
      rateType: "SPOT",
      effectiveDate: new Date().toISOString().slice(0, 10)
    }
  });

  const allowedSet = new Set<string>(ALLOWED_CURRENCIES);
  const currenciesQ = useQuery({
    queryKey: ["fx-currencies", apiContext?.entityId],
    queryFn: () => (apiContext ? getFXCurrencies(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r) => ((r.data as unknown as Currency[]) ?? []).filter((c) => allowedSet.has(c.code))
  });
  const ratesQ = useQuery({
    queryKey: ["fx-rates", apiContext?.entityId],
    queryFn: () => (apiContext ? getFXRates(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r) =>
      ((r.data as unknown as FXRate[]) ?? []).filter(
        (rate) => allowedSet.has(rate.fromCurrency) && allowedSet.has(rate.toCurrency)
      )
  });

  const upsertMut = useMutation({
    mutationFn: (v: z.infer<typeof rateSchema>) =>
      upsertFXRate(apiContext!, { ...v, rate: v.rate, source: editingRate?.source ?? "MANUAL" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["fx-rates"] });
      closeDialog();
      setFeedback("Rate saved.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFXRate(apiContext!, id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["fx-rates"] });
      setFeedback("Rate deleted.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const ecbMut = useMutation({
    mutationFn: () => importECBRates(apiContext!),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["fx-rates", "fx-currencies"] });
      const d = r.data as { imported: number; date: string };
      setFeedback(`ECB import: ${d?.imported} rates for ${d?.date}`);
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  function openNewRate() {
    setEditingRate(null);
    form.reset({
      fromCurrency: "USD",
      toCurrency: "EUR",
      rateType: "SPOT",
      effectiveDate: new Date().toISOString().slice(0, 10),
      rate: ""
    });
    setShowRateDialog(true);
  }

  function openEditRate(rate: FXRate) {
    setEditingRate(rate);
    form.reset({
      fromCurrency: rate.fromCurrency,
      toCurrency: rate.toCurrency,
      rateType: rate.rateType,
      effectiveDate: rate.effectiveDate.slice(0, 10),
      rate: parseFloat(rate.rate).toString()
    });
    setShowRateDialog(true);
  }

  function closeDialog() {
    setShowRateDialog(false);
    setEditingRate(null);
    form.reset();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-primary">Foreign Exchange</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Base / Reporting Currency:{" "}
              <span className="font-semibold text-foreground">{BASE_CURRENCY}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="teal" onClick={openNewRate}>
              + Rate
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={ecbMut.isPending}
              onClick={() => ecbMut.mutate()}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${ecbMut.isPending ? "animate-spin" : ""}`} />
              {ecbMut.isPending ? "Importing…" : "Import ECB Rates"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-4 pt-0">
          {feedback && (
            <p
              className={`mb-3 text-sm ${feedback.toLowerCase().includes("error") ? "text-destructive" : "text-emerald-700"}`}
            >
              {feedback}
            </p>
          )}
          <Tabs defaultValue="rates">
            <TabsList className="mb-4">
              <TabsTrigger value="rates">FX Rates</TabsTrigger>
              <TabsTrigger value="currencies">Currencies</TabsTrigger>
            </TabsList>

            <TabsContent value="rates">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Effective Date</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ratesQ.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : (ratesQ.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-6 text-muted-foreground">
                        No rates found. Import ECB rates or add manually.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (ratesQ.data ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-semibold">{r.fromCurrency}</TableCell>
                        <TableCell className="font-semibold">{r.toCurrency}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {parseFloat(r.rate).toFixed(6)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={rateTypeVariant[r.rateType] ?? "secondary"}>
                            {r.rateType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(r.effectiveDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {r.source ?? "MANUAL"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => openEditRate(r)}
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => {
                                if (
                                  confirm(
                                    `Delete ${r.fromCurrency}/${r.toCurrency} ${r.rateType} rate?`
                                  )
                                )
                                  deleteMut.mutate(r.id);
                              }}
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="currencies">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Active</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {currenciesQ.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : (currenciesQ.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-6 text-muted-foreground">
                        No currencies. Import ECB rates to seed currencies.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (currenciesQ.data ?? []).map((c) => (
                      <TableRow key={c.code}>
                        <TableCell className="font-mono font-semibold">{c.code}</TableCell>
                        <TableCell>{c.name}</TableCell>
                        <TableCell>{c.symbol ?? "-"}</TableCell>
                        <TableCell>
                          <Badge variant={c.isActive ? "success" : "secondary"}>
                            {c.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Add / Edit Rate Dialog */}
      <Dialog
        open={showRateDialog}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingRate ? "Edit FX Rate" : "Add FX Rate"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((v: z.infer<typeof rateSchema>) => upsertMut.mutate(v))}
            className="space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From Currency</Label>
                <select
                  {...form.register("fromCurrency")}
                  className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                >
                  {ALLOWED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>To Currency</Label>
                <select
                  {...form.register("toCurrency")}
                  className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                >
                  {ALLOWED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Rate</Label>
                <Input type="number" step="0.000001" {...form.register("rate")} />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select
                  {...form.register("rateType")}
                  className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                >
                  <option value="SPOT">SPOT</option>
                  <option value="AVERAGE">AVERAGE</option>
                  <option value="CLOSING">CLOSING</option>
                  <option value="BUDGET">BUDGET</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Effective Date</Label>
              <Input type="date" {...form.register("effectiveDate")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" variant="teal" disabled={upsertMut.isPending}>
                {upsertMut.isPending ? "Saving…" : "Save Rate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
