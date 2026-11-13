"use client";

/**
 * Transfer Desk — Format Detail / Edit page
 *
 * Dual-tab editor:
 *   - GUI tab: editable field table + general settings
 *   - Code tab: raw FSD JSON textarea (read-write for power users)
 *
 * System formats are read-only with a banner suggesting "clone to modify".
 */

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTenantHref } from "../../../../../../../hooks/use-tenant-router";
import { useApiContext } from "../../../../../../../components/use-api-context";
import { usePermissions } from "../../../../../../../components/use-permissions";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../../../components/ui/card";
import { Button } from "../../../../../../../components/ui/button";
import { Input } from "../../../../../../../components/ui/input";
import { Label } from "../../../../../../../components/ui/label";
import { Badge } from "../../../../../../../components/ui/badge";
import { Checkbox } from "../../../../../../../components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../../../../../../components/ui/table";
import {
  ArrowLeft,
  Save,
  Loader2,
  Lock,
  CheckCircle2,
  XCircle,
  Code2,
  LayoutGrid,
  Plus,
  Trash2,
  AlertTriangle
} from "lucide-react";
import {
  getTransferFormat,
  updateTransferFormat,
  type TransferFormatDetail,
  type FormatClassification
} from "../../../../../../../lib/gl-api";

// ── Types ────────────────────────────────────────────────────────────────────

type FsdField = {
  name: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  minLength?: number;
};

type ParsedSchema = {
  classification: string;
  fieldSep?: string;
  recordSep?: string;
  initialLinesToIgnore?: number;
  encoding?: string;
  xmlRoot?: string;
  record?: {
    name: string;
    fields: FsdField[];
  };
};

const FIELD_TYPES = [
  { value: "string", label: "String" },
  { value: "integer", label: "Integer" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Boolean" }
];

const DELIMITER_OPTIONS = [
  { value: ",", label: "Comma (,)" },
  { value: "\t", label: "Tab" },
  { value: ";", label: "Semicolon (;)" },
  { value: "|", label: "Pipe (|)" }
];

// ── Component ───────────────────────────────────────────────────────────────

export default function FormatDetailPage() {
  const params = useParams();
  const formatId = params.id as string;
  const apiCtx = useApiContext();
  const href = useTenantHref();
  const { canTransferDeskDesigner } = usePermissions();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"gui" | "code">("gui");
  const [codeValue, setCodeValue] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [schema, setSchema] = useState<ParsedSchema | null>(null);
  const [dirty, setDirty] = useState(false);
  const [formatName, setFormatName] = useState("");
  const [description, setDescription] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["transfer-format", formatId],
    queryFn: () => getTransferFormat(apiCtx!, formatId)
  });

  const format = data?.data;

  // Sync state from loaded format
  useEffect(() => {
    if (!format) return;
    setFormatName(format.name);
    setDescription(format.description ?? "");
    setCodeValue(format.fsdXml);
    try {
      const parsed = JSON.parse(format.fsdXml) as ParsedSchema;
      setSchema(parsed);
    } catch {
      setSchema(null);
    }
  }, [format]);

  const isReadOnly = !canTransferDeskDesigner || (format?.isSystem ?? false);

  // ── GUI → Code sync ─────────────────────────────────────────────────────

  const syncCodeFromSchema = useCallback((s: ParsedSchema) => {
    const json = JSON.stringify(s, null, 2);
    setCodeValue(json);
    setCodeError(null);
  }, []);

  // ── Code → GUI sync ─────────────────────────────────────────────────────

  const handleCodeChange = useCallback((value: string) => {
    setCodeValue(value);
    setDirty(true);
    try {
      const parsed = JSON.parse(value) as ParsedSchema;
      setSchema(parsed);
      setCodeError(null);
    } catch (e) {
      setCodeError((e as Error).message);
    }
  }, []);

  // ── Field editing ─────────────────────────────────────────────────────────

  const updateField = useCallback(
    (idx: number, key: string, value: unknown) => {
      if (!schema?.record) return;
      const newFields = [...schema.record.fields];
      newFields[idx] = { ...newFields[idx]!, [key]: value };
      const newSchema = {
        ...schema,
        record: { ...schema.record, fields: newFields }
      };
      setSchema(newSchema);
      syncCodeFromSchema(newSchema);
      setDirty(true);
    },
    [schema, syncCodeFromSchema]
  );

  const addField = useCallback(() => {
    if (!schema?.record) return;
    const newSchema = {
      ...schema,
      record: {
        ...schema.record,
        fields: [
          ...schema.record.fields,
          {
            name: `field${schema.record.fields.length + 1}`,
            type: "string",
            required: false,
            maxLength: 128,
            minLength: 0
          }
        ]
      }
    };
    setSchema(newSchema);
    syncCodeFromSchema(newSchema);
    setDirty(true);
  }, [schema, syncCodeFromSchema]);

  const removeField = useCallback(
    (idx: number) => {
      if (!schema?.record || schema.record.fields.length <= 1) return;
      const newFields = schema.record.fields.filter((_, i) => i !== idx);
      const newSchema = {
        ...schema,
        record: { ...schema.record, fields: newFields }
      };
      setSchema(newSchema);
      syncCodeFromSchema(newSchema);
      setDirty(true);
    },
    [schema, syncCodeFromSchema]
  );

  const updateSchemaProp = useCallback(
    (key: string, value: unknown) => {
      if (!schema) return;
      const newSchema = { ...schema, [key]: value };
      setSchema(newSchema);
      syncCodeFromSchema(newSchema);
      setDirty(true);
    },
    [schema, syncCodeFromSchema]
  );

  // ── Save mutation ─────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: () =>
      updateTransferFormat(apiCtx!, formatId, {
        name: formatName.trim(),
        description: description.trim() || undefined,
        fsdXml: codeValue
      }),
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["transfer-format", formatId] });
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading format...
      </div>
    );
  }

  if (error || !format) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-red-600">
        <p>Failed to load format</p>
        <Link href={href("/transfer-desk/formats")} className="mt-3">
          <Button variant="outline" size="sm">
            Back to Formats
          </Button>
        </Link>
      </div>
    );
  }

  const fields = schema?.record?.fields ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={href("/transfer-desk/formats")}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            {isReadOnly ? (
              <h1 className="text-2xl font-bold tracking-tight">{format.name}</h1>
            ) : (
              <Input
                className="text-2xl font-bold tracking-tight border-none p-0 h-auto focus-visible:ring-0"
                value={formatName}
                onChange={(e) => {
                  setFormatName(e.target.value);
                  setDirty(true);
                }}
              />
            )}
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                {format.classification}
              </Badge>
              {format.isSystem && (
                <Badge
                  variant="outline"
                  className="bg-amber-50 text-amber-700 border-amber-200 text-xs"
                >
                  <Lock className="mr-1 h-3 w-3" /> System
                </Badge>
              )}
              {format.isValid ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
            </div>
          </div>
        </div>
        {!isReadOnly && (
          <Button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}>
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" /> Save
              </>
            )}
          </Button>
        )}
      </div>

      {/* System format banner */}
      {format.isSystem && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <Lock className="mr-1 inline h-4 w-4" />
          System format — this definition is read-only. Clone it to create a custom version.
        </div>
      )}

      {/* Save error */}
      {saveMutation.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {(saveMutation.error as Error).message}
        </div>
      )}

      {/* Description */}
      {!isReadOnly ? (
        <div>
          <Label className="text-xs text-muted-foreground">Description</Label>
          <Input
            className="mt-1"
            value={description}
            placeholder="Optional description"
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
          />
        </div>
      ) : (
        format.description && <p className="text-sm text-muted-foreground">{format.description}</p>
      )}

      {/* Tab switcher */}
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => setActiveTab("gui")}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "gui"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <LayoutGrid className="h-4 w-4" /> GUI Editor
        </button>
        <button
          onClick={() => setActiveTab("code")}
          className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "code"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Code2 className="h-4 w-4" /> Code
        </button>
      </div>

      {/* ── GUI Tab ──────────────────────────────────────────────────────── */}
      {activeTab === "gui" && schema && (
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
                  <p className="mt-1 font-medium text-sm">{schema.classification}</p>
                </div>
                {schema.classification === "DELIMITED" && (
                  <div>
                    <Label className="text-xs">Field Separator</Label>
                    {isReadOnly ? (
                      <p className="mt-1 font-medium text-sm">
                        {schema.fieldSep === "\t"
                          ? "Tab"
                          : schema.fieldSep === ","
                            ? "Comma"
                            : schema.fieldSep === ";"
                              ? "Semicolon"
                              : (schema.fieldSep ?? "Comma")}
                      </p>
                    ) : (
                      <Select
                        value={schema.fieldSep ?? ","}
                        onValueChange={(v) => updateSchemaProp("fieldSep", v)}
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
                    )}
                  </div>
                )}
                <div>
                  <Label className="text-xs">Encoding</Label>
                  <p className="mt-1 font-medium text-sm">{schema.encoding ?? "UTF-8"}</p>
                </div>
                <div>
                  <Label className="text-xs">Skip Lines</Label>
                  {isReadOnly ? (
                    <p className="mt-1 font-medium text-sm">{schema.initialLinesToIgnore ?? 0}</p>
                  ) : (
                    <Input
                      type="number"
                      min={0}
                      className="mt-1"
                      value={schema.initialLinesToIgnore ?? 0}
                      onChange={(e) =>
                        updateSchemaProp("initialLinesToIgnore", parseInt(e.target.value) || 0)
                      }
                    />
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Fields table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Fields ({fields.length})</CardTitle>
                {!isReadOnly && (
                  <Button variant="outline" size="sm" onClick={addField}>
                    <Plus className="mr-1 h-3 w-3" /> Add Field
                  </Button>
                )}
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
                      {!isReadOnly && <TableHead className="w-[50px]" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell>
                          {isReadOnly ? (
                            <span className="text-sm font-medium">{field.name}</span>
                          ) : (
                            <Input
                              value={field.name}
                              onChange={(e) => updateField(idx, "name", e.target.value)}
                              className="h-8 text-sm"
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {isReadOnly ? (
                            <span className="text-sm">{field.type ?? "string"}</span>
                          ) : (
                            <Select
                              value={field.type ?? "string"}
                              onValueChange={(v) => updateField(idx, "type", v)}
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
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {isReadOnly ? (
                            field.required ? (
                              <CheckCircle2 className="mx-auto h-4 w-4 text-green-600" />
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )
                          ) : (
                            <Checkbox
                              checked={field.required ?? false}
                              onCheckedChange={(v) => updateField(idx, "required", !!v)}
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {isReadOnly ? (
                            <span className="text-sm">{field.maxLength ?? "—"}</span>
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              value={field.maxLength ?? ""}
                              onChange={(e) =>
                                updateField(idx, "maxLength", parseInt(e.target.value) || undefined)
                              }
                              className="h-8 text-sm"
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {isReadOnly ? (
                            <span className="text-sm">{field.minLength ?? "—"}</span>
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              value={field.minLength ?? ""}
                              onChange={(e) =>
                                updateField(idx, "minLength", parseInt(e.target.value) || undefined)
                              }
                              className="h-8 text-sm"
                            />
                          )}
                        </TableCell>
                        {!isReadOnly && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => removeField(idx)}
                              disabled={fields.length <= 1}
                            >
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "gui" && !schema && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-amber-500" />
            <p>Unable to parse FSD schema. Switch to Code tab to edit directly.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Code Tab ─────────────────────────────────────────────────────── */}
      {activeTab === "code" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">FSD Schema (JSON)</CardTitle>
              {codeError && (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                  <XCircle className="mr-1 h-3 w-3" /> Invalid JSON
                </Badge>
              )}
              {!codeError && codeValue && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Valid JSON
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <textarea
              className="w-full rounded-md border border-input bg-background p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={Math.max(15, codeValue.split("\n").length + 2)}
              value={codeValue}
              readOnly={isReadOnly}
              onChange={(e) => handleCodeChange(e.target.value)}
              spellCheck={false}
            />
            {codeError && <p className="mt-2 text-xs text-red-600">{codeError}</p>}
          </CardContent>
        </Card>
      )}

      {/* Test section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test Format</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Upload a sample file to test parsing with this format definition. This feature will be
            available in a future update.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
