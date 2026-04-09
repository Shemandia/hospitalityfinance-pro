"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  getRevaluationProfiles,
  createRevaluationProfile,
  deleteRevaluationProfile,
  type RevaluationProfileSummary
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
import { Plus, Trash2, RefreshCcw } from "lucide-react";

const RATE_TYPES = [
  { value: "CLOSING", label: "Closing rate" },
  { value: "AVERAGE", label: "Average rate" },
  { value: "CUSTOM", label: "Custom rate" }
];

const ACCOUNT_TYPES = [
  { value: "ASSET", label: "Asset" },
  { value: "LIABILITY", label: "Liability" },
  { value: "REVENUE", label: "Revenue" },
  { value: "EXPENSE", label: "Expense" },
  { value: "EQUITY", label: "Equity" }
];

export default function RevaluationProfilesPage() {
  const apiContext = useApiContext();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [feedback, setFeedback] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState<string[]>([]);
  const [accountCodeFrom, setAccountCodeFrom] = useState("");
  const [accountCodeTo, setAccountCodeTo] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState("");
  const [rateType, setRateType] = useState("CLOSING");
  const [gainAccountCode, setGainAccountCode] = useState("");
  const [lossAccountCode, setLossAccountCode] = useState("");
  const [autoReverse, setAutoReverse] = useState(true);
  const [postDifferences, setPostDifferences] = useState(true);
  const [description, setDescription] = useState("");

  const profilesQ = useQuery({
    queryKey: ["revaluation-profiles", apiContext?.tenantSlug, apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getRevaluationProfiles(apiContext);
      return (res.data as unknown as RevaluationProfileSummary[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const createMut = useMutation({
    mutationFn: () =>
      createRevaluationProfile(apiContext!, {
        name,
        accountTypeFilter: accountTypeFilter.length > 0 ? accountTypeFilter : undefined,
        accountCodeFrom: accountCodeFrom || undefined,
        accountCodeTo: accountCodeTo || undefined,
        currencyFilter: currencyFilter || undefined,
        rateType,
        gainAccountCode,
        lossAccountCode,
        autoReverse,
        postDifferences,
        description: description || undefined
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["revaluation-profiles"] });
      setShowCreate(false);
      resetForm();
      setFeedback("Profile created.");
    },
    onError: (e) => setFeedback((e as Error).message)
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRevaluationProfile(apiContext!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["revaluation-profiles"] });
      setFeedback("Profile deactivated.");
    }
  });

  function resetForm() {
    setName("");
    setAccountTypeFilter([]);
    setAccountCodeFrom("");
    setAccountCodeTo("");
    setCurrencyFilter("");
    setRateType("CLOSING");
    setGainAccountCode("");
    setLossAccountCode("");
    setAutoReverse(true);
    setPostDifferences(true);
    setDescription("");
  }

  function toggleAccountType(type: string) {
    setAccountTypeFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  const profiles = profilesQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Revaluation Profiles</h1>
          <p className="text-sm text-muted-foreground">
            Configure ledger FX revaluation profiles for period-end processing
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

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">Active Profiles</CardTitle>
        </CardHeader>
        <CardContent>
          {profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No revaluation profiles configured.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Account Types</TableHead>
                  <TableHead>Code Range</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Rate Type</TableHead>
                  <TableHead>Gain / Loss</TableHead>
                  <TableHead>Options</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-xs">
                      {(p.accountTypeFilter ?? []).length > 0
                        ? (p.accountTypeFilter as string[]).join(", ")
                        : "All"}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {p.accountCodeFrom || p.accountCodeTo
                        ? `${p.accountCodeFrom ?? "..."} – ${p.accountCodeTo ?? "..."}`
                        : "All"}
                    </TableCell>
                    <TableCell>{p.currencyFilter ?? "All"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {p.rateType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {p.gainAccountCode} / {p.lossAccountCode}
                    </TableCell>
                    <TableCell className="text-xs">
                      {p.autoReverse && (
                        <Badge variant="secondary" className="text-[10px] mr-1">
                          <RefreshCcw className="h-2.5 w-2.5 mr-0.5" />
                          Auto-rev
                        </Badge>
                      )}
                      {p.postDifferences && (
                        <Badge variant="secondary" className="text-[10px]">
                          Post
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMut.mutate(p.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Revaluation Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Profile Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Month-End BS Reval"
              />
            </div>
            <div className="space-y-1">
              <Label>Account Types (leave empty for all)</Label>
              <div className="flex flex-wrap gap-2">
                {ACCOUNT_TYPES.map((at) => (
                  <label key={at.value} className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={accountTypeFilter.includes(at.value)}
                      onChange={() => toggleAccountType(at.value)}
                      className="rounded border-border"
                    />
                    {at.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Account Code From</Label>
                <Input
                  value={accountCodeFrom}
                  onChange={(e) => setAccountCodeFrom(e.target.value)}
                  placeholder="1000"
                />
              </div>
              <div className="space-y-1">
                <Label>Account Code To</Label>
                <Input
                  value={accountCodeTo}
                  onChange={(e) => setAccountCodeTo(e.target.value)}
                  placeholder="3999"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Currency Filter (blank = all)</Label>
                <Input
                  value={currencyFilter}
                  onChange={(e) => setCurrencyFilter(e.target.value.toUpperCase())}
                  placeholder="EUR"
                  maxLength={3}
                />
              </div>
              <div className="space-y-1">
                <Label>Rate Type</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-border bg-white px-3 py-1 text-sm"
                  value={rateType}
                  onChange={(e) => setRateType(e.target.value)}
                >
                  {RATE_TYPES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Gain Account Code</Label>
                <Input
                  value={gainAccountCode}
                  onChange={(e) => setGainAccountCode(e.target.value)}
                  placeholder="7100"
                />
              </div>
              <div className="space-y-1">
                <Label>Loss Account Code</Label>
                <Input
                  value={lossAccountCode}
                  onChange={(e) => setLossAccountCode(e.target.value)}
                  placeholder="7200"
                />
              </div>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoReverse}
                  onChange={(e) => setAutoReverse(e.target.checked)}
                  className="rounded border-border"
                />
                Auto-reverse next period
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={postDifferences}
                  onChange={(e) => setPostDifferences(e.target.checked)}
                  className="rounded border-border"
                />
                Post differences to GL
              </label>
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Revalue all balance sheet accounts at closing rate"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              variant="teal"
              disabled={!name || !gainAccountCode || !lossAccountCode || createMut.isPending}
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
