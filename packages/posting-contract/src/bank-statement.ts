/**
 * Bank statement document, version 1 (docs/IMPORT-PLAN.md section 6a: the
 * MT940 importer becomes a template). One statement of one bank account of
 * an entity; the account is named by its number, never by an internal ID.
 */
import { z } from "zod";
import { fromScaled, isDecimal, scaleOf, toScaled } from "./decimal.js";
import { type ContractError, ContractErrorCode, issuesToErrors } from "./errors.js";
import { AMOUNT_SCALE, type ContractResult, isoDate } from "./gl-journal.js";

const code = (max: number) => z.string().trim().min(1).max(max);

const signedAmount = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (!isDecimal(value) || scaleOf(value) > AMOUNT_SCALE) {
      ctx.addIssue({
        code: "custom",
        message: `${value} is not an amount with at most ${AMOUNT_SCALE} decimal places`,
        params: { code: ContractErrorCode.INVALID_AMOUNT }
      });
    }
  });

export const bankStatementLineV1 = z
  .object({
    valueDate: isoDate,
    bookingDate: isoDate.optional(),
    /** Signed: money in is positive, money out negative. */
    amount: signedAmount,
    description: code(1000),
    /** The bank's or the counterparty's reference. */
    reference: z.string().trim().max(100).optional(),
    counterparty: z.string().trim().max(200).optional(),
    lineRef: z.string().trim().max(100).optional()
  })
  .strict();

export const bankStatementDocumentV1 = z
  .object({
    contractVersion: z.literal(1),
    documentType: z.literal("BANK_STATEMENT"),
    sourceSystem: code(20),
    /** The statement's own reference (MT940 field 20 or 28C). */
    sourceDocumentRef: code(100),
    entityCode: code(20),
    bankAccountNumber: code(50),
    statementDate: isoDate,
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/, "A currency is three capital letters (ISO 4217)"),
    openingBalance: signedAmount,
    closingBalance: signedAmount,
    lines: z.array(bankStatementLineV1).max(100_000)
  })
  .strict()
  .superRefine((doc, ctx) => {
    try {
      const moved = doc.lines.reduce((sum, l) => sum + toScaled(l.amount, AMOUNT_SCALE), 0n);
      const opening = toScaled(doc.openingBalance, AMOUNT_SCALE);
      const closing = toScaled(doc.closingBalance, AMOUNT_SCALE);
      if (opening + moved !== closing) {
        ctx.addIssue({
          code: "custom",
          path: ["closingBalance"],
          message: `Opening ${doc.openingBalance} plus movements ${fromScaled(moved, AMOUNT_SCALE)} is ${fromScaled(opening + moved, AMOUNT_SCALE)}, not the closing ${doc.closingBalance}`,
          params: { code: ContractErrorCode.STATEMENT_DOES_NOT_ADD_UP }
        });
      }
    } catch {
      // An amount that is not a decimal is reported by its own field.
    }
  });

export type BankStatementLineV1 = z.infer<typeof bankStatementLineV1>;
export type BankStatementDocumentV1 = z.infer<typeof bankStatementDocumentV1>;

export function validateBankStatement(input: unknown): ContractResult<BankStatementDocumentV1> {
  const version = (input as { contractVersion?: unknown } | null)?.contractVersion;
  if (version !== undefined && version !== 1) {
    const error: ContractError = {
      code: ContractErrorCode.UNSUPPORTED_VERSION,
      path: "contractVersion",
      message: `Contract version ${String(version)} is not supported; this release reads version 1`
    };
    return { ok: false, errors: [error] };
  }
  const parsed = bankStatementDocumentV1.safeParse(input);
  return parsed.success
    ? { ok: true, document: parsed.data }
    : { ok: false, errors: issuesToErrors(parsed.error.issues) };
}
