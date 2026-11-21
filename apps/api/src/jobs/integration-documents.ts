/**
 * Build canonical documents from transformed records (import plan section 4,
 * stage 4). From here on nothing knows which source system the data came
 * from.
 *
 * The transformation writes, for every record, the contract's field keys
 * (@hfp/posting-contract DOCUMENT_FIELDS): the document's fields
 * (sourceDocumentRef, documentDate, entityCode, journalTypeCode, currency,
 * fxRate, journalDescription) and the line's (accountCode, debit, credit,
 * amount, statValue, description, lineRef, taxCode, and one
 * "dimensions.<name>" per dimension). Records with the same entity and
 * source document reference form one document, one line each, in file
 * order. The document's fields must agree across its records.
 */
import {
  DIMENSION_KEY_PREFIX,
  DOCUMENT_FIELDS,
  type GlJournalDocumentV1
} from "@hfp/posting-contract";

export type TransformedRecord = Record<string, unknown>;

export type BuiltDocument = {
  /** The canonical document, not yet checked against the contract. */
  document: GlJournalDocumentV1;
  /** The records (by index in the file) that made it, one per line. */
  recordIndices: number[];
};

export type RecordError = { recordIndex: number; code: string; message: string };

export const DocumentBuildError = {
  /** A record without the entity or the source document reference. */
  MISSING_DOCUMENT_KEY: "MISSING_DOCUMENT_KEY",
  /** Records of one document disagree on a document field. */
  CONFLICTING_DOCUMENT_FIELD: "CONFLICTING_DOCUMENT_FIELD"
} as const;

const DOCUMENT_KEYS = DOCUMENT_FIELDS.GL_JOURNAL.filter((f) => f.level === "document").map((f) => ({
  key: f.key,
  name: f.name
}));
const LINE_KEYS = DOCUMENT_FIELDS.GL_JOURNAL.filter(
  (f) => f.level === "line" && !f.key.startsWith(DIMENSION_KEY_PREFIX)
).map((f) => ({ key: f.key, name: f.name }));

/**
 * A record value as the contract's string: numbers in plain decimal notation
 * (at most 8 places; the contract checks the places each field allows),
 * dates as YYYY-MM-DD, blanks as absent.
 */
export function asContractValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    // Parsers and transformations yield floating-point numbers; fix them to
    // 8 places so that 0.30000000000000004 is 0.3, then drop trailing zeros.
    const fixed = value.toFixed(8);
    return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
  }
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

/** Groups transformed records into GL journal documents of `sourceSystem`. */
export function buildGlDocuments(
  records: ReadonlyArray<TransformedRecord>,
  options: { sourceSystem: string }
): { documents: BuiltDocument[]; errors: RecordError[] } {
  const errors: RecordError[] = [];
  const groups = new Map<
    string,
    { fields: Record<string, string>; doc: BuiltDocument; conflict?: string }
  >();

  records.forEach((record, recordIndex) => {
    const entityCode = asContractValue(record.entityCode);
    const ref = asContractValue(record.sourceDocumentRef);
    if (!entityCode || !ref) {
      errors.push({
        recordIndex,
        code: DocumentBuildError.MISSING_DOCUMENT_KEY,
        message: `The record has no ${!entityCode ? "entityCode" : "sourceDocumentRef"}; the transformation must set it.`
      });
      return;
    }
    const groupKey = `${entityCode}\u0000${ref}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        fields: {},
        doc: {
          document: {
            contractVersion: 1,
            documentType: "GL_JOURNAL",
            sourceSystem: options.sourceSystem,
            sourceDocumentRef: ref,
            entityCode,
            lines: []
          } as unknown as GlJournalDocumentV1,
          recordIndices: []
        }
      };
      groups.set(groupKey, group);
    }

    for (const { key, name } of DOCUMENT_KEYS) {
      const value = asContractValue(record[key]);
      if (value === undefined) continue;
      const seen = group.fields[name];
      if (seen === undefined) group.fields[name] = value;
      else if (seen !== value && !group.conflict) {
        group.conflict = `${key} is ${seen} on one record of ${ref} and ${value} on another`;
      }
    }

    const line: Record<string, unknown> = {};
    for (const { key, name } of LINE_KEYS) {
      const value = asContractValue(record[key]);
      if (value !== undefined) line[name] = value;
    }
    const dimensions: Record<string, string> = {};
    for (const [key, raw] of Object.entries(record)) {
      if (!key.startsWith(DIMENSION_KEY_PREFIX)) continue;
      const value = asContractValue(raw);
      if (value !== undefined) dimensions[key.slice(DIMENSION_KEY_PREFIX.length)] = value;
    }
    if (Object.keys(dimensions).length > 0) line.dimensions = dimensions;

    (group.doc.document.lines as unknown[]).push(line);
    group.doc.recordIndices.push(recordIndex);
  });

  const documents: BuiltDocument[] = [];
  for (const group of groups.values()) {
    if (group.conflict) {
      for (const recordIndex of group.doc.recordIndices) {
        errors.push({
          recordIndex,
          code: DocumentBuildError.CONFLICTING_DOCUMENT_FIELD,
          message: group.conflict
        });
      }
      continue;
    }
    Object.assign(group.doc.document, group.fields);
    documents.push(group.doc);
  }
  return { documents, errors };
}
