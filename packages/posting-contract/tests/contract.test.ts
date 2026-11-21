import { describe, expect, it } from "vitest";
import {
  ContractErrorCode,
  DOCUMENT_FIELDS,
  fromScaled,
  toScaled,
  validateBankStatement,
  validateDocument,
  validateGlJournal
} from "../src/index.js";

const journal = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 1,
  documentType: "GL_JOURNAL",
  sourceSystem: "OPERA",
  sourceDocumentRef: "EZZ-2026-10-14-FIDEL",
  documentDate: "2026-10-14",
  entityCode: "EZZ",
  currency: "TZS",
  lines: [
    { accountCode: "1200", debit: "1180000", dimensions: { Department: "ROOMS" } },
    { accountCode: "4000", credit: "1000000", dimensions: { Department: "ROOMS" } },
    { accountCode: "2300", amount: "-180000.00" }
  ],
  ...overrides
});

const codes = (result: ReturnType<typeof validateGlJournal>) =>
  result.ok ? [] : result.errors.map((e) => e.code);

describe("GL journal contract v1", () => {
  it("accepts a balanced journal and normalises every line to debit and credit", () => {
    const result = validateGlJournal(journal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.total).toBe("1180000");
    expect(result.document.lines).toEqual([
      {
        lineNumber: 1,
        accountCode: "1200",
        debit: "1180000",
        credit: "0",
        dimensions: { Department: "ROOMS" }
      },
      {
        lineNumber: 2,
        accountCode: "4000",
        debit: "0",
        credit: "1000000",
        dimensions: { Department: "ROOMS" }
      },
      { lineNumber: 3, accountCode: "2300", debit: "0", credit: "180000", dimensions: {} }
    ]);
  });

  it("refuses an unbalanced journal, exactly, with no float rounding", () => {
    expect(
      codes(
        validateGlJournal(
          journal({
            lines: [
              { accountCode: "1200", debit: "0.1" },
              { accountCode: "1201", debit: "0.2" },
              { accountCode: "4000", credit: "0.3" }
            ]
          })
        )
      )
    ).toEqual([]);
    const result = validateGlJournal(
      journal({
        lines: [
          { accountCode: "1200", debit: "100.0001" },
          { accountCode: "4000", credit: "100" }
        ]
      })
    );
    expect(codes(result)).toEqual([ContractErrorCode.UNBALANCED]);
    expect(result.ok ? "" : result.errors[0]!.message).toBe(
      "Debits 100.0001 and credits 100 differ"
    );
  });

  it("accepts a statistics-only journal (no money)", () => {
    const result = validateGlJournal(
      journal({
        lines: [
          { accountCode: "9100", statValue: "212", dimensions: { Department: "ROOMS" } },
          { accountCode: "9110", statValue: "198.5" }
        ]
      })
    );
    expect(result.ok).toBe(true);
  });

  it("refuses badly shaped lines", () => {
    expect(
      codes(
        validateGlJournal(journal({ lines: [{ accountCode: "1200", amount: "1", debit: "1" }] }))
      )
    ).toContain(ContractErrorCode.LINE_SHAPE);
    expect(
      codes(
        validateGlJournal(journal({ lines: [{ accountCode: "1200", debit: "1", credit: "1" }] }))
      )
    ).toContain(ContractErrorCode.LINE_SHAPE);
    expect(codes(validateGlJournal(journal({ lines: [{ accountCode: "1200" }] })))).toContain(
      ContractErrorCode.LINE_SHAPE
    );
    // A zero on the other side is fine.
    expect(
      codes(
        validateGlJournal(journal({ lines: [{ accountCode: "1200", debit: "0", credit: "0" }] }))
      )
    ).toEqual([]);
  });

  it("refuses amounts that are not exact decimals, negative sides, or too many places", () => {
    for (const debit of ["1e5", "12,5", "1.23456", "-1", "abc", "123456789012345"]) {
      expect(
        codes(
          validateGlJournal(
            journal({
              lines: [
                { accountCode: "1", debit },
                { accountCode: "2", credit: "1" }
              ]
            })
          )
        ),
        debit
      ).toContain(ContractErrorCode.INVALID_AMOUNT);
    }
    expect(codes(validateGlJournal(journal({ fxRate: "0" })))).toContain(
      ContractErrorCode.INVALID_AMOUNT
    );
    expect(codes(validateGlJournal(journal({ fxRate: "0.000412345" })))).toContain(
      ContractErrorCode.INVALID_AMOUNT
    );
    expect(validateGlJournal(journal({ fxRate: "0.00041234" })).ok).toBe(true);
  });

  it("refuses dates that do not exist", () => {
    for (const documentDate of ["2026-02-30", "2026-13-01", "14/10/2026", "2026-10-1"]) {
      expect(codes(validateGlJournal(journal({ documentDate }))), documentDate).toEqual([
        ContractErrorCode.INVALID_DATE
      ]);
    }
    expect(validateGlJournal(journal({ documentDate: "2028-02-29" })).ok).toBe(true);
  });

  it("allows ten dimensions on a line, not eleven", () => {
    const dims = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`D${i + 1}`, `C${i + 1}`]));
    const lines = (n: number) => [
      { accountCode: "1200", debit: "1", dimensions: dims(n) },
      { accountCode: "4000", credit: "1" }
    ];
    expect(validateGlJournal(journal({ lines: lines(10) })).ok).toBe(true);
    expect(codes(validateGlJournal(journal({ lines: lines(11) })))).toEqual([
      ContractErrorCode.TOO_MANY_DIMENSIONS
    ]);
  });

  it("requires the identifying fields and refuses fields it does not know", () => {
    const { sourceDocumentRef: _r, ...noRef } = journal();
    const result = validateGlJournal(noRef);
    expect(result.ok ? [] : result.errors.map((e) => [e.code, e.path])).toEqual([
      [ContractErrorCode.INVALID_FIELD, "sourceDocumentRef"]
    ]);
    expect(codes(validateGlJournal(journal({ accountId: "a-uuid" })))).toEqual([
      ContractErrorCode.UNKNOWN_FIELD
    ]);
    expect(
      codes(validateGlJournal(journal({ lines: [{ accountId: "x", debit: "1" }] })))
    ).toContain(ContractErrorCode.UNKNOWN_FIELD);
    expect(codes(validateGlJournal(journal({ currency: "tzs" })))).toEqual([
      ContractErrorCode.INVALID_FIELD
    ]);
    expect(codes(validateGlJournal(journal({ sourceDocumentRef: "x".repeat(101) })))).toEqual([
      ContractErrorCode.INVALID_FIELD
    ]);
  });

  it("refuses another contract version by name", () => {
    expect(codes(validateGlJournal(journal({ contractVersion: 2 })))).toEqual([
      ContractErrorCode.UNSUPPORTED_VERSION
    ]);
  });
});

describe("bank statement contract v1", () => {
  const statement = (overrides: Record<string, unknown> = {}) => ({
    contractVersion: 1,
    documentType: "BANK_STATEMENT",
    sourceSystem: "MT940",
    sourceDocumentRef: "STMT-2026-10-14",
    entityCode: "EZZ",
    bankAccountNumber: "0150123456700",
    statementDate: "2026-10-14",
    currency: "TZS",
    openingBalance: "1000.00",
    closingBalance: "1450.25",
    lines: [
      { valueDate: "2026-10-14", amount: "500.25", description: "Card settlement" },
      { valueDate: "2026-10-14", amount: "-50", description: "Bank charges", reference: "CHG" }
    ],
    ...overrides
  });

  it("accepts a statement whose lines add up", () => {
    expect(validateBankStatement(statement()).ok).toBe(true);
    expect(validateBankStatement(statement({ lines: [], closingBalance: "1000" })).ok).toBe(true);
  });

  it("refuses one that does not add up", () => {
    const result = validateBankStatement(statement({ closingBalance: "1450.26" }));
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual([
      ContractErrorCode.STATEMENT_DOES_NOT_ADD_UP
    ]);
  });
});

describe("documents and fields", () => {
  it("validates by document type, and names an unknown one", () => {
    expect(validateDocument(journal()).ok).toBe(true);
    const result = validateDocument({ documentType: "AP_INVOICE" });
    expect(result.ok ? [] : result.errors.map((e) => e.code)).toEqual([
      ContractErrorCode.UNKNOWN_DOCUMENT_TYPE
    ]);
  });

  it("lists every field of the schema, so mapping screens and the pipeline agree with it", () => {
    const gl = DOCUMENT_FIELDS.GL_JOURNAL.map((f) => `${f.level}:${f.name}`);
    expect(gl).toContain("document:sourceDocumentRef");
    expect(gl).toContain("line:dimensions");
    expect(new Set(gl).size).toBe(gl.length);
  });
});

describe("decimal helpers", () => {
  it("scale and unscale exactly", () => {
    expect(toScaled("-12.5", 4)).toBe(-125000n);
    expect(fromScaled(-125000n, 4)).toBe("-12.5");
    expect(fromScaled(5n, 4)).toBe("0.0005");
    expect(fromScaled(0n, 4)).toBe("0");
    expect(() => toScaled("1.23456", 4)).toThrow(/more than 4/);
  });
});
