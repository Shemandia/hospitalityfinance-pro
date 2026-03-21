"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback, useId } from "react";
import { useApiContext } from "../../../../../components/use-api-context";
import {
  listInterfaceDefinitions,
  createInterfaceDefinition,
  updateInterfaceDefinition,
  deleteInterfaceDefinition,
  previewDraftInterfaceDefinition,
  previewInterfaceDefinition,
  executeInterfaceImport,
  getPeriodList
} from "../../../../../lib/gl-api";
import type {
  InterfaceDefinition,
  InterfaceDefinitionPayload,
  InterfaceExecuteResult,
  FieldMappingRule,
  TargetField,
  SourceType,
  FieldTransform,
  ConnectorType,
  SourceFormat,
  PreviewResult,
  Period
} from "../../../../../lib/gl-api";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import { Button } from "../../../../../components/ui/button";
import { Badge } from "../../../../../components/ui/badge";
import { Input } from "../../../../../components/ui/input";
import { Label } from "../../../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../../../../components/ui/select";
import { Separator } from "../../../../../components/ui/separator";
import {
  Plus,
  Trash2,
  Save,
  Play,
  Copy,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ArrowDownToLine,
  Edit2,
  X
} from "lucide-react";

// ── constants ─────────────────────────────────────────────────────────────────

const GL_TARGET_FIELDS: { value: TargetField; label: string; group: string }[] = [
  { value: "postingDate", label: "Posting Date", group: "Journal Header" },
  { value: "reference", label: "Reference", group: "Journal Header" },
  { value: "accountCode", label: "Account Code", group: "Journal Line" },
  { value: "debitAmount", label: "Debit Amount", group: "Journal Line" },
  { value: "creditAmount", label: "Credit Amount", group: "Journal Line" },
  { value: "currency", label: "Currency", group: "Journal Line" },
  { value: "lineDescription", label: "Line Description", group: "Journal Line" },
  { value: "dimension1", label: "Dimension 1", group: "Dimensions" },
  { value: "dimension2", label: "Dimension 2", group: "Dimensions" },
  { value: "dimension3", label: "Dimension 3", group: "Dimensions" },
  { value: "dimension4", label: "Dimension 4", group: "Dimensions" },
  { value: "dimension5", label: "Dimension 5", group: "Dimensions" },
  { value: "dimension6", label: "Dimension 6", group: "Dimensions" }
];

const AP_TARGET_FIELDS: { value: TargetField; label: string; group: string }[] = [
  { value: "supplierCode" as TargetField, label: "Supplier Code", group: "Invoice Header" },
  { value: "invoiceNumber" as TargetField, label: "Invoice Number", group: "Invoice Header" },
  { value: "invoiceDate" as TargetField, label: "Invoice Date", group: "Invoice Header" },
  { value: "dueDate" as TargetField, label: "Due Date", group: "Invoice Header" },
  { value: "currency", label: "Currency", group: "Invoice Header" },
  { value: "grossAmount" as TargetField, label: "Gross Amount", group: "Invoice Header" },
  { value: "taxAmount" as TargetField, label: "Tax Amount", group: "Invoice Header" },
  { value: "netAmount" as TargetField, label: "Net Amount", group: "Invoice Header" },
  { value: "lineDescription", label: "Line Description", group: "Invoice Line" },
  { value: "lineAmount" as TargetField, label: "Line Amount", group: "Invoice Line" },
  { value: "lineGLAccountCode" as TargetField, label: "Line GL Account", group: "Invoice Line" },
  { value: "externalPoRef" as TargetField, label: "PO Reference", group: "Invoice Header" }
];

const SUPPLIER_TARGET_FIELDS: { value: TargetField; label: string; group: string }[] = [
  { value: "code" as TargetField, label: "Supplier Code", group: "Master Data" },
  { value: "name" as TargetField, label: "Name", group: "Master Data" },
  { value: "taxId" as TargetField, label: "Tax ID", group: "Master Data" },
  { value: "currency", label: "Currency", group: "Master Data" },
  { value: "paymentTermsDays" as TargetField, label: "Payment Terms (days)", group: "Master Data" },
  { value: "bankAccountNumber" as TargetField, label: "Bank Account", group: "Banking" },
  { value: "bankSwiftCode" as TargetField, label: "SWIFT/BIC", group: "Banking" },
  { value: "contactEmail" as TargetField, label: "Email", group: "Contact" },
  { value: "isActive" as TargetField, label: "Active", group: "Master Data" }
];

type TargetTypeOption = "GL_JOURNAL" | "AP_INVOICE" | "SUPPLIER_SYNC";

function getTargetFields(targetType: TargetTypeOption) {
  if (targetType === "AP_INVOICE") return AP_TARGET_FIELDS;
  if (targetType === "SUPPLIER_SYNC") return SUPPLIER_TARGET_FIELDS;
  return GL_TARGET_FIELDS;
}

// Keep backward compat
const TARGET_FIELDS = GL_TARGET_FIELDS;

const SOURCE_TYPES: { value: SourceType; label: string; hint: string }[] = [
  { value: "CONSTANT", label: "Constant", hint: "Fixed value applied to every row" },
  { value: "COLUMN", label: "Column", hint: "Value from a source column by name" },
  { value: "LOOKUP", label: "Lookup", hint: "Translate source code via Connector Mappings" },
  { value: "FORMULA", label: "Formula", hint: "Template e.g. {col1} - {col2}" },
  { value: "EXPRESSION" as SourceType, label: "Expression", hint: "Math: {qty} * {price}" },
  { value: "CONDITIONAL" as SourceType, label: "Conditional", hint: "If: colName=value?then:else" }
];

const TRANSFORMS: { value: FieldTransform; label: string }[] = [
  { value: "NONE", label: "None" },
  { value: "UPPERCASE", label: "Uppercase" },
  { value: "LOWERCASE", label: "Lowercase" },
  { value: "TRIM", label: "Trim whitespace" },
  { value: "ABS", label: "Absolute value (|x|)" },
  { value: "NEGATE", label: "Negate (−x)" },
  { value: "ROUND", label: "Round (arg: decimals)" },
  { value: "LEFT", label: "Left N chars (arg: N)" },
  { value: "RIGHT", label: "Right N chars (arg: N)" },
  { value: "SUBSTRING", label: "Substring (arg: start,length)" },
  { value: "PAD_LEFT", label: "Pad left (arg: length,char)" },
  { value: "REPLACE", label: "Replace (arg: search|replace)" },
  { value: "SPLIT", label: "Split (arg: delimiter|index)" },
  { value: "CONCAT", label: "Concat suffix (arg: suffix)" },
  { value: "DATE_FORMAT", label: "Date → ISO" },
  { value: "DATE_PARSE" as FieldTransform, label: "Parse date (arg: DD/MM/YYYY etc.)" },
  { value: "MULTIPLY" as FieldTransform, label: "Multiply (arg: factor)" },
  { value: "DIVIDE" as FieldTransform, label: "Divide (arg: divisor)" },
  { value: "MAP_VALUE" as FieldTransform, label: "Map value (arg: k1=v1,k2=v2,*=default)" },
  { value: "STRIP_NON_NUMERIC" as FieldTransform, label: "Strip non-numeric" },
  { value: "DEFAULT_IF_EMPTY" as FieldTransform, label: "Default if empty (arg: value)" }
];

const CONNECTOR_TYPES: { value: ConnectorType; label: string }[] = [
  { value: "OPERA_CLOUD", label: "Opera Cloud (OHIP)" },
  { value: "OPERA_SUN", label: "Opera SUN" },
  { value: "SIMPHONY_POS" as ConnectorType, label: "Simphony POS" },
  { value: "SKY_JANA", label: "Sky Jana" },
  { value: "BANK", label: "Bank Feed" },
  { value: "PAYROLL" as ConnectorType, label: "Payroll" },
  { value: "PROCUREMENT" as ConnectorType, label: "Procurement / MM" },
  { value: "CUSTOM", label: "Custom" }
];

const SOURCE_FORMATS: { value: SourceFormat; label: string }[] = [
  { value: "CSV", label: "CSV / TSV" },
  { value: "JSON", label: "JSON" },
  { value: "XML", label: "XML" },
  { value: "EXCEL" as SourceFormat, label: "Excel (.xlsx)" },
  { value: "MT940", label: "MT940 (SWIFT)" },
  { value: "FIXED_WIDTH", label: "Fixed Width" },
  { value: "SAF", label: "SAF (SunSystems)" }
];

const TARGET_TYPES: { value: TargetTypeOption; label: string }[] = [
  { value: "GL_JOURNAL", label: "GL Journal" },
  { value: "AP_INVOICE", label: "AP Invoice" },
  { value: "SUPPLIER_SYNC", label: "Supplier Sync" }
];

const CSV_SAMPLE = `business_date,revenue_code,description,gross_amount,currency
2026-01-31,ROOM_REV,Room Revenue,125000.00,USD
2026-01-31,FB_FOOD,Food & Beverage,42000.00,USD
2026-01-31,SPA_REV,Spa Revenue,18500.00,USD`;

const JSON_SAMPLE = `[
  { "business_date": "2026-01-31", "revenue_code": "ROOM_REV", "description": "Room Revenue", "gross_amount": "125000.00", "currency": "USD" },
  { "business_date": "2026-01-31", "revenue_code": "FB_FOOD",  "description": "Food & Beverage", "gross_amount": "42000.00", "currency": "USD" }
]`;

function newRule(): FieldMappingRule & { _id: string } {
  return {
    _id: crypto.randomUUID(),
    targetField: "accountCode",
    sourceType: "COLUMN",
    sourceValue: "",
    transform: "NONE",
    required: false
  } as FieldMappingRule & { _id: string };
}

// ── sub-components ────────────────────────────────────────────────────────────

function DefinitionBadge({ def }: { def: InterfaceDefinition }) {
  const ct = CONNECTOR_TYPES.find((c) => c.value === def.connectorType)?.label ?? def.connectorType;
  const sf = def.sourceFormat;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant="outline" className="text-[10px]">
        {ct}
      </Badge>
      <Badge variant="secondary" className="text-[10px]">
        {sf}
      </Badge>
      {!def.isActive && (
        <Badge variant="destructive" className="text-[10px]">
          Inactive
        </Badge>
      )}
    </div>
  );
}

// ── FieldMappingTable ──────────────────────────────────────────────────────────

type RuleWithId = FieldMappingRule & { _id: string };

function FieldMappingTable({
  rules,
  onChange
}: {
  rules: RuleWithId[];
  onChange: (rules: RuleWithId[]) => void;
}) {
  const updateRule = (id: string, patch: Partial<RuleWithId>) => {
    onChange(rules.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  };
  const removeRule = (id: string) => onChange(rules.filter((r) => r._id !== id));
  const addRule = () => onChange([...rules, newRule()]);

  return (
    <div className="space-y-0 border border-slate-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[200px_130px_1fr_130px_80px_32px] gap-2 bg-slate-100 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
        <span>GL Target Field</span>
        <span>Source Type</span>
        <span>Source Value</span>
        <span>Transform</span>
        <span className="text-center">Required</span>
        <span />
      </div>

      {rules.length === 0 && (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          No mappings yet. Click "Add Rule" below.
        </p>
      )}

      {rules.map((rule) => (
        <div
          key={rule._id}
          className="grid grid-cols-[200px_130px_1fr_130px_80px_32px] gap-2 px-3 py-2 border-b border-slate-100 hover:bg-slate-50/40 items-center"
        >
          {/* Target field */}
          <Select
            value={rule.targetField}
            onValueChange={(v) => updateRule(rule._id, { targetField: v as TargetField })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["Journal Header", "Journal Line", "Dimensions"].map((group) => (
                <div key={group}>
                  <p className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase">
                    {group}
                  </p>
                  {TARGET_FIELDS.filter((f) => f.group === group).map((f) => (
                    <SelectItem key={f.value} value={f.value} className="text-xs">
                      {f.label}
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>

          {/* Source type */}
          <Select
            value={rule.sourceType}
            onValueChange={(v) => updateRule(rule._id, { sourceType: v as SourceType })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_TYPES.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Source value */}
          <div className="space-y-0.5">
            <Input
              value={rule.sourceValue}
              onChange={(e) => updateRule(rule._id, { sourceValue: e.target.value })}
              placeholder={
                rule.sourceType === "CONSTANT"
                  ? "Fixed value…"
                  : rule.sourceType === "COLUMN"
                    ? "column_name"
                    : rule.sourceType === "LOOKUP"
                      ? "source_code_column"
                      : "{col1} - {col2}"
              }
              className="h-7 text-xs font-mono"
            />
            {rule.sourceType === "LOOKUP" && (
              <p className="text-[10px] text-amber-600">Uses Connector Mappings lookup table</p>
            )}
          </div>

          {/* Transform */}
          <div>
            <Select
              value={rule.transform ?? "NONE"}
              onValueChange={(v) => updateRule(rule._id, { transform: v as FieldTransform })}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSFORMS.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rule.transform === "DATE_FORMAT" && (
              <Input
                value={rule.transformArg ?? ""}
                onChange={(e) => updateRule(rule._id, { transformArg: e.target.value })}
                placeholder="YYYY-MM-DD"
                className="h-6 text-xs mt-0.5 font-mono"
              />
            )}
          </div>

          {/* Required */}
          <div className="flex justify-center">
            <input
              type="checkbox"
              checked={rule.required}
              onChange={(e) => updateRule(rule._id, { required: e.target.checked })}
              className="rounded border-border"
              title="Required field"
            />
          </div>

          {/* Delete */}
          <button
            onClick={() => removeRule(rule._id)}
            className="text-slate-300 hover:text-red-500 transition-colors"
            title="Remove rule"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <div className="px-3 py-2 bg-slate-50">
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addRule}>
          <Plus className="h-3 w-3" />
          Add Rule
        </Button>
      </div>
    </div>
  );
}

// ── PreviewPanel ──────────────────────────────────────────────────────────────

function PreviewPanel({
  definitionId,
  rules,
  sourceFormat,
  isNew
}: {
  definitionId: string | null;
  rules: RuleWithId[];
  sourceFormat: SourceFormat;
  isNew: boolean;
}) {
  const apiContext = useApiContext();
  const [sampleData, setSampleData] = useState(sourceFormat === "JSON" ? JSON_SAMPLE : CSV_SAMPLE);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Execute state
  const [autoPost, setAutoPost] = useState(true);
  const [execReference, setExecReference] = useState("");
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("AUTO");
  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<InterfaceExecuteResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const fileInputId = useId();

  // Fetch open periods for the period selector
  const periodsQuery = useQuery({
    queryKey: ["open-periods", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await getPeriodList(apiContext, { status: "OPEN" as Period["status"] });
      return (res.data as Period[]) ?? [];
    },
    enabled: Boolean(apiContext) && !isNew
  });

  // File upload handler
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") setSampleData(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const runPreview = async () => {
    if (!apiContext) return;
    setLoading(true);
    setError(null);
    try {
      let res;
      if (!isNew && definitionId) {
        res = await previewInterfaceDefinition(apiContext, definitionId, sampleData, 10);
      } else {
        res = await previewDraftInterfaceDefinition(apiContext, {
          sourceFormat,
          fieldMappings: rules.map(({ _id, ...r }) => r),
          sampleData,
          maxRows: 10
        });
      }
      setResult(res.data as PreviewResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const runExecute = async () => {
    if (!apiContext || !definitionId || isNew) return;
    setExecuting(true);
    setExecError(null);
    setExecResult(null);
    try {
      const res = await executeInterfaceImport(apiContext, definitionId, {
        fileContent: sampleData,
        autoPost,
        reference: execReference || undefined,
        periodId: selectedPeriodId !== "AUTO" ? selectedPeriodId : undefined
      });
      setExecResult(res.data as InterfaceExecuteResult);
    } catch (e) {
      setExecError((e as Error).message);
    } finally {
      setExecuting(false);
    }
  };

  const mappedFields = TARGET_FIELDS.filter((f) => rules.some((r) => r.targetField === f.value));

  const canExecute = !isNew && definitionId && sampleData && rules.length > 0;

  return (
    <div className="flex flex-col h-full space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Source Data ({sourceFormat})
          </Label>
          <label
            htmlFor={fileInputId}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-(--color-primary) cursor-pointer transition-colors"
          >
            <ArrowDownToLine className="h-3 w-3" />
            Upload file
          </label>
          <input
            id={fileInputId}
            type="file"
            accept=".csv,.json,.xml,.txt,.sun,.mt940"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
        <textarea
          value={sampleData}
          onChange={(e) => setSampleData(e.target.value)}
          rows={8}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y leading-relaxed"
          placeholder={sourceFormat === "JSON" ? JSON_SAMPLE : CSV_SAMPLE}
          spellCheck={false}
        />
      </div>

      {/* Action buttons: Preview + Execute */}
      <div className="flex gap-2">
        <Button
          onClick={runPreview}
          disabled={loading || rules.length === 0 || !sampleData}
          className="gap-1.5 flex-1"
          size="sm"
          variant="outline"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {loading ? "Previewing…" : "Preview"}
        </Button>
        <Button
          onClick={runExecute}
          disabled={executing || !canExecute}
          className="gap-1.5 flex-1"
          size="sm"
        >
          {executing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowDownToLine className="h-3.5 w-3.5" />
          )}
          {executing ? "Importing…" : "Execute Import"}
        </Button>
      </div>

      {/* Execute options */}
      {canExecute && (
        <div className="space-y-2">
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                id="autoPost"
                checked={autoPost}
                onChange={(e) => setAutoPost(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="autoPost" className="text-slate-600">
                Auto-post journal
              </label>
            </div>
            <Input
              value={execReference}
              onChange={(e) => setExecReference(e.target.value)}
              placeholder="Reference (optional)"
              className="h-6 text-xs flex-1 max-w-50"
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide shrink-0">
              Period
            </Label>
            <Select value={selectedPeriodId} onValueChange={setSelectedPeriodId}>
              <SelectTrigger className="h-6 text-xs w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">Auto-detect</SelectItem>
                {(periodsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(periodsQuery.data ?? []).length === 0 && !periodsQuery.isLoading && (
              <span className="text-[10px] text-amber-600">No open periods found</span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {execError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {execError}
        </div>
      )}

      {/* Execute result */}
      {execResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Import Successful
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-emerald-800">
            <span className="text-emerald-600">Journal:</span>
            <span className="font-mono">{execResult.reference}</span>
            <span className="text-emerald-600">Status:</span>
            <Badge
              variant={execResult.status === "POSTED" ? "default" : "secondary"}
              className="text-[10px] w-fit"
            >
              {execResult.status}
            </Badge>
            {execResult.periodName && (
              <>
                <span className="text-emerald-600">Period:</span>
                <span>{execResult.periodName}</span>
              </>
            )}
            <span className="text-emerald-600">Lines created:</span>
            <span>{execResult.linesCreated}</span>
            <span className="text-emerald-600">Total rows:</span>
            <span>{execResult.totalRows}</span>
          </div>
          {execResult.unmappedCodes.length > 0 && (
            <div className="pt-1 border-t border-emerald-200">
              <p className="text-[10px] font-semibold text-amber-700 mb-1">Unmapped codes:</p>
              <div className="flex flex-wrap gap-1">
                {execResult.unmappedCodes.map((code) => (
                  <Badge
                    key={code}
                    variant="outline"
                    className="text-[10px] font-mono text-amber-700 border-amber-300"
                  >
                    {code}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {execResult.previewErrors > 0 && (
            <p className="text-[10px] text-amber-600">
              {execResult.previewErrors} row(s) had parse warnings
            </p>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-3 flex-1 overflow-auto">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-emerald-600 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {result.parsedRows} rows parsed
            </span>
            {result.errors.length > 0 && (
              <span className="flex items-center gap-1 text-red-600 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                {result.errors.length} error{result.errors.length > 1 ? "s" : ""}
              </span>
            )}
            {result.unmappedLookups.length > 0 && (
              <span className="flex items-center gap-1 text-amber-600 font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                {result.unmappedLookups.length} unmapped
              </span>
            )}
          </div>

          {/* Mapped rows table */}
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="py-1.5 px-2 text-left font-semibold text-slate-500 w-8">#</th>
                  {mappedFields.map((f) => (
                    <th
                      key={f.value}
                      className="py-1.5 px-2 text-left font-semibold text-slate-600 whitespace-nowrap"
                    >
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.mappedRows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="py-1.5 px-2 text-slate-400">{i + 1}</td>
                    {mappedFields.map((f) => {
                      const val = row[f.value];
                      return (
                        <td
                          key={f.value}
                          className={`py-1.5 px-2 font-mono ${val === null ? "text-slate-300 italic" : "text-slate-700"}`}
                        >
                          {val ?? "null"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Errors */}
          {result.errors.length > 0 && (
            <div className="space-y-1">
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-600 flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  Row {e.row} / {e.field}: {e.message}
                </p>
              ))}
            </div>
          )}

          {/* Unmapped lookups */}
          {result.unmappedLookups.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-700">
                Unmapped lookup codes (add to Connector Mappings):
              </p>
              <div className="flex flex-wrap gap-1">
                {result.unmappedLookups.map((code) => (
                  <Badge
                    key={code}
                    variant="outline"
                    className="text-[10px] font-mono text-amber-700 border-amber-300"
                  >
                    {code}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Editor (create / edit) ─────────────────────────────────────────────────────

type EditorMode = "create" | "edit";

function Editor({
  definition,
  mode,
  onSaved,
  onCancel
}: {
  definition: InterfaceDefinition | null;
  mode: EditorMode;
  onSaved: (def: InterfaceDefinition) => void;
  onCancel: () => void;
}) {
  const apiContext = useApiContext();

  const [name, setName] = useState(definition?.name ?? "");
  const [connectorType, setConnectorType] = useState<ConnectorType>(
    definition?.connectorType ?? "OPERA_CLOUD"
  );
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>(definition?.sourceFormat ?? "CSV");
  const [description, setDescription] = useState(definition?.description ?? "");
  const [isActive, setIsActive] = useState(definition?.isActive ?? true);
  const [rules, setRules] = useState<RuleWithId[]>(() =>
    (definition?.fieldMappings ?? []).map((r) => ({ ...r, _id: crypto.randomUUID() }))
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async () => {
    if (!apiContext || !name || rules.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload: InterfaceDefinitionPayload = {
        name,
        connectorType,
        sourceFormat,
        description: description || undefined,
        isActive,
        fieldMappings: rules.map(({ _id, ...r }) => r)
      };
      let saved: InterfaceDefinition;
      if (mode === "create") {
        const res = await createInterfaceDefinition(apiContext, payload);
        saved = res.data as InterfaceDefinition;
      } else {
        const res = await updateInterfaceDefinition(apiContext, definition!.id, payload);
        saved = res.data as InterfaceDefinition;
      }
      onSaved(saved);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const canSave = name.length > 0 && rules.length > 0;

  return (
    <div className="grid grid-cols-1 gap-0 xl:grid-cols-[1fr_380px] h-full">
      {/* Left: form */}
      <div className="space-y-5 overflow-y-auto pr-0 xl:pr-6 xl:border-r xl:border-slate-200 pb-6">
        {/* Header fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Interface Name *
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Opera Daily Revenue Import"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Connector
            </Label>
            <Select
              value={connectorType}
              onValueChange={(v) => setConnectorType(v as ConnectorType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONNECTOR_TYPES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Source Format
            </Label>
            <Select value={sourceFormat} onValueChange={(v) => setSourceFormat(v as SourceFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_FORMATS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
            />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-border"
            />
            <label htmlFor="isActive" className="text-sm text-slate-700">
              Active
            </label>
          </div>
        </div>

        <Separator />

        {/* Field mappings */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Field Transformation Rules</h3>
            <p className="text-xs text-muted-foreground">
              {rules.length} rule{rules.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* Source types legend */}
          <div className="grid grid-cols-2 gap-1.5 text-xs text-muted-foreground mb-2">
            {SOURCE_TYPES.map((s) => (
              <div key={s.value} className="flex items-start gap-1.5">
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {s.label}
                </Badge>
                <span>{s.hint}</span>
              </div>
            ))}
          </div>

          <FieldMappingTable rules={rules} onChange={setRules} />
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-2">
          <Button onClick={save} disabled={!canSave || saving} className="gap-1.5">
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saving ? "Saving…" : mode === "create" ? "Create Interface" : "Save Changes"}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        </div>
      </div>

      {/* Right: preview panel */}
      <div className="xl:pl-6 pt-5 xl:pt-0 overflow-y-auto border-t xl:border-t-0 border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Live Preview</h3>
        <PreviewPanel
          definitionId={definition?.id ?? null}
          rules={rules}
          sourceFormat={sourceFormat}
          isNew={mode === "create"}
        />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type View =
  | { type: "list" }
  | { type: "create" }
  | { type: "edit"; definition: InterfaceDefinition };

export default function TransferDeskPage() {
  const apiContext = useApiContext();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ type: "list" });
  const [filterConnector, setFilterConnector] = useState<string>("ALL");

  const listQuery = useQuery({
    queryKey: ["interface-definitions", apiContext?.entityId],
    queryFn: async () => {
      if (!apiContext) return [];
      const res = await listInterfaceDefinitions(apiContext);
      return (res.data as InterfaceDefinition[]) ?? [];
    },
    enabled: Boolean(apiContext)
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!apiContext) throw new Error("Missing context.");
      await deleteInterfaceDefinition(apiContext, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["interface-definitions", apiContext?.entityId] });
    }
  });

  const onSaved = useCallback(
    (def: InterfaceDefinition) => {
      queryClient.invalidateQueries({ queryKey: ["interface-definitions", apiContext?.entityId] });
      setView({ type: "edit", definition: def });
    },
    [queryClient, apiContext]
  );

  const definitions = listQuery.data ?? [];
  const filtered =
    filterConnector === "ALL"
      ? definitions
      : definitions.filter((d) => d.connectorType === filterConnector);

  // ── List view ───────────────────────────────────────────────────────────────

  if (view.type === "list") {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-(--color-primary)">Transfer Desk</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Configure file interface transformation rules — map source fields to GL journal
              entries.
            </p>
          </div>
          <Button className="gap-1.5" onClick={() => setView({ type: "create" })}>
            <Plus className="h-3.5 w-3.5" />
            New Interface
          </Button>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilterConnector("ALL")}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterConnector === "ALL" ? "bg-(--color-primary) text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            All ({definitions.length})
          </button>
          {CONNECTOR_TYPES.map((ct) => {
            const count = definitions.filter((d) => d.connectorType === ct.value).length;
            if (count === 0) return null;
            return (
              <button
                key={ct.value}
                onClick={() => setFilterConnector(ct.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterConnector === ct.value ? "bg-(--color-primary) text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
              >
                {ct.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {listQuery.isLoading ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
                <ArrowDownToLine className="h-8 w-8 opacity-30" />
                <p className="text-sm">No interface definitions yet.</p>
                <Button size="sm" onClick={() => setView({ type: "create" })} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />
                  Create your first interface
                </Button>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Name
                    </th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Connector
                    </th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Format
                    </th>
                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Rules
                    </th>
                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Status
                    </th>
                    <th className="py-2.5 px-4 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filtered.map((def) => (
                    <tr key={def.id} className="hover:bg-slate-50/40">
                      <td className="py-3 px-4">
                        <button
                          onClick={() => setView({ type: "edit", definition: def })}
                          className="text-sm font-medium text-slate-800 hover:text-(--color-primary) transition-colors text-left"
                        >
                          {def.name}
                        </button>
                        {def.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
                            {def.description}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className="text-[10px]">
                          {CONNECTOR_TYPES.find((c) => c.value === def.connectorType)?.label ??
                            def.connectorType}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="secondary" className="text-[10px]">
                          {def.sourceFormat}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-right text-sm text-slate-600">
                        {def.fieldMappings.length}
                      </td>
                      <td className="py-3 px-4">
                        {def.isActive ? (
                          <Badge variant="default" className="text-[10px]">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px]">
                            Inactive
                          </Badge>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => setView({ type: "edit", definition: def })}
                            className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete interface "${def.name}"?`)) {
                                deleteMutation.mutate(def.id);
                              }
                            }}
                            className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Create / Edit view ──────────────────────────────────────────────────────

  const editDef = view.type === "edit" ? view.definition : null;

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setView({ type: "list" })}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-(--color-primary) transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Transfer Desk
        </button>
        <span className="text-slate-300">/</span>
        <span className="text-sm font-medium text-slate-700">
          {view.type === "create" ? "New Interface" : editDef?.name}
        </span>
        {editDef && <DefinitionBadge def={editDef} />}
      </div>

      <Separator />

      <div className="flex-1 min-h-0">
        <Editor
          definition={editDef}
          mode={view.type === "create" ? "create" : "edit"}
          onSaved={onSaved}
          onCancel={() => setView({ type: "list" })}
        />
      </div>
    </div>
  );
}
