"use client";

/**
 * FieldMappingEditor — reusable field mapping table for Transfer Desk profiles.
 *
 * Extracted from `app/[tenant]/(dashboard)/settings/integrations/transfer-desk/page.tsx`
 * (QW10) so it can be reused in:
 *   - The existing interface-definition editor (its original home)
 *   - Step 5 (Mapping) of the profile creation wizard once that's built
 *   - Any future per-profile detail view
 *
 * Each row maps one source field expression to one HFP target field with an
 * optional value transform. The component is purely controlled — pass `rules`
 * + `onChange`. Target field options come from `targetFields` so the same
 * component handles GL Journal, AP Invoice, and any future target types.
 *
 * Notes per Sky Jana exclusion:
 *   - The constants below still include SUPPLIER_TARGET_FIELDS and the
 *     SUPPLIER_SYNC target type for backward compat with the existing
 *     interface-definition editor. New profiles should NOT use them — Sky
 *     Jana MMS owns supplier master data. They will be removed when the
 *     interface-definition editor is migrated to the new wizard.
 */

import { Plus, X } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import type { FieldMappingRule, FieldTransform, SourceType, TargetField } from "../../lib/gl-api";

// ── Types ───────────────────────────────────────────────────────────────────

export type RuleWithId = FieldMappingRule & { _id: string };

export type TargetFieldOption = {
  value: TargetField;
  label: string;
  /** Logical group used as a section header inside the dropdown */
  group: string;
};

// ── Default option lists ────────────────────────────────────────────────────

export const GL_TARGET_FIELDS: TargetFieldOption[] = [
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

export const AP_TARGET_FIELDS: TargetFieldOption[] = [
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
  {
    value: "lineGLAccountCode" as TargetField,
    label: "Line Ledger Account",
    group: "Invoice Line"
  },
  { value: "externalPoRef" as TargetField, label: "PO Reference", group: "Invoice Header" }
];

/**
 * @deprecated Sky Jana MMS owns supplier master data. Kept here only for the
 * legacy interface-definition editor; do NOT use in new profiles.
 */
export const SUPPLIER_TARGET_FIELDS: TargetFieldOption[] = [
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

export type TargetTypeOption = "GL_JOURNAL" | "AP_INVOICE" | "SUPPLIER_SYNC";

export function getTargetFields(targetType: TargetTypeOption): TargetFieldOption[] {
  if (targetType === "AP_INVOICE") return AP_TARGET_FIELDS;
  if (targetType === "SUPPLIER_SYNC") return SUPPLIER_TARGET_FIELDS;
  return GL_TARGET_FIELDS;
}

export const SOURCE_TYPES: { value: SourceType; label: string; hint: string }[] = [
  { value: "CONSTANT", label: "Constant", hint: "Fixed value applied to every row" },
  { value: "COLUMN", label: "Column", hint: "Value from a source column by name" },
  { value: "LOOKUP", label: "Lookup", hint: "Translate source code via lookup table" },
  { value: "FORMULA", label: "Formula", hint: "Template e.g. {col1} - {col2}" },
  { value: "EXPRESSION" as SourceType, label: "Expression", hint: "Math: {qty} * {price}" },
  {
    value: "CONDITIONAL" as SourceType,
    label: "Conditional",
    hint: "If: colName=value?then:else"
  }
];

export const TRANSFORMS: { value: FieldTransform; label: string }[] = [
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

// ── Factory ─────────────────────────────────────────────────────────────────

export function newRule(defaults?: Partial<RuleWithId>): RuleWithId {
  return {
    _id: crypto.randomUUID(),
    targetField: defaults?.targetField ?? ("accountCode" as TargetField),
    sourceType: defaults?.sourceType ?? ("COLUMN" as SourceType),
    sourceValue: defaults?.sourceValue ?? "",
    transform: defaults?.transform ?? ("NONE" as FieldTransform),
    required: defaults?.required ?? false
  } as RuleWithId;
}

// ── Component ───────────────────────────────────────────────────────────────

type Props = {
  rules: RuleWithId[];
  onChange: (rules: RuleWithId[]) => void;
  /**
   * The list of target fields available for the current target type. Defaults
   * to GL_JOURNAL fields. Pass AP_TARGET_FIELDS, GL_TARGET_FIELDS, or a custom
   * list per use case.
   */
  targetFields?: TargetFieldOption[];
};

export function FieldMappingEditor({ rules, onChange, targetFields = GL_TARGET_FIELDS }: Props) {
  const updateRule = (id: string, patch: Partial<RuleWithId>) => {
    onChange(rules.map((r) => (r._id === id ? { ...r, ...patch } : r)));
  };
  const removeRule = (id: string) => onChange(rules.filter((r) => r._id !== id));
  const addRule = () => onChange([...rules, newRule()]);

  const groups = Array.from(new Set(targetFields.map((f) => f.group)));

  return (
    <div className="space-y-0 border border-slate-200 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[200px_130px_1fr_130px_80px_32px] gap-2 bg-slate-100 px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
        <span>Target Field</span>
        <span>Source Type</span>
        <span>Source Value</span>
        <span>Transform</span>
        <span className="text-center">Required</span>
        <span />
      </div>

      {rules.length === 0 && (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          No mappings yet. Click &ldquo;Add Rule&rdquo; below.
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
              {groups.map((group) => (
                <div key={group}>
                  <p className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase">
                    {group}
                  </p>
                  {targetFields
                    .filter((f) => f.group === group)
                    .map((f) => (
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
              <p className="text-[10px] text-amber-600">
                Resolved via the linked lookup table at runtime
              </p>
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
            type="button"
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
