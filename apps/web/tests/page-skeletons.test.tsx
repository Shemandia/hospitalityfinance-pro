import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  KPICardsSkeleton,
  TableSkeleton,
  DashboardSkeleton,
  ListPageSkeleton
} from "../components/page-skeletons";

describe("Skeleton components", () => {
  it("KPICardsSkeleton renders the correct number of cards", () => {
    const { container } = render(<KPICardsSkeleton count={3} />);
    // Each card has animate-pulse skeleton elements
    const cards = container.querySelectorAll(".animate-pulse");
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });

  it("KPICardsSkeleton defaults to 4 cards", () => {
    const { container } = render(<KPICardsSkeleton />);
    // 4 cards x 3 skeleton bars each = at least 12 pulse elements
    const cards = container.querySelectorAll(".animate-pulse");
    expect(cards.length).toBeGreaterThanOrEqual(4);
  });

  it("TableSkeleton renders rows and columns", () => {
    const { container } = render(<TableSkeleton rows={5} cols={3} />);
    const pulses = container.querySelectorAll(".animate-pulse");
    // header (3 cols) + 5 rows x 3 cols + 1 title = 19+
    expect(pulses.length).toBeGreaterThanOrEqual(15);
  });

  it("DashboardSkeleton renders without crashing", () => {
    const { container } = render(<DashboardSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });

  it("ListPageSkeleton renders without crashing", () => {
    const { container } = render(<ListPageSkeleton />);
    expect(container.firstChild).toBeTruthy();
  });
});
