import type { ContractErrorCode } from "@hfp/posting-contract";

/**
 * Why the posting service refused a document. Stable codes: imports report
 * them per document, and screens and tests match on them. The contract's own
 * codes (shape, amounts, balance) come first, from @hfp/posting-contract.
 */
export const PostingErrorCode = {
  ENTITY_NOT_FOUND: "ENTITY_NOT_FOUND",
  ENTITY_INACTIVE: "ENTITY_INACTIVE",
  SOURCE_SYSTEM_NOT_FOUND: "SOURCE_SYSTEM_NOT_FOUND",
  SOURCE_SYSTEM_INACTIVE: "SOURCE_SYSTEM_INACTIVE",
  /** The entity has no period for the month of the document date. */
  NO_PERIOD: "NO_PERIOD",
  /** The period of the document date is not open. */
  PERIOD_NOT_OPEN: "PERIOD_NOT_OPEN",
  JOURNAL_TYPE_NOT_FOUND: "JOURNAL_TYPE_NOT_FOUND",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  /** Inactive, or closed to posting. */
  ACCOUNT_NOT_POSTABLE: "ACCOUNT_NOT_POSTABLE",
  /** Money on a statistical account. */
  AMOUNT_ON_STATISTICAL_ACCOUNT: "AMOUNT_ON_STATISTICAL_ACCOUNT",
  /** A quantity on a financial account. */
  STAT_VALUE_ON_FINANCIAL_ACCOUNT: "STAT_VALUE_ON_FINANCIAL_ACCOUNT",
  DIMENSION_NOT_FOUND: "DIMENSION_NOT_FOUND",
  DIMENSION_VALUE_NOT_FOUND: "DIMENSION_VALUE_NOT_FOUND",
  DIMENSION_REQUIRED: "DIMENSION_REQUIRED",
  /** Journal lines carry no tax code yet (WP-U adds it). */
  TAX_CODE_NOT_SUPPORTED: "TAX_CODE_NOT_SUPPORTED",
  /** No exchange rate for the currency pair on or before the document date. */
  NO_RATE: "NO_RATE",
  /** A rate other than 1 for the entity's own currency. */
  RATE_FOR_FUNCTIONAL_CURRENCY: "RATE_FOR_FUNCTIONAL_CURRENCY",
  /** The ledger refused the journal (journal-type rules, source restrictions, functional balance). */
  LEDGER_REFUSED: "LEDGER_REFUSED",
  /** Reverse-and-replace: no posted journal for this document. */
  NOTHING_TO_REPLACE: "NOTHING_TO_REPLACE",
  /** Reverse-and-replace: the journal to replace is not posted (still awaiting approval, or reversed). */
  REPLACE_NOT_POSTED: "REPLACE_NOT_POSTED",
  /** Reverse-and-replace: the reversal would need approval, so the swap cannot happen in one step. */
  REVERSAL_NEEDS_APPROVAL: "REVERSAL_NEEDS_APPROVAL",
  /** Reverse-and-replace: a reason is required. */
  REASON_REQUIRED: "REASON_REQUIRED"
} as const;

export type PostingErrorCode = (typeof PostingErrorCode)[keyof typeof PostingErrorCode];

export type PostingError = {
  code: PostingErrorCode | ContractErrorCode | string;
  /** Where in the document ("lines.2.accountCode"); "" for the whole document. */
  path: string;
  message: string;
};
