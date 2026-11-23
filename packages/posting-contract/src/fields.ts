/**
 * The fields of each document type, for mapping screens and for the
 * pipeline's build step: what a transformation can fill. This replaces the
 * hand-written target-field lists that lived in the API (import plan step 5).
 */
import { MAX_DIMENSIONS } from "./gl-journal.js";

export const DOCUMENT_TYPES = ["GL_JOURNAL", "BANK_STATEMENT"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type FieldKind = "code" | "text" | "date" | "decimal" | "currency" | "dimensions";

export type ContractField = {
  name: string;
  /**
   * The key a transformation writes in its output record for this field.
   * Usually the name; the journal's description is "journalDescription" (the
   * line has one too), and dimensions are "dimensions.<dimension name>".
   */
  key: string;
  /** Once per document, or once per line. */
  level: "document" | "line";
  kind: FieldKind;
  required: boolean;
  description: string;
};

export const DOCUMENT_FIELDS: Readonly<Record<DocumentType, ReadonlyArray<ContractField>>> = {
  GL_JOURNAL: [
    {
      name: "sourceDocumentRef",
      key: "sourceDocumentRef",
      level: "document",
      kind: "code",
      required: true,
      description:
        "The source's own document reference; with the entity and source system, it posts once"
    },
    {
      name: "documentDate",
      key: "documentDate",
      level: "document",
      kind: "date",
      required: true,
      description: "Business date (YYYY-MM-DD); chooses the period and the rate date"
    },
    {
      name: "entityCode",
      key: "entityCode",
      level: "document",
      kind: "code",
      required: true,
      description: "Entity code (from the property-to-entity lookup)"
    },
    {
      name: "journalTypeCode",
      key: "journalTypeCode",
      level: "document",
      kind: "code",
      required: false,
      description: "Journal type code"
    },
    {
      name: "description",
      key: "journalDescription",
      level: "document",
      kind: "text",
      required: false,
      description: "Journal description"
    },
    {
      name: "currency",
      key: "currency",
      level: "document",
      kind: "currency",
      required: true,
      description: "Transaction currency (ISO 4217)"
    },
    {
      name: "fxRate",
      key: "fxRate",
      level: "document",
      kind: "decimal",
      required: false,
      description: "Rate to the functional currency; looked up when absent"
    },
    {
      name: "accountCode",
      key: "accountCode",
      level: "line",
      kind: "code",
      required: true,
      description: "Ledger account code"
    },
    {
      name: "debit",
      key: "debit",
      level: "line",
      kind: "decimal",
      required: false,
      description: "Debit amount (or use amount)"
    },
    {
      name: "credit",
      key: "credit",
      level: "line",
      kind: "decimal",
      required: false,
      description: "Credit amount (or use amount)"
    },
    {
      name: "amount",
      key: "amount",
      level: "line",
      kind: "decimal",
      required: false,
      description: "Signed amount: positive debit, negative credit"
    },
    {
      name: "statValue",
      key: "statValue",
      level: "line",
      kind: "decimal",
      required: false,
      description: "Quantity for a statistical account"
    },
    {
      name: "dimensions",
      key: "dimensions.*",
      level: "line",
      kind: "dimensions",
      required: false,
      description: `Up to ${MAX_DIMENSIONS} dimension codes, keyed by the entity's dimension names`
    },
    {
      name: "taxCode",
      key: "taxCode",
      level: "line",
      kind: "code",
      required: false,
      description: "Tax code"
    },
    {
      name: "description",
      key: "description",
      level: "line",
      kind: "text",
      required: false,
      description: "Line description"
    },
    {
      name: "lineRef",
      key: "lineRef",
      level: "line",
      kind: "code",
      required: false,
      description: "The source's line reference"
    }
  ],
  BANK_STATEMENT: [
    {
      name: "sourceDocumentRef",
      key: "sourceDocumentRef",
      level: "document",
      kind: "code",
      required: true,
      description: "Statement reference"
    },
    {
      name: "entityCode",
      key: "entityCode",
      level: "document",
      kind: "code",
      required: true,
      description: "Entity code"
    },
    {
      name: "bankAccountNumber",
      key: "bankAccountNumber",
      level: "document",
      kind: "code",
      required: true,
      description: "Bank account number, as on the entity's bank account"
    },
    {
      name: "statementDate",
      key: "statementDate",
      level: "document",
      kind: "date",
      required: true,
      description: "Statement date (YYYY-MM-DD)"
    },
    {
      name: "currency",
      key: "currency",
      level: "document",
      kind: "currency",
      required: true,
      description: "Account currency (ISO 4217)"
    },
    {
      name: "openingBalance",
      key: "openingBalance",
      level: "document",
      kind: "decimal",
      required: true,
      description: "Opening balance"
    },
    {
      name: "closingBalance",
      key: "closingBalance",
      level: "document",
      kind: "decimal",
      required: true,
      description: "Closing balance"
    },
    {
      name: "valueDate",
      key: "valueDate",
      level: "line",
      kind: "date",
      required: true,
      description: "Value date (YYYY-MM-DD)"
    },
    {
      name: "bookingDate",
      key: "bookingDate",
      level: "line",
      kind: "date",
      required: false,
      description: "Booking date (YYYY-MM-DD)"
    },
    {
      name: "amount",
      key: "amount",
      level: "line",
      kind: "decimal",
      required: true,
      description: "Signed amount: in positive, out negative"
    },
    {
      name: "description",
      key: "description",
      level: "line",
      kind: "text",
      required: true,
      description: "Narrative"
    },
    {
      name: "reference",
      key: "reference",
      level: "line",
      kind: "code",
      required: false,
      description: "Bank or counterparty reference"
    },
    {
      name: "counterparty",
      key: "counterparty",
      level: "line",
      kind: "text",
      required: false,
      description: "Counterparty name"
    },
    {
      name: "lineRef",
      key: "lineRef",
      level: "line",
      kind: "code",
      required: false,
      description: "The source's line reference"
    }
  ]
};

/** The prefix of dimension keys in a transformation's output: "dimensions.Department". */
export const DIMENSION_KEY_PREFIX = "dimensions.";
