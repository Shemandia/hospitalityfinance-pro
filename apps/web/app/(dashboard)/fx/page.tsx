"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApiContext } from "../../../components/use-api-context";
import { getFXCurrencies, getFXRates, importECBRates, upsertFXRate } from "../../../lib/gl-api";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select";
import { RefreshCw } from "lucide-react";

type Currency = { code: string; name: string; symbol?: string; isActive: boolean };
type FXRate = { id: string; fromCurrency: string; toCurrency: string; rate: string; rateType: string; effectiveDate: string; source?: string };

const rateTypeVariant: Record<string, "info" | "warning" | "success" | "secondary"> = {
  SPOT: "info", AVERAGE: "warning", CLOSING: "success", BUDGET: "secondary",
};

const rateSchema = z.object({
  fromCurrency: z.string().length(3),
  toCurrency: z.string().length(3),
  rate: z.string().min(1, "Required"),
  rateType: z.string().min(1),
  effectiveDate: z.string().min(1),
});

export default function FXPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [showNewRate, setShowNewRate] = useState(false);
  const [feedback, setFeedback] = useState("");

  const form = useForm<z.infer<typeof rateSchema>>({
    resolver: zodResolver(rateSchema),
    defaultValues: { fromCurrency: "USD", toCurrency: "EUR", rateType: "SPOT", effectiveDate: new Date().toISOString().slice(0, 10) },
  });

  const currenciesQ = useQuery({ queryKey: ["fx-currencies", apiContext?.entityId], queryFn: () => apiContext ? getFXCurrencies(apiContext) : Promise.resolve({ data: [] }), enabled: Boolean(apiContext), select: r => (r.data as unknown as Currency[]) ?? [] });
  const ratesQ = useQuery({ queryKey: ["fx-rates", apiContext?.entityId], queryFn: () => apiContext ? getFXRates(apiContext) : Promise.resolve({ data: [] }), enabled: Boolean(apiContext), select: r => (r.data as unknown as FXRate[]) ?? [] });

  const upsertMut = useMutation({
    mutationFn: (v: z.infer<typeof rateSchema>) => upsertFXRate(apiContext!, { ...v, rate: parseFloat(v.rate), source: "MANUAL" }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["fx-rates"] }); setShowNewRate(false); form.reset(); setFeedback("Rate saved."); },
    onError: e => setFeedback((e as Error).message),
  });

  const ecbMut = useMutation({
    mutationFn: () => importECBRates(apiContext!),
    onSuccess: r => { qc.invalidateQueries({ queryKey: ["fx-rates"] }); const d = r.data as { imported: number; date: string }; setFeedback(`ECB import: ${d?.imported} rates for ${d?.date}`); },
    onError: e => setFeedback((e as Error).message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-primary">Foreign Exchange</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="teal" onClick={() => setShowNewRate(true)}>+ Rate</Button>
            <Button size="sm" variant="outline" disabled={ecbMut.isPending} onClick={() => ecbMut.mutate()}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${ecbMut.isPending ? "animate-spin" : ""}`} />
              {ecbMut.isPending ? "Importing…" : "Import ECB Rates"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-6 pb-4 pt-0">
          {feedback && <p className={`mb-3 text-sm ${feedback.toLowerCase().includes("error") ? "text-destructive" : "text-emerald-700"}`}>{feedback}</p>}
          <Tabs defaultValue="rates">
            <TabsList className="mb-4">
              <TabsTrigger value="rates">FX Rates</TabsTrigger>
              <TabsTrigger value="currencies">Currencies</TabsTrigger>
            </TabsList>

            <TabsContent value="rates">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead><TableHead>To</TableHead><TableHead className="text-right">Rate</TableHead>
                    <TableHead>Type</TableHead><TableHead>Effective Date</TableHead><TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ratesQ.isLoading
                    ? <TableRow><TableCell colSpan={6} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                    : (ratesQ.data ?? []).map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-semibold">{r.fromCurrency}</TableCell>
                        <TableCell className="font-semibold">{r.toCurrency}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{parseFloat(r.rate).toFixed(6)}</TableCell>
                        <TableCell><Badge variant={rateTypeVariant[r.rateType] ?? "secondary"}>{r.rateType}</Badge></TableCell>
                        <TableCell className="text-xs">{new Date(r.effectiveDate).toLocaleDateString()}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{r.source ?? "MANUAL"}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="currencies">
              <Table>
                <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Symbol</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
                <TableBody>
                  {currenciesQ.isLoading
                    ? <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>
                    : (currenciesQ.data ?? []).map(c => (
                      <TableRow key={c.code}>
                        <TableCell className="font-mono font-semibold">{c.code}</TableCell>
                        <TableCell>{c.name}</TableCell>
                        <TableCell>{c.symbol ?? "-"}</TableCell>
                        <TableCell><Badge variant={c.isActive ? "success" : "secondary"}>{c.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Add Rate Dialog */}
      <Dialog open={showNewRate} onOpenChange={setShowNewRate}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add / Update FX Rate</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit((v: z.infer<typeof rateSchema>) => upsertMut.mutate(v))} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From Currency</Label>
                <Input {...form.register("fromCurrency")} maxLength={3} className="uppercase" onChange={e => form.setValue("fromCurrency", e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-1.5">
                <Label>To Currency</Label>
                <Input {...form.register("toCurrency")} maxLength={3} className="uppercase" onChange={e => form.setValue("toCurrency", e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-1.5">
                <Label>Rate</Label>
                <Input type="number" step="0.000001" {...form.register("rate")} />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select {...form.register("rateType")} className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm">
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
              <Button type="button" variant="outline" onClick={() => setShowNewRate(false)}>Cancel</Button>
              <Button type="submit" variant="teal" disabled={upsertMut.isPending}>{upsertMut.isPending ? "Saving…" : "Save Rate"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
