/**
 * @hfp/posting-contract: the canonical documents (docs/IMPORT-PLAN.md
 * section 2). Every import produces one of these; the posting service
 * accepts only these.
 */
import { validateBankStatement } from "./bank-statement.js";
import { ContractErrorCode } from "./errors.js";
import { type ContractResult, validateGlJournal } from "./gl-journal.js";

export * from "./decimal.js";
export * from "./errors.js";
export * from "./gl-journal.js";
export * from "./bank-statement.js";
export * from "./fields.js";

/** Validates any document by its documentType. */
export function validateDocument(input: unknown): ContractResult<unknown> {
  const type = (input as { documentType?: unknown } | null)?.documentType;
  if (type === "GL_JOURNAL") return validateGlJournal(input);
  if (type === "BANK_STATEMENT") return validateBankStatement(input);
  return {
    ok: false,
    errors: [
      {
        code: ContractErrorCode.UNKNOWN_DOCUMENT_TYPE,
        path: "documentType",
        message: `Unknown document type ${JSON.stringify(type)}; expected GL_JOURNAL or BANK_STATEMENT`
      }
    ]
  };
}
