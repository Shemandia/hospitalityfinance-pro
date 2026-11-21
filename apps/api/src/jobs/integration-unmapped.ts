/**
 * What a ledger import does with records the transformation could not map
 * (docs/IMPORT-PLAN.md section 5). The profile chooses; nothing is fixed in
 * code.
 *
 *   REJECT    a record with an unmapped code fails, and with it its whole
 *             document (never a document with lines missing).
 *   HOLD      the same, and the run is staged for review even when it would
 *             otherwise commit.
 *   SUSPENSE  an unmapped account code becomes the profile's suspense
 *             account, with the source code kept in the line description;
 *             any other unmapped value is rejected.
 *
 * Any other transformation error fails the record (and its document).
 */
import type { TmlRecord, TmlResult } from "@hfp/tml-engine";

export type UnmappedPolicy = "REJECT" | "HOLD" | "SUSPENSE";

export type RecordFailure = { code: "UNMAPPED_CODE" | "TRANSFORM_ERROR"; message: string };

export type PolicyResult = {
  /** Every record, index-aligned with the file; failed ones as far as they got. */
  records: TmlRecord[];
  /** Records that must not post, by index. */
  failures: Map<number, RecordFailure>;
  /** How many values were unmapped (sent to suspense or not). */
  unmapped: number;
  /** How many lines were sent to the suspense account. */
  suspended: number;
};

export function applyUnmappedPolicy(
  tml: Pick<TmlResult, "records" | "errors">,
  profile: { unmappedPolicy?: UnmappedPolicy | null; suspenseAccountCode?: string | null }
): PolicyResult {
  const policy = profile.unmappedPolicy ?? "REJECT";
  const records = tml.records.map((r) => ({ ...r }));
  const failures = new Map<number, RecordFailure>();
  let unmapped = 0;
  let suspended = 0;

  const fail = (index: number, code: RecordFailure["code"], message: string) => {
    const seen = failures.get(index);
    failures.set(index, {
      // An unmapped code is the more useful reason to report.
      code: seen?.code === "UNMAPPED_CODE" ? "UNMAPPED_CODE" : code,
      message: seen ? `${seen.message}; ${message}` : message
    });
  };

  for (const error of tml.errors) {
    if (!error.unmapped) {
      fail(error.recordIndex, "TRANSFORM_ERROR", `[${error.ruleType}] ${error.message}`);
      continue;
    }
    unmapped++;
    const { table, key, target } = error.unmapped;
    const record = records[error.recordIndex]!;
    if (policy === "SUSPENSE" && target === "accountCode" && profile.suspenseAccountCode) {
      record.accountCode = profile.suspenseAccountCode;
      const original =
        record.description == null || record.description === ""
          ? ""
          : `: ${String(record.description)}`;
      record.description = `Unmapped ${table} ${key}${original}`;
      suspended++;
      continue;
    }
    fail(error.recordIndex, "UNMAPPED_CODE", `${table} has no entry for "${key}" (${target})`);
  }
  return { records, failures, unmapped, suspended };
}
