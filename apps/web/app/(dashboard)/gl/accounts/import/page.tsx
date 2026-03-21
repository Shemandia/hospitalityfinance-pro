"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  previewCOAImport,
  executeCOAImport,
  getExcelSheetNames,
  type COAPreviewResult,
  type COAImportResult,
  type COAPreviewRow,
  type COAFileInput
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
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertTriangle,
  XCircle,
  ArrowRight,
  Download,
  RefreshCw
} from "lucide-react";

const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".xlsm"];

function isExcelFile(name: string) {
  return EXCEL_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Sample CSV template ───────────────────────────────────────────────────────

const SAMPLE_CSV = `code,name,type,normalBalance,allowPosting,parentCode,level,usaliCategory,usaliDepartment
1000,Cash and Cash Equivalents,ASSET,DEBIT,false,,1,,
1010,Cash on Hand,ASSET,DEBIT,true,1000,2,,
1020,Bank — Operating Account,ASSET,DEBIT,true,1000,2,,
1100,Accounts Receivable,ASSET,DEBIT,false,,1,,
1110,Guest Ledger,ASSET,DEBIT,true,1100,2,Rooms,
1120,City Ledger,ASSET,DEBIT,true,1100,2,Rooms,
2000,Current Liabilities,LIABILITY,CREDIT,false,,1,,
2100,Accounts Payable,LIABILITY,CREDIT,true,2000,2,,
2200,Accrued Expenses,LIABILITY,CREDIT,true,2000,2,,
3000,Equity,EQUITY,CREDIT,false,,1,,
3100,Retained Earnings,EQUITY,CREDIT,true,3000,2,,
4000,Revenue,REVENUE,CREDIT,false,,1,,
4100,Rooms Revenue,REVENUE,CREDIT,true,4000,2,Rooms,Rooms
4200,Food Revenue,REVENUE,CREDIT,true,4000,2,F&B,Food & Beverage
4300,Beverage Revenue,REVENUE,CREDIT,true,4000,2,F&B,Food & Beverage
5000,Cost of Sales,EXPENSE,DEBIT,false,,1,,
5100,Cost of Food,EXPENSE,DEBIT,true,5000,2,F&B,Food & Beverage
5200,Cost of Beverage,EXPENSE,DEBIT,true,5000,2,F&B,Food & Beverage
6000,Operating Expenses,EXPENSE,DEBIT,false,,1,,
6100,Salaries & Wages,EXPENSE,DEBIT,true,6000,2,Payroll,
6200,Guest Supplies,EXPENSE,DEBIT,true,6000,2,Rooms,Rooms`;

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { num: 1, label: "Upload" },
    { num: 2, label: "Preview" },
    { num: 3, label: "Import" }
  ];
  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((s, i) => (
        <div key={s.num} className="flex items-center gap-2">
          <div
            className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-medium ${
              current === s.num
                ? "bg-(--color-primary) text-white"
                : current > s.num
                  ? "bg-emerald-600 text-white"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {current > s.num ? <CheckCircle className="h-4 w-4" /> : s.num}
          </div>
          <span className={`text-sm ${current >= s.num ? "font-medium" : "text-muted-foreground"}`}>
            {s.label}
          </span>
          {i < steps.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground mx-2" />}
        </div>
      ))}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: COAPreviewRow["status"] }) {
  const conf: Record<
    string,
    { variant: "default" | "success" | "secondary" | "destructive"; label: string }
  > = {
    new: { variant: "success", label: "New" },
    update: { variant: "default", label: "Update" },
    exists: { variant: "secondary", label: "Exists" },
    error: { variant: "destructive", label: "Error" }
  };
  const c = conf[status] ?? conf.error;
  return (
    <Badge variant={c.variant} className="text-[10px]">
      {c.label}
    </Badge>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function COAImportPage() {
  const apiContext = useApiContext();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileContent, setFileContent] = useState("");
  const [fileBase64, setFileBase64] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [isExcel, setIsExcel] = useState(false);
  const [preview, setPreview] = useState<COAPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<COAImportResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Options
  const [updateExisting, setUpdateExisting] = useState(true);
  const [reactivateInactive, setReactivateInactive] = useState(true);
  const [skipErrors, setSkipErrors] = useState(true);

  // Build the file input for API calls
  const fileInput = useMemo((): COAFileInput => {
    if (isExcel) return { fileBase64, sheetName: sheetName || undefined };
    return { fileContent };
  }, [isExcel, fileBase64, sheetName, fileContent]);

  const hasFile = isExcel ? !!fileBase64 : !!fileContent;

  // ── File handling ─────────────────────────────────────────────────────

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileName(file.name);
      setPreview(null);
      setImportResult(null);
      setPreviewError(null);
      setSheetNames([]);
      setSheetName("");

      const excel = isExcelFile(file.name);
      setIsExcel(excel);

      if (excel) {
        // Read as ArrayBuffer → base64
        setFileContent("");
        const buffer = await file.arrayBuffer();
        const b64 = arrayBufferToBase64(buffer);
        setFileBase64(b64);

        // Fetch sheet names
        if (apiContext) {
          try {
            const res = await getExcelSheetNames(apiContext, b64);
            const names = res.data as unknown as string[];
            setSheetNames(names);
            if (names.length === 1) setSheetName(names[0]);
          } catch {
            // non-fatal — user can still try preview
          }
        }
      } else {
        // CSV/text — read as text
        setFileBase64("");
        const reader = new FileReader();
        reader.onload = () => setFileContent(reader.result as string);
        reader.readAsText(file);
      }
    },
    [apiContext]
  );

  function downloadTemplate() {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "coa-template.csv"
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Preview mutation ──────────────────────────────────────────────────

  const previewMutation = useMutation({
    mutationFn: () => previewCOAImport(apiContext!, fileInput),
    onSuccess: (res) => {
      setPreview(res.data as unknown as COAPreviewResult);
      setPreviewError(null);
      setStep(2);
    },
    onError: (e: Error) => setPreviewError(e.message)
  });

  // ── Execute mutation ──────────────────────────────────────────────────

  const executeMutation = useMutation({
    mutationFn: () =>
      executeCOAImport(apiContext!, fileInput, { updateExisting, reactivateInactive, skipErrors }),
    onSuccess: (res) => {
      setImportResult(res.data as unknown as COAImportResult);
      setStep(3);
    },
    onError: (e: Error) => setPreviewError(e.message)
  });

  // ── Filtered rows ─────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    if (!search.trim()) return preview.rows;
    const q = search.toLowerCase();
    return preview.rows.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.type.toLowerCase().includes(q) ||
        r.status.includes(q)
    );
  }, [preview, search]);

  // ── Reset ─────────────────────────────────────────────────────────────

  function reset() {
    setStep(1);
    setFileContent("");
    setFileBase64("");
    setSheetName("");
    setSheetNames([]);
    setFileName("");
    setIsExcel(false);
    setPreview(null);
    setImportResult(null);
    setPreviewError(null);
    setSearch("");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-(--color-primary) flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Import Chart of Accounts
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload a CSV or Excel file to create or update GL accounts in bulk.
          </p>
        </div>
        {step !== 1 && (
          <Button variant="outline" size="sm" onClick={reset} className="gap-1">
            <RefreshCw className="h-3.5 w-3.5" /> Start Over
          </Button>
        )}
      </div>

      <StepIndicator current={step} />

      {/* ── Step 1: Upload ──────────────────────────────────────────────── */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1">
                <Download className="h-3.5 w-3.5" /> Download Template
              </Button>
              <span className="text-xs text-muted-foreground">
                Use this template as a starting point
              </span>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Select file (CSV or Excel)</Label>
              <Input
                type="file"
                accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm"
                onChange={handleFileSelect}
              />
              {fileName && (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-mono font-medium">{fileName}</span>
                  {!isExcel && fileContent && (
                    <span>
                      {" "}
                      — {fileContent.split("\n").filter((l) => l.trim()).length - 1} data rows
                    </span>
                  )}
                  {isExcel && fileBase64 && (
                    <span> — Excel file ({Math.round((fileBase64.length * 0.75) / 1024)} KB)</span>
                  )}
                </p>
              )}
            </div>

            {/* Sheet picker for Excel files */}
            {isExcel && sheetNames.length > 1 && (
              <div className="space-y-1.5">
                <Label>Select sheet</Label>
                <Select value={sheetName} onValueChange={setSheetName}>
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Choose a sheet…" />
                  </SelectTrigger>
                  <SelectContent>
                    {sheetNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Expected format */}
            <div className="rounded-md bg-muted/50 p-3">
              <p className="text-xs font-medium mb-1.5">Expected CSV columns:</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "code *",
                  "name *",
                  "type *",
                  "normalBalance",
                  "allowPosting",
                  "parentCode",
                  "level",
                  "usaliCategory",
                  "usaliDepartment"
                ].map((col) => (
                  <span
                    key={col}
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono ${col.includes("*") ? "bg-primary/10 font-semibold" : "bg-muted"}`}
                  >
                    {col}
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Type: ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE — Header names are flexible
                (e.g. &quot;Account Code&quot;, &quot;Acct Name&quot;, &quot;GL Code&quot; all
                work).
              </p>
            </div>

            {previewError && (
              <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                {previewError}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                onClick={() => previewMutation.mutate()}
                disabled={
                  !hasFile ||
                  !apiContext ||
                  previewMutation.isPending ||
                  (isExcel && sheetNames.length > 1 && !sheetName)
                }
                className="gap-1"
              >
                {previewMutation.isPending ? (
                  "Parsing…"
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" /> Preview Import
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Preview ─────────────────────────────────────────────── */}
      {step === 2 && preview && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Total Rows</p>
              <p className="text-xl font-bold mt-0.5">{preview.totalRows}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">New Accounts</p>
              <p className="text-xl font-bold mt-0.5 text-emerald-700">{preview.newAccounts}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Updates</p>
              <p className="text-xl font-bold mt-0.5 text-blue-700">{preview.existingAccounts}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted-foreground">Errors</p>
              <p
                className={`text-xl font-bold mt-0.5 ${preview.errorRows > 0 ? "text-destructive" : ""}`}
              >
                {preview.errorRows}
              </p>
            </Card>
          </div>

          {/* Error list */}
          {preview.errors.length > 0 && (
            <Card className="border-destructive/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" /> Validation Errors ({preview.errors.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="max-h-32 overflow-y-auto space-y-0.5 text-xs">
                  {preview.errors.slice(0, 20).map((e, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="text-muted-foreground shrink-0">Row {e.row}:</span>
                      <span>
                        {e.column && (
                          <span className="font-mono text-muted-foreground">{e.column} — </span>
                        )}
                        {e.message}
                      </span>
                    </div>
                  ))}
                  {preview.errors.length > 20 && (
                    <p className="text-muted-foreground">…and {preview.errors.length - 20} more</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Preview table */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Account Preview</CardTitle>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by code, name, type…"
                className="max-w-xs"
              />
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs w-12">#</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Code</TableHead>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Bal</TableHead>
                      <TableHead className="text-xs">Lvl</TableHead>
                      <TableHead className="text-xs">Parent</TableHead>
                      <TableHead className="text-xs">Post?</TableHead>
                      <TableHead className="text-xs">Issues</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                          No rows to show
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredRows.map((row) => (
                        <TableRow
                          key={row.rowNumber}
                          className={
                            row.status === "error"
                              ? "bg-destructive/5"
                              : row.status === "new"
                                ? "bg-emerald-50/50"
                                : ""
                          }
                        >
                          <TableCell className="text-xs text-muted-foreground">
                            {row.rowNumber}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={row.status} />
                          </TableCell>
                          <TableCell className="font-mono text-xs font-medium">
                            {row.code}
                          </TableCell>
                          <TableCell className="text-sm">{row.name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.type}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.normalBalance === "DEBIT" ? "DR" : "CR"}
                          </TableCell>
                          <TableCell className="text-xs text-center">{row.level}</TableCell>
                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {row.parentCode || "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {row.allowPosting ? "Yes" : "No"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {row.issues.length > 0 && (
                              <span className="text-amber-700" title={row.issues.join("\n")}>
                                <AlertTriangle className="h-3 w-3 inline mr-0.5" />
                                {row.issues.length}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Import options + execute */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm font-medium">Import Options</p>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={updateExisting}
                    onChange={(e) => setUpdateExisting(e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                  Update existing accounts
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={reactivateInactive}
                    onChange={(e) => setReactivateInactive(e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                  Reactivate inactive accounts
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={skipErrors}
                    onChange={(e) => setSkipErrors(e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                  Skip error rows (don't abort)
                </label>
              </div>

              {previewError && (
                <p className="text-sm text-destructive rounded border border-destructive/30 bg-destructive/10 px-3 py-2">
                  {previewError}
                </p>
              )}

              <div className="flex justify-between items-center pt-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button
                  onClick={() => executeMutation.mutate()}
                  disabled={!apiContext || executeMutation.isPending || preview.validRows === 0}
                  className="gap-1"
                >
                  {executeMutation.isPending ? (
                    "Importing…"
                  ) : (
                    <>
                      <CheckCircle className="h-3.5 w-3.5" /> Import {preview.validRows} Account
                      {preview.validRows !== 1 ? "s" : ""}
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Step 3: Result ──────────────────────────────────────────────── */}
      {step === 3 && importResult && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" /> Import Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md bg-emerald-50 px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-2xl font-bold text-emerald-700">{importResult.created}</p>
              </div>
              <div className="rounded-md bg-blue-50 px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground">Updated</p>
                <p className="text-2xl font-bold text-blue-700">{importResult.updated}</p>
              </div>
              <div className="rounded-md bg-muted/50 px-4 py-3 text-center">
                <p className="text-xs text-muted-foreground">Skipped</p>
                <p className="text-2xl font-bold text-muted-foreground">{importResult.skipped}</p>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <>
                <Separator />
                <div>
                  <p className="text-sm font-medium text-destructive mb-2 flex items-center gap-1.5">
                    <XCircle className="h-4 w-4" /> {importResult.errors.length} Error
                    {importResult.errors.length !== 1 ? "s" : ""}
                  </p>
                  <div className="max-h-32 overflow-y-auto space-y-0.5 text-xs">
                    {importResult.errors.map((e, i) => (
                      <div key={i} className="flex gap-2">
                        <span className="text-muted-foreground shrink-0">Row {e.row}:</span>
                        <span>{e.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <Separator />
            <div className="flex gap-2">
              <Button variant="outline" onClick={reset} className="gap-1">
                <RefreshCw className="h-3.5 w-3.5" /> Import Another File
              </Button>
              <Button
                variant="outline"
                onClick={() => (window.location.href = "/gl/accounts")}
                className="gap-1"
              >
                View Chart of Accounts
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
