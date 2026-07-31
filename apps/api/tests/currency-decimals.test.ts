/**
 * Currency decimal places — display and payment-file formatting.
 *
 * P0: every payment format hardcoded 2 decimals, so a 402,500 TZS supplier
 * payment was emitted with phantom cents. TZS is a zero-decimal currency by
 * local convention and Tanzanian banks may reject or misread the fractional
 * digits.
 *
 * The MT103 comma is deliberately NOT a bug and is asserted here so nobody
 * "fixes" it into a period: SWIFT field 32A mandates a comma decimal separator.
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "../src/db/client.js";
import {
  resolveCurrencyDecimals,
  decimalsFor,
  formatAmountPlain,
  formatAmountSwift,
  FALLBACK_ZERO_DECIMAL_CURRENCIES
} from "../src/shared/currency-decimals.js";

const D = (v: string) => new Prisma.Decimal(v);

/** Stand-in for the `currencies` registry. */
function registry(rows: Array<{ code: string; decimalPlaces: number }>) {
  return {
    currency: {
      async findMany({ where }: any) {
        const wanted: string[] = where.code.in;
        return rows.filter((r) => wanted.includes(r.code));
      }
    }
  };
}

describe("resolveCurrencyDecimals", () => {
  it("takes decimal places from the currencies table", async () => {
    const map = await resolveCurrencyDecimals(
      registry([
        { code: "TZS", decimalPlaces: 0 },
        { code: "USD", decimalPlaces: 2 }
      ]),
      ["TZS", "USD"]
    );
    expect(map.get("TZS")).toBe(0);
    expect(map.get("USD")).toBe(2);
  });

  it("lets the registry override the built-in assumption", async () => {
    // If a tenant genuinely transacts TZS with senti, the table wins.
    const map = await resolveCurrencyDecimals(registry([{ code: "TZS", decimalPlaces: 2 }]), [
      "TZS"
    ]);
    expect(map.get("TZS")).toBe(2);
  });

  it("falls back to the zero-decimal list for currencies absent from the table", async () => {
    const map = await resolveCurrencyDecimals(registry([]), ["TZS", "JPY", "USD"]);
    expect(map.get("TZS")).toBe(0);
    expect(map.get("JPY")).toBe(0);
    expect(map.get("USD")).toBe(2);
  });

  it("is case-insensitive and issues one query for many codes", async () => {
    let calls = 0;
    const counting = {
      currency: {
        async findMany() {
          calls++;
          return [{ code: "TZS", decimalPlaces: 0 }];
        }
      }
    };
    const map = await resolveCurrencyDecimals(counting, ["tzs", "TZS", "usd"]);
    expect(calls).toBe(1);
    expect(decimalsFor(map, "tzs")).toBe(0);
    expect(decimalsFor(map, "USD")).toBe(2);
  });

  it("includes TZS in the fallback list", () => {
    expect(FALLBACK_ZERO_DECIMAL_CURRENCIES.has("TZS")).toBe(true);
  });
});

describe("formatAmountPlain — CSV and ISO 20022 pain.001", () => {
  it("writes a zero-decimal currency with no fractional digits", () => {
    expect(formatAmountPlain(D("402500"), 0)).toBe("402500");
  });

  it("writes a two-decimal currency unchanged", () => {
    expect(formatAmountPlain(D("1234.5"), 2)).toBe("1234.50");
  });

  it("uses a period, which is what pain.001 requires", () => {
    expect(formatAmountPlain(D("1234.56"), 2)).toContain(".");
    expect(formatAmountPlain(D("1234.56"), 2)).not.toContain(",");
  });

  it("rounds rather than truncates at the currency's precision", () => {
    expect(formatAmountPlain(D("402500.6"), 0)).toBe("402501");
  });
});

describe("formatAmountSwift — MT103 field 32A", () => {
  it("keeps the mandatory comma with no digits after it for a zero-decimal currency", () => {
    // 32A is 6!n3!a15d and the comma must be present even when the currency
    // has no fractional digits. "402500" without it is a malformed field.
    expect(formatAmountSwift(D("402500"), 0)).toBe("402500,");
  });

  it("uses a comma, not a period, for a two-decimal currency", () => {
    expect(formatAmountSwift(D("1234.56"), 2)).toBe("1234,56");
  });

  it("never emits a period", () => {
    for (const [amount, decimals] of [
      ["402500", 0],
      ["1234.56", 2],
      ["0.05", 2]
    ] as Array<[string, number]>) {
      expect(formatAmountSwift(D(amount), decimals)).not.toContain(".");
    }
  });

  it("no longer pads a shilling amount with phantom cents", () => {
    // The reported failure: 402,500 TZS went out as "402500,00".
    expect(formatAmountSwift(D("402500"), 0)).not.toBe("402500,00");
  });
});
