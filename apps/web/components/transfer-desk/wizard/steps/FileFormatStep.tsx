"use client";

/**
 * Step 2 — File Format Definition (FSD)
 *
 * Only shown for IMPORT and EXPORT profile types.
 *
 * Two tabs:
 * - "Upload Sample": drag-and-drop upload → /fsd/auto-detect → preview + schema editor
 * - "Define Manually": format type selector → field editor grid
 *
 * Both tabs share the SchemaEditor component for editing fields.
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useApiContext } from "../../../use-api-context";
import { autoDetectFormat } from "../../../../lib/transfer-desk/api";
import { FORMAT_TYPES } from "../../../../lib/transfer-desk/constants";
import type { FormatType, FormatDetectionResult } from "../../../../lib/transfer-desk/types";
import type { Step2FormData } from "../../../../lib/transfer-desk/validation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../ui/table";
import { Badge } from "../../../ui/badge";
import { FileUploadZone } from "../shared/FileUploadZone";
import { SchemaEditor } from "../shared/SchemaEditor";
import { FileSpreadsheet, PenLine, Loader2 } from "lucide-react";

type FileFormatStepProps = {
  data: Step2FormData | null;
  onSubmit: (data: Step2FormData) => void;
  onValidChange: (valid: boolean) => void;
};

export function FileFormatStep({ data, onSubmit, onValidChange }: FileFormatStepProps) {
  const apiContext = useApiContext();
  const [activeTab, setActiveTab] = useState<string>("upload");

  // ── Upload tab state ────────────────────────────────────────────────────

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [detection, setDetection] = useState<FormatDetectionResult | null>(null);

  // ── Schema state (shared between tabs) ──────────────────────────────────

  const [formatConfig, setFormatConfig] = useState<Step2FormData["format"]>(
    data?.format ?? { type: "csv" }
  );
  const [fields, setFields] = useState<Step2FormData["fields"]>(data?.fields ?? []);
  const [options] = useState<Step2FormData["options"]>(data?.options);

  // ── Auto-detect mutation ────────────────────────────────────────────────

  const detectMutation = useMutation({
    mutationFn: (file: File) => {
      if (!apiContext) throw new Error("No API context");
      return autoDetectFormat(apiContext, file);
    },
    onSuccess: (result) => {
      const raw = result.data as any;

      // Map API response shape to FormatDetectionResult
      const det = raw.detection ?? raw;
      const schema = raw.proposedSchema;
      const mapped: FormatDetectionResult = {
        confidence: det.confidence ?? 0,
        detectedFormat: det.detectedFormat ?? { type: "csv" },
        suggestedFields:
          schema?.fields ??
          det.detectedFields?.map((f: any) => ({
            name: f.name,
            target: "",
            type: f.suggestedType ?? "string"
          })) ??
          [],
        sampleRows: raw.previewRows ?? []
      };
      setDetection(mapped);

      // Apply detected format to schema state
      const fmt = mapped.detectedFormat;
      setFormatConfig({
        type: fmt.type,
        delimiter: fmt.delimiter,
        quoteChar: fmt.quoteChar,
        escapeChar: fmt.escapeChar,
        encoding: fmt.encoding,
        hasHeaderRow: fmt.hasHeaderRow,
        lineEnding: fmt.lineEnding,
        sheetIndex: fmt.sheetIndex,
        skipRowsBeforeHeader: fmt.skipRowsBeforeHeader,
        xmlRootElement: fmt.xmlRootElement,
        fixedRecordLength: fmt.fixedRecordLength
      });

      // Apply detected fields
      if (mapped.suggestedFields?.length) {
        setFields(
          mapped.suggestedFields.map((f) => ({
            name: f.name,
            target: f.target ?? "",
            type: f.type,
            columnName: f.columnName,
            columnIndex: f.columnIndex,
            fixedStart: f.fixedStart,
            fixedLength: f.fixedLength,
            xmlPath: f.xmlPath,
            dateFormat: f.dateFormat,
            decimalDivisor: f.decimalDivisor,
            precision: f.precision,
            required: f.required,
            defaultValue: f.defaultValue
          }))
        );
      }
    }
  });

  const handleFileSelect = useCallback(
    (file: File) => {
      setUploadedFile(file);
      detectMutation.mutate(file);
    },
    [detectMutation]
  );

  const handleFileClear = useCallback(() => {
    setUploadedFile(null);
    setDetection(null);
  }, []);

  // ── Validate and propagate to parent ────────────────────────────────────

  const isValid = fields.length > 0 && fields.every((f) => f.name.trim() && f.target.trim());

  useEffect(() => {
    onValidChange(isValid);
  }, [isValid, onValidChange]);

  // Propagate changes to parent when fields change
  useEffect(() => {
    if (isValid) {
      onSubmit({ format: formatConfig, fields, options });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isValid, JSON.stringify(formatConfig), JSON.stringify(fields)]);

  // ── File preview table ──────────────────────────────────────────────────

  const sampleRows = detection?.sampleRows ?? [];
  const sampleColumns = sampleRows.length > 0 ? Object.keys(sampleRows[0]) : [];

  return (
    <div className="space-y-5">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="upload" className="gap-1.5">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Upload Sample
          </TabsTrigger>
          <TabsTrigger value="manual" className="gap-1.5">
            <PenLine className="h-3.5 w-3.5" />
            Define Manually
          </TabsTrigger>
        </TabsList>

        {/* ── Upload Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="upload">
          <div className="space-y-5">
            <FileUploadZone
              file={uploadedFile}
              onFileSelect={handleFileSelect}
              onClear={handleFileClear}
              isLoading={detectMutation.isPending}
              error={detectMutation.error?.message ?? null}
            />

            {/* Detection results */}
            {detection && !detectMutation.isPending && (
              <div className="space-y-4">
                {/* Confidence badge */}
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      detection.confidence > 0.8
                        ? "success"
                        : detection.confidence > 0.5
                          ? "warning"
                          : "destructive"
                    }
                    className="text-[10px]"
                  >
                    {Math.round(detection.confidence * 100)}% confidence
                  </Badge>
                  <span className="text-xs text-slate-500">
                    Detected as{" "}
                    <span className="font-medium text-slate-700">
                      {FORMAT_TYPES.find((f) => f.value === formatConfig.type)?.label ??
                        formatConfig.type}
                    </span>
                  </span>
                </div>

                {/* File preview (first 10 rows) */}
                {sampleRows.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      File Preview ({sampleRows.length} rows)
                    </h3>
                    <div className="rounded-lg border border-slate-200 overflow-x-auto max-h-64">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {sampleColumns.map((col) => (
                              <TableHead key={col} className="text-[10px] whitespace-nowrap">
                                {col}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sampleRows.map((row, i) => (
                            <TableRow key={i}>
                              {sampleColumns.map((col) => (
                                <TableCell key={col} className="text-[11px] font-mono py-1.5">
                                  {String(row[col] ?? "")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {/* Schema editor (populated from detection) */}
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Detected Schema — Review & Adjust
                  </h3>
                  <SchemaEditor
                    formatType={formatConfig.type}
                    fields={fields}
                    onFieldsChange={setFields}
                    formatConfig={formatConfig}
                    onFormatConfigChange={setFormatConfig}
                  />
                </div>
              </div>
            )}

            {detectMutation.isPending && (
              <div className="flex items-center justify-center py-8 text-slate-400 gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Analyzing file format...</span>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Manual Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="manual">
          <div className="space-y-5">
            {/* Format type selector */}
            <div className="space-y-1.5 max-w-xs">
              <label className="text-sm font-medium text-slate-700">Format Type</label>
              <Select
                value={formatConfig.type}
                onValueChange={(v) => setFormatConfig({ ...formatConfig, type: v as FormatType })}
              >
                <SelectTrigger className="text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAT_TYPES.map((ft) => (
                    <SelectItem key={ft.value} value={ft.value} className="text-sm">
                      <span>{ft.label}</span>
                      <span className="ml-2 text-[10px] text-slate-400">
                        {ft.extensions.join(", ")}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Schema editor */}
            <SchemaEditor
              formatType={formatConfig.type}
              fields={fields}
              onFieldsChange={setFields}
              formatConfig={formatConfig}
              onFormatConfigChange={setFormatConfig}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Validation summary */}
      {fields.length > 0 && !isValid && (
        <p className="text-xs text-amber-600">
          All fields must have a name and target path to proceed.
        </p>
      )}
    </div>
  );
}
