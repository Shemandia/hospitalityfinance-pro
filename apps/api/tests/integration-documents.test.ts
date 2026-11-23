import { describe, expect, it } from "vitest";
import { asContractValue, buildGlDocuments } from "../src/jobs/integration-documents.js";

describe("asContractValue", () => {
  it("writes numbers as plain decimals, without floating-point noise", () => {
    expect(asContractValue(0.1 + 0.2)).toBe("0.3");
    expect(asContractValue(385000)).toBe("385000");
    expect(asContractValue(-12.5)).toBe("-12.5");
    expect(asContractValue(500000 / 1000)).toBe("500");
    // Beyond what the ledger holds: not a plain decimal, so the contract refuses it.
    expect(asContractValue(1e21)).toBe("1e+21");
  });

  it("writes dates as YYYY-MM-DD and treats blanks as absent", () => {
    expect(asContractValue(new Date(Date.UTC(2026, 3, 14)))).toBe("2026-04-14");
    expect(asContractValue("  ")).toBeUndefined();
    expect(asContractValue(null)).toBeUndefined();
    expect(asContractValue(Number.NaN)).toBeUndefined();
    expect(asContractValue(" EZZ ")).toBe("EZZ");
  });
});

describe("buildGlDocuments", () => {
  const rec = (ref: string, account: string, extra: Record<string, unknown> = {}) => ({
    entityCode: "EZZ",
    sourceDocumentRef: ref,
    documentDate: "2026-04-14",
    currency: "TZS",
    accountCode: account,
    ...extra
  });

  it("groups by entity and reference in file order, one line per record", () => {
    const { documents, errors } = buildGlDocuments(
      [
        rec("A", "1200", {
          debit: 10,
          "dimensions.Department": "ROOMS",
          journalDescription: "Night audit",
          description: "Room"
        }),
        rec("B", "1200", { amount: 5 }),
        rec("A", "4000", { credit: 10, "dimensions.Department": "ROOMS", "dimensions.Market": "" }),
        { ...rec("A", "9100", { statValue: 212 }), entityCode: "DOH" }
      ],
      { sourceSystem: "OPERA" }
    );
    expect(errors).toEqual([]);
    expect(
      documents.map((d) => [d.document.entityCode, d.document.sourceDocumentRef, d.recordIndices])
    ).toEqual([
      ["EZZ", "A", [0, 2]],
      ["EZZ", "B", [1]],
      ["DOH", "A", [3]]
    ]);
    expect(documents[0]!.document).toMatchObject({
      sourceSystem: "OPERA",
      description: "Night audit",
      lines: [
        {
          accountCode: "1200",
          debit: "10",
          description: "Room",
          dimensions: { Department: "ROOMS" }
        },
        { accountCode: "4000", credit: "10", dimensions: { Department: "ROOMS" } }
      ]
    });
    expect(documents[1]!.document.lines).toEqual([{ accountCode: "1200", amount: "5" }]);
  });

  it("reports records without a key, and every record of a document whose fields disagree", () => {
    const { documents, errors } = buildGlDocuments(
      [
        rec("", "1200"),
        rec("A", "1200", { currency: "TZS" }),
        rec("A", "4000", { currency: "USD" }),
        rec("B", "1")
      ],
      { sourceSystem: "OPERA" }
    );
    expect(documents.map((d) => d.document.sourceDocumentRef)).toEqual(["B"]);
    expect(errors.map((e) => [e.recordIndex, e.code])).toEqual([
      [0, "MISSING_DOCUMENT_KEY"],
      [1, "CONFLICTING_DOCUMENT_FIELD"],
      [2, "CONFLICTING_DOCUMENT_FIELD"]
    ]);
    expect(errors[1]!.message).toBe("currency is TZS on one record of A and USD on another");
  });
});
