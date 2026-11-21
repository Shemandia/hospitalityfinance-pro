/** Revenue Mix: every department in a pie has its own colour; the rest fold into "Other". */
import { describe, expect, it } from "vitest";
import { labelInkOn, OTHER_COLOR, REVENUE_MIX_COLORS, revenueMixSlices } from "../lib/revenue-mix";

const USALI = [
  "Rooms",
  "Food & Beverage",
  "Other Operated Departments",
  "Miscellaneous Income",
  "Spa & Wellness",
  "Golf",
  "Parking",
  "Retail",
  "Telecommunications",
  "Rentals",
  "Laundry",
  "Minor Operated"
];
const dept = (name: string, revenue: number) => ({ name, revenue: String(revenue) });

describe("revenueMixSlices", () => {
  it("gives each department its own colour, in the API's order", () => {
    const slices = revenueMixSlices(USALI.slice(0, 7).map((n, i) => dept(n, 1000 - i)));
    expect(slices.map((s) => s.label)).toEqual(USALI.slice(0, 7));
    expect(slices.map((s) => s.color)).toEqual([...REVENUE_MIX_COLORS]);
    expect(new Set(slices.map((s) => s.color)).size).toBe(7);
  });

  it("never repeats a colour: past seven, the smallest fold into a grey Other", () => {
    // Twelve departments; Golf and Retail are among the largest despite their place in the list.
    const revenue: Record<string, number> = { Golf: 900, Retail: 800 };
    const slices = revenueMixSlices(USALI.map((n, i) => dept(n, revenue[n] ?? 1000 - i * 50)));

    expect(slices).toHaveLength(8);
    const coloured = slices.slice(0, 7);
    expect(new Set(coloured.map((s) => s.color)).size).toBe(7);
    expect(coloured.map((s) => s.label)).toEqual([
      "Rooms",
      "Food & Beverage",
      "Other Operated Departments",
      "Miscellaneous Income",
      "Spa & Wellness",
      "Golf",
      "Retail"
    ]);

    const other = slices[7]!;
    expect(other.label).toBe("Other");
    expect(other.color).toBe(OTHER_COLOR);
    expect(other.members).toEqual([
      "Parking",
      "Telecommunications",
      "Rentals",
      "Laundry",
      "Minor Operated"
    ]);
    expect(other.value).toBe(700 + 600 + 550 + 500 + 450);
  });

  it("leaves out departments with no revenue, before choosing colours", () => {
    const slices = revenueMixSlices([
      dept("Rooms", 500),
      dept("Golf", 0),
      dept("Spa & Wellness", -20),
      dept("Retail", 30)
    ]);
    expect(slices.map((s) => [s.label, s.color])).toEqual([
      ["Rooms", REVENUE_MIX_COLORS[0]],
      ["Retail", REVENUE_MIX_COLORS[1]]
    ]);
  });
});

describe("labelInkOn", () => {
  it("puts white on the dark slices and dark ink on the light ones", () => {
    expect(labelInkOn("#008300")).toBe("#ffffff");
    expect(labelInkOn("#eda100")).toBe("#0b0b0b");
    expect(labelInkOn(OTHER_COLOR)).toBe("#0b0b0b");
  });
});
