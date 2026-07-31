/**
 * Payment file content for a zero-decimal currency.
 *
 * The unit tests in currency-decimals.test.ts prove the formatting helpers;
 * these prove the three payment formats actually use them. What matters is the
 * bytes the bank receives, so these assert on generated file content.
 *
 * buildPaymentFile is private and pure — it takes the run, the entries and a
 * decimals map — so it is exercised directly rather than through the storage
 * and tenant-context machinery that surrounds file generation.
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "../src/db/client.js";
import { APService } from "../src/modules/ap/service.js";

const D = (v: string) => new Prisma.Decimal(v);

function entry(currency: string, amount: string) {
  return {
    supplierName: "Zanzibar Supplies Ltd",
    supplierCode: "ZSL",
    currency,
    amount: D(amount),
    reference: "PR-0001",
    supplierBankAccount: "0123456789",
    supplierBankName: "CRDB Bank",
    supplierBankSwift: "CORUTZTZ",
    remittanceInfo: "Payment for 3 invoices"
  };
}

/** buildPaymentFile is private; reach it directly for a pure-function test. */
function build(format: string, entries: ReturnType<typeof entry>[], decimals: Map<string, number>) {
  const service = new APService({} as never);
  return (service as any).buildPaymentFile(
    { id: "run-1", bankFileFormat: format },
    entries,
    decimals
  ) as { extension: string; content: string };
}

const TZS_ZERO = new Map([["TZS", 0]]);
const USD_TWO = new Map([["USD", 2]]);

describe("payment files — zero-decimal currency (TZS)", () => {
  it("CSV writes whole shillings with no phantom cents", () => {
    const { extension, content } = build("CSV", [entry("TZS", "402500")], TZS_ZERO);
    expect(extension).toBe("csv");
    expect(content).toContain('"402500"');
    expect(content).not.toContain("402500.00");
  });

  it("pain.001 writes whole shillings in InstdAmt and CtrlSum", () => {
    const { extension, content } = build("PAIN001", [entry("TZS", "402500")], TZS_ZERO);
    expect(extension).toBe("xml");
    expect(content).toContain('<InstdAmt Ccy="TZS">402500</InstdAmt>');
    expect(content).toContain("<CtrlSum>402500</CtrlSum>");
    expect(content).not.toContain("402500.00");
  });

  it("MT103 keeps the mandatory comma but drops the fractional digits", () => {
    // The audit's failure case: the bank file carried "402500,00".
    const { extension, content } = build("SWIFT_MT103", [entry("TZS", "402500")], TZS_ZERO);
    expect(extension).toBe("mt103");
    expect(content).toContain("TZS402500,");
    expect(content).not.toContain("402500,00");
  });
});

describe("payment files — two-decimal currency (USD)", () => {
  it("CSV and pain.001 still use a period with two decimals", () => {
    const csv = build("CSV", [entry("USD", "1234.5")], USD_TWO);
    expect(csv.content).toContain('"1234.50"');

    const xml = build("PAIN001", [entry("USD", "1234.5")], USD_TWO);
    expect(xml.content).toContain('<InstdAmt Ccy="USD">1234.50</InstdAmt>');
  });

  it("MT103 uses a comma, as SWIFT field 32A requires", () => {
    const { content } = build("SWIFT_MT103", [entry("USD", "1234.5")], USD_TWO);
    expect(content).toContain("USD1234,50");
    // A period here would be a malformed 32A.
    expect(content).not.toContain("USD1234.50");
  });
});

describe("payment files — unknown currency", () => {
  it("defaults to two decimals rather than dropping precision", () => {
    const csv = build("CSV", [entry("XYZ", "10.25")], new Map());
    expect(csv.content).toContain('"10.25"');
  });
});
