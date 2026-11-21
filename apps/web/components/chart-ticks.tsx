"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * Axis labels that wrap instead of being cut.
 *
 * Category names (departments, customers) are shown in full: long ones wrap
 * onto further lines, and the chart's margin is sized from the labels it
 * actually has, so nothing is clipped at the edge of the SVG.
 */

/** The fields of nivo's AxisTickProps this tick reads (@nivo/axes is not a direct dependency). */
type TickProps = {
  value: string | number;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
  textX: number;
  textY: number;
  textAnchor: string;
  theme: { line: CSSProperties; text: CSSProperties };
};

const CHAR_WIDTH = 6.2; // px per character at the axis font (11px)
const LINE_HEIGHT = 13; // px per wrapped line

/** Greedy word wrap; a single word longer than `maxChars` keeps its own line. */
export function wrapLabel(text: string, maxChars: number): string[] {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= maxChars) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines.length > 0 ? lines : [""];
}

/** Left margin for a horizontal bar chart whose category labels wrap at `maxChars`. */
export function categoryAxisWidth(labels: readonly string[], maxChars: number): number {
  const widest = Math.max(
    0,
    ...labels.flatMap((label) => wrapLabel(label, maxChars).map((line) => line.length))
  );
  return Math.ceil(widest * CHAR_WIDTH) + 16;
}

/** Bottom margin for a vertical bar chart whose category labels wrap at `maxChars`. */
export function categoryAxisHeight(labels: readonly string[], maxChars: number): number {
  const lines = Math.max(1, ...labels.map((label) => wrapLabel(label, maxChars).length));
  return lines * LINE_HEIGHT + 14;
}

/** A nivo `renderTick` that draws the tick's label wrapped at `maxChars`. */
export function wrappedTick(maxChars: number) {
  return function WrappedTick(tick: TickProps) {
    const lines = wrapLabel(String(tick.value), maxChars);
    const bottomAxis = tick.textAnchor === "middle";
    // Bottom axis: lines go down from the tick. Side axis: centred on the tick.
    const firstDy = bottomAxis ? 0 : -((lines.length - 1) * LINE_HEIGHT) / 2;
    return (
      <g transform={`translate(${tick.x},${tick.y})`}>
        <line x1={0} x2={tick.lineX} y1={0} y2={tick.lineY} style={tick.theme.line} />
        <text
          textAnchor={tick.textAnchor as "start" | "middle" | "end"}
          dominantBaseline={bottomAxis ? "hanging" : "central"}
          transform={`translate(${tick.textX},${tick.textY})`}
          style={tick.theme.text}
        >
          {lines.map((line, i) => (
            <tspan key={i} x={0} dy={i === 0 ? firstDy : LINE_HEIGHT}>
              {line}
            </tspan>
          ))}
          <title>{String(tick.value)}</title>
        </text>
      </g>
    );
  };
}

/**
 * The rendered width of an element, kept current as it resizes (0 before the
 * first measure). A callback ref, so an element that mounts later (after the
 * data loads) is measured too.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/**
 * Whether a vertical bar chart's categories are too narrow for their labels,
 * so the chart should lie on its side and give the labels a full line.
 */
export function needsHorizontalBars(
  chartWidth: number,
  categories: number,
  maxChars: number,
  sideMargins = 76
): boolean {
  if (chartWidth <= 0 || categories === 0) return false;
  return (chartWidth - sideMargins) / categories < maxChars * CHAR_WIDTH;
}
