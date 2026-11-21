/**
 * The Revenue Mix pie's slices: one colour per department, never repeated.
 *
 * The colours are a categorical palette checked for colour-blind and
 * normal-vision separation between neighbouring slices, including the last
 * slice against the first (a pie closes on itself). Seven is the most one
 * pie shows: with more departments the seven largest keep a colour and the
 * rest are one grey "Other" slice, which names them in the legend.
 * Slices keep the API's department order (the USALI order), "Other" last.
 */

/** In this order every pie of 2 to 7 slices passes the checks; do not cycle it. */
export const REVENUE_MIX_COLORS = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#e34948" // red
] as const;

/** The "Other" slice: neutral, so it never reads as one more department. */
export const OTHER_COLOR = "#94a3b8";

export type RevenueMixSlice = {
  id: string;
  label: string;
  value: number;
  color: string;
  /** For "Other": the departments it holds. */
  members?: string[];
};

export function revenueMixSlices(
  departments: ReadonlyArray<{ name: string; revenue: string | number }>
): RevenueMixSlice[] {
  const withRevenue = departments
    .map((d) => ({ name: d.name, value: Number(d.revenue) }))
    .filter((d) => Number.isFinite(d.value) && d.value > 0);

  let shown = withRevenue;
  let others: typeof withRevenue = [];
  if (withRevenue.length > REVENUE_MIX_COLORS.length) {
    const largest = new Set(
      [...withRevenue]
        .sort((a, b) => b.value - a.value)
        .slice(0, REVENUE_MIX_COLORS.length)
        .map((d) => d.name)
    );
    shown = withRevenue.filter((d) => largest.has(d.name));
    others = withRevenue.filter((d) => !largest.has(d.name));
  }

  const slices: RevenueMixSlice[] = shown.map((d, i) => ({
    id: d.name,
    label: d.name,
    value: d.value,
    color: REVENUE_MIX_COLORS[i]!
  }));
  if (others.length > 0) {
    slices.push({
      id: "__other__",
      label: "Other",
      value: others.reduce((sum, d) => sum + d.value, 0),
      color: OTHER_COLOR,
      members: others.map((d) => d.name)
    });
  }
  return slices;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** The ink for a label drawn on a slice: dark or white, whichever contrasts more. */
export function labelInkOn(hex: string): string {
  const l = luminance(hex);
  const onDark = (l + 0.05) / (luminance("#0b0b0b") + 0.05);
  const onWhite = 1.05 / (l + 0.05);
  return onDark >= onWhite ? "#0b0b0b" : "#ffffff";
}
