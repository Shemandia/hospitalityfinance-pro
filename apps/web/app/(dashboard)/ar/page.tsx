"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useApiContext } from "../../../components/use-api-context";
import {
  createARCustomer,
  createARInvoice,
  createARReceipt,
  getARAgeing,
  getARCustomers,
  getARInvoices,
  getPeriods,
  postARInvoice
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
import { Skeleton } from "../../../components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../components/ui/select";

type Customer = { id: string; name: string; code: string; currency: string };
type ARInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: string;
  amountPaid: string;
  currency: string;
  status: string;
  customer: { id: string; name: string; code: string };
};
type AgeingRow = {
  customerId: string;
  customerName: string;
  currency: string;
  current: string;
  days1to30: string;
  days31to60: string;
  days61to90: string;
  over90: string;
  total: string;
};
type Period = { id: string; name: string; status: string };

const statusVariant: Record<string, "success" | "destructive" | "info" | "warning" | "secondary"> =
  {
    PAID: "success",
    OVERDUE: "destructive",
    POSTED: "info",
    PARTIALLY_PAID: "warning",
    DRAFT: "secondary"
  };

const invoiceSchema = z.object({
  customerId: z.string().min(1, "Required"),
  invoiceNumber: z.string().min(1, "Required"),
  invoiceDate: z.string().min(1),
  dueDate: z.string().min(1),
  amount: z.string().min(1, "Required"),
  currency: z.string().length(3),
  periodId: z.string().optional()
});

const customerSchema = z.object({
  name: z.string().min(1, "Required"),
  code: z.string().min(1, "Required"),
  email: z.string().email().optional().or(z.literal("")),
  currency: z.string().length(3)
});

const receiptSchema = z.object({
  customerId: z.string().min(1, "Required"),
  amount: z.string().min(1, "Required"),
  currency: z.string().length(3),
  receiptDate: z.string().min(1),
  reference: z.string().optional()
});

export default function ARPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [showInvoice, setShowInvoice] = useState(false);
  const [showCustomer, setShowCustomer] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [ageingAsOf, setAgeingAsOf] = useState(new Date().toISOString().slice(0, 10));

  const invForm = useForm<z.infer<typeof invoiceSchema>>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      currency: "USD",
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: (() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d.toISOString().slice(0, 10);
      })()
    }
  });
  const custForm = useForm<z.infer<typeof customerSchema>>({
    resolver: zodResolver(customerSchema),
    defaultValues: { currency: "USD" }
  });
  const rcptForm = useForm<z.infer<typeof receiptSchema>>({
    resolver: zodResolver(receiptSchema),
    defaultValues: { currency: "USD", receiptDate: new Date().toISOString().slice(0, 10) }
  });

  const customersQ = useQuery({
    queryKey: ["ar-customers", apiContext?.entityId],
    queryFn: () => (apiContext ? getARCustomers(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r) => (r.data as unknown as Customer[]) ?? []
  });
  const invoicesQ = useQuery({
    queryKey: ["ar-invoices", apiContext?.entityId],
    queryFn: () => (apiContext ? getARInvoices(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r) => (r.data as unknown as ARInvoice[]) ?? []
  });
  const periodsQ = useQuery({
    queryKey: ["periods", apiContext?.entityId],
    queryFn: () => (apiContext ? getPeriods(apiContext) : Promise.resolve({ data: [] })),
    enabled: Boolean(apiContext),
    select: (r) => (r.data as unknown as Period[]) ?? []
  });
  const ageingQ = useQuery({
    queryKey: ["ar-ageing", apiContext?.entityId, ageingAsOf],
    queryFn: () =>
      apiContext ? getARAgeing(apiContext, ageingAsOf) : Promise.resolve({ data: [] }),
    enabled: Boolean(apiContext),
    select: (r) => (r.data as unknown as AgeingRow[]) ?? []
  });

  const createInvMut = useMutation({
    mutationFn: (v: z.infer<typeof invoiceSchema>) =>
      createARInvoice(apiContext!, {
        ...v,
        amount: parseFloat(v.amount),
        periodId: v.periodId || undefined
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      setShowInvoice(false);
      invForm.reset();
      setFeedback("Invoice created.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });
  const createCustMut = useMutation({
    mutationFn: (v: z.infer<typeof customerSchema>) =>
      createARCustomer(apiContext!, { ...v, email: v.email || undefined }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ar-customers"] });
      setShowCustomer(false);
      custForm.reset();
      setFeedback("Customer created.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });
  const createRcptMut = useMutation({
    mutationFn: (v: z.infer<typeof receiptSchema>) =>
      createARReceipt(apiContext!, {
        ...v,
        amount: parseFloat(v.amount),
        reference: v.reference || undefined
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      setShowReceipt(false);
      rcptForm.reset();
      setFeedback("Receipt recorded.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });
  const postInvMut = useMutation({
    mutationFn: (id: string) => postARInvoice(apiContext!, id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ar-invoices"] });
      setFeedback("Invoice posted to GL.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const fmt = (v: string) => parseFloat(v).toLocaleString(undefined, { minimumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-primary">Accounts Receivable</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="teal" onClick={() => setShowInvoice(true)}>
              + Invoice
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowReceipt(true)}>
              + Receipt
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setShowCustomer(true)}>
              + Customer
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
          <Tabs defaultValue="invoices">
            <TabsList className="mb-4">
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="customers">Customers</TabsTrigger>
              <TabsTrigger value="ageing">Ageing Report</TabsTrigger>
            </TabsList>

            <TabsContent value="invoices">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead>CCY</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoicesQ.isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 9 }).map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : (invoicesQ.data ?? []).map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                          <TableCell>{inv.customer?.name ?? "-"}</TableCell>
                          <TableCell className="text-xs">
                            {new Date(inv.invoiceDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-xs">
                            {new Date(inv.dueDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {fmt(inv.amount)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {fmt(inv.amountPaid)}
                          </TableCell>
                          <TableCell>{inv.currency}</TableCell>
                          <TableCell>
                            <Badge variant={statusVariant[inv.status] ?? "secondary"}>
                              {inv.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {inv.status === "DRAFT" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={postInvMut.isPending}
                                onClick={() => postInvMut.mutate(inv.id)}
                              >
                                Post
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="customers">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Currency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customersQ.isLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 3 }).map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : (customersQ.data ?? []).map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-xs">{c.code}</TableCell>
                          <TableCell>{c.name}</TableCell>
                          <TableCell>{c.currency}</TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </TabsContent>

            <TabsContent value="ageing">
              <div className="flex items-center gap-3 mb-4">
                <Label>As of date</Label>
                <Input
                  type="date"
                  value={ageingAsOf}
                  onChange={(e) => setAgeingAsOf(e.target.value)}
                  className="w-44"
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>CCY</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">1–30d</TableHead>
                    <TableHead className="text-right">31–60d</TableHead>
                    <TableHead className="text-right">61–90d</TableHead>
                    <TableHead className="text-right">90+d</TableHead>
                    <TableHead className="text-right font-semibold">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ageingQ.isLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          {Array.from({ length: 8 }).map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : (ageingQ.data ?? []).map((row) => (
                        <TableRow key={row.customerId}>
                          <TableCell>{row.customerName}</TableCell>
                          <TableCell>{row.currency}</TableCell>
                          {[
                            row.current,
                            row.days1to30,
                            row.days31to60,
                            row.days61to90,
                            row.over90
                          ].map((v, i) => (
                            <TableCell key={i} className="text-right font-mono text-xs">
                              {fmt(v)}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-mono text-xs font-semibold text-primary">
                            {fmt(row.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* New Invoice Dialog */}
      <Dialog open={showInvoice} onOpenChange={setShowInvoice}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New AR Invoice</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={invForm.handleSubmit((v: z.infer<typeof invoiceSchema>) =>
              createInvMut.mutate(v)
            )}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Controller
                control={invForm.control}
                name="customerId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {(customersQ.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.code} {"\u2013"} {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Invoice #</Label>
                <Input {...invForm.register("invoiceNumber")} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Input {...invForm.register("currency")} maxLength={3} />
              </div>
              <div className="space-y-1.5">
                <Label>Invoice Date</Label>
                <Input type="date" {...invForm.register("invoiceDate")} />
              </div>
              <div className="space-y-1.5">
                <Label>Due Date</Label>
                <Input type="date" {...invForm.register("dueDate")} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Amount</Label>
              <Input type="number" step="0.01" {...invForm.register("amount")} />
            </div>
            <div className="space-y-1.5">
              <Label>Period (optional)</Label>
              <Controller
                control={invForm.control}
                name="periodId"
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Auto-detect from date" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Auto-detect from date</SelectItem>
                      {(periodsQ.data ?? [])
                        .filter((p) => p.status === "OPEN")
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowInvoice(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="teal" disabled={createInvMut.isPending}>
                {createInvMut.isPending ? "Creating…" : "Create Invoice"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Customer Dialog */}
      <Dialog open={showCustomer} onOpenChange={setShowCustomer}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New Customer</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={custForm.handleSubmit((v: z.infer<typeof customerSchema>) =>
              createCustMut.mutate(v)
            )}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input {...custForm.register("name")} />
            </div>
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input {...custForm.register("code")} />
            </div>
            <div className="space-y-1.5">
              <Label>Email (optional)</Label>
              <Input type="email" {...custForm.register("email")} />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Input {...custForm.register("currency")} maxLength={3} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCustomer(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="teal" disabled={createCustMut.isPending}>
                {createCustMut.isPending ? "Saving…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Receipt Dialog */}
      <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Receipt</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={rcptForm.handleSubmit((v: z.infer<typeof receiptSchema>) =>
              createRcptMut.mutate(v)
            )}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <Controller
                control={rcptForm.control}
                name="customerId"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select customer" />
                    </SelectTrigger>
                    <SelectContent>
                      {(customersQ.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.code} {"\u2013"} {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" step="0.01" {...rcptForm.register("amount")} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Input {...rcptForm.register("currency")} maxLength={3} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" {...rcptForm.register("receiptDate")} />
            </div>
            <div className="space-y-1.5">
              <Label>Reference</Label>
              <Input {...rcptForm.register("reference")} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowReceipt(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="teal" disabled={createRcptMut.isPending}>
                {createRcptMut.isPending ? "Saving…" : "Record Receipt"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
