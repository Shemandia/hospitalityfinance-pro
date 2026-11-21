/** Chart category labels wrap and size the chart's margin; they are never cut. */
import { describe, expect, it } from "vitest";
import {
  categoryAxisHeight,
  categoryAxisWidth,
  needsHorizontalBars,
  wrapLabel
} from "../components/chart-ticks";

describe("chart labels", () => {
  it("wrap on word boundaries and keep every word", () => {
    expect(wrapLabel("Other Operated Departments", 14)).toEqual(["Other Operated", "Departments"]);
    expect(wrapLabel("Rooms", 14)).toEqual(["Rooms"]);
    expect(wrapLabel("Food & Beverage", 14)).toEqual(["Food &", "Beverage"]);
    expect(wrapLabel("Supercalifragilistic", 8)).toEqual(["Supercalifragilistic"]);
  });

  it("size the side axis from the widest wrapped line", () => {
    expect(categoryAxisWidth(["Rooms", "Other Operated Departments"], 14)).toBeGreaterThan(
      categoryAxisWidth(["Rooms"], 14)
    );
  });

  it("size the bottom axis from the most wrapped label", () => {
    expect(categoryAxisHeight(["Rooms"], 14)).toBeLessThan(
      categoryAxisHeight(["Rooms", "Other Operated Departments"], 14)
    );
  });

  it("lay bars down only when the categories are narrower than their labels", () => {
    expect(needsHorizontalBars(900, 6, 14)).toBe(false);
    expect(needsHorizontalBars(350, 6, 14)).toBe(true);
    expect(needsHorizontalBars(0, 6, 14)).toBe(false);
  });
});
