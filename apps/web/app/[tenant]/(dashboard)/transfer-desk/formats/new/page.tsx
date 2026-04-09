"use client";

/**
 * Transfer Desk — Format Creation Wizard
 *
 * 3-step wizard following the "sample-file-first" principle:
 *   Step 1: Upload sample file → auto-detect format
 *   Step 2: Edit detected fields (name, type, required, lengths)
 *   Step 3: Name, review FSD JSON, save
 */

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { useTenantHref, useTenantRouter } from "../../../../../../hooks/use-tenant-router";
import { useApiContext } from "../../../../../../components/use-api-context";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../components/ui/card";
import { Button } from "../../../../../../components/ui/button";
import { Input } from "../../../../../../components/ui/input";
import { Label } from "../../../../../../components/ui/label";
import { Badge } from "../../../../../../components/ui/badge";
import { Checkbox } from "../../../../../../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../../components/ui/table";
import {
  ArrowLeft,
  ArrowRight,
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Plus,
  Save
} from "lucide-react";
import {
  detectFormatFromFile,
  createTransferFormat,
  type DetectedField,
  type DetectionResult,
  type FormatClassification
} from "../../../../../../lib/gl-api";

// ── Types ────────────────────────────────────────────────────────────────────

type EditableField = DetectedField & { id: number };

type WizardState = {
  step: 1 | 2 | 3;
  // Step 1
  fileContent: string | null;
  fileName: string | null;
  detection: DetectionResult | null;
  detecting: boolean;
  // Step 2
  fields: EditableField[];
  classification: FormatClassification;
  delimiter: string;
  recordSep: string;
  hasHeaders: boolean;
  initialLinesToIgnore: number;
  // Step 3
  formatName: string;
  description: string;
};

const FIELD_TYPES = [
  { value: "string", label: "String" },
  { value: "integer", label: "Integer" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" }
] as const;

const DELIMITER_OPTIONS = [
  { value: ",", label: "Comma (,)" },
  { value: "\t", label: "Tab" },
  { value: ";", label: "Semicolon (;)" },
  { value: "|", label: "Pipe (|)" }
] as const;

let nextFieldId = 1;

function makeFieldId(): number {
  return nextFieldId++;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function FormatCreationWizard() {
  const apiCtx = useApiContext();
  const href = useTenantHref();
  const router = useTenantRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [state, setState] = useState<WizardState>({
    step: 1,
    fileContent: null,
    fileName: null,
    detection: null,
    detecting: false,
    fields: [],
    classification: "DELIMITED",
    delimiter: ",",
    recordSep: "\n",
    hasHeaders: false,
    initialLinesToIgnore: 0,
    formatName: "",
    description: ""
  });

  // ── Step navigation ─────────────────────────────────────────────────────

  const goStep = useCallback((step: 1 | 2 | 3) => setState((s) => ({ ...s, step })), []);

  // ── Step 1: File upload + detection ─────────────────────────────────────

  const handleFileSelect = useCallback(
    async (file: File) => {
      const text = await file.text();
      setState((s) => ({
        ...s,
        fileContent: text,
        fileName: file.name,
        detecting: true
      }));

      try {
        const result = await detectFormatFromFile(apiCtx, text);
        const detected = result.data;
        setState((s) => ({
          ...s,
          detecting: false,
          detection: detected,
          fields: detected.fields.map((f) => ({ ...f, id: makeFieldId() })),
          classification: detected.classification,
          delimiter: detected.delimiter ?? ",",
          recordSep: detected.recordSep,
          hasHeaders: detected.hasHeaders,
          initialLinesToIgnore: detected.hasHeaders ? 1 : 0
        }));
      } catch {
        setState((s) => ({ ...s, detecting: false }));
      }
    },
    [apiCtx]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const skipDetection = useCallback(() => {
    setState((s) => ({
      ...s,
      step: 2,
      fields: [
        {
          id: makeFieldId(),
          name: "field1",
          type: "string",
          required: false,
          maxLength: 128,
          minLength: 0,
          sampleValues: []
        }
      ]
    }));
  }, []);

  // ── Step 2: Field editing ───────────────────────────────────────────────

  const updateField = useCallback((id: number, key: keyof EditableField, value: unknown) => {
    setState((s) => ({
      ...s,
      fields: s.fields.map((f) => (f.id === id ? { ...f, [key]: value } : f))
    }));
  }, []);

  const removeField = useCallback((id: number) => {
    setState((s) => ({
      ...s,
      fields: s.fields.filter((f) => f.id !== id)
    }));
  }, []);

  const addField = useCallback(() => {
    setState((s) => ({
      ...s,
      fields: [
        ...s.fields,
        {
          id: makeFieldId(),
          name: `field${s.fields.length + 1}`,
          type: "string" as const,
          required: false,
          maxLength: 128,
          minLength: 0,
          sampleValues: []
        }
      ]
    }));
  }, []);

  // ── Step 3: Build FSD JSON + save ───────────────────────────────────────

  const buildFsdJson = useCallback((): string => {
    const schema: Record<string, unknown> = {
      classification: state.classification,
      encoding: state.detection?.encoding ?? "UTF-8"
    };

    if (state.classification === "DELIMITED") {
      schema.fieldSep = state.delimiter;
      schema.recordSep = state.recordSep;
      if (state.initialLinesToIgnore > 0) {
        schema.initialLinesToIgnore = state.initialLinesToIgnore;
      }
    }

    if (state.classification === "SIMPLE_XML" && state.detection?.suggestedSchema) {
      const suggested = state.detection.suggestedSchema as Record<string, unknown>;
      schema.xmlRoot = suggested.xmlRoot;
    }

    if (state.classification === "SINGLE_FIXED") {
      schema.recordSep = state.recordSep;
      if (state.initialLinesToIgnore > 0) {
        schema.initialLinesToIgnore = state.initialLinesToIgnore;
      }
    }

    schema.record = {
      name: "record",
      fields: state.fields.map((f) => {
        const field: Record<string, unknown> = {
          name: f.name,
          type: f.type
        };
        if (f.required) field.required = true;
        if (f.maxLength && f.maxLength !== 128) field.maxLength = f.maxLength;
        if (f.minLength && f.minLength > 0) field.minLength = f.minLength;
        if (state.classification === "SINGLE_FIXED" && f.startPos !== undefined) {
          field.maxLength = f.length ?? f.maxLength;
          field.minLength = f.length ?? f.minLength;
        }
        return field;
      })
    };

    return JSON.stringify(schema, null, 2);
  }, [state]);

  const createMutation = useMutation({
    mutationFn: () =>
      createTransferFormat(apiCtx, {
        name: state.formatName.trim(),
        description: state.description.trim() || undefined,
        classification: state.classification,
        fsdXml: buildFsdJson()
      }),
    onSuccess: (result) => {
      router.push(`/transfer-desk/formats/${result.data.id}`);
    }
  });

  // ── Confidence indicator ────────────────────────────────────────────────

  function ConfidenceBadge({ confidence }: { confidence: number }) {
    if (confidence >= 70) {
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
          <CheckCircle2 className="mr-1 h-3 w-3" /> {confidence}% confidence
        </Badge>
      );
    }
    if (confidence >= 40) {
      return (
        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
          <AlertTriangle className="mr-1 h-3 w-3" /> {confidence}% confidence
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
        <AlertTriangle className="mr-1 h-3 w-3" /> {confidence}% confidence
      </Badge>
    );
  }

  // ── Step indicator ──────────────────────────────────────────────────────

  const steps = [
    { num: 1 as const, label: "Upload & Detect" },
    { num: 2 as const, label: "Edit Fields" },
    { num: 3 as const, label: "Name & Save" }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href={href("/transfer-desk/formats")}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create Format Definition</h1>
          <p className="text-sm text-muted-foreground">
            Upload a sample file to auto-detect the format structure
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <nav className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.num} className="flex items-center">
            {i > 0 && <div className="mx-2 h-px w-8 bg-border" />}
            <button
              onClick={() => {
                if (s.num < state.step) goStep(s.num);
              }}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                s.num === state.step
                  ? "bg-primary text-primary-foreground"
                  : s.num < state.step
                    ? "bg-muted text-foreground cursor-pointer hover:bg-muted/80"
                    : "bg-muted/50 text-muted-foreground cursor-default"
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-background/20 text-xs">
                {s.num}
              </span>
              {s.label}
            </button>
          </div>
        ))}
      </nav>

      {/* ── Step 1: Upload & Detect ──────────────────────────────────────── */}
      {state.step === 1 && (
        <div className="space-y-6">
          {/* Drop zone */}
          <Card>
            <CardContent className="p-8">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 py-12 transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileInput}
                  accept=".csv,.tsv,.txt,.xml,.dat"
                />
                {state.detecting ? (
                  <>
                    <Loader2 className="mb-3 h-10 w-10 animate-spin text-primary" />
                    <p className="text-sm font-medium">Analyzing file structure...</p>
                  </>
                ) : state.fileName ? (
                  <>
                    <FileText className="mb-3 h-10 w-10 text-primary" />
                    <p className="text-sm font-medium">{state.fileName}</p>
                    <p className="text-xs text-muted-foreground">Click or drop to replace</p>
                  </>
                ) : (
                  <>
                    <Upload className="mb-3 h-10 w-10 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      Drop a sample file here or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground">
                      CSV, TSV, TXT, XML, DAT — max 10 MB
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Detection results */}
          {state.detection && !state.detecting && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Detection Results</CardTitle>
                  <ConfidenceBadge confidence={state.detection.confidence} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Classification</p>
                    <p className="font-medium">{state.detection.classification}</p>
                  </div>
                  {state.detection.delimiter && (
                    <div>
                      <p className="text-xs text-muted-foreground">Delimiter</p>
                      <p className="font-medium">
                        {state.detection.delimiter === "\t"
                          ? "Tab"
                          : state.detection.delimiter === ","
                            ? "Comma"
                            : state.detection.delimiter === ";"
                              ? "Semicolon"
                              : state.detection.delimiter === "|"
                                ? "Pipe"
                                : state.detection.delimiter}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Encoding</p>
                    <p className="font-medium">{state.detection.encoding}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Fields</p>
                    <p className="font-medium">{state.detection.fields.length}</p>
                  </div>
                </div>

                {/* Preview table */}
                {state.detection.previewRows.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Preview (first {state.detection.previewRows.length} rows)
                    </p>
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {state.detection.fields.map((f) => (
                              <TableHead key={f.name} className="text-xs">
                                {f.name}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {state.detection.previewRows.slice(0, 5).map((row, i) => (
                            <TableRow key={i}>
                              {state.detection!.fields.map((f) => (
                                <TableCell key={f.name} className="text-xs">
                                  {row[f.name] ?? ""}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={skipDetection}
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Skip detection — create manually
            </button>
            <Button
              onClick={() => goStep(2)}
              disabled={!state.detection && state.fields.length === 0}
            >
              Next: Edit Fields
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 2: Edit Fields ──────────────────────────────────────────── */}
      {state.step === 2 && (
        <div className="space-y-6">
          {/* General settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">General Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <Label className="text-xs">Classification</Label>
                  <Select
                    value={state.classification}
                    onValueChange={(v) =>
                      setState((s) => ({ ...s, classification: v as FormatClassification }))
                    }
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DELIMITED">Delimited</SelectItem>
                      <SelectItem value="SINGLE_FIXED">Fixed Width</SelectItem>
                      <SelectItem value="SIMPLE_XML">Simple XML</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {state.classification === "DELIMITED" && (
                  <div>
                    <Label className="text-xs">Field Separator</Label>
                    <Select
                      value={state.delimiter}
                      onValueChange={(v) => setState((s) => ({ ...s, delimiter: v }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DELIMITER_OPTIONS.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div>
                  <Label className="text-xs">Record Separator</Label>
                  <Select
                    value={state.recordSep}
                    onValueChange={(v) => setState((s) => ({ ...s, recordSep: v }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={"\r\n"}>Windows (\r\n)</SelectItem>
                      <SelectItem value={"\n"}>Unix (\n)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Initial Lines to Ignore</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    className="mt-1"
                    value={state.initialLinesToIgnore}
                    onChange={(e) =>
                      setState((s) => ({
                        ...s,
                        initialLinesToIgnore: parseInt(e.target.value) || 0
                      }))
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Fields table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Fields ({state.fields.length})</CardTitle>
                <Button variant="outline" size="sm" onClick={addField}>
                  <Plus className="mr-1 h-3 w-3" /> Add Field
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">#</TableHead>
                      <TableHead>Field Name</TableHead>
                      <TableHead className="w-[120px]">Type</TableHead>
                      <TableHead className="w-[70px] text-center">Required</TableHead>
                      <TableHead className="w-[90px]">Max Length</TableHead>
                      <TableHead className="w-[90px]">Min Length</TableHead>
                      <TableHead className="w-[200px]">Sample Values</TableHead>
                      <TableHead className="w-[50px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.fields.map((field, idx) => (
                      <TableRow key={field.id}>
                        <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell>
                          <Input
                            value={field.name}
                            onChange={(e) => updateField(field.id, "name", e.target.value)}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={field.type}
                            onValueChange={(v) => updateField(field.id, "type", v)}
                          >
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={field.required}
                            onCheckedChange={(v) => updateField(field.id, "required", !!v)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            value={field.maxLength}
                            onChange={(e) =>
                              updateField(field.id, "maxLength", parseInt(e.target.value) || 0)
                            }
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            value={field.minLength}
                            onChange={(e) =>
                              updateField(field.id, "minLength", parseInt(e.target.value) || 0)
                            }
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {field.sampleValues.slice(0, 3).join(", ") || "—"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => removeField(field.id)}
                            disabled={state.fields.length <= 1}
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => goStep(1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <Button onClick={() => goStep(3)} disabled={state.fields.length === 0}>
              Next: Name & Save
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Name & Save ──────────────────────────────────────────── */}
      {state.step === 3 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Format Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Format Name *</Label>
                <Input
                  className="mt-1"
                  placeholder="e.g. Jana Purchasing Voucher"
                  value={state.formatName}
                  onChange={(e) => setState((s) => ({ ...s, formatName: e.target.value }))}
                />
              </div>
              <div>
                <Label>Description</Label>
                <textarea
                  className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  rows={3}
                  placeholder="Optional description of this format"
                  value={state.description}
                  onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
                />
              </div>
            </CardContent>
          </Card>

          {/* FSD JSON preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">FSD Schema Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <textarea
                readOnly
                className="w-full rounded-md border border-input bg-muted/30 p-3 font-mono text-xs"
                rows={Math.min(20, buildFsdJson().split("\n").length + 1)}
                value={buildFsdJson()}
              />
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Classification</dt>
                  <dd className="font-medium">{state.classification}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Fields</dt>
                  <dd className="font-medium">{state.fields.length}</dd>
                </div>
                {state.classification === "DELIMITED" && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Delimiter</dt>
                    <dd className="font-medium">
                      {state.delimiter === "\t"
                        ? "Tab"
                        : state.delimiter === ","
                          ? "Comma"
                          : state.delimiter === ";"
                            ? "Semicolon"
                            : state.delimiter}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">Source File</dt>
                  <dd className="font-medium">{state.fileName ?? "Manual"}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Error */}
          {createMutation.error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {(createMutation.error as Error).message}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => goStep(2)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                !state.formatName.trim() || state.fields.length === 0 || createMutation.isPending
              }
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" /> Create Format
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
