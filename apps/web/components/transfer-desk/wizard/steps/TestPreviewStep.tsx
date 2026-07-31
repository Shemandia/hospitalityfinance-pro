"use client";

/**
 * Step 5 — Test & Preview
 *
 * Upload a test file (or reuse sample from Step 2), run a dry-run test
 * via POST /transfer-desk/profiles/:profileId/test, stream progress via SSE,
 * then display results in 4 tabbed views.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApiContext } from "../../../../components/use-api-context";
import { startTest } from "../../../../lib/transfer-desk/api";
import { useTestStream } from "../../../../lib/transfer-desk/hooks/useTestStream";
import type { TestResults } from "../../../../lib/transfer-desk/types";
import { FileUploadZone } from "../shared/FileUploadZone";
import { ProgressStream } from "../shared/ProgressStream";
import { ParsePreview } from "../shared/ParsePreview";
import { JournalPreview } from "../shared/JournalPreview";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../../../ui/tabs";
import { Button } from "../../../ui/button";
import { Badge } from "../../../ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../ui/table";
import {
  Play,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  FileText,
  ArrowRightLeft,
  ShieldAlert,
  BookOpen
} from "lucide-react";

type TestPreviewStepProps = {
  profileId?: string;
  /** Sample file from Step 2 (if available) */
  sampleFile?: File | null;
  onValidChange: (valid: boolean) => void;
};

export function TestPreviewStep({ profileId, sampleFile, onValidChange }: TestPreviewStepProps) {
  const apiContext = useApiContext();
  const stream = useTestStream();
  const [testFile, setTestFile] = useState<File | null>(sampleFile ?? null);
  const [testError, setTestError] = useState<string | null>(null);

  // Mark step valid once test completes successfully
  useEffect(() => {
    const isComplete = stream.status === "complete" && stream.results !== null;
    onValidChange(isComplete);
    if (isComplete) {
      const s = stream.results!.summary;
      if (s.errorRows > 0) {
        toast.warning("Test completed with errors", {
          description: `${s.errorRows} of ${s.totalRows} rows had errors`
        });
      } else {
        toast.success("Test completed", {
          description: `${s.validRows} rows passed validation`
        });
      }
    }
    if (stream.status === "error") {
      toast.error("Test failed", { description: stream.error ?? "Unknown error" });
    }
  }, [stream.status, stream.results, stream.error, onValidChange]);

  // Start test mutation
  const startMutation = useMutation({
    mutationFn: async () => {
      if (!apiContext) throw new Error("No API context");
      if (!profileId) throw new Error("Profile must be saved before testing");
      if (!testFile) throw new Error("Please select a test file");
      return startTest(apiContext, profileId, testFile);
    },
    onSuccess: (result) => {
      if (apiContext && profileId) {
        stream.start(profileId, result.data.testId, apiContext);
      }
    },
    onError: (err: Error) => {
      setTestError(err.message);
    }
  });

  const handleRunTest = useCallback(() => {
    setTestError(null);
    stream.reset();
    startMutation.mutate();
  }, [startMutation, stream]);

  const handleClearFile = useCallback(() => {
    setTestFile(null);
    stream.reset();
    setTestError(null);
  }, [stream]);

  const results = stream.results;
  const canRun =
    Boolean(testFile) &&
    Boolean(profileId) &&
    !startMutation.isPending &&
    stream.status !== "streaming";

  return (
    <div className="space-y-6">
      {/* File selection */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Test File</h3>
        <FileUploadZone
          file={testFile}
          onFileSelect={setTestFile}
          onClear={handleClearFile}
          isLoading={startMutation.isPending}
          error={testError}
        />
        {sampleFile && !testFile && (
          <button
            type="button"
            className="mt-2 text-xs text-emerald-600 hover:text-emerald-700 underline"
            onClick={() => setTestFile(sampleFile)}
          >
            Use sample file from Step 2
          </button>
        )}
      </div>

      {/* Run button */}
      <div className="flex items-center gap-3">
        <Button
          variant="teal"
          size="sm"
          onClick={handleRunTest}
          disabled={!canRun}
          className="gap-1.5"
        >
          <Play className="h-3.5 w-3.5" /> Run Test
        </Button>
        {!profileId && (
          <p className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Save the profile as draft before running a test.
          </p>
        )}
      </div>

      {/* Progress */}
      <ProgressStream status={stream.status} progress={stream.progress} error={stream.error} />

      {/* Summary banner */}
      {stream.summary && (
        <SummaryBanner
          totalRows={stream.summary.totalRows}
          validRows={stream.summary.validRows}
          errorRows={stream.summary.errorRows}
          warnings={stream.summary.warnings}
        />
      )}

      {/* Results tabs */}
      {results && <ResultsTabs results={results} />}
    </div>
  );
}

// ── Summary Banner ─────────────────────────────────────────────────────────────

function SummaryBanner({
  totalRows,
  validRows,
  errorRows,
  warnings
}: {
  totalRows: number;
  validRows: number;
  errorRows: number;
  warnings: number;
}) {
  return (
    <div className="grid grid-cols-4 gap-3">
      <StatCard label="Total Rows" value={totalRows} />
      <StatCard label="Valid" value={validRows} color="emerald" />
      <StatCard label="Errors" value={errorRows} color={errorRows > 0 ? "red" : "emerald"} />
      <StatCard label="Warnings" value={warnings} color={warnings > 0 ? "amber" : "emerald"} />
    </div>
  );
}

function StatCard({
  label,
  value,
  color
}: {
  label: string;
  value: number;
  color?: "emerald" | "red" | "amber";
}) {
  const colorClasses = {
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-200",
    red: "text-red-700 bg-red-50 border-red-200",
    amber: "text-amber-700 bg-amber-50 border-amber-200"
  };
  const cls = color ? colorClasses[color] : "text-slate-700 bg-slate-50 border-slate-200";
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${cls}`}>
      <p className="text-lg font-bold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-[10px] font-medium uppercase tracking-wider">{label}</p>
    </div>
  );
}

// ── Results Tabs ───────────────────────────────────────────────────────────────

function ResultsTabs({ results }: { results: TestResults }) {
  const [highlightedRow, setHighlightedRow] = useState<number | null>(null);

  const errorRowIndices = useMemo(
    () => new Set(results.validationErrors.map((e) => e.rowIndex)),
    [results.validationErrors]
  );

  return (
    <Tabs defaultValue="parsed" className="space-y-3">
      <TabsList className="grid grid-cols-4 w-full">
        <TabsTrigger value="parsed" className="gap-1.5 text-xs">
          <FileText className="h-3.5 w-3.5" /> Parsed Data
        </TabsTrigger>
        <TabsTrigger value="mapped" className="gap-1.5 text-xs">
          <ArrowRightLeft className="h-3.5 w-3.5" /> Mapped Output
        </TabsTrigger>
        <TabsTrigger value="validation" className="gap-1.5 text-xs">
          <ShieldAlert className="h-3.5 w-3.5" /> Validation
          {results.validationErrors.length > 0 && (
            <Badge variant="destructive" className="text-[8px] px-1 py-0 ml-1">
              {results.validationErrors.length}
            </Badge>
          )}
        </TabsTrigger>
        <TabsTrigger value="journal" className="gap-1.5 text-xs">
          <BookOpen className="h-3.5 w-3.5" /> Journal
        </TabsTrigger>
      </TabsList>

      {/* Tab 1: Parsed Data */}
      <TabsContent value="parsed">
        <ParsePreview rows={results.parsedRows} errorRowIndices={errorRowIndices} />
      </TabsContent>

      {/* Tab 2: Mapped Output */}
      <TabsContent value="mapped">
        <ParsePreview rows={results.mappedRows} />
      </TabsContent>

      {/* Tab 3: Validation Report */}
      <TabsContent value="validation">
        <ValidationReport
          errors={results.validationErrors}
          highlightedRow={highlightedRow}
          onRowClick={setHighlightedRow}
        />
      </TabsContent>

      {/* Tab 4: Journal Preview */}
      <TabsContent value="journal">
        <JournalPreview entries={results.journalPreview} />
      </TabsContent>
    </Tabs>
  );
}

// ── Validation Report ──────────────────────────────────────────────────────────

function ValidationReport({
  errors,
  highlightedRow,
  onRowClick
}: {
  errors: TestResults["validationErrors"];
  highlightedRow: number | null;
  onRowClick: (row: number | null) => void;
}) {
  if (errors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-500 mb-2" />
        <p className="text-sm font-medium text-emerald-700">All rows passed validation</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Badge variant="outline" className="text-[10px]">
        {errors.length} issue{errors.length !== 1 ? "s" : ""}
      </Badge>
      <div className="rounded-lg border border-slate-200 overflow-auto max-h-[420px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 text-[10px]">Row</TableHead>
              <TableHead className="text-[11px]">Field</TableHead>
              <TableHead className="text-[11px]">Error</TableHead>
              <TableHead className="text-[11px]">Value</TableHead>
              <TableHead className="w-16 text-[11px]">Severity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {errors.map((err, idx) => {
              const isError = err.errorCode.startsWith("ERR");
              const isHighlighted = highlightedRow === err.rowIndex;
              return (
                <TableRow
                  key={idx}
                  className={`cursor-pointer ${
                    isHighlighted
                      ? "bg-amber-50 ring-1 ring-inset ring-amber-300"
                      : "hover:bg-slate-50"
                  }`}
                  onClick={() => onRowClick(isHighlighted ? null : err.rowIndex)}
                >
                  <TableCell className="text-xs tabular-nums font-mono">
                    {err.rowIndex + 1}
                  </TableCell>
                  <TableCell className="text-xs font-mono">{err.fieldName}</TableCell>
                  <TableCell className="text-xs">{err.message}</TableCell>
                  <TableCell className="text-xs font-mono max-w-[120px] truncate">
                    {err.rawValue == null ? (
                      <span className="text-slate-300 italic">null</span>
                    ) : (
                      String(err.rawValue)
                    )}
                  </TableCell>
                  <TableCell>
                    {isError ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-red-600">
                        <AlertCircle className="h-3 w-3" /> Error
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                        <AlertTriangle className="h-3 w-3" /> Warn
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
