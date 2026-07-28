"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  previewSAFFile,
  getSAFAccountMapping,
  executeSAFImport,
  type SAFPreviewSummary,
  type SAFAccountMapping,
  type SAFExecuteResult
} from "../../../../../lib/gl-api";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { Separator } from "../../../../../components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import {
  FileUp,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ArrowRight,
  RefreshCw,
  Upload,
  Layers,
  BookOpen
} from "lucide-react";

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { num: 1, label: "Upload" },
    { num: 2, label: "Review" },
    { num: 3, label: "Import" }
  ];
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 mb-4 sm:mb-6">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center gap-1.5 sm:gap-2">
          <div
            className={`h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium shrink-0 ${
              current === s.num
                ? "bg-[var(--color-primary)] text-white"
                : current > s.num
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {current > s.num ? <CheckCircle className="h-3.5 w-3.5" /> : s.num}
          </div>
          <span
            className={`text-xs sm:text-sm ${current >= s.num ? "font-medium" : "text-muted-foreground"}`}
          >
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground mx-1 sm:mx-2 shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtNum(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtDate(d: string | null | undefined) {
  if (!d || d.length !== 8) return d ?? "—";
  return `${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}`;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SAFImportPage() {
  const apiContext = useApiContext();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileContent, setFileContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<SAFPreviewSummary | null>(null);
  const [mapping, setMapping] = useState<SAFAccountMapping[]>([]);
  const [result, setResult] = useState<SAFExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Options
  const [groupingStrategy, setGroupingStrategy] = useState<
    "single_entry" | "by_reference" | "by_journal_type"
  >("by_reference");
  const [autoPost, setAutoPost] = useState(true);
  const [autoCreateAccounts, setAutoCreateAccounts] = useState(true);
  const [sourceModule, setSourceModule] = useState("PROC");
  const [descriptionPrefix, setDescriptionPrefix] = useState("SAF Import");

  // ── File handling ─────────────────────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setMapping([]);
    setResult(null);
    setError(null);

    const ext = file.name.toLowerCase();
    if (ext.endsWith(".sun")) {
      setSourceModule("OPERA");
      setDescriptionPrefix("Opera SUN Import");
    } else if (ext.endsWith(".txt") || ext.endsWith(".saf")) {
      setSourceModule("PROC");
      setDescriptionPrefix("Jana SAF Import");
    }

    const reader = new FileReader();
    reader.onload = () => setFileContent(reader.result as string);
    reader.readAsText(file);
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────

  const previewMutation = useMutation({
    mutationFn: () => previewSAFFile(apiContext!, fileContent, fileName),
    onSuccess: (res) => {
      const data = res.data as unknown as SAFPreviewSummary;
      setPreview(data);
      setError(null);
      setStep(2);
      // Auto-set source module and description based on detected format
      if (data.format === "pipe_delimited") {
        setSourceModule("OPERA");
        const typeLabel = data.operaFileType?.replace(/_/g, " ") ?? "SUN";
        setDescriptionPrefix(`Opera ${typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)}`);
        setGroupingStrategy("single_entry");
      } else if (data.janaFileType === "internal_movements") {
        setSourceModule("PROC");
        setDescriptionPrefix("Jana Store Issue");
        setGroupingStrategy("single_entry");
      } else if (data.janaFileType === "inventory_differences") {
        setSourceModule("PROC");
        setDescriptionPrefix("Jana Stock Variance");
        setGroupingStrategy("single_entry");
      }
    },
    onError: (e: Error) => setError(e.message)
  });

  const mappingMutation = useMutation({
    mutationFn: () => getSAFAccountMapping(apiContext!, fileContent, fileName),
    onSuccess: (res) => {
      setMapping(res.data as unknown as SAFAccountMapping[]);
      setError(null);
    },
    onError: (e: Error) => setError(e.message)
  });

  const loadMapping = useCallback(() => {
    if (mapping.length === 0) mappingMutation.mutate();
  }, [mapping.length]);

  const executeMutation = useMutation({
    mutationFn: () =>
      executeSAFImport(apiContext!, {
        fileContent,
        filename: fileName,
        groupingStrategy,
        autoPost,
        autoCreateAccounts,
        sourceModule,
        descriptionPrefix
      }),
    onSuccess: (res) => {
      setResult(res.data as unknown as SAFExecuteResult);
      setStep(4);
      setError(null);
    },
    onError: (e: Error) => setError(e.message)
  });

  const isStatsFile =
    preview?.operaFileType === "market_stats" || preview?.operaFileType === "daily_stats";

  const mappingStats = useMemo(() => {
    const matched = mapping.filter((m) => m.status === "matched").length;
    const partial = mapping.filter((m) => m.status === "partial_match").length;
    const unmatched = mapping.filter((m) => m.status === "unmatched").length;
    return { matched, partial, unmatched, total: mapping.length };
  }, [mapping]);

  function reset() {
    setStep(1);
    setFileContent("");
    setFileName("");
    setPreview(null);
    setMapping([]);
    setResult(null);
    setError(null);
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-[var(--color-primary)] flex items-center gap-2">
            <FileUp className="h-5 w-5 shrink-0" /> SAF File Import
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Import Jana (.txt) or Opera (.SUN) SAF files into GL journals.
          </p>
        </div>
        {step !== 1 && (
          <Button variant="outline" size="sm" onClick={reset} className="gap-1 self-start shrink-0">
            <RefreshCw className="h-3.5 w-3.5" /> Start Over
          </Button>
        )}
      </div>

      <StepIndicator current={step > 3 ? 3 : step} />

      {/* ── Step 1: Upload ──────────────────────────────────────────────── */}
      {step === 1 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base">Upload SAF File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs sm:text-sm">Select SAF file (.txt, .saf, .SUN)</Label>
              <Input
                type="file"
                accept=".txt,.saf,.sun,.SUN"
                onChange={handleFileSelect}
                className="text-sm"
              />
              {fileName && (
                <p className="text-xs text-muted-foreground truncate">
                  <span className="font-mono font-medium">{fileName}</span>
                  {fileContent && (
                    <span> — {fileContent.split("\n").filter((l) => l.trim()).length} lines</span>
                  )}
                </p>
              )}
            </div>

            <div className="rounded-md bg-muted/50 p-2.5 sm:p-3">
              <p className="text-[11px] sm:text-xs text-muted-foreground">
                Supports both formats: Jana fixed-width (.txt) and Opera pipe-delimited (.SUN).
                Format is auto-detected.
              </p>
            </div>

            {error && (
              <p className="text-xs sm:text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2 break-words">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => previewMutation.mutate()}
                disabled={!fileContent || !apiContext || previewMutation.isPending}
                className="gap-1"
              >
                {previewMutation.isPending ? (
                  "Parsing…"
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" /> Parse & Preview
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Preview + Mapping + Options ─────────────────────────── */}
      {step === 2 && preview && (
        <>
          {/* Format detection badge */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] sm:text-xs font-mono">
              {preview.format === "pipe_delimited"
                ? "Opera (pipe-delimited)"
                : "Jana (fixed-width)"}
            </Badge>
            {preview.operaFileType && (
              <Badge variant="secondary" className="text-[10px] sm:text-xs capitalize">
                {preview.operaFileType.replace(/_/g, " ")}
              </Badge>
            )}
            {preview.janaFileType && (
              <Badge variant="secondary" className="text-[10px] sm:text-xs capitalize">
                {preview.janaFileType.replace(/_/g, " ")}
              </Badge>
            )}
            <span className="text-[10px] sm:text-xs text-muted-foreground font-mono">
              {fileName}
            </span>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
            <Card className="p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Lines</p>
              <p className="text-lg sm:text-xl font-bold mt-0.5">
                {preview.lineCount.toLocaleString()}
              </p>
            </Card>
            <Card className="p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Accounts</p>
              <p className="text-lg sm:text-xl font-bold mt-0.5">{preview.uniqueAccountCount}</p>
            </Card>
            <Card className="p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Total Debits</p>
              <p className="text-base sm:text-lg font-bold mt-0.5 text-blue-700 truncate">
                {fmtNum(preview.totalDebits)}
              </p>
            </Card>
            <Card className="p-3 sm:p-4">
              <p className="text-[10px] sm:text-xs text-muted-foreground">Total Credits</p>
              <p className="text-base sm:text-lg font-bold mt-0.5 text-emerald-700 truncate">
                {fmtNum(preview.totalCredits)}
              </p>
            </Card>
          </div>

          {/* Balance + meta */}
          <Card
            className={
              preview.isBalanced
                ? "border-emerald-300"
                : isStatsFile
                  ? "border-amber-300"
                  : "border-destructive/40"
            }
          >
            <CardContent className="py-3 sm:pt-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2">
                <div className="flex items-center gap-2">
                  {preview.isBalanced ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                      <span className="text-xs sm:text-sm font-medium text-emerald-700">
                        File is balanced
                      </span>
                    </>
                  ) : isStatsFile ? (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span className="text-xs sm:text-sm font-medium text-amber-700">
                        Statistics file (not balanced by design)
                      </span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                      <span className="text-xs sm:text-sm font-medium text-destructive">
                        Out of balance by {fmtNum(preview.difference)}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] sm:text-xs text-muted-foreground">
                  {preview.fileCurrency && (
                    <span>
                      File: <strong>{preview.fileCurrency}</strong>
                    </span>
                  )}
                  {preview.baseCurrency && (
                    <span>
                      Base: <strong>{preview.baseCurrency}</strong>
                    </span>
                  )}
                  {preview.reportingCurrency &&
                    preview.reportingCurrency !== preview.baseCurrency && (
                      <span>
                        Reporting: <strong>{preview.reportingCurrency}</strong>
                      </span>
                    )}
                  {preview.dateRange && (
                    <span>
                      {fmtDate(preview.dateRange.earliest)} — {fmtDate(preview.dateRange.latest)}
                    </span>
                  )}
                </div>
              </div>
              {preview.journalTypes.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {preview.journalTypes.map((jt) => (
                    <Badge key={jt} variant="secondary" className="text-[9px] sm:text-[10px]">
                      {jt}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* FX Rate — show when file currency differs from reporting currency */}
          {preview.fileCurrency &&
            preview.reportingCurrency &&
            preview.fileCurrency.toUpperCase() !== preview.reportingCurrency.toUpperCase() && (
              <Card className={preview.fxRate ? "border-blue-300" : "border-amber-300"}>
                <CardContent className="py-3 sm:pt-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2">
                    <div className="flex items-center gap-2">
                      {preview.fxRate ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-blue-600 shrink-0" />
                          <span className="text-xs sm:text-sm font-medium text-blue-700">
                            Exchange Rate: 1 {preview.fileCurrency} ={" "}
                            {parseFloat(preview.fxRate).toFixed(6)} {preview.reportingCurrency}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                          <span className="text-xs sm:text-sm font-medium text-amber-700">
                            No FX rate found for {preview.fileCurrency}/{preview.reportingCurrency}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-[10px] sm:text-xs text-muted-foreground">
                      {preview.fxRate && preview.fxRateDate && (
                        <span>
                          Rate date: <strong>{preview.fxRateDate}</strong>
                        </span>
                      )}
                      {preview.fxRate && preview.totalDebits > 0 && (
                        <span className="ml-3">
                          ≈ {fmtNum(preview.totalDebits * parseFloat(preview.fxRate))}{" "}
                          {preview.reportingCurrency} (debits)
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

          {/* Parse warnings */}
          {preview.errors.length > 0 && (
            <Card className="border-amber-300">
              <CardContent className="py-3">
                <p className="text-xs font-medium text-amber-700 flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {preview.errors.length} Warning
                  {preview.errors.length !== 1 ? "s" : ""}
                </p>
                <div className="max-h-20 overflow-y-auto space-y-0.5 text-[11px]">
                  {preview.errors.slice(0, 8).map((e, i) => (
                    <div key={i} className="truncate">
                      <span className="text-muted-foreground">Ln {e.line}:</span> {e.message}
                    </div>
                  ))}
                  {preview.errors.length > 8 && (
                    <p className="text-muted-foreground">…{preview.errors.length - 8} more</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top accounts — side by side on md+, stacked on mobile */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
            <Card>
              <CardHeader className="pb-1 pt-3 px-3 sm:px-6">
                <CardTitle className="text-xs sm:text-sm">Top Debit Accounts</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-1">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] sm:text-xs px-2 sm:px-4">Code</TableHead>
                        <TableHead className="text-[10px] sm:text-xs text-right px-2 sm:px-4">
                          Total
                        </TableHead>
                        <TableHead className="text-[10px] sm:text-xs text-right px-2 sm:px-4 w-12">
                          Ln
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.debitAccounts.slice(0, 6).map((a) => (
                        <TableRow key={a.code}>
                          <TableCell className="font-mono text-[11px] sm:text-xs px-2 sm:px-4 py-1.5">
                            {a.code}
                          </TableCell>
                          <TableCell className="text-[11px] sm:text-xs text-right tabular-nums px-2 sm:px-4 py-1.5">
                            {fmtNum(a.total)}
                          </TableCell>
                          <TableCell className="text-[11px] sm:text-xs text-right text-muted-foreground px-2 sm:px-4 py-1.5">
                            {a.lines}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1 pt-3 px-3 sm:px-6">
                <CardTitle className="text-xs sm:text-sm">Top Credit Accounts</CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-1">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] sm:text-xs px-2 sm:px-4">Code</TableHead>
                        <TableHead className="text-[10px] sm:text-xs text-right px-2 sm:px-4">
                          Total
                        </TableHead>
                        <TableHead className="text-[10px] sm:text-xs text-right px-2 sm:px-4 w-12">
                          Ln
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.creditAccounts.slice(0, 6).map((a) => (
                        <TableRow key={a.code}>
                          <TableCell className="font-mono text-[11px] sm:text-xs px-2 sm:px-4 py-1.5">
                            {a.code}
                          </TableCell>
                          <TableCell className="text-[11px] sm:text-xs text-right tabular-nums px-2 sm:px-4 py-1.5">
                            {fmtNum(a.total)}
                          </TableCell>
                          <TableCell className="text-[11px] sm:text-xs text-right text-muted-foreground px-2 sm:px-4 py-1.5">
                            {a.lines}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Account mapping */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3 gap-2">
              <CardTitle className="text-xs sm:text-sm flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 shrink-0" /> Account Mapping
              </CardTitle>
              {mapping.length === 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={loadMapping}
                  disabled={mappingMutation.isPending}
                  className="gap-1 text-xs shrink-0"
                >
                  {mappingMutation.isPending ? "Loading…" : "Check Mapping"}
                </Button>
              )}
            </CardHeader>
            {mapping.length > 0 && (
              <CardContent className="pt-0 space-y-2">
                <div className="flex gap-3 sm:gap-4 text-[10px] sm:text-xs">
                  <span className="text-emerald-700 font-medium">
                    {mappingStats.matched} matched
                  </span>
                  <span className="text-amber-700 font-medium">{mappingStats.partial} partial</span>
                  <span className="text-destructive font-medium">
                    {mappingStats.unmatched} unmatched
                  </span>
                </div>
                <div className="max-h-52 overflow-y-auto overflow-x-auto -mx-3 sm:-mx-6">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] sm:text-xs px-2 sm:px-4">
                          SAF Code
                        </TableHead>
                        <TableHead className="text-[10px] sm:text-xs px-2 sm:px-4">
                          Status
                        </TableHead>
                        <TableHead className="text-[10px] sm:text-xs px-2 sm:px-4">
                          GL Account
                        </TableHead>
                        <TableHead className="text-[10px] sm:text-xs px-2 sm:px-4 hidden sm:table-cell">
                          Type
                        </TableHead>
                        <TableHead className="text-[10px] sm:text-xs px-2 sm:px-4 hidden md:table-cell">
                          Suggestion
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mapping.map((m) => (
                        <TableRow
                          key={m.safCode}
                          className={
                            m.status === "unmatched"
                              ? "bg-destructive/5"
                              : m.status === "partial_match"
                                ? "bg-amber-50/50"
                                : ""
                          }
                        >
                          <TableCell className="font-mono text-[11px] sm:text-xs font-medium px-2 sm:px-4 py-1.5">
                            {m.safCode}
                          </TableCell>
                          <TableCell className="px-2 sm:px-4 py-1.5">
                            <Badge
                              variant={
                                m.status === "matched"
                                  ? "success"
                                  : m.status === "partial_match"
                                    ? "default"
                                    : "destructive"
                              }
                              className="text-[9px] sm:text-[10px]"
                            >
                              {m.status === "matched"
                                ? "Matched"
                                : m.status === "partial_match"
                                  ? "Partial"
                                  : "Unmatched"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-[11px] sm:text-xs px-2 sm:px-4 py-1.5 max-w-[150px] truncate">
                            {m.glAccountCode ? (
                              <span className="font-mono">{m.glAccountCode}</span>
                            ) : (
                              "—"
                            )}
                            {m.glAccountName && (
                              <span className="text-muted-foreground ml-1">{m.glAccountName}</span>
                            )}
                          </TableCell>
                          <TableCell className="text-[11px] sm:text-xs text-muted-foreground px-2 sm:px-4 py-1.5 hidden sm:table-cell">
                            {m.isVendor ? "Vendor" : "GL"}
                          </TableCell>
                          <TableCell className="text-[11px] sm:text-xs text-muted-foreground px-2 sm:px-4 py-1.5 hidden md:table-cell max-w-[180px] truncate">
                            {m.suggestion || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Import options + execute */}
          <Card>
            <CardContent className="pt-3 sm:pt-4 space-y-3 sm:space-y-4">
              <p className="text-xs sm:text-sm font-medium">Import Options</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[11px] sm:text-xs">Grouping Strategy</Label>
                  <Select
                    value={groupingStrategy}
                    onValueChange={(v) => setGroupingStrategy(v as typeof groupingStrategy)}
                  >
                    <SelectTrigger className="text-xs sm:text-sm h-8 sm:h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="by_reference">By Reference</SelectItem>
                      <SelectItem value="by_journal_type">By Journal Type</SelectItem>
                      <SelectItem value="single_entry">Single Entry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] sm:text-xs">Source Module</Label>
                  <Input
                    value={sourceModule}
                    onChange={(e) => setSourceModule(e.target.value)}
                    className="font-mono text-xs sm:text-sm h-8 sm:h-9"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2 lg:col-span-1">
                  <Label className="text-[11px] sm:text-xs">Description Prefix</Label>
                  <Input
                    value={descriptionPrefix}
                    onChange={(e) => setDescriptionPrefix(e.target.value)}
                    className="text-xs sm:text-sm h-8 sm:h-9"
                  />
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-4">
                <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoCreateAccounts}
                    onChange={(e) => setAutoCreateAccounts(e.target.checked)}
                    className="h-3.5 w-3.5 sm:h-4 sm:w-4 rounded border-border"
                  />
                  Auto-create missing accounts & suppliers
                </label>
                <label className="flex items-center gap-1.5 text-xs sm:text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoPost}
                    onChange={(e) => setAutoPost(e.target.checked)}
                    className="h-3.5 w-3.5 sm:h-4 sm:w-4 rounded border-border"
                  />
                  Auto-post journals (skip draft)
                </label>
              </div>

              {error && (
                <p className="text-xs sm:text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2 break-words">
                  {error}
                </p>
              )}

              <Separator />

              <div className="flex justify-between items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  size="sm"
                  onClick={() => executeMutation.mutate()}
                  disabled={
                    !apiContext ||
                    executeMutation.isPending ||
                    (!preview?.isBalanced && !isStatsFile)
                  }
                  className="gap-1"
                >
                  {executeMutation.isPending ? (
                    "Importing…"
                  ) : (
                    <>
                      <BookOpen className="h-3.5 w-3.5" /> Create Journals
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Step 4: Result ──────────────────────────────────────────────── */}
      {step === 4 && result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" /> Import Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
              <div className="rounded-md bg-emerald-50 px-3 py-2.5 sm:px-4 sm:py-3 text-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground">Journals</p>
                <p className="text-xl sm:text-2xl font-bold text-emerald-700">
                  {result.journalsCreated}
                </p>
              </div>
              <div className="rounded-md bg-blue-50 px-3 py-2.5 sm:px-4 sm:py-3 text-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground">Lines</p>
                <p className="text-xl sm:text-2xl font-bold text-blue-700">
                  {result.linesImported}
                </p>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2.5 sm:px-4 sm:py-3 text-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground">Skipped</p>
                <p className="text-xl sm:text-2xl font-bold text-muted-foreground">
                  {result.linesSkipped}
                </p>
              </div>
              <div className="rounded-md bg-purple-50 px-3 py-2.5 sm:px-4 sm:py-3 text-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground">New Accts</p>
                <p className="text-xl sm:text-2xl font-bold text-purple-700">
                  {result.accountsCreated}
                </p>
              </div>
              <div className="rounded-md bg-amber-50 px-3 py-2.5 sm:px-4 sm:py-3 text-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground">Suppliers</p>
                <p className="text-xl sm:text-2xl font-bold text-amber-700">
                  {result.suppliersCreated}
                </p>
              </div>
              <div className="rounded-md bg-teal-50 px-3 py-2.5 sm:px-4 sm:py-3 text-center col-span-2 sm:col-span-1">
                <p className="text-[10px] sm:text-xs text-muted-foreground">AP Invoices</p>
                <p className="text-xl sm:text-2xl font-bold text-teal-700">
                  {result.invoicesCreated ?? 0}
                </p>
              </div>
            </div>

            {(result.duplicatesSkipped ?? 0) > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs sm:text-sm font-medium text-amber-700 mb-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {result.duplicatesSkipped}{" "}
                    Duplicate invoice{result.duplicatesSkipped !== 1 ? "s" : ""} skipped
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(result.duplicateReferences ?? []).map((ref) => (
                      <Badge
                        key={ref}
                        variant="secondary"
                        className="font-mono text-[9px] sm:text-[10px]"
                      >
                        {ref}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {result.unmappedAccounts.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-xs sm:text-sm font-medium text-amber-700 mb-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{" "}
                    {result.unmappedAccounts.length} Unmapped
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {result.unmappedAccounts.map((code) => (
                      <Badge
                        key={code}
                        variant="secondary"
                        className="font-mono text-[9px] sm:text-[10px]"
                      >
                        {code}
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={reset} className="gap-1">
                <RefreshCw className="h-3.5 w-3.5" /> Import Another
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (window.location.href = "/gl/journals")}
                className="gap-1"
              >
                <BookOpen className="h-3.5 w-3.5" /> View Journals
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
