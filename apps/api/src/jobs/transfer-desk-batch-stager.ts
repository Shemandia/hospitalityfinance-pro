/**
 * Transfer Desk — held-batch staging.
 *
 * Pure helpers: turn mapped journals into staged batch items with
 * stage-time validation, and resolve the effective review mode.
 */

import { Prisma } from "../db/client.js";
import type { MappedJournal } from "./transfer-desk-record-mapper.js";
import type { JournalCreateInput } from "../modules/gl/types.js";

const D = (v: unknown): Prisma.Decimal => new Prisma.Decimal(String(v ?? 0));

export type ValidationMessage = {
  code: string;
  severity: "WARNING" | "ERROR";
  message: string;
  line?: number;
};

export type StagedItem = {
  itemIndex: number;
  targetComponent: "GL_JOURNAL";
  payload: JournalCreateInput;
  sourceRecordIndices: number[];
  status: "HELD" | "ERROR";
  validationStatus: "OK" | "WARNING" | "ERROR";
  validationMessages: ValidationMessage[];
};

export type StageContext = {
  /** Valid account identifiers — contains BOTH account ids and codes for active accounts. */
  validAccountKeys: Set<string>;
  /** periodId -> status (e.g. "OPEN", "CLOSED"). */
  periodStatusById: Map<string, string>;
};

function validateJournal(input: JournalCreateInput, ctx: StageContext): ValidationMessage[] {
  const messages: ValidationMessage[] = [];

  input.lines.forEach((line, i) => {
    const key = String((line as any).accountId ?? (line as any).accountCode ?? "");
    if (!key || !ctx.validAccountKeys.has(key)) {
      messages.push({
        code: "ACCOUNT_NOT_FOUND",
        severity: "ERROR",
        message: `Line ${i + 1}: account "${key}" not found or inactive in entity.`,
        line: i + 1
      });
    }
  });

  let drFunc = D(0);
  let crFunc = D(0);
  for (const line of input.lines) {
    const rate = D((line as any).fxRate ?? 1);
    drFunc = drFunc.add(D((line as any).debit).mul(rate));
    crFunc = crFunc.add(D((line as any).credit).mul(rate));
  }
  if (!drFunc.toDecimalPlaces(4).equals(crFunc.toDecimalPlaces(4))) {
    messages.push({
      code: "UNBALANCED_FUNCTIONAL",
      severity: "ERROR",
      message: `Journal does not balance in functional currency (DR ${drFunc.toFixed(4)} vs CR ${crFunc.toFixed(4)}).`
    });
  }

  const status = ctx.periodStatusById.get(input.periodId);
  if (!status) {
    messages.push({
      code: "PERIOD_NOT_FOUND",
      severity: "WARNING",
      message: `Period "${input.periodId}" not found.`
    });
  } else if (status !== "OPEN") {
    messages.push({
      code: "PERIOD_NOT_OPEN",
      severity: "WARNING",
      message: `Period is ${status}, not OPEN.`
    });
  }

  return messages;
}

function worstSeverity(messages: ValidationMessage[]): "OK" | "WARNING" | "ERROR" {
  if (messages.some((m) => m.severity === "ERROR")) return "ERROR";
  if (messages.some((m) => m.severity === "WARNING")) return "WARNING";
  return "OK";
}

export function stageJournalItems(journals: MappedJournal[], ctx: StageContext): StagedItem[] {
  return journals.map((journal, itemIndex) => {
    const messages = validateJournal(journal.input, ctx);
    const validationStatus = worstSeverity(messages);
    return {
      itemIndex,
      targetComponent: "GL_JOURNAL",
      payload: journal.input,
      sourceRecordIndices: journal.sourceIndices,
      status: validationStatus === "ERROR" ? "ERROR" : "HELD",
      validationStatus,
      validationMessages: messages
    };
  });
}

export function resolveReviewMode(
  profileReviewMode: string | null | undefined,
  execution: { automationId: string | null; triggeredBy: string | null }
): "HOLD" | "AUTO_COMMIT" {
  const scheduled = Boolean(execution.automationId) || execution.triggeredBy === "scheduler";
  if (scheduled) return "AUTO_COMMIT";
  return profileReviewMode === "AUTO_COMMIT" ? "AUTO_COMMIT" : "HOLD";
}
