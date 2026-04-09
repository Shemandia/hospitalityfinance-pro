/**
 * Transfer Desk — FSD record → HFP service input mapping.
 *
 * Converts flat FsdRecordValue[] (from @hfp/fsd-engine parse()) into the
 * typed input shapes expected by GL, AP, and AR services.
 *
 * Supported target components:
 *   - GL_JOURNAL  → groups records into journal lines, creates one journal
 *   - AP_INVOICE  → one record per invoice
 *   - AR_INVOICE  → one record per invoice
 *   - Anything else → UNSUPPORTED_COMPONENT error
 *
 * Field mapping uses `targetParams.fieldMap` from the profile (a
 * Record<string, string> mapping FSD field name → target field name).
 * Falls back to 1:1 name matching if no fieldMap is provided.
 */

import type { FsdRecordValue } from "@hfp/fsd-engine";
import type { JournalCreateInput } from "../modules/gl/types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type FieldMap = Record<string, string>;

export type TargetParams = {
  fieldMap?: FieldMap;
  /** Field name to group records into separate journals. If absent, all records → one journal. */
  groupBy?: string;
  /** Period ID for journal posting */
  periodId?: string;
  /** Functional currency for journals */
  functionalCurrency?: string;
  /** Entity ID for target operations */
  entityId?: string;
  /** Default description for journals when not in the source data */
  defaultDescription?: string;
};

export type MappedJournal = {
  entityId: string;
  input: JournalCreateInput;
  /** Which source record indices contributed to this journal */
  sourceIndices: number[];
};

export type MapResult =
  | { ok: true; component: "GL_JOURNAL"; journals: MappedJournal[] }
  | {
      ok: true;
      component: "AP_INVOICE";
      records: Array<{ index: number; data: Record<string, unknown> }>;
    }
  | {
      ok: true;
      component: "AR_INVOICE";
      records: Array<{ index: number; data: Record<string, unknown> }>;
    }
  | { ok: false; code: string; message: string };

// ── Field resolution ─────────────────────────────────────────────────────────

function getTargetFieldName(fsdFieldName: string, fieldMap: FieldMap | undefined): string {
  if (fieldMap && fieldMap[fsdFieldName]) {
    return fieldMap[fsdFieldName]!;
  }
  return fsdFieldName;
}

function buildTargetRecord(
  record: FsdRecordValue,
  fieldMap: FieldMap | undefined
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [fsdKey, value] of Object.entries(record)) {
    const targetKey = getTargetFieldName(fsdKey, fieldMap);
    result[targetKey] = value;
  }
  return result;
}

// ── GL_JOURNAL mapping ───────────────────────────────────────────────────────

function mapToJournals(records: FsdRecordValue[], params: TargetParams): MappedJournal[] {
  const fieldMap = params.fieldMap;
  const groupByField = params.groupBy;

  // Group records
  const groups = new Map<string, { indices: number[]; records: FsdRecordValue[] }>();

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const key = groupByField ? String(rec[groupByField] ?? "__all__") : "__all__";
    let group = groups.get(key);
    if (!group) {
      group = { indices: [], records: [] };
      groups.set(key, group);
    }
    group.indices.push(i);
    group.records.push(rec);
  }

  const journals: MappedJournal[] = [];

  for (const [groupKey, group] of groups) {
    const lines = group.records.map((rec) => {
      const mapped = buildTargetRecord(rec, fieldMap);
      return {
        accountId: String(mapped.accountId ?? mapped.accountCode ?? ""),
        debit: String(mapped.debit ?? "0"),
        credit: String(mapped.credit ?? "0"),
        currency: String(mapped.currency ?? params.functionalCurrency ?? "USD"),
        fxRate: String(mapped.fxRate ?? "1"),
        description: mapped.description ? String(mapped.description) : undefined,
        dimension1: mapped.dimension1 ? String(mapped.dimension1) : undefined,
        dimension2: mapped.dimension2 ? String(mapped.dimension2) : undefined
      };
    });

    // Use first record's reference/description as journal-level fields
    const firstMapped = buildTargetRecord(group.records[0]!, fieldMap);

    const input: JournalCreateInput = {
      periodId: params.periodId ?? String(firstMapped.periodId ?? ""),
      reference: firstMapped.reference ? String(firstMapped.reference) : undefined,
      description: firstMapped.journalDescription
        ? String(firstMapped.journalDescription)
        : (params.defaultDescription ?? `Transfer Desk import — ${groupKey}`),
      source: "IMPORT",
      functionalCurrency:
        params.functionalCurrency ?? String(firstMapped.functionalCurrency ?? "USD"),
      lines
    };

    journals.push({
      entityId: params.entityId ?? "",
      input,
      sourceIndices: group.indices
    });
  }

  return journals;
}

// ── Main mapper ──────────────────────────────────────────────────────────────

const SUPPORTED_WRITE_COMPONENTS = new Set(["GL_JOURNAL", "AP_INVOICE", "AR_INVOICE"]);

export function mapRecordsToTarget(
  targetComponent: string,
  records: FsdRecordValue[],
  params: TargetParams
): MapResult {
  if (!SUPPORTED_WRITE_COMPONENTS.has(targetComponent)) {
    return {
      ok: false,
      code: "UNSUPPORTED_COMPONENT",
      message: `Target component "${targetComponent}" is not supported for data writing. Supported: ${[...SUPPORTED_WRITE_COMPONENTS].join(", ")}`
    };
  }

  switch (targetComponent) {
    case "GL_JOURNAL": {
      const journals = mapToJournals(records, params);
      return { ok: true, component: "GL_JOURNAL", journals };
    }

    case "AP_INVOICE": {
      const mapped = records.map((rec, i) => ({
        index: i,
        data: buildTargetRecord(rec, params.fieldMap)
      }));
      return { ok: true, component: "AP_INVOICE", records: mapped };
    }

    case "AR_INVOICE": {
      const mapped = records.map((rec, i) => ({
        index: i,
        data: buildTargetRecord(rec, params.fieldMap)
      }));
      return { ok: true, component: "AR_INVOICE", records: mapped };
    }

    default:
      return {
        ok: false,
        code: "UNSUPPORTED_COMPONENT",
        message: `Target component "${targetComponent}" is not supported`
      };
  }
}
