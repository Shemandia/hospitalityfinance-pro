import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  fmt,
  fmtCurrency,
  fmtDate,
  fmtDateTime,
  fmtDecimal,
  fmtPct,
  getCurrencyDecimals,
  isZeroDecimalCurrency
} from "../lib/format";

describe("format", () => {
  it("formats numbers with default en-US locale", () => {
    expect(DEFAULT_LOCALE).toBe("en-US");
    expect(fmt(1234.5)).toBe("1,235");
    expect(fmt(1234.5, 2)).toBe("1,234.50");
    expect(fmtDecimal(1234.5)).toBe("1,234.50");
  });

  it("accepts explicit locale for number formatting", () => {
    expect(fmt(1234.5, 2, "de-DE")).toBe("1.234,50");
    expect(fmtDecimal(1234.5, 2, "de-DE")).toBe("1.234,50");
    expect(fmtPct(72.34, 1, "de-DE")).toBe("72,3%");
  });

  it("resolves currency decimals from registry with zero-decimal fallback", () => {
    expect(isZeroDecimalCurrency("TZS")).toBe(true);
    expect(isZeroDecimalCurrency("tzs")).toBe(true);
    expect(getCurrencyDecimals("TZS")).toBe(0);
    expect(getCurrencyDecimals("USD")).toBe(2);
    expect(getCurrencyDecimals("USD", 3)).toBe(3);
    expect(getCurrencyDecimals("TZS", 2)).toBe(2);
  });

  it("formats currency using resolved decimals and locale", () => {
    expect(fmtCurrency(1234, "USD")).toContain("1,234.00");
    expect(fmtCurrency(1234, "TZS")).not.toMatch(/\.00/);
    expect(fmtCurrency(1234.5, "USD", 3)).toContain("1,234.500");
  });

  it("returns en dash for empty values and formats dates", () => {
    expect(fmt(null)).toBe("–");
    expect(fmtCurrency(undefined, "USD")).toBe("–");
    expect(fmtDate(null)).toBe("–");
    expect(fmtDateTime(undefined)).toBe("–");
    expect(fmtDate("2026-03-15T10:30:00Z", "en-US", "UTC")).toContain("2026");
    expect(fmtDateTime("2026-03-15T10:30:00Z", "en-US", "UTC")).toContain("2026");
  });
});
