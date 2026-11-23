/**
 * Integrations — FSD record → HFP service input mapping.
 *
 * Converts flat FsdRecordValue[] (from @hfp/fsd-engine parse()) into the
 * input shapes of the AP and AR services, which WP-U replaces. Ledger
 * imports (GL_JOURNAL) do not come here: they become canonical documents and
 * post through the posting service (integration-import-documents.ts).
 *
 * Supported target components:
 *   - AP_INVOICE  → one record per invoice
 *   - AR_INVOICE  → one record per invoice
 *   - Anything else → UNSUPPORTED_COMPONENT error
 *
 * Field mapping uses `targetParams.fieldMap` from the profile (a
 * Record<string, string> mapping FSD field name → target field name).
 * Falls back to 1:1 name matching if no fieldMap is provided.
 */

import type { FsdRecordValue } from "@hfp/fsd-engine";

// ── Types ────────────────────────────────────────────────────────────────────

export type FieldMap = Record<string, string>;

export type TargetParams = {
  fieldMap?: FieldMap;
  /** Entity ID for target operations */
  entityId?: string;
  /** Kept for profiles that still carry it; ignored. */
  periodId?: string;
};

export type MapResult =
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

// ── Main mapper ──────────────────────────────────────────────────────────────

const SUPPORTED_WRITE_COMPONENTS = new Set(["AP_INVOICE", "AR_INVOICE"]);

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
