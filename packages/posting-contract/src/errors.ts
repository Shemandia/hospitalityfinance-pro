import type { ZodIssue } from "zod";

/**
 * Stable error codes for documents that break the contract. Imports report
 * them per document; screens and tests match on the code, not the message.
 */
export const ContractErrorCode = {
  /** A field is missing, has the wrong type, or is out of range. */
  INVALID_FIELD: "INVALID_FIELD",
  /** A field the contract does not know. */
  UNKNOWN_FIELD: "UNKNOWN_FIELD",
  INVALID_DATE: "INVALID_DATE",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  /** A line mixes amount with debit/credit, has both sides, or carries nothing. */
  LINE_SHAPE: "LINE_SHAPE",
  TOO_MANY_DIMENSIONS: "TOO_MANY_DIMENSIONS",
  /** Debits and credits differ in the transaction currency. */
  UNBALANCED: "UNBALANCED",
  /** Opening balance plus the lines is not the closing balance. */
  STATEMENT_DOES_NOT_ADD_UP: "STATEMENT_DOES_NOT_ADD_UP",
  UNSUPPORTED_VERSION: "UNSUPPORTED_VERSION",
  UNKNOWN_DOCUMENT_TYPE: "UNKNOWN_DOCUMENT_TYPE"
} as const;

export type ContractErrorCode = (typeof ContractErrorCode)[keyof typeof ContractErrorCode];

export type ContractError = {
  code: ContractErrorCode;
  /** Where in the document, e.g. "lines.2.debit"; "" for the whole document. */
  path: string;
  message: string;
};

export function issuesToErrors(issues: ReadonlyArray<ZodIssue>): ContractError[] {
  return issues.map((issue) => {
    const code =
      issue.code === "custom" && issue.params?.code
        ? (issue.params.code as ContractErrorCode)
        : issue.code === "unrecognized_keys"
          ? ContractErrorCode.UNKNOWN_FIELD
          : ContractErrorCode.INVALID_FIELD;
    return { code, path: issue.path.join("."), message: issue.message };
  });
}
