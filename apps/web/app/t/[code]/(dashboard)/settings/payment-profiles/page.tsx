"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../../components/use-api-context";
import {
  getPaymentProfiles,
  createPaymentProfile,
  deletePaymentProfile,
  type PaymentProfileSummary
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../../../../components/ui/tabs";
import { Plus, Trash2, CreditCard, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

const PAYMENT_METHODS = [
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CARD", label: "Card" },
  { value: "CASH", label: "Cash" }
];

const FX_HANDLING = [
  { value: "ORIGINAL", label: "Original rate (as booked)" },
  { value: "CURRENT_RATE", label: "Current rate (latest exchange rate)" }
];

export default function PaymentProfilesPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [feedback, setFeedback] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"PAY" | "COLLECT">("PAY");
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [currency, setCurrency] = useState("");
  const [fxHandling, setFxHandling] = useState("ORIGINAL");
  const [bankAccountId, setBankAccountId] = useState("");
  const [remittanceAdvice, setRemittanceAdvice] = useState(true);
  const [totalPaymentLimit, setTotalPaymentLimit] = useState("");
  const [description, setDescription] = useState("");

  const profilesQ = useQuery({
    queryKey: ["payment-profiles", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getPaymentProfiles(apiContext);
      return (res.data as unknown as PaymentProfileSummary[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const createMut = useMutation({
    mutationFn: () =>
      createPaymentProfile(apiContext!, {
        name,
        direction,
        paymentMethod,
        currency: currency || undefined,
        fxHandling,
        bankAccountId: bankAccountId || undefined,
        remittanceAdvice,
        totalPaymentLimit: totalPaymentLimit ? parseFloat(totalPaymentLimit) : undefined,
        description: description || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-profiles"] });
      setShowCreate(false);
      resetForm();
      setFeedback("Profile created.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePaymentProfile(apiContext!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payment-profiles"] });
      setFeedback("Profile deactivated.");
    }
  });

  function resetForm() {
    setName("");
    setDirection("PAY");
    setPaymentMethod("BANK_TRANSFER");
    setCurrency("");
    setFxHandling("ORIGINAL");
    setBankAccountId("");
    setRemittanceAdvice(true);
    setTotalPaymentLimit("");
    setDescription("");
  }

  const profiles = profilesQ.data ?? [];
  const payProfiles = profiles.filter((p) => p.direction === "PAY");
  const collectProfiles = profiles.filter((p) => p.direction === "COLLECT");

  function ProfileTable({ items }: { items: PaymentProfileSummary[] }) {
    if (items.length === 0) {
      return (
        <p className="text-sm text-muted-foreground py-4 text-center">No profiles configured.</p>
      );
    }
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Method</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead>Exchange Rate Handling</TableHead>
            <TableHead>Limit</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">
                {p.name}
                {p.isSystem && (
                  <Badge variant="secondary" className="ml-2 text-[10px]">
                    System
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px]">
                  {p.paymentMethod.replace("_", " ")}
                </Badge>
              </TableCell>
              <TableCell>{p.currency ?? "Any"}</TableCell>
              <TableCell className="text-xs">
                {p.fxHandling === "CURRENT_RATE" ? "Current" : "Original"}
              </TableCell>
              <TableCell className="text-xs tabular-nums">
                {p.totalPaymentLimit ? Number(p.totalPaymentLimit).toLocaleString() : "—"}
              </TableCell>
              <TableCell className="text-right">
                {!p.isSystem && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => deleteMut.mutate(p.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Payment Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Configure reusable payment and collection run profiles
          </p>
        </div>
        <Button variant="teal" size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 h-3 w-3" /> New Profile
        </Button>
      </div>

      {feedback && (
        <p
          className={`text-sm ${feedback.includes("error") ? "text-destructive" : "text-emerald-700"}`}
        >
          {feedback}
        </p>
      )}

      <Tabs defaultValue="pay">
        <TabsList>
          <TabsTrigger value="pay" className="gap-1">
            <ArrowUpFromLine className="h-3 w-3" /> Payment ({payProfiles.length})
          </TabsTrigger>
          <TabsTrigger value="collect" className="gap-1">
            <ArrowDownToLine className="h-3 w-3" /> Collection ({collectProfiles.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pay">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Accounts Payable Payment Profiles
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileTable items={payProfiles} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="collect">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                AR Collection Profiles
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileTable items={collectProfiles} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Payment Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Profile Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Weekly Supplier Payments"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Direction</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as "PAY" | "COLLECT")}
                >
                  <option value="PAY">Payment (AP)</option>
                  <option value="COLLECT">Collection (AR)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Payment Method</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Currency (blank = any)</Label>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="USD"
                  maxLength={3}
                />
              </div>
              <div className="space-y-1">
                <Label>Exchange Rate Handling</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                  value={fxHandling}
                  onChange={(e) => setFxHandling(e.target.value)}
                >
                  {FX_HANDLING.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Bank Account ID (optional)</Label>
                <Input
                  value={bankAccountId}
                  onChange={(e) => setBankAccountId(e.target.value)}
                  placeholder="1200"
                />
              </div>
              <div className="space-y-1">
                <Label>Total Limit (optional)</Label>
                <Input
                  type="number"
                  value={totalPaymentLimit}
                  onChange={(e) => setTotalPaymentLimit(e.target.value)}
                  placeholder="100000"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={remittanceAdvice}
                onChange={(e) => setRemittanceAdvice(e.target.checked)}
                className="rounded border-border"
              />
              Generate remittance advice
            </label>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Weekly run for TZS bank transfers"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!name || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? "Creating..." : "Create Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
